import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BATTLE_RESULT } from '../js/config.js';
import { createRng, hashString } from '../js/utils.js';
import { simulateBattle } from '../js/battle.js';
import { compareBattleReports, validateBattleOutcomeConsistency } from '../js/integrity.js';
import {
  buildTargetRanking, chooseTargetDeterministically, compareTargetRanking,
  insertionSortRanking, mergeSortRanking, nativeSortRanking
} from '../js/battle-targeting.js';
import { SCENARIOS, rebuildScenarioInput } from '../experiments/battle-sandbox/report-adapter/fixture-scenarios.js';
import { stableStringify } from '../experiments/battle-sandbox/report-adapter/report-normalizer.js';

let total = 0;
let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`); } catch (error) { console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}: ${error.message}`); throw error; } }
const actor = { id: 'actor-1', category: 'infantry' };
const target = (id, category = 'infantry', hp = 50) => ({ id, category, hp, alive: true });
const ids = (ranking) => ranking.map((row) => row.id);
const reportFor = (scenario, seed, sortImplementation) => simulateBattle({ ...rebuildScenarioInput({ ...scenario, seed }), seed, targetSortImplementation: sortImplementation });
const fixtureRoot = path.resolve('experiments/battle-sandbox/report-adapter');

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2D-A.3 跨引擎确定性测试');
console.log('════════════════════════════════════════════');
check('targeting module exists', () => assert.equal(typeof chooseTargetDeterministically, 'function'));
check('target comparator source has no RNG call', () => { const source = fs.readFileSync('js/battle-targeting.js', 'utf8'); assert.doesNotMatch(source, /compareTargetRanking[\s\S]*?rng\s*\(/); assert.doesNotMatch(source, /\.sort\([\s\S]*?rng\s*\(/); });
check('comparator is stable across 100 calls', () => { const [a, b] = buildTargetRanking(actor, [target('a'), target('b')], 4); const values = Array.from({ length: 100 }, () => compareTargetRanking(a, b)); assert.equal(new Set(values).size, 1); });
check('comparator is antisymmetric', () => { const [a, b] = buildTargetRanking(actor, [target('a'), target('b')], 4); assert.equal(Math.sign(compareTargetRanking(a, b)), -Math.sign(compareTargetRanking(b, a))); });
check('comparator is transitive for sampled triples', () => { const ranking = buildTargetRanking(actor, [target('a', 'infantry', 40), target('b', 'infantry', 40), target('c', 'support', 60)], 9); for (const a of ranking) for (const b of ranking) for (const c of ranking) if (compareTargetRanking(a, b) < 0 && compareTargetRanking(b, c) < 0) assert.ok(compareTargetRanking(a, c) < 0); });
check('comparator does not mutate ranking objects', () => { const ranking = buildTargetRanking(actor, [target('a'), target('b')], 4); const before = structuredClone(ranking); compareTargetRanking(ranking[0], ranking[1]); assert.deepEqual(ranking, before); });
check('empty targets return null without RNG', () => { let count = 0; const rng = { int() { count += 1; return 1; } }; assert.equal(chooseTargetDeterministically(actor, [], rng), null); assert.equal(count, 0); });
check('single target returns it', () => { const only = target('only'); assert.equal(chooseTargetDeterministically(actor, [only], createRng(1)), only); });
check('non-empty selection consumes exactly one RNG draw', () => { let count = 0; const rng = { int() { count += 1; return 1; } }; chooseTargetDeterministically(actor, [target('a'), target('b')], rng); assert.equal(count, 1); });
check('RNG draw count is independent of candidate count', () => { for (const count of [1, 2, 5, 12]) { let draws = 0; const rng = { int() { draws += 1; return 7; } }; chooseTargetDeterministically(actor, Array.from({ length: count }, (_, i) => target(`u-${i}`)), rng); assert.equal(draws, 1); } });
check('native and insertion ordering agree for 1000 candidate sets', () => { for (let seed = 1; seed <= 1000; seed += 1) { const candidates = Array.from({ length: 2 + (seed % 11) }, (_, i) => target(`u-${(seed * 37 + i * 13) % 17}`, ['infantry', 'support', 'vehicle', 'armor'][i % 4], (seed + i * 7) % 61)); const ranking = buildTargetRanking(actor, candidates, hashString(`salt:${seed}`)); assert.deepEqual(ids(nativeSortRanking(ranking)), ids(insertionSortRanking(ranking))); } });
check('native and merge ordering agree for 1000 candidate sets', () => { for (let seed = 1; seed <= 1000; seed += 1) { const candidates = Array.from({ length: 2 + (seed % 11) }, (_, i) => target(`u-${(seed * 19 + i * 5) % 23}`, ['infantry', 'support', 'vehicle', 'armor'][i % 4], (seed + i * 11) % 53)); const ranking = buildTargetRanking(actor, candidates, hashString(`salt:${seed}`)); assert.deepEqual(ids(nativeSortRanking(ranking)), ids(mergeSortRanking(ranking))); } });
check('input permutation does not change winner', () => { const candidates = [target('a'), target('b'), target('c'), target('d')]; const expected = chooseTargetDeterministically(actor, candidates, createRng(33)); for (const order of [[3, 1, 0, 2], [2, 0, 3, 1], [1, 3, 2, 0]]) assert.equal(chooseTargetDeterministically(actor, order.map((i) => candidates[i]), createRng(33)).id, expected.id); });
check('fully tied targets remain stable and different salts can vary order', () => { const candidates = ['a', 'b', 'c', 'd'].map((id) => target(id)); const winners = new Set(Array.from({ length: 32 }, (_, i) => chooseTargetDeterministically(actor, candidates, createRng(i + 1)).id)); assert.ok(winners.size > 1); });
check('seed does not change an unambiguous priority winner', () => { const candidates = [target('armor', 'armor', 1), target('infantry', 'infantry', 100)]; for (let seed = 1; seed <= 32; seed += 1) assert.equal(chooseTargetDeterministically(actor, candidates, createRng(seed)).id, 'infantry'); });
check('all formal fixtures agree across three sort implementations for seeds 1..200', () => { for (const scenario of SCENARIOS) for (let seed = 1; seed <= 200; seed += 1) { const native = reportFor(scenario, seed, 'native'); assert.equal(validateBattleOutcomeConsistency(native).ok, true); for (const implementation of ['insertion', 'merge']) assert.equal(compareBattleReports(native, reportFor(scenario, seed, implementation)).ok, true, `${scenario.id} seed ${seed} ${implementation}`); } });
check('legacy seed 2 remains a valid withdraw', () => { const scenario = { unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road' }; const report = reportFor(scenario, 2, 'native'); assert.equal(report.result, BATTLE_RESULT.WITHDRAW); assert.equal(report.capture, false); assert.deepEqual(report.rewards, {}); assert.equal(report.events.filter((event) => event.type === 'retreat').length, 1); assert.equal(validateBattleOutcomeConsistency(report).ok, true); });
check('formal source scan excludes RNG in sort comparators and wall clock', () => { const source = fs.readFileSync('js/battle.js', 'utf8').split('export function issueCommand')[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); assert.doesNotMatch(source, /\.sort\([\s\S]{0,600}\brng(?:Ref)?\s*\(/); assert.doesNotMatch(source, /Date\.now\s*\(/); assert.ok(fs.existsSync(path.join(fixtureRoot, 'fixture-manifest.json'))); });
check('manifest boundary includes targeting and RNG utility', () => { const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture-manifest.json'), 'utf8')); assert.ok(manifest.formalBoundaryFiles.includes('js/battle-targeting.js')); assert.ok(manifest.formalBoundaryFiles.includes('js/utils.js')); });

console.log(`stage8-2D-A-3-test: ${passed} passed / ${total} total`);
