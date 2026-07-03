// Codex token accounting.
//
// Codex `exec --json` reports usage once per turn in the `turn.completed` event:
//   { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
// cached_input_tokens is the cached SUBSET of input_tokens; reasoning tokens are
// reported for transparency. Per-turn total = input + output (the standard cost
// basis). We keep the last turn's context size and SUM the generated + total
// across turns (a resumed multi-turn run re-sends context, so cost accumulates).
//
// This is the only place Codex-side tokens become visible to the main Claude
// session — Claude Code's own accounting measures the wrapper subagent, never
// the Codex child.

/**
 * @typedef {object} UsageBreakdown
 * @property {number} input_tokens
 * @property {number} cached_input_tokens
 * @property {number} output_tokens
 * @property {number} reasoning_output_tokens
 * @property {number} total_tokens
 */

/**
 * @typedef {object} UsageAccumulator
 * @property {number} turns
 * @property {number} input_tokens last turn's input (context) size
 * @property {number} cached_input_tokens last turn's cached input
 * @property {number} output_tokens summed generated output across turns
 * @property {number} reasoning_output_tokens summed reasoning tokens across turns
 * @property {number} total_tokens summed (input+output) across turns
 * @property {UsageBreakdown | null} last most recent turn's breakdown
 */

/** @returns {UsageAccumulator} */
export function emptyUsage() {
  return {
    turns: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    last: null,
  };
}

/** @param {unknown} v @returns {number} */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Normalize a raw Codex usage object into a stable breakdown.
 * @param {unknown} raw
 * @returns {UsageBreakdown | null}
 */
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const input = num(r.input_tokens);
  const cached = num(r.cached_input_tokens);
  const output = num(r.output_tokens);
  const reasoning = num(r.reasoning_output_tokens);
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
}

/**
 * Fold one turn's usage into an accumulator (returns the same object).
 * @param {UsageAccumulator} acc
 * @param {unknown} raw
 * @returns {UsageAccumulator}
 */
export function accumulate(acc, raw) {
  const u = normalizeUsage(raw);
  if (!u) return acc;
  acc.turns += 1;
  acc.input_tokens = u.input_tokens;
  acc.cached_input_tokens = u.cached_input_tokens;
  acc.output_tokens += u.output_tokens;
  acc.reasoning_output_tokens += u.reasoning_output_tokens;
  acc.total_tokens += u.total_tokens;
  acc.last = u;
  return acc;
}

/**
 * One-line human-readable token summary for the progress log.
 * @param {UsageAccumulator} acc
 * @returns {string}
 */
export function formatUsage(acc) {
  return `tokens in=${acc.input_tokens} cached=${acc.cached_input_tokens} `
    + `out=${acc.output_tokens} reasoning=${acc.reasoning_output_tokens} total=${acc.total_tokens}`;
}
