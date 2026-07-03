import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRunState, reduceEvent, finalMessage, extractError, preview } from '../scripts/lib/events.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} name */
function feedFixture(name) {
  const raw = fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
  const state = createRunState();
  const lines = [];
  for (const l of raw.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    const { lines: produced } = reduceEvent(state, JSON.parse(t));
    lines.push(...produced);
  }
  return { state, lines };
}

test('reduces a basic exec stream into state', () => {
  const { state, lines } = feedFixture('exec-basic.jsonl');
  assert.equal(state.sessionId, '0199a213-thread-uuid');
  assert.equal(state.phase, 'running');
  assert.equal(state.done, false);
  assert.equal(state.failed, false);
  assert.equal(state.turns, 1);
  // token math: total = input + output summed per turn
  assert.equal(state.usage.output_tokens, 80);
  assert.equal(state.usage.input_tokens, 1200);
  assert.equal(state.usage.cached_input_tokens, 1000);
  assert.equal(state.usage.reasoning_output_tokens, 10);
  assert.equal(state.usage.total_tokens, 1280);
  // file changes collected
  assert.deepEqual(state.filesChanged, ['src/a.ts', 'src/b.ts']);
  // final message is the last agent_message
  assert.equal(finalMessage(state), 'Done. I updated src/a.ts and added src/b.ts.');
  // progress surfaced a command, a token line, and the message
  const joined = lines.join('\n');
  assert.match(joined, /session 0199a213-thread-uuid/);
  assert.match(joined, /\$ bash -lc/);
  assert.match(joined, /tokens in=1200 .* out=80 .* total=1280/);
  assert.match(joined, /Done\. I updated/);
});

test('handles turn.failed and error events', () => {
  const state = createRunState();
  reduceEvent(state, { type: 'thread.started', thread_id: 't1' });
  const { lines } = reduceEvent(state, { type: 'turn.failed', error: { message: 'model overloaded' } });
  assert.equal(state.failed, true);
  assert.equal(state.phase, 'failed');
  assert.equal(state.lastError, 'model overloaded');
  assert.match(lines.join('\n'), /turn failed: model overloaded/);
});

test('extractError unwraps strings, objects, and JSON strings', () => {
  assert.equal(extractError('boom'), 'boom');
  assert.equal(extractError({ message: 'inner' }), 'inner');
  assert.equal(extractError({ error: { message: 'nested' } }), 'nested');
  assert.equal(extractError('{"error":{"message":"json"}}'), 'json');
  assert.equal(extractError(null), '');
});

test('ignores malformed and unknown events without throwing', () => {
  const state = createRunState();
  assert.doesNotThrow(() => reduceEvent(state, null));
  assert.doesNotThrow(() => reduceEvent(state, {}));
  assert.doesNotThrow(() => reduceEvent(state, { type: 'nonsense' }));
  assert.doesNotThrow(() => reduceEvent(state, { type: 'item.completed' }));
  assert.equal(state.messages.length, 0);
});

test('preview collapses whitespace and truncates', () => {
  assert.equal(preview('  a   b\nc  '), 'a b c');
  assert.equal(preview('abcdef', 4), 'abc…');
});
