import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// End-to-end exercise of the spawn -> JSONL parse -> finalize pipeline using a
// FAKE codex binary that replays a recorded event stream. Zero LLM cost.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'codexray.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'exec-basic.jsonl');

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexray-int-'));
const dataDir = path.join(workdir, 'data');
const fakeCodex = path.join(workdir, 'fake-codex');

test.before(() => {
  fs.writeFileSync(
    fakeCodex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 0.142.5"; exit 0; fi
cat >/dev/null 2>&1
cat "${FIXTURE}"
`,
  );
  fs.chmodSync(fakeCodex, 0o755);
});

test.after(() => fs.rmSync(workdir, { recursive: true, force: true }));

/** @param {string[]} args */
function runCli(args) {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_BIN: fakeCodex,
      CODEXRAY_DATA_DIR: dataDir,
      CODEXRAY_SESSION_ID: 'itest',
      CLAUDE_PLUGIN_DATA: '',
    },
  });
}

test('run drives a full job and reports final message + tokens', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX fake-binary only');
  const out = runCli(['run', '--json', '--sandbox', 'read-only', 'do the thing']);
  const result = JSON.parse(out);
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /updated src\/a\.ts/);
  assert.equal(result.usage.total_tokens, 1280);
  assert.equal(result.sessionId, '0199a213-thread-uuid');
  assert.deepEqual(result.filesChanged, ['src/a.ts', 'src/b.ts']);

  // progress file is human-readable and tail-able
  const jobs = JSON.parse(runCli(['list', '--json']));
  assert.ok(jobs.length >= 1);
  const jobId = jobs[0].id;
  const progress = fs.readFileSync(path.join(dataDir, 'jobs', `${jobId}.progress.log`), 'utf8');
  assert.match(progress, /codexray start/);
  assert.match(progress, /tokens in=1200 .* total=1280/);
  assert.match(progress, /codexray DONE/);

  // status + result subcommands read it back
  const status = runCli(['status', jobId]);
  assert.match(status, /status +completed/);
  const finalMsg = runCli(['result', jobId]);
  assert.match(finalMsg, /updated src\/a\.ts/);
});

test('a prompt after -- that looks like a flag is accepted, not mis-parsed', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX fake-binary only');
  const out = runCli(['run', '--json', '--sandbox', 'read-only', '--', '--review all files for security']);
  const result = JSON.parse(out);
  assert.equal(result.status, 'completed'); // did not error with "requires a prompt"
});

test('doctor reports the fake binary via env', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX fake-binary only');
  const out = runCli(['doctor', '--json']);
  const report = JSON.parse(out);
  assert.equal(report.checks.codexBin.version, '0.142.5');
  assert.equal(report.checks.codexBin.source, 'env');
});
