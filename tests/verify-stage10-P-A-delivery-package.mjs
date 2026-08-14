import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = 'iron-command-stage10-P-A-command-ui-foundation/';
const zipPath = path.join(root, 'iron-command-stage10-P-A-command-ui-foundation.zip');
assert.equal(fs.existsSync(zipPath), true, 'delivery ZIP missing');
const entries = execFileSync('/usr/bin/unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
const required = [
  'package.json', 'README.md', 'index.html', 'js/command-ui.js', 'js/command-presentation.js',
  'tests/stage10-P-A-command-ui-test.mjs', 'tests/browser/stage10-P-A-command-ui.mjs',
  'evidence/stage10-P-A/stage10-P-A-machine.json', 'evidence/stage10-P-A/stage10-P-A-browser.json',
  'evidence/stage10-P-A/stage10-P-A-state-equivalence.json', 'evidence/stage10-P-A/stage10-P-A-selfcheck.json',
  'screenshots/stage10-P-A/13-mobile-inspector.png', 'HANDOFF-STAGE10-P-A.md', 'STAGE10-P-A-SELFCHECK.json'
];
required.forEach((file) => assert.equal(entries.includes(`${prefix}${file}`), true, `missing package entry ${file}`));
const forbidden = entries.filter((entry) => /(^|\/)(\.git|node_modules|browser-profiles|artifacts|output|dist)(\/|$)/.test(entry) || /\.zip$/i.test(entry));
assert.deepEqual(forbidden, []);
assert.ok(fs.statSync(zipPath).size < 200 * 1024 * 1024, 'delivery ZIP is not compact');
console.log(JSON.stringify({ stage: '10-P-A', passed: true, entries: entries.length, bytes: fs.statSync(zipPath).size, forbiddenEntries: forbidden.length }));
