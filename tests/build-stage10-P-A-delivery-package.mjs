import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'iron-command-stage10-P-A-command-ui-foundation';
const targetZip = path.join(root, `${packageName}.zip`);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage10-pa-package-'));
const staging = path.join(tempRoot, packageName);

const excluded = (relativePath) => {
  const parts = relativePath.split(path.sep);
  const top = parts[0];
  if (['.git', 'node_modules', 'dist', 'output', 'artifacts', 'browser-profiles', '.preview-logs', 'tmp'].includes(top)) return true;
  if (top === 'screenshots' && parts.length > 1 && parts[1] !== 'stage10-P-A') return true;
  if (top === 'evidence' && parts.length > 1 && parts[1] !== 'stage10-P-A') return true;
  if (top === 'tests' && ['outputs', 'evidence'].includes(parts[1])) return true;
  if (relativePath === 'experiments/battle-sandbox/universal-planner/scenarios/fuzz.json') return true;
  if (/^stage[89]_.*\.json$/i.test(relativePath)) return true;
  if (/^STAGE[89].*SELFCHECK\.json$/i.test(relativePath)) return true;
  if (/\.zip$/i.test(relativePath) || /-final-package-record\.json$/i.test(relativePath)) return true;
  return parts.some((part) => part === '.DS_Store' || part === '__pycache__' || part.endsWith('.pyc'));
};

function copyTree(source, destination, relative = '') {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (excluded(childRelative)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath, childRelative);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

try {
  copyTree(root, staging);
  if (fs.existsSync(targetZip)) fs.rmSync(targetZip);
  execFileSync('/usr/bin/zip', ['-q', '-r', targetZip, packageName], { cwd: tempRoot, maxBuffer: 32 * 1024 * 1024 });
  const bytes = fs.statSync(targetZip).size;
  console.log(JSON.stringify({ stage: '10-P-A', package: path.basename(targetZip), bytes, compact: bytes < 200 * 1024 * 1024 }));
  if (bytes >= 200 * 1024 * 1024) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
