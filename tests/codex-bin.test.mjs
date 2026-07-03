import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findOnPath, baseConfigArgs } from '../scripts/lib/codex-bin.mjs';

test('baseConfigArgs disables codexclaw by default and can be turned off', () => {
  assert.deepEqual(baseConfigArgs(), ['-c', 'plugins."codexclaw@personal".enabled=false']);
  assert.deepEqual(baseConfigArgs({ disableCodexclaw: false }), []);
  assert.deepEqual(baseConfigArgs({ disableCodexclaw: true }), ['-c', 'plugins."codexclaw@personal".enabled=false']);
});

test('findOnPath locates an executable on PATH and misses non-executables', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX exec-bit semantics only');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexray-bin-'));
  const exe = path.join(dir, 'faux-codex');
  fs.writeFileSync(exe, '#!/bin/sh\necho hi\n');
  fs.chmodSync(exe, 0o755);
  const notExe = path.join(dir, 'plain');
  fs.writeFileSync(notExe, 'nope');
  fs.chmodSync(notExe, 0o644);

  const prevPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.equal(findOnPath('faux-codex'), exe);
    assert.equal(findOnPath('plain'), null);
    assert.equal(findOnPath('does-not-exist'), null);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
