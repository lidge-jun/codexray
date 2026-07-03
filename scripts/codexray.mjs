#!/usr/bin/env node
// codexray CLI — run Codex from Claude Code with live progress + token visibility.
//
// Subcommands:
//   run [prompt]     run a Codex task (blocking; Claude launches it via Bash
//                    run_in_background). --detach self-detaches for non-subagent
//                    callers and returns a job id immediately.
//   status [jobId]   show status + progress tail (latest job if omitted)
//   result [jobId]   print the final Codex answer
//   cancel [jobId]   terminate a running job
//   list             list recent jobs
//   doctor           check the codex binary, version, and data dir
//   _worker          (internal) detached worker entrypoint
//
// Global: --json for machine-readable output where applicable.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { newJobId, jobPaths, resolveDataDir } from './lib/paths.mjs';
import { resolveCodexBin, findOnPath } from './lib/codex-bin.mjs';
import { initState, writeState, readState, readResult, listJobs, pruneJobs } from './lib/job-store.mjs';
import { executeRun } from './lib/exec-runner.mjs';
import { renderStatus, renderResult, renderList } from './lib/render.mjs';

const SELF = fileURLToPath(import.meta.url);
const BOOLEAN_FLAGS = new Set([
  'fast', 'detach', 'json', 'resume-last', 'no-disable-codexclaw', 'help', 'h', 'all', 'read-only', 'follow',
]);

/**
 * Minimal long-flag + positional parser (no deps).
 * @param {string[]} argv
 * @returns {{ _: string[], [k: string]: string | boolean | string[] }}
 */
function parseArgs(argv) {
  /** @type {any} */
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        args[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(body)) {
        args[body] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args[body] = next;
          i += 1;
        } else {
          args[body] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** @param {string} msg @returns {never} */
function fail(msg) {
  process.stderr.write(`codexray: ${msg}\n`);
  process.exit(2);
}

/** @returns {Promise<string>} */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/**
 * @param {any} args
 * @returns {Promise<string>}
 */
async function resolvePrompt(args) {
  const positional = args._.slice(1);
  if (positional.length && positional[0] !== '-') return positional.join(' ');
  return (await readStdin()).trim();
}

/**
 * @param {unknown} v
 * @returns {'read-only'|'workspace-write'|'danger-full-access'}
 */
function normalizeSandbox(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'read-only' || s === 'read' || s === 'ro') return 'read-only';
  if (s === 'danger-full-access' || s === 'full' || s === 'danger') return 'danger-full-access';
  return 'workspace-write';
}

/** @param {any} args @returns {string | null} */
function jobArg(args) {
  const positional = args._.slice(1);
  if (positional.length) return positional[0];
  const latest = listJobs({ limit: 1 });
  return latest.length ? latest[0].id : null;
}

/** @param {import('./lib/exec-runner.mjs').RunOptions & { prompt: string }} opts */
function buildRunOptions(opts) {
  return opts;
}

/** @param {any} args */
async function cmdRun(args) {
  const prompt = await resolvePrompt(args);
  if (!prompt) fail('run requires a prompt (positional arg or piped via stdin)');

  const model = args.model ? String(args.model) : 'default';
  const effort = args.effort ? String(args.effort) : '';
  const sandbox = args['read-only'] ? 'read-only' : normalizeSandbox(args.sandbox);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const claudeSessionId = process.env.CODEXRAY_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  const spark = /spark/i.test(model);

  let resumeSessionId = args.resume ? String(args.resume) : null;
  if (args['resume-last']) {
    const prior = listJobs({ claudeSessionId: claudeSessionId ?? undefined })
      .find((j) => j.sessionId);
    resumeSessionId = prior ? prior.sessionId : null;
    if (!resumeSessionId) fail('--resume-last: no prior job with a session id found');
  }

  const jobId = newJobId();
  const state = initState({ id: jobId, model, effort, cwd, claudeSessionId });
  writeState(state);
  fs.writeFileSync(jobPaths(jobId).progress, '');

  /** @type {import('./lib/exec-runner.mjs').RunOptions} */
  const opts = buildRunOptions({
    prompt,
    model,
    effort,
    resumeSessionId,
    sandbox,
    fastMode: !!args.fast,
    disableCodexclaw: !args['no-disable-codexclaw'],
    outputSchema: args['output-schema'] ? String(args['output-schema']) : null,
    codexBin: args['codex-bin'] ? String(args['codex-bin']) : null,
    spark,
  });

  if (args.detach) {
    const workerFile = path.join(jobPaths(jobId).dir, `${jobId}.worker.json`);
    fs.writeFileSync(workerFile, JSON.stringify({ opts }));
    const child = spawn(process.execPath, [SELF, '_worker', '--job-id', jobId], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CODEXRAY_WORKER: '1', CODEXRAY_FOREGROUND: '0' },
    });
    child.unref();
    const p = jobPaths(jobId);
    const launch = {
      jobId,
      status: 'running',
      progressPath: p.progress,
      statePath: p.state,
      resultPath: p.result,
      hint: `tail progressPath with Read to watch live; run 'codexray result ${jobId}' when done`,
    };
    process.stdout.write(args.json
      ? `${JSON.stringify(launch, null, 2)}\n`
      : `codexray job ${jobId} started (detached).\nProgress: ${p.progress}\nResult later: codexray result ${jobId}\n`);
    return 0;
  }

  // Emit a job header on stderr immediately so a caller that launched this via
  // Bash run_in_background can learn the progress-file path (from the combined
  // output) without a second call, while stdout stays a clean result payload.
  const p = jobPaths(jobId);
  process.stderr.write(`${JSON.stringify({ codexray: 'job', jobId, progressPath: p.progress, resultPath: p.result })}\n`);

  const { result } = await executeRun(state, opts);
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderResult(result)}\n`);
  pruneJobs();
  return result.status === 'completed' ? 0 : 1;
}

/** @param {any} args */
async function cmdWorker(args) {
  const jobId = args['job-id'] ? String(args['job-id']) : '';
  if (!jobId) fail('_worker requires --job-id');
  const state = readState(jobId);
  if (!state) fail(`_worker: no state for job ${jobId}`);
  const workerFile = path.join(jobPaths(jobId).dir, `${jobId}.worker.json`);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(workerFile, 'utf8'));
  } catch {
    fail(`_worker: cannot read worker spec ${workerFile}`);
  }
  const { result } = await executeRun(/** @type {any} */ (state), spec.opts);
  try { fs.rmSync(workerFile, { force: true }); } catch { /* ignore */ }
  pruneJobs();
  return result.status === 'completed' ? 0 : 1;
}

/** @param {any} args */
function cmdStatus(args) {
  const jobId = jobArg(args);
  if (!jobId) fail('no jobs found');
  const state = readState(jobId);
  if (!state) fail(`no such job: ${jobId}`);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderStatus(state, { tail: args.tail ? Number(args.tail) : 12 })}\n`);
  }
  return 0;
}

