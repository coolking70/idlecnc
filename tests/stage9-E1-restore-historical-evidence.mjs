import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const historicalPattern = /^(stage8_.*\.json|stage9_[abcd]_.*\.json)$/;
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  .split('\n').map((row) => row.trim()).filter((row) => historicalPattern.test(row));
const restored = [];
paths.forEach((relativePath) => {
  const baselineBytes = execFileSync('git', ['show', `${baseline}:${relativePath}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const currentPath = path.join(root, relativePath);
  if (!fs.existsSync(currentPath) || !fs.readFileSync(currentPath).equals(baselineBytes)) {
    fs.writeFileSync(currentPath, baselineBytes);
    restored.push(relativePath);
  }
});
console.log(JSON.stringify({ stage: '9-E.1', baseline, restoredCount: restored.length, restored }));
