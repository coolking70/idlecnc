import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); const zipPath = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2F-A-2-universal-spatial-final.zip')); assert.ok(fs.existsSync(zipPath)); assert.ok(fs.statSync(zipPath).size <= 20 * 1024 * 1024, 'package exceeds 20MB');
const list = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }); assert.equal(list.status, 0); const entries = list.stdout.split(/\r?\n/).filter(Boolean); assert.ok(entries.every((entry) => !entry.includes('..') && !entry.startsWith('/') && !entry.includes('\\'))); assert.ok(!entries.some((entry) => entry === 'experiments/battle-sandbox/universal-planner/scenarios/fuzz.json')); assert.ok(entries.includes('experiments/battle-sandbox/universal-planner/scenarios/fuzz-specs.json')); assert.ok(entries.includes('delivery-file-manifest.json'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-spatial-verify-')); let server;
try {
  const extracted = spawnSync('unzip', ['-q', zipPath, '-d', temp], { encoding: 'utf8' }); assert.equal(extracted.status, 0, extracted.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'delivery-file-manifest.json'), 'utf8')); for (const entry of manifest.entries) { const file = path.join(temp, entry.path); assert.ok(fs.existsSync(file), entry.path); const digest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')); assert.equal(digest, entry.sha256, entry.path); }
  const npm = spawnSync('npm', ['test'], { cwd: temp, encoding: 'utf8', stdio: 'inherit' }); assert.equal(npm.status, 0, 'npm test failed in extracted package');
  server = spawn(process.execPath, ['scripts/serve.mjs', '18765'], { cwd: temp, stdio: 'ignore' }); let ready = false; for (let attempt = 0; attempt < 40; attempt += 1) { try { const response = await fetch('http://127.0.0.1:18765/experiments/battle-sandbox/universal-planner/index.html'); if (response.status === 200) { ready = true; break; } } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } assert.equal(ready, true, 'npm start HTTP check failed');
  const coverage = JSON.parse(fs.readFileSync(path.join(temp, 'experiments/battle-sandbox/universal-planner/scenarios/coverage.json'), 'utf8')); assert.equal(coverage.planFailures.length, 0); assert.equal(coverage.canonicalCount, 120); assert.equal(coverage.fuzzCount, 1000); console.log(JSON.stringify({ ok: true, entries: entries.length, canonical: coverage.canonicalCount, fuzz: coverage.fuzzCount }, null, 2));
} finally { if (server) server.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); }

