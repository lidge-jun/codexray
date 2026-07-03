// Core worker: spawn `codex exec --json`, parse the JSONL stream, and maintain
// the tail-able progress log + machine-readable state + result files.
//
// This process IS the worker. In the intended flow the main Claude Code session
// launches `codexray run ...` via Bash run_in_background, so this blocking loop
// does not block Claude; Claude tails the progress file and is auto-rewoken by
// the task-notification when this process exits. (A self-detaching `--detach`
// path is layered on top in codexray.mjs for non-subagent callers.)

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { jobPaths } from './paths.mjs';
import { resolveCodexBin, baseConfigArgs } from './codex-bin.mjs';
import { appendProgress, appendRaw } from './log.mjs';
import { createRunState, reduceEvent, finalMessage } from './events.mjs';
import { writeState, readState, writeResult, usageSnapshot } from './job-store.mjs';

const STATE_WRITE_THROTTLE_MS = 750;

/**
 * @typedef {object} RunOptions
 * @property {string} prompt task text (sent via stdin)
 * @property {string} model model id or 'default'
 * @property {string} effort reasoning effort ('' to leave default)
 * @property {string | null} resumeSessionId resume an existing Codex thread
 * @property {'read-only'|'workspace-write'|'danger-full-access'} sandbox
 * @property {boolean} fastMode service_tier=fast
 * @property {boolean} disableCodexclaw disable the interactive codexclaw plugin
 * @property {string | null} outputSchema path to a JSON schema file
 * @property {string | null} codexBin explicit codex binary
 * @property {boolean} spark model is text-only spark (skip reasoning summary flags)
 */

/**
 * Build argv for a fresh `codex exec` run. Prompt is NOT included (sent via stdin).
 * @param {RunOptions} o
 * @returns {string[]}
 */
export function buildExecArgs(o) {
  /** @type {string[]} */
  const args = [...baseConfigArgs({ disableCodexclaw: o.disableCodexclaw }), 'exec'];
  if (o.model && o.model !== 'default') args.push('-m', o.model);
  if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`);
  if (!o.spark) {
    args.push('-c', 'model_reasoning_summary="detailed"');
    args.push('-c', 'show_raw_agent_reasoning=true');
  }
  args.push('-c', `service_tier="${o.fastMode ? 'fast' : 'default'}"`);
  args.push(...sandboxArgs(o.sandbox));
  args.push('--skip-git-repo-check', '--color', 'never', '--json');
  if (o.outputSchema) args.push('--output-schema', o.outputSchema);
  return args;
}

/**
 * Build argv for a `codex exec resume` run. SESSION_ID is positional; prompt is
 * read from stdin via the `-` sentinel.
 * @param {RunOptions} o
 * @param {string} sessionId
 * @returns {string[]}
 */
export function buildResumeArgs(o, sessionId) {
  /** @type {string[]} */
  const args = [...baseConfigArgs({ disableCodexclaw: o.disableCodexclaw }), 'exec', 'resume'];
  if (o.model && o.model !== 'default') args.push('-m', o.model);
  if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`);
  if (!o.spark) {
    args.push('-c', 'model_reasoning_summary="detailed"');
    args.push('-c', 'show_raw_agent_reasoning=true');
  }
  args.push('-c', `service_tier="${o.fastMode ? 'fast' : 'default'}"`);
  args.push(...sandboxArgs(o.sandbox));
  args.push('--skip-git-repo-check', '--color', 'never');
  args.push(sessionId, '-', '--json');
  return args;
}

/**
 * @param {'read-only'|'workspace-write'|'danger-full-access'} sandbox
 * @returns {string[]}
 */
function sandboxArgs(sandbox) {
  if (sandbox === 'danger-full-access') return ['--dangerously-bypass-approvals-and-sandbox'];
  return ['-s', sandbox, '-c', 'approval_policy="never"'];
}

