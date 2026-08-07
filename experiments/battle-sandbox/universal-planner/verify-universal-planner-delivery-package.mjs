import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const zipPath = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2F-A-1-universal-planner-hardening.zip'));
assert.equal(fs.existsSync(zipPath), true, `missing package: ${zipPath}`);
const list = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }); assert.equal(list.status, 0, 'zip listing failed');
const entries = list.stdout.split(/\r?\n/).filter(Boolean);
assert.ok(entries.length > 0); assert.ok(entries.every((entry) => !entry.includes('..') && !entry.startsWith('/') && !entry.includes('\\')));
assert.ok(!entries.some((entry) => entry.startsWith('node_modules/') || entry.startsWith('.git/')));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-8-2F-A-1-'));
try {
  const extracted = spawnSync('unzip', ['-q', zipPath, '-d', temp], { encoding: 'utf8' }); assert.equal(extracted.status, 0, extracted.stderr);
  const run = (script, args = []) => { const result = spawnSync(process.execPath, [script, ...args], { cwd: temp, encoding: 'utf8', stdio: 'inherit' }); assert.equal(result.status, 0, `${script} failed`); };
  run('experiments/battle-sandbox/tests/universal-presentation-planner-test.mjs');
  run('experiments/battle-sandbox/tests/universal-presentation-corpus-test.mjs');
  run('experiments/battle-sandbox/tests/universal-presentation-input-stability-test.mjs');
  run('experiments/battle-sandbox/tests/universal-presentation-semantics-test.mjs');
  run('experiments/battle-sandbox/tests/universal-presentation-continuous-layout-test.mjs');
  run('experiments/battle-sandbox/tests/universal-presentation-delivery-test.mjs');
  console.log(JSON.stringify({ ok: true, zip: zipPath, entries: entries.length }, null, 2));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