/** @param {any} args */
function cmdResult(args) {
  const jobId = jobArg(args);
  if (!jobId) fail('no jobs found');
  const result = readResult(jobId);
  const state = readState(jobId);
  if (!result) {
    if (state && state.status === 'running') {
      process.stdout.write('(job still running — no result yet)\n');
      return 0;
    }
    fail(`no result for job: ${jobId}`);
  }
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderResult(result)}\n`);
  return 0;
}

/** @param {any} args */
function cmdCancel(args) {
  const jobId = jobArg(args);
  if (!jobId) fail('no jobs found');
  const state = readState(jobId);
  if (!state) fail(`no such job: ${jobId}`);
  if (state.status !== 'running') {
    process.stdout.write(`job ${jobId} is not running (${state.status})\n`);
    return 0;
  }
  if (state.pid) {
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  state.status = 'cancelled';
  state.phase = 'cancelled';
  state.lastError = 'cancelled by user';
  state.endedAt = new Date().toISOString();
  writeState(state);
  process.stdout.write(`cancelled ${jobId}\n`);
  return 0;
}

/**
 * Tail a job's progress file. Without --follow prints the current contents once.
 * With --follow, streams successive running jobs' progress until killed — this
 * powers the optional plugin monitor.
 * @param {any} args
 * @returns {Promise<number>}
 */
async function cmdWatch(args) {
  const follow = !!args.follow;
  if (!follow) {
    const positional = args._.slice(1);
    const jobId = positional.length ? positional[0] : (listJobs({ limit: 1 })[0]?.id ?? null);
    if (!jobId) fail('no job to watch');
    const state = readState(jobId);
    if (!state) fail(`no such job: ${jobId}`);
    try { process.stdout.write(fs.readFileSync(state.progressPath, 'utf8')); } catch { /* empty */ }
    return 0;
  }
  // Persistent monitor loop: tail each running job as it appears.
  let currentId = /** @type {string | null} */ (null);
  let offset = 0;
  await new Promise(() => {
    setInterval(() => {
      if (!currentId) {
        const running = listJobs().find((j) => j.status === 'running');
        if (running) { currentId = running.id; offset = 0; }
      }
      if (currentId) {
        const s = readState(currentId);
        const pp = s ? s.progressPath : null;
        if (pp) {
          try {
            const buf = fs.readFileSync(pp);
            if (buf.length > offset) { process.stdout.write(buf.subarray(offset)); offset = buf.length; }
          } catch { /* not yet */ }
        }
        if (!s || s.status !== 'running') currentId = null;
      }
    }, 500);
  });
  return 0; // unreachable; the harness kills the monitor at session end
}

/** @param {any} args */
function cmdList(args) {
  const jobs = listJobs({ limit: args.limit ? Number(args.limit) : 30 });
  process.stdout.write(args.json ? `${JSON.stringify(jobs, null, 2)}\n` : `${renderList(jobs)}\n`);
  return 0;
}

/** @param {any} args */
function cmdDoctor(args) {
  /** @type {any} */
  const report = { ok: true, checks: {} };
  try {
    const resolved = resolveCodexBin({ codexBin: args['codex-bin'] ? String(args['codex-bin']) : undefined });
    report.checks.codexBin = { bin: resolved.bin, version: resolved.version, source: resolved.source };
    if (!resolved.version) { report.ok = false; report.checks.codexBin.warning = 'could not read codex version'; }
  } catch (err) {
    report.ok = false;
    report.checks.codexBin = { error: err instanceof Error ? err.message : String(err) };
  }
  const all = collectCodexOnPath();
  report.checks.codexOnPath = all;
  if (all.length > 1) report.checks.multipleInstalls = `found ${all.length} codex binaries — using the first; pin CODEX_BIN to be explicit`;
  const dataDir = resolveDataDir();
  let writable = false;
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK); writable = true; } catch { /* not writable */ }
  report.checks.dataDir = { path: dataDir, writable };
  if (!writable) report.ok = false;
  report.checks.node = process.version;

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const c = report.checks;
    process.stdout.write([
      `codexray doctor — ${report.ok ? 'OK' : 'PROBLEMS FOUND'}`,
      `codex     ${c.codexBin?.bin || c.codexBin?.error} (${c.codexBin?.version || 'version?'}, via ${c.codexBin?.source || 'n/a'})`,
      c.multipleInstalls ? `warning   ${c.multipleInstalls}` : `installs  ${all.length}`,
      `data dir  ${c.dataDir.path} (${c.dataDir.writable ? 'writable' : 'NOT writable'})`,
      `node      ${c.node}`,
    ].join('\n') + '\n');
  }
  return report.ok ? 0 : 1;
}

/** @returns {string[]} */
function collectCodexOnPath() {
  const seen = new Set();
  const out = [];
  const first = findOnPath('codex');
  if (first) { seen.add(first); out.push(first); }
  // scan remaining PATH dirs for other codex binaries
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    try {
      fs.accessSync(full, fs.constants.X_OK);
      if (!seen.has(full)) { seen.add(full); out.push(full); }
    } catch { /* not here */ }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`codexray — run Codex from Claude Code with live progress + tokens