/**
 * @typedef {object} RunResult
 * @property {string} id
 * @property {'running'|'completed'|'failed'|'cancelled'} status
 * @property {string | null} sessionId
 * @property {number} exitCode
 * @property {string} message
 * @property {object} usage
 * @property {string[]} filesChanged
 * @property {string[]} commands
 * @property {string | null} error
 */

/**
 * Run a Codex task to completion, driving the job's on-disk files.
 * @param {import('./job-store.mjs').JobState} state persisted job state (mutated)
 * @param {RunOptions} opts
 * @returns {Promise<{ state: import('./job-store.mjs').JobState, result: RunResult }>}
 */
export async function executeRun(state, opts) {
  const paths = jobPaths(state.id);
  const runState = createRunState();
  const resolved = resolveCodexBin({ codexBin: opts.codexBin });
  const args = opts.resumeSessionId
    ? buildResumeArgs(opts, opts.resumeSessionId)
    : buildExecArgs(opts);

  appendProgress(paths.progress, `codexray start (codex ${resolved.version ?? '?'}) sandbox=${opts.sandbox} model=${opts.model} effort=${opts.effort || 'default'}`);
  appendProgress(paths.progress, `argv codex ${args.join(' ')}`);

  const child = spawn(resolved.bin, args, {
    cwd: state.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  state.pid = child.pid ?? null;
  writeState(state);

  // Prompt via stdin (both fresh and resume paths read stdin). Guard against a
  // child that exits before draining stdin (EPIPE) so it never crashes us.
  child.stdin.on('error', () => { /* child closed stdin early; not fatal */ });
  try {
    child.stdin.write(opts.prompt ?? '');
    child.stdin.end();
  } catch {
    // if stdin is already closed the child will error on its own
  }

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 65_536) stderr = stderr.slice(-65_536);
  });

  let lastWrite = 0;
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      return; // non-JSON noise on stdout is ignored
    }
    appendRaw(paths.raw, evt);
    const { lines } = reduceEvent(runState, evt);
    for (const l of lines) appendProgress(paths.progress, l);
    state.phase = runState.phase;
    if (runState.sessionId) state.sessionId = runState.sessionId;
    if (runState.lastError) state.lastError = runState.lastError;
    state.usage = usageSnapshot(runState.usage);
    const now = Date.now();
    if (now - lastWrite > STATE_WRITE_THROTTLE_MS) {
      writeState(state);
      lastWrite = now;
    }
  });

  const [exitCode] = await Promise.all([
    /** @type {Promise<number>} */ (new Promise((resolve) => {
      child.on('close', (code) => resolve(typeof code === 'number' ? code : 0));
      child.on('error', () => resolve(-1));
    })),
    new Promise((resolve) => rl.on('close', resolve)),
  ]);

  // Honor an external cancel that arrived while we were running.
  const disk = readState(state.id);
  const cancelled = !!disk && disk.status === 'cancelled';

  const failed = !cancelled && (runState.failed || exitCode !== 0);
  const message = finalMessage(runState);
  if (failed && !state.lastError) {
    state.lastError = stderr.trim().split('\n').slice(-5).join('\n') || `exited with code ${exitCode}`;
  }
  if (cancelled) state.lastError = state.lastError || 'cancelled by user';

  state.status = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
  state.phase = state.status;
  state.usage = usageSnapshot(runState.usage);
  state.sessionId = runState.sessionId ?? state.sessionId;
  state.endedAt = new Date().toISOString();
  writeState(state);

  const result = {
    id: state.id,
    status: state.status,
    sessionId: state.sessionId,
    exitCode,
    message,
    usage: state.usage,
    filesChanged: runState.filesChanged,
    commands: runState.commands,
    error: state.status !== 'completed' ? state.lastError : null,
  };
  writeResult(state.id, result);

  appendProgress(
    paths.progress,
    state.status === 'completed'
      ? `codexray DONE — ${runState.usage.total_tokens} total tokens, ${runState.filesChanged.length} file(s) changed`
      : `codexray ${state.status.toUpperCase()} (exit ${exitCode}): ${(state.lastError || '').split('\n')[0].slice(0, 160)}`,
  );

  return { state, result };
}
