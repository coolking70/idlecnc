import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createIsolatedTempRoot(prefix = 'iron-command-a2-1-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const name of ['tmp', 'browser-profiles', 'extracted', 'logs']) fs.mkdirSync(path.join(root, name), { recursive: true });
  return root;
}

export function buildIsolatedTempEnv(root, baseEnv = process.env) {
  const tmp = path.join(root, 'tmp');
  return {
    ...baseEnv,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    IRON_COMMAND_TEMP_ROOT: root,
    IRON_COMMAND_BROWSER_PROFILE_ROOT: path.join(root, 'browser-profiles')
  };
}

export function removeIsolatedTempRoot(root) {
  if (root) fs.rmSync(root, { recursive: true, force: true });
}

export function assertIsolatedTempRootClean(root) {
  return !root || !fs.existsSync(root);
}

