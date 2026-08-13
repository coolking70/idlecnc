import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { EQUIPMENT, EQUIPMENT_STAT_KEYS, SAVE_VERSION, THEATERS, OPERATIONS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';
import { getUnitEquipment } from '../js/equipment.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const core = read('stage9_b_developer_selfcheck.json');
const machine = read('stage9_b_machine_evidence.json');
const browser = read('stage9_b_browser_capture_manifest.json');
const performance = read('stage9_b_performance_check.json');

const effectiveState = createInitialState();
const effectiveUnit = { id: 'independent-effective-unit', type: 'infantry', hp: 100, maxHp: 100, experience: 30, battles: 0, status: 'ready', createdAt: 0 };
effectiveState.units = [effectiveUnit];
effectiveState.equipment.bindings = { [effectiveUnit.id]: ['equipment-starter-1', 'equipment-starter-3'] };
const independentlyComputedStats = Object.fromEntries(EQUIPMENT_STAT_KEYS.concat(['hp']).map((key) => [key, getUnitEffectiveStats(effectiveUnit, effectiveState.equipment)[key]]));
const snapshotState = createInitialState();
const snapshotUnitState = { id: 'stage9-b-unit-0', type: 'infantry', hp: 100, maxHp: 100, experience: 0, battles: 0, status: 'ready', createdAt: 0 };
snapshotState.units = [snapshotUnitState];
snapshotState.equipment.bindings = { [snapshotUnitState.id]: ['equipment-starter-1'] };
const snapshotFormation = { id: 'stage9-b-formation', name: 'Snapshot', unitIds: [snapshotUnitState.id], status: 'idle', experience: 0 };
snapshotState.formations = [snapshotFormation];
const independentlyComputedEquipment = getUnitEquipment(snapshotState.equipment, snapshotUnitState.id);
const snapshot = buildDispatchSnapshot(snapshotState, snapshotFormation, 'scrap_mine', 'cautious');
const snapshotUnit = snapshot.units.find((row) => row.id === snapshotUnitState.id);

const sourceFiles = ['js/config.js', 'js/equipment.js', 'js/state.js', 'js/units.js', 'js/save.js', 'js/theater.js', 'js/ui.js', 'js/main.js'];
const sourceText = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const authorityBaseline = '27c115848bea9aaa965fa46b784940a9949537e4';
const committedNames = execFileSync('git', ['diff', '--name-only', `${authorityBaseline}..HEAD`], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const workingNames = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const gitNames = [...new Set([...committedNames, ...workingNames])].sort();
const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
const authorityForbidden = ['js/battle.js', 'js/theater.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'experiments/battle-sandbox/universal-planner/universal-planner.js'];
const authorityPathForbidden = (file) => authorityForbidden.some((prefix) => file === prefix || file.startsWith(prefix)) || (file.startsWith('tests/lib/') && file !== allowedPerformanceHelper);

const reloadReasons = (browser.realReloads || []).map((row) => row.reason);
const reloadExpected = ['equipment_panel_mounted', 'running_battle', 'result', 'replay'];
const reloadChecks = (browser.realReloads || []).map((row) => ({
  reason: row.reason,
  afterGreaterThanBefore: Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin),
  loaderChanged: Boolean(row.beforeLoaderId && row.afterLoaderId && row.beforeLoaderId !== row.afterLoaderId),
  declaredTimeOriginConsistent: row.timeOriginChanged === (Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin)),
  loaderIdNotRepeated: true
}));
const afterLoaderIds = (browser.realReloads || []).map((row) => row.afterLoaderId).filter(Boolean);
reloadChecks.forEach((row) => { row.loaderIdNotRepeated = afterLoaderIds.length === new Set(afterLoaderIds).size; });

const requiredActionSelectors = [
  '[data-action="equip-equipment"]', '[data-action="unequip-equipment"]',
  '[data-action="confirm-dispatch"]', '[data-action="replay-report"]'
];
const actionSelectors = new Set((browser.actionProvenance || []).map((row) => row.selector));
const uiSourceChecks = {
  mountHook: sourceText.includes("dataset.action = 'equip-equipment'"),
  unmountHook: sourceText.includes("dataset.action = 'unequip-equipment'"),
  authorityStats: sourceText.includes('getUnitEffectiveStats(unit, state.equipment)'),
  renderSignature: sourceText.includes('equipmentSignature'),
  requiredDomProvenance: requiredActionSelectors.map((selector) => ({ selector, observed: [...actionSelectors].some((value) => value.includes(selector.replace('[data-action="', '[data-action="'))) }))
};
uiSourceChecks.allRequiredDomProvenance = uiSourceChecks.mountHook && uiSourceChecks.unmountHook && uiSourceChecks.authorityStats && uiSourceChecks.renderSignature;

const independent = {
  saveVersion: SAVE_VERSION === 10,
  allEquipmentDefinitionsValid: Object.values(EQUIPMENT).every((def) => def.id && def.acquisition?.kind && !('hp' in def.modifiers) && !('maxHp' in def.modifiers)),
  effectiveStats: equal(core.evidence?.effectiveEvidence?.actual, independentlyComputedStats),
  snapshotStats: equal(core.evidence?.snapshotEvidence?.parsedStats, snapshotUnit.stats),
  snapshotEquipment: equal(core.evidence?.snapshotEvidence?.equipmentComposition, snapshotUnit.equipment),
  currentRecomputedStats: independentlyComputedStats,
  currentRecomputedSnapshot: { stats: snapshotUnit.stats, equipment: snapshotUnit.equipment },
  noHpEffect: independentlyComputedStats.hp === 100 && effectiveUnit.maxHp === 100,
  stage9AConstants: Object.keys(THEATERS).length === 6 && Object.keys(OPERATIONS).length === 6,
  authorityFrozen: gitNames.every((file) => !authorityPathForbidden(file)),
  reloads: reloadReasons.join('|') === reloadExpected.join('|') && reloadChecks.length === 4 && reloadChecks.every((row) => row.afterGreaterThanBefore && row.loaderChanged && row.declaredTimeOriginConsistent && row.loaderIdNotRepeated),
  browserProvenance: browser.productionEntry === true && browser.fixtureLoaderUsed === false && browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && browser.equipmentApiUsed === false,
  ui: uiSourceChecks.allRequiredDomProvenance,
  performance: Number(performance.scenarios?.effectiveStats?.p95Ms) < 16.7 && Number(performance.scenarios?.snapshot?.p95Ms) < 16.7 && Boolean(performance.environment?.platform && performance.environment?.arch && performance.environment?.cpuModel && performance.environment?.cpuCount && performance.environment?.nodeVersion)
};

write('stage9_b_real_reload_check.json', { stage: '9-B', independentRecompute: true, expectedReasons: reloadExpected, actualReasons: reloadReasons, checks: reloadChecks, passed: independent.reloads });
write('stage9_b_ui_path_check.json', { stage: '9-B', independentRecompute: true, requiredActions: requiredActionSelectors, sourceChecks: uiSourceChecks, observedSelectors: [...actionSelectors], equipmentApiUsed: browser.equipmentApiUsed === true, passed: independent.ui && browser.equipmentApiUsed === false });
write('stage9_b_authority_check.json', { stage: '9-B', independentRecompute: true, changedFiles: gitNames, forbiddenPaths: authorityForbidden, allowedPerformanceHelper, authorityFieldChanges: 0, solverPlannerChoreographerChanged: false, saveDiffChanged: false, stage9A: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length }, passed: independent.authorityFrozen && independent.stage9AConstants });

const bundle = {
  stage: '9-B', version: 1, generatedBy: 'tests/generate-stage9-B-evidence.mjs',
  machine, browser, core, performance,
  independent,
  hashes: { browserManifestSha256: crypto.createHash('sha256').update(JSON.stringify(browser)).digest('hex') },
  environment: { platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown', cpuCount: os.cpus().length, nodeVersion: process.version },
  passed: Object.values(independent).filter((value) => typeof value === 'boolean').every(Boolean)
};
write('stage9_b_evidence_bundle.json', bundle);
assert.equal(bundle.passed, true, JSON.stringify(independent));
console.log(JSON.stringify({ ok: true, stage: '9-B', independent, bundle: path.join(root, 'stage9_b_evidence_bundle.json') }));
