// Resolve the Codex binary to an absolute path and read its version.
//
// Why absolute-path resolution matters: multiple codex installs can coexist on
// one machine (e.g. a bun-global 0.142.5 and an nvm 0.134.0). child_process
// spawn() ignores the user's interactive shell functions, so a shell alias that
// pins a version or disables a plugin is NOT applied. We therefore resolve the
// binary deterministically and re-apply those conventions ourselves.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

/**
 * Find an executable by name on PATH, returning the first absolute match.
 * @param {string} name
 * @returns {string | null}
 */
export function findOnPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = IS_WIN ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = path.join(dir, cand);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // not here, keep scanning
      }
    }
  }
  return null;
}

/**
 * Read `codex-cli X.Y.Z` and return the semver string, or null on failure.
 * @param {string} bin
 * @returns {string | null}
 */
export function getCodexVersion(bin) {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} ResolvedCodex
 * @property {string} bin absolute path to the codex executable
 * @property {string | null} version parsed semver, or null if unreadable
 * @property {'env' | 'path'} source how the binary was located
 */

/**
 * Resolve the Codex binary. Honors CODEX_BIN, then PATH.
 * @param {{ codexBin?: string | null }} [opts]
 * @returns {ResolvedCodex}
 */
export function resolveCodexBin(opts = {}) {
  const explicit = (opts.codexBin || process.env.CODEX_BIN || '').trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`CODEX_BIN points at a missing file: ${explicit}`);
    }
    return { bin: path.resolve(explicit), version: getCodexVersion(explicit), source: 'env' };
  }
  const found = findOnPath('codex');
  if (!found) {
    throw new Error(
      'Could not find the `codex` binary on PATH. Install it (npm i -g @openai/codex) or set CODEX_BIN to an absolute path.',
    );
  }
  return { bin: found, version: getCodexVersion(found), source: 'path' };
}

/**
 * Config-override args re-applied on every spawn because the shell is bypassed.
 * By default we disable the interactive codexclaw plugin for deterministic,
 * side-effect-free runs (mirrors the user's own `codex exec` shell convention).
 * @param {{ disableCodexclaw?: boolean }} [opts]
 * @returns {string[]}
 */
export function baseConfigArgs(opts = {}) {
  const disable = opts.disableCodexclaw !== false;
  return disable ? ['-c', 'plugins."codexclaw@personal".enabled=false'] : [];
}
