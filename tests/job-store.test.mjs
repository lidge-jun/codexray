import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scope all job files to a throwaway data dir BEFORE importing the store.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexray-jobs-'));
process.env.CODEXRAY_DATA_DIR = DATA_DIR;

const store = await import('../scripts/lib/job-store.mjs');
const { initState, writeState, readState, writeResult, readResult, listJobs, pruneJobs, removeJob, usageSnapshot } = store;

test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('state round-trips through disk', () => {
  const state = initState({ id: 'cxr-a', model: 'gpt-5.5', effort: 'high', cwd: '/tmp', claudeSessionId: 'sess-1' });
  assert.equal(state.status, 'running');
  writeState(state);
  const back = readState('cxr-a');
  assert.ok(back);
  assert.equal(back.id, 'cxr-a');
  assert.equal(back.model, 'gpt-5.5');
  assert.equal(back.claudeSessionId, 'sess-1');
});

test('result round-trips', () => {
  writeResult('cxr-a', { id: 'cxr-a', status: 'completed', message: 'hi' });
  assert.equal(readResult('cxr-a')?.message, 'hi');
  assert.equal(readResult('missing'), null);
});

test('listJobs filters by claude session and sorts newest first', () => {
  const s2 = initState({ id: 'cxr-b', model: 'm', effort: '', cwd: '/tmp', claudeSessionId: 'sess-2' });
  s2.createdAt = '2999-01-01T00:00:00.000Z';
  writeState(s2);
  const scoped = listJobs({ claudeSessionId: 'sess-2' });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, 'cxr-b');
  const all = listJobs();
  assert.equal(all[0].id, 'cxr-b'); // newest createdAt first
});

test('usageSnapshot flattens an accumulator', () => {
  const snap = usageSnapshot({ turns: 1, input_tokens: 10, cached_input_tokens: 2, output_tokens: 3, reasoning_output_tokens: 1, total_tokens: 13, last: null });
  assert.deepEqual(snap, { turns: 1, input_tokens: 10, cached_input_tokens: 2, output_tokens: 3, reasoning_output_tokens: 1, total_tokens: 13 });
});

test('pruneJobs keeps at most N finished jobs and never deletes running', () => {
  // wipe to a known set
  for (const j of listJobs()) removeJob(j.id);
  for (let i = 0; i < 5; i += 1) {
    const s = initState({ id: `fin-${i}`, model: 'm', effort: '', cwd: '/tmp', claudeSessionId: null });
    s.status = 'completed';
    s.createdAt = `2000-01-0${i + 1}T00:00:00.000Z`;
    writeState(s);
  }
  const running = initState({ id: 'run-1', model: 'm', effort: '', cwd: '/tmp', claudeSessionId: null });
  running.status = 'running';
  writeState(running);

  const removed = pruneJobs(2);
  assert.ok(removed >= 1);
  const left = listJobs();
  assert.ok(left.some((j) => j.id === 'run-1'), 'running job survives prune');
  assert.ok(left.filter((j) => j.status === 'completed').length <= 2);
});
