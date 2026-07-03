// Filesystem layout for codexray jobs.
//
// The plugin data dir is persistent and provided by Claude Code as
// CLAUDE_PLUGIN_DATA (~/.claude/plugins/data/<plugin-id>/). When codexray runs
// outside a plugin context (tests, standalone CLI) we fall back to a stable
// per-user temp dir so job files still have a known home.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** @returns {string} absolute path to the codexray data root. */
export function resolveDataDir() {
  // Explicit override wins (tests, power users).
  const explicit = (process.env.CODEXRAY_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);

  const pluginData = (process.env.CLAUDE_PLUGIN_DATA || '').trim();
  if (pluginData) {
    // When installed, CLAUDE_PLUGIN_DATA is codexray's own dir — use it as-is.
    // If it leaked from another plugin's env, nest a codexray/ subdir so we
    // never scatter job files into a foreign plugin's data directory.
    return /codexray/i.test(path.basename(pluginData))
      ? path.resolve(pluginData)
      : path.resolve(pluginData, 'codexray');
  }
  return path.join(os.tmpdir(), 'codexray');
}

/** @returns {string} absolute path to the jobs directory (created on demand). */
export function resolveJobsDir() {
  const dir = path.join(resolveDataDir(), 'jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * All on-disk paths for a single job.
 * @param {string} jobId
 * @returns {{ id: string, dir: string, state: string, progress: string, result: string, raw: string }}
 */
export function jobPaths(jobId) {
  const dir = resolveJobsDir();
  return {
    id: jobId,
    dir,
    state: path.join(dir, `${jobId}.state.json`),
    progress: path.join(dir, `${jobId}.progress.log`),
    result: path.join(dir, `${jobId}.result.json`),
    raw: path.join(dir, `${jobId}.raw.jsonl`),
  };
}

/**
 * Generate a sortable, collision-resistant job id.
 * @returns {string}
 */
export function newJobId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cxr-${ts}-${rand}`;
}
