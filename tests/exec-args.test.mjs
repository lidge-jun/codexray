import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExecArgs, buildResumeArgs } from '../scripts/lib/exec-runner.mjs';

/** @returns {import('../scripts/lib/exec-runner.mjs').RunOptions} */
function baseOpts(over = {}) {
  return {
    prompt: 'do a thing',
    model: 'gpt-5.5',
    effort: 'high',
    resumeSessionId: null,
    sandbox: 'workspace-write',
    fastMode: false,
    disableCodexclaw: true,
    outputSchema: null,
    codexBin: null,
    spark: false,
    ...over,
  };
}

test('buildExecArgs assembles a fresh exec invocation', () => {
  const args = buildExecArgs(baseOpts());
  assert.ok(args.includes('exec'));
  assert.deepEqual(args.slice(0, 2), ['-c', 'plugins."codexclaw@personal".enabled=false']);
  assert.ok(sub(args, ['-m', 'gpt-5.5']));
  assert.ok(sub(args, ['-c', 'model_reasoning_effort="high"']));
  assert.ok(sub(args, ['-c', 'model_reasoning_summary="detailed"']));
  assert.ok(sub(args, ['-s', 'workspace-write', '-c', 'approval_policy="never"']));
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--skip-git-repo-check'));
  // prompt is NEVER in argv (goes via stdin)
  assert.ok(!args.some((a) => a.includes('do a thing')));
});

test('spark models skip reasoning-summary flags', () => {
  const args = buildExecArgs(baseOpts({ spark: true, model: 'gpt-5.3-codex-spark' }));
  assert.ok(!sub(args, ['-c', 'model_reasoning_summary="detailed"']));
});

test('danger-full-access uses the bypass flag instead of -s', () => {
  const args = buildExecArgs(baseOpts({ sandbox: 'danger-full-access' }));
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('-s'));
});

test('read-only keeps approval never', () => {
  const args = buildExecArgs(baseOpts({ sandbox: 'read-only' }));
  assert.ok(sub(args, ['-s', 'read-only', '-c', 'approval_policy="never"']));
});

test('buildResumeArgs targets exec resume with session id and stdin prompt', () => {
  const args = buildResumeArgs(baseOpts(), 'sess-123');
  assert.ok(sub(args, ['exec', 'resume']));
  assert.ok(args.includes('sess-123'));
  assert.ok(args.includes('-')); // stdin sentinel for the prompt
  assert.ok(args.includes('--json'));
});

test('default model is omitted from argv', () => {
  const args = buildExecArgs(baseOpts({ model: 'default' }));
  assert.ok(!args.includes('-m'));
});

/**
 * True if `needle` appears as a contiguous subsequence of `hay`.
 * @param {string[]} hay @param {string[]} needle
 */
function sub(hay, needle) {
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
