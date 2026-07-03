// Minimal structured logging to a progress file + optional stderr mirror.
//
// The progress file is the load-bearing surface: the main Claude Code session
// tails it with the Read tool between tool calls to watch a Codex run live.
// Lines are therefore human-readable and one event per line.

import fs from 'node:fs';

/** @returns {string} `HH:MM:SS` in UTC. */
function stamp() {
  return new Date().toISOString().slice(11, 19);
}

/**
 * Append one timestamped line to a progress log, mirroring to stderr when the
 * process runs in the foreground (CODEXRAY_FOREGROUND=1).
 * @param {string} progressPath
 * @param {string} line
 */
export function appendProgress(progressPath, line) {
  const text = `${stamp()} ${line}\n`;
  fs.appendFileSync(progressPath, text);
  if (process.env.CODEXRAY_FOREGROUND === '1') {
    process.stderr.write(`[codexray] ${line}\n`);
  }
}

/**
 * Append one raw JSONL event line to the raw archive (best-effort).
 * @param {string} rawPath
 * @param {unknown} obj
 */
export function appendRaw(rawPath, obj) {
  try {
    fs.appendFileSync(rawPath, `${JSON.stringify(obj)}\n`);
  } catch {
    // raw archive is diagnostic only; never fail a run because of it
  }
}
