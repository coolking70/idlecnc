import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCorpus } from './scenario-corpus-generator.mjs';

const dir = new URL('./scenarios/', import.meta.url);
const disk = JSON.parse(fs.readFileSync(new URL('coverage.json', dir), 'utf8'));
const generated = buildCorpus();
assert.deepEqual(disk, generated.coverage, 'disk coverage differs from deterministic rebuild');
assert.equal(disk.canonicalCount, 120); assert.equal(disk.fuzzCount, 1000); assert.deepEqual(disk.planFailures, []); assert.deepEqual(disk.continuousLayoutFailures, []); assert.deepEqual(disk.semanticFailures, []);
for (const result of ['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped']) assert.ok(disk.canonical.byResult[result] >= 10, `canonical result quota: ${result}`);
assert.equal(disk.missionResultMatrix.totalCells, 60); assert.equal(disk.missionResultMatrix.coveredCells, 44);
assert.deepEqual(disk.missionResultMatrix.unobservedCells, [
  { missionId: 'enemy_outpost', result: 'victory' },
  { missionId: 'enemy_outpost', result: 'pyrrhic' },
  { missionId: 'enemy_outpost', result: 'defeat' },
  { missionId: 'mountain_pass', result: 'victory' },
  { missionId: 'mountain_pass', result: 'pyrrhic' },
  { missionId: 'outpost_sweep', result: 'victory' },
  { missionId: 'outpost_sweep', result: 'pyrrhic' },
  { missionId: 'outpost_sweep', result: 'defeat' },
  { missionId: 'pass_patrol', result: 'victory' },
  { missionId: 'pass_patrol', result: 'pyrrhic' },
  { missionId: 'relay_intercept', result: 'victory' },
  { missionId: 'relay_intercept', result: 'pyrrhic' },
  { missionId: 'relay_intercept', result: 'defeat' },
  { missionId: 'relay_station', result: 'defeat' },
  { missionId: 'river_crossing', result: 'defeat' },
  { missionId: 'salvage_run', result: 'defeat' }
]);
for (const result of ['victory', 'withdraw', 'wiped']) assert.ok(disk.missionResultMatrix.cells.some((cell) => cell.missionId === 'convoy_escort' && cell.result === result && cell.canonical > 0), `canonical convoy evidence: ${result}`);
assert.ok(disk.fuzz.friendTypesSequences.length >= 50, 'fuzz roster sequence coverage');
console.log(JSON.stringify({ ok: true, canonical: disk.canonicalCount, fuzz: disk.fuzzCount, total: disk.total.total, planFailures: disk.planFailures.length, friendTypesSequences: disk.fuzz.friendTypesSequences.length }, null, 2));
