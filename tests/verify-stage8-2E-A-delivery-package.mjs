import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2E-A-formal-sidecar-integration.zip'));
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = ['index.html', 'package.json', 'js/main.js', 'js/battle-renderer.js', 'js/battle-presentation/presentation-router.js', 'js/battle-presentation/contract-battle-adapter.js', 'tests/stage8-2E-A-test.mjs', 'experiments/battle-sandbox/tests/formal-contract-presentation-integration-test.mjs', 'STAGE8-2E-A-DELIVERY.md', 'tests/stage8-2E-A-boundary.json', 'screenshots/stage8-2E-A-screenshot-manifest.json'];
if (!fs.existsSync(archive)) throw new Error(`archive not found: ${archive}`);
execFileSync('unzip', ['-tq', archive], { stdio: 'inherit' });
const entries = execFileSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
assert.equal(entries.some((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('node_modules') || entry.includes('/.')), false);
required.forEach((file) => assert.ok(entries.includes(file), `missing ${file}`));
const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-ea-'));
try {
  execFileSync('unzip', ['-q', archive, '-d', extracted]);
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'tests/stage8-2E-A-boundary.json'), 'utf8'));
  const actualBoundary = crypto.createHash('sha256').update(manifest.formalBoundaryFiles.slice().sort().map((file) => `${file}\0${hashFile(path.join(extracted, file))}\n`).join('')).digest('hex');
  assert.equal(actualBoundary, manifest.formalBoundaryHash, 'formal boundary hash mismatch');
  const screenshots = JSON.parse(fs.readFileSync(path.join(extracted, 'screenshots/stage8-2E-A-screenshot-manifest.json'), 'utf8'));
  const hashes = screenshots.captures.map((capture) => { const file = path.join(extracted, capture.file); assert.ok(fs.existsSync(file), capture.file); const hash = hashFile(file); assert.equal(hash, capture.sha256, capture.file); return hash; });
  assert.equal(new Set(hashes).size, hashes.length, 'screenshot hashes must be unique');
  execFileSync('npm', ['test'], { cwd: extracted, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const { createServer } = await import(pathToFileURL(path.join(extracted, 'scripts/serve.mjs')).href);
  const server = createServer(extracted);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  await new Promise((resolve) => server.close(resolve));
  console.log(`verify-stage8-2E-A-delivery-package: ok boundary=${manifest.formalBoundaryHash} captures=${hashes.length}`);
} finally {
  fs.rmSync(extracted, { recursive: true, force: true });
}
