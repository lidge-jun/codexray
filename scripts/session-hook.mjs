#!/usr/bin/env node
// Claude Code session lifecycle hook for codexray.
//
//   SessionStart -> export CODEXRAY_SESSION_ID (via CLAUDE_ENV_FILE) so that
//                   `codexray run` can scope jobs to this Claude session.
//   SessionEnd   -> terminate this session's still-running jobs and prune old
//                   job files, so a closed session leaves nothing orphaned.

import fs from 'node:fs';

/** @returns {Promise<Record<string, unknown>>} */
function readInput() {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    process.stdin.on('error', () => resolve({}));
  });
}

async function main() {
  const mode = process.argv[2] || '';
  const input = await readInput();
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';

  if (mode === 'SessionStart') {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile && sessionId) {
      try { fs.appendFileSync(envFile, `CODEXRAY_SESSION_ID=${sessionId}\n`); } catch { /* non-fatal */ }
    }
    return 0;
  }

  if (mode === 'SessionEnd') {
    const { listJobs, writeState, pruneJobs } = await import('./lib/job-store.mjs');
    for (const j of listJobs({ claudeSessionId: sessionId || undefined })) {
      if (j.status === 'running') {
        if (j.pid) { try { process.kill(j.pid, 'SIGTERM'); } catch { /* already gone */ } }
        j.status = 'cancelled';
        j.phase = 'cancelled';
        j.lastError = 'session ended';
        j.endedAt = new Date().toISOString();
        try { writeState(j); } catch { /* non-fatal */ }
      }
    }
    try { pruneJobs(50); } catch { /* non-fatal */ }
    return 0;
  }

  return 0;
}

main().then((code) => process.exit(typeof code === 'number' ? code : 0));
