import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { coverageText } from '../universal-planner/coverage-dashboard.js';

const planner = new URL('../universal-planner/', import.meta.url);
const coverage = JSON.parse(fs.readFileSync(new URL('scenarios/coverage.json', planner), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('screenshots/manifest.json', planner), 'utf8'));
assert.equal(coverage.canonicalCount, 120); assert.equal(coverage.fuzzCount, 1000); assert.deepEqual(coverage.planFailures, []); assert.deepEqual(coverage.continuousLayoutFailures, []); assert.deepEqual(coverage.semanticFailures, []);
for (const key of ['byTerrain', 'byMissionKind', 'byMissionId', 'byStrategy', 'byResult', 'byArchetype', 'byFriendlyActorCount', 'byEnemyActorCount']) assert.ok(Object.keys(coverage.total[key]).length);
for (const result of ['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped']) assert.ok(coverage.canonical.byResult[result] >= 10);
assert.equal(coverage.missionResultMatrix.totalCells, 60); assert.equal(coverage.missionResultMatrix.coveredCells, 44); assert.equal(coverage.missionResultMatrix.unobservedCells.length, 16);
assert.ok(!coverageText(coverage).includes('undefined'), 'coverage dashboard must not display undefined fields'); assert.match(coverageText(coverage), /mission×result 44\/60/);
assert.ok(coverage.fuzz.friendTypesSequences.length >= 50); assert.equal(manifest.screenshots.length, 12); assert.equal(manifest.sha256Unique, true); assert.deepEqual(manifest.pageErrors, []); assert.deepEqual(manifest.consoleErrors, []);
assert.deepEqual(manifest.screenshots.map((item) => item.file), ['01-repair-contact.png', '02-multiple-repair-contact.png', '03-convoy-victory-clear.png', '04-convoy-withdraw-returned.png', '05-convoy-wiped-stopped.png', '06-salvage-standoff.png', '07-fortified-obstacle-routing.png', '08-wreck-avoidance.png', '09-withdraw-obstacle-routing.png', '10-many-actors-no-collision.png', '11-pyrrhic-partial-objective.png', '12-spatial-debug-overlay.png']);
const times = new Set(manifest.screenshots.map((item) => item.actualTime)); assert.ok(times.size >= 8, 'dynamic evidence uses distinct times');
for (const item of manifest.screenshots) { assert.ok(item.planFingerprint); assert.ok(Number.isFinite(item.requestedTime)); assert.ok(Number.isFinite(item.actualTime)); assert.ok(item.currentPositionsHash); assert.ok(item.result); assert.ok(Array.isArray(item.activeActions)); assert.match(item.pngSha256, /^[a-f0-9]{64}$/); }
const evidence = Object.fromEntries(manifest.screenshots.map((item) => [item.file, item]));
assert.equal(evidence['03-convoy-victory-clear.png'].missionId, 'convoy_escort'); assert.equal(evidence['03-convoy-victory-clear.png'].result, 'victory');
assert.equal(evidence['04-convoy-withdraw-returned.png'].missionId, 'convoy_escort'); assert.equal(evidence['04-convoy-withdraw-returned.png'].result, 'withdraw');
assert.equal(evidence['05-convoy-wiped-stopped.png'].missionId, 'convoy_escort'); assert.equal(evidence['05-convoy-wiped-stopped.png'].result, 'wiped');
const digest = crypto.createHash('sha256').update(JSON.stringify(manifest.screenshots)).digest('hex'); assert.equal(digest.length, 64);
console.log('universal-presentation-delivery-test: delivery manifest passed');
