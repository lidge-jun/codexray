// Job registry backed by per-job files under <data>/jobs/.
//
// Each job owns four files (see paths.mjs):
//   <id>.state.json    machine-readable status/phase/tokens/pid/sessionId
//   <id>.progress.log  human-readable, tail-able live progress
//   <id>.result.json   final answer + usage + touched files (on completion)
//   <id>.raw.jsonl     raw Codex event archive (diagnostic)
//
// There is no shared registry file: listing scans the directory. This keeps
// concurrent jobs lock-free and crash-safe (a dead job leaves a readable state
// file, never a corrupt shared index).

import fs from 'node:fs';
import path from 'node:path';
import { resolveJobsDir, jobPaths } from './paths.mjs';

/**
 * @typedef {object} JobState
 * @property {string} id
 * @property {'running'|'completed'|'failed'|'cancelled'} status
 * @property {string} phase
 * @property {number | null} pid
 * @property {string | null} sessionId
 * @property {string} model
 * @property {string} effort
 * @property {string} cwd
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} endedAt
 * @property {object} usage
 * @property {string | null} lastError
 * @property {string | null} claudeSessionId
 * @property {string} progressPath
 * @property {string} resultPath
 * @property {string} rawPath
 */

/**
 * Write a JSON file atomically (write temp, then rename).
 * @param {string} file
 * @param {unknown} data
 */
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * @param {string} file
 * @returns {any | null}
 */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Persist job state.
 * @param {JobState} state
 */
export function writeState(state) {
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(jobPaths(state.id).state, state);
}

/**
 * @param {string} jobId
 * @returns {JobState | null}
 */
export function readState(jobId) {
  return readJsonSafe(jobPaths(jobId).state);
}

/**
 * @param {string} jobId
 * @param {object} result
 */
export function writeResult(jobId, result) {
  writeJsonAtomic(jobPaths(jobId).result, result);
}

/**
 * @param {string} jobId
 * @returns {any | null}
 */
export function readResult(jobId) {
  return readJsonSafe(jobPaths(jobId).result);
}

/**
 * List jobs, newest first, optionally scoped to a Claude session id.
 * @param {{ claudeSessionId?: string, limit?: number }} [opts]
 * @returns {JobState[]}
 */
export function listJobs(opts = {}) {
  const dir = resolveJobsDir();
  /** @type {JobState[]} */
  const jobs = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!name.endsWith('.state.json')) continue;
    const state = readJsonSafe(path.join(dir, name));
    if (!state || typeof state.id !== 'string') continue;
    // Exact-match when scoping to a session: a null-session (standalone CLI) job
    // must NOT be swept up by a session's SessionEnd cleanup.
    if (opts.claudeSessionId && state.claudeSessionId !== opts.claudeSessionId) {
      continue;
    }
    jobs.push(state);
  }
  jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return typeof opts.limit === 'number' ? jobs.slice(0, opts.limit) : jobs;
}

/**
 * Delete a job's files.
 * @param {string} jobId
 */
export function removeJob(jobId) {
  const p = jobPaths(jobId);
  for (const f of [p.state, p.progress, p.result, p.raw]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * Keep at most `max` most-recent jobs; delete the rest. Never deletes a job
 * still marked running.
 * @param {number} [max]
 * @returns {number} count removed
 */
export function pruneJobs(max = 50) {
  const jobs = listJobs();
  let removed = 0;
  const keepRunning = jobs.filter((j) => j.status === 'running');
  const finished = jobs.filter((j) => j.status !== 'running');
  const excess = finished.slice(Math.max(0, max - keepRunning.length));
  for (const j of excess) {
    removeJob(j.id);
    removed += 1;
  }
  return removed;
}

/**
 * Build the initial state object for a new job.
 * @param {{ id: string, model: string, effort: string, cwd: string, claudeSessionId: string | null }} init
 * @returns {JobState}
 */
export function initState(init) {
  const now = new Date().toISOString();
  const p = jobPaths(init.id);
  return {
    id: init.id,
    status: 'running',
    phase: 'starting',
    pid: null,
    sessionId: null,
    model: init.model,
    effort: init.effort,
    cwd: init.cwd,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    usage: { turns: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 },
    lastError: null,
    claudeSessionId: init.claudeSessionId,
    progressPath: p.progress,
    resultPath: p.result,
    rawPath: p.raw,
  };
}

/**
 * Snapshot a usage accumulator into a plain state.usage object.
 * @param {import('./tokens.mjs').UsageAccumulator} acc
 * @returns {object}
 */
export function usageSnapshot(acc) {
  return {
    turns: acc.turns,
    input_tokens: acc.input_tokens,
    cached_input_tokens: acc.cached_input_tokens,
    output_tokens: acc.output_tokens,
    reasoning_output_tokens: acc.reasoning_output_tokens,
    total_tokens: acc.total_tokens,
  };
}
