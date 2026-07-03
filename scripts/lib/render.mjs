// Human- and machine-readable rendering of job status and results for the CLI.

import fs from 'node:fs';

/**
 * Read the last `n` lines of a progress file.
 * @param {string} progressPath
 * @param {number} [n]
 * @returns {string[]}
 */
export function readProgressTail(progressPath, n = 12) {
  let text = '';
  try {
    text = fs.readFileSync(progressPath, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((l) => l.length > 0);
  return lines.slice(-n);
}

/**
 * @param {import('./job-store.mjs').JobState} state
 * @param {{ tail?: number }} [opts]
 * @returns {string}
 */
export function renderStatus(state, opts = {}) {
  const u = /** @type {Record<string, number>} */ (state.usage || {});
  const out = [
    `job      ${state.id}`,
    `status   ${state.status} (${state.phase})`,
    `model    ${state.model}${state.effort ? ` / ${state.effort}` : ''}`,
    `session  ${state.sessionId || '(pending)'}`,
    `tokens   in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} total=${u.total_tokens ?? 0}`,
  ];
  if (state.lastError) out.push(`error    ${String(state.lastError).split('\n')[0].slice(0, 200)}`);
  const tail = readProgressTail(state.progressPath, opts.tail ?? 12);
  if (tail.length) {
    out.push('--- progress (tail) ---');
    out.push(...tail);
  }
  return out.join('\n');
}

/**
 * @param {any} result
 * @returns {string}
 */
export function renderResult(result) {
  if (!result) return '(no result yet — job may still be running)';
  if (result.status === 'failed') {
    return `FAILED: ${result.error || 'unknown error'}`;
  }
  return String(result.message || '(no final message)');
}

/**
 * @param {import('./job-store.mjs').JobState[]} jobs
 * @returns {string}
 */
export function renderList(jobs) {
  if (!jobs.length) return '(no jobs)';
  return jobs
    .map((j) => {
      const u = /** @type {Record<string, number>} */ (j.usage || {});
      return `${j.id}  ${j.status.padEnd(9)} ${String(j.phase).padEnd(11)} `
        + `tok=${u.total_tokens ?? 0}  ${j.model}  ${j.createdAt}`;
    })
    .join('\n');
}