USAGE
  codexray run [prompt]        run a task (blocking; launch via Bash run_in_background)
  codexray run --detach ...    self-detach and return a job id immediately
  codexray status [jobId]      status + progress tail (latest job if omitted)
  codexray result [jobId]      final Codex answer
  codexray cancel [jobId]      terminate a running job
  codexray watch [jobId]       print progress once, or --follow to stream live
  codexray list                recent jobs
  codexray doctor              check codex binary / version / data dir

RUN OPTIONS
  --model <id>        codex model (default: account default)
  --effort <level>    reasoning effort: minimal|low|medium|high|xhigh
  --sandbox <mode>    read-only | workspace-write (default) | danger-full-access
  --read-only         shortcut for --sandbox read-only
  --fast              service_tier=fast
  --resume <id>       resume a Codex thread/session id
  --resume-last       resume this session's most recent job
  --output-schema <f> JSON Schema file for a structured final answer
  --no-disable-codexclaw   keep the codexclaw plugin enabled (default: disabled)
  --codex-bin <path>  explicit codex binary
  --detach            run in a detached worker, print job id + progress path
  --json              machine-readable output

Prompt may be passed as an argument or piped via stdin.
`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.help || args.h) return printHelp();
  try {
    switch (cmd) {
      case 'run': return await cmdRun(args);
      case '_worker': return await cmdWorker(args);
      case 'status': return cmdStatus(args);
      case 'result': return cmdResult(args);
      case 'cancel': return cmdCancel(args);
      case 'watch': return await cmdWatch(args);
      case 'list': return cmdList(args);
      case 'doctor': return cmdDoctor(args);
      default:
        fail(`unknown command: ${cmd} (try 'codexray --help')`);
        return 2;
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

main().then((code) => process.exit(typeof code === 'number' ? code : 0));
