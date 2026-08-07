import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCorpus } from '../universal-planner/scenario-corpus-generator.mjs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';

const corpus = buildCorpus();
const rows = [...corpus.canonical, ...corpus.fuzz];
assert.equal(corpus.canonical.length, 120);
assert.equal(corpus.fuzz.length, 1000);
assert.equal(rows.length, 1120);
assert.deepEqual(corpus.coverage.planFailures, []);
for (const key of ['byTerrain', 'byMissionKind', 'byMissionId', 'byStrategy', 'byResult', 'byArchetype', 'byFriendlyActorCount', 'byEnemyActorCount']) assert.ok(Object.keys(corpus.coverage.total[key]).length > 0, `coverage: ${key}`);
for (const result of ['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped']) assert.ok(corpus.coverage.canonical.byResult[result] >= 10, `result coverage: ${result}`);
assert.ok(corpus.coverage.fuzz.friendTypesSequences.length >= 50);
for (const key of ['repairEvents', 'friendlyLoss', 'enemyArmor', 'initialDamage', 'experiencedUnits', 'ambushed', 'enemyRevealed', 'revealHighThreat']) assert.ok(corpus.coverage.total[key].present > 0 || corpus.coverage.total[key].true > 0, `semantic coverage: ${key}`);
assert.equal(new Set(rows.map((row) => row.reportId)).size, rows.length);
assert.equal(new Set(rows.map((row) => row.planHash)).size, rows.length);
assert.equal(Math.min(...rows.map((row) => row.friendlyCount)), 1);
assert.equal(Math.max(...rows.map((row) => row.friendlyCount)), 8);
assert.ok(Math.min(...rows.map((row) => row.enemyCount)) >= 2);
assert.ok(Math.max(...rows.map((row) => row.enemyCount)) <= 10);
assert.equal(Math.max(...rows.map((row) => row.actorCount)), 18);
for (const row of rows) assert.equal(buildUniversalPlan(row.report).ok, true, `corpus plan: ${row.id}`);

const diskCoverage = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/coverage.json', import.meta.url), 'utf8'));
assert.deepEqual(diskCoverage, corpus.coverage);
console.log(`universal-presentation-corpus-test: ${rows.length} plans passed`);
