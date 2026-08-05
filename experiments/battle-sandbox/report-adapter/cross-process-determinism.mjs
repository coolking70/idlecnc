import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const childSource = String.raw`
  import fs from 'node:fs';
  import crypto from 'node:crypto';
  import { simulateBattle } from './js/battle.js';
  import { SCENARIOS, rebuildScenarioInput } from './experiments/battle-sandbox/report-adapter/fixture-scenarios.js';
  import { stableStringify } from './experiments/battle-sandbox/report-adapter/report-normalizer.js';
  const hash = (value) => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
  const result = {};
  for (const scenario of SCENARIOS) {
    const fixture = JSON.parse(fs.readFileSync('./experiments/battle-sandbox/report-adapter/fixtures/' + scenario.id + '.json', 'utf8'));
    const input = rebuildScenarioInput(fixture.scenario);
    result[scenario.id] = hash(simulateBattle({ ...input, seed: fixture.scenario.seed }));
  }
  process.stdout.write(JSON.stringify(result));
`;

const runs = [];
for (let i = 0; i < 8; i += 1) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: projectRoot, encoding: 'utf8'
  });
  if (child.status !== 0) throw new Error(`cross-process child ${i + 1} failed:\n${child.stderr || child.stdout}`);
  try { runs.push(JSON.parse(child.stdout)); }
  catch (error) { throw new Error(`cross-process child ${i + 1} emitted invalid JSON: ${child.stdout}`); }
}

const ids = Object.keys(runs[0] || {});
for (const id of ids) {
  const hashes = runs.map((run) => run[id]);
  const same = new Set(hashes).size === 1;
  console.log(`${id}:`);
  console.log(`  ${hashes.length} / ${hashes.length} ${same ? 'same' : 'different'}`);
  console.log(`  hash: ${hashes[0]}`);
  if (!same) process.exitCode = 1;
}
if (process.exitCode) throw new Error('cross-process deterministic hashes differ');
