import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyUsage, normalizeUsage, accumulate, formatUsage } from '../scripts/lib/tokens.mjs';

test('emptyUsage is zeroed', () => {
  const u = emptyUsage();
  assert.equal(u.turns, 0);
  assert.equal(u.total_tokens, 0);
  assert.equal(u.last, null);
});

test('normalizeUsage derives total = input + output and defaults missing fields', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 100, output_tokens: 20 }), {
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 0,
    total_tokens: 120,
  });
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage('x'), null);
});

test('accumulate sums output/total and keeps last input across turns', () => {
  const acc = emptyUsage();
  accumulate(acc, { input_tokens: 100, output_tokens: 20 });
  accumulate(acc, { input_tokens: 300, cached_input_tokens: 250, output_tokens: 40, reasoning_output_tokens: 5 });
  assert.equal(acc.turns, 2);
  assert.equal(acc.input_tokens, 300); // last turn's context
  assert.equal(acc.cached_input_tokens, 250);
  assert.equal(acc.output_tokens, 60); // summed
  assert.equal(acc.reasoning_output_tokens, 5);
  assert.equal(acc.total_tokens, 120 + 340); // summed input+output per turn
  assert.equal(acc.last?.output_tokens, 40);
});

test('accumulate is a no-op on invalid usage', () => {
  const acc = emptyUsage();
  accumulate(acc, undefined);
  assert.equal(acc.turns, 0);
});

test('formatUsage renders a stable one-liner', () => {
  const acc = emptyUsage();
  accumulate(acc, { input_tokens: 5, cached_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 3 });
  assert.equal(formatUsage(acc), 'tokens in=5 cached=1 out=2 reasoning=3 total=7');
});
