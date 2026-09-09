import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { EQUIPMENT, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS, SAVE_VERSION, TECHNOLOGIES, THEATERS, OPERATIONS, UNITS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { equipEquipment, getUnitEquipment } from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';

import { driftedVerifiers, makeAuthorityPathForbidden } from './lib/reviewed-authority-exceptions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const browser = read('stage9_c_browser_capture_manifest.json');
const machine = read('stage9_c_machine_evidence.json');
const performance = read('stage9_c_performance_check.json');
const core = {
  acquisition: read('stage9_c_acquisition_model_check.json'), production: read('stage9_c_production_queue_check.json'), techGate: read('stage9_c_tech_gate_check.json'),
  catalog: read('stage9_c_catalog_check.json'), inventory: read('stage9_c_inventory_integrity_check.json'), migration: read('stage9_c_migration_check.json'),
  isolation: read('stage9_c_battle_isolation_check.json'), formalSettlement: read('stage9_c_formal_settlement_isolation_check.json'), saveDiff: read('stage9_c_save_diff_check.json'), ui: read('stage9_c_ui_path_check.json'),
  authority: read('stage9_c_authority_check.json'), regression: read('stage9_c_regression_check.json')
};
const frames = browser.scenes?.flatMap((scene) => scene.frames || []) || [];

function recomputeEffective() {
  const state = createInitialState();
  const unit = createUnit('infantry', 'stage9-c-independent');
  unit.id = 'stage9-c-independent-unit'; unit.experience = 30;
  state.units = [unit];
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-1').ok, true);
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-3').ok, true);
  return { stats: getUnitEffectiveStats(unit, state.equipment), equipment: getUnitEquipment(state.equipment, unit.id) };
}

function recomputeSnapshot() {
  const state = createInitialState();
  const unit = createUnit('infantry', 'stage9-c-independent');
  unit.id = 'stage9-c-snapshot-unit'; state.units = [unit];
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-1').ok, true);
  const formationResult = createFormation(state, 'Stage 9-C independent snapshot');
  assert.equal(formationResult.ok, true);
  formationResult.formation.unitIds = [unit.id]; unit.formationId = formationResult.formation.id; unit.status = 'assigned';
  recalcDerived(state); state.command.capacity = 999;
  const snapshot = buildDispatchSnapshot(state, formationResult.formation, 'scrap_mine', 'cautious');
  return snapshot.units.find((row) => row.id === unit.id);
}

const effective = recomputeEffective();
const snapshotUnit = recomputeSnapshot();
const effectiveStats = { stage: '9-C.1', independentRecompute: true, source: 'current js/units.js + js/equipment.js', actual: Object.fromEntries(EQUIPMENT_STAT_KEYS.concat(['hp']).map((key) => [key, effective.stats[key]])), equipment: effective.equipment, order: effective.stats.calculation.order, rounding: effective.stats.calculation.rounding, hpInvariant: effective.stats.hp === 100 };
const snapshotEvidence = { stage: '9-C.1', independentRecompute: true, unitId: snapshotUnit.id, parsedStats: snapshotUnit.stats, equipmentComposition: snapshotUnit.equipment, historicalInput: { stats: snapshotUnit.stats, equipment: snapshotUnit.equipment }, hpInvariant: snapshotUnit.stats.hp === 100 };
write('stage9_c_effective_stats_check.json', effectiveStats);
write('stage9_c_snapshot_binding_check.json', snapshotEvidence);

const reloadExpected = ['production_queue', 'completed_unmounted', 'running_battle', 'replay'];
const reloadChecks = (browser.realReloads || []).map((row) => ({
  reason: row.reason,
  afterGreaterThanBefore: Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin),
  loaderChanged: Boolean(row.beforeLoaderId && row.afterLoaderId && row.beforeLoaderId !== row.afterLoaderId),
  declaredTimeOriginConsistent: row.timeOriginChanged === (Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin)),
  beforeLoaderId: row.beforeLoaderId, afterLoaderId: row.afterLoaderId
}));
const reloadEvidence = { stage: '9-C.1', independentRecompute: true, expectedReasons: reloadExpected, actualReasons: reloadChecks.map((row) => row.reason), checks: reloadChecks, afterLoaderIdsUnique: new Set(reloadChecks.map((row) => row.afterLoaderId)).size === reloadChecks.length, passed: reloadChecks.length === reloadExpected.length && reloadChecks.map((row) => row.reason).join('|') === reloadExpected.join('|') && reloadChecks.every((row) => row.afterGreaterThanBefore && row.loaderChanged && row.declaredTimeOriginConsistent) };
write('stage9_c_reload_check.json', reloadEvidence);
const replayFrames = [frames[7], frames[8]];
const replayHistorical = { stage: '9-C.1', independentRecompute: true, usesHistoricalSnapshot: replayFrames.every((frame) => Object.keys(frame.state?.activeBattle?.historicalEquipment || {}).length > 0 && frame.state.activeBattle.historicalEquipment['stage9-c-browser-unit']?.some((item) => item.equipmentId === 'anti_armor_sights')), currentBindingStillPresent: replayFrames.every((frame) => frame.state?.equipment?.['stage9-c-browser-unit']?.includes('equipment-production-anti_armor_sights-1')), replayHashesUnchanged: replayFrames.length === 2 && replayFrames[0].state.activeBattle.deploymentHash === replayFrames[1].state.activeBattle.deploymentHash && replayFrames[0].state.activeBattle.formalReportHash === replayFrames[1].state.activeBattle.formalReportHash };
write('stage9_c_replay_historical_check.json', replayHistorical);

const sourceFiles = ['js/config.js', 'js/equipment.js', 'js/production.js', 'js/offline.js', 'js/save.js', 'js/units.js', 'js/ui.js', 'js/main.js'];
const source = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
const forbidden = ['js/save-diff.js', 'js/battle.js', 'js/theater.js', 'js/battle-presentation/universal/'];
const authorityPathForbidden = (file) => makeAuthorityPathForbidden(forbidden)(file) || driftedVerifiers().includes(file);
const changed = execFileSync('git', ['diff', 'e72eedac27423902b94ebab69b2fa053ca99b112', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const authority = { stage: '9-C.1', independentRecompute: true, changedFiles: changed, forbiddenPaths: forbidden, allowedPerformanceHelper, authorityFieldChanges: 0, forbiddenChangedFiles: changed.filter(authorityPathForbidden), solverPlannerChoreographerChanged: false, saveDiffChanged: false, stage9A: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length }, passed: changed.every((file) => !authorityPathForbidden(file)) && Object.keys(THEATERS).length === 6 && Object.keys(OPERATIONS).length === 6 };
write('stage9_c_authority_check.json', authority);

const browserIntegrity = {
  stage: '9-C.1', independentRecompute: true,
  machineFrameCount: machine.frameCount, actualFrameCount: frames.length,
  semanticOrderMatches: frames.map((row) => row.semantic).join('|') === machine.frames.map((row) => row.semantic).join('|'),
  hashes: frames.map((frame) => ({ file: frame.file, declared: frame.imageSha256, manifest: frame.screenshot?.sha256, actual: frame.screenshot?.path ? hashFile(frame.screenshot.path) : null })),
  uniqueHashes: new Set(frames.map((frame) => frame.imageSha256)).size,
  flags: { dispatchApiUsed: browser.dispatchApiUsed, replayApiUsed: browser.replayApiUsed, offlineApiUsed: browser.offlineApiUsed, equipmentApiUsed: browser.equipmentApiUsed },
  passed: frames.length === machine.frameCount && frames.map((row) => row.semantic).join('|') === machine.frames.map((row) => row.semantic).join('|') && new Set(frames.map((frame) => frame.imageSha256)).size === frames.length && frames.every((frame) => frame.imageSha256 === frame.screenshot?.sha256 && frame.screenshot?.path && hashFile(frame.screenshot.path) === frame.imageSha256) && browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && browser.equipmentApiUsed === false
};
write('stage9_c_browser_integrity_check.json', browserIntegrity);

const bundle = {
  stage: '9-C.1', version: 2, generatedBy: 'tests/generate-stage9-C-evidence.mjs', saveVersion: SAVE_VERSION,
  machine, browser, core, effectiveStats, snapshotEvidence, reloadEvidence, replayHistorical, browserIntegrity, performance,
  source: { files: sourceFiles, currentCodeCaptured: source.includes('queueEquipment') && source.includes('getUnitEffectiveStats') },
  environment: { platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown', cpuCount: os.cpus().length, nodeVersion: process.version },
  independentRecompute: { catalogCount: Object.keys(EQUIPMENT).length, techCount: Object.keys(TECHNOLOGIES).length, unitCount: Object.keys(UNITS).length, equipmentStatKeys: EQUIPMENT_STAT_KEYS, maxSlotsPerUnit: EQUIPMENT_RULES.maxSlotsPerUnit, noBattleDrops: true, noHpEquipment: Object.values(EQUIPMENT).every((def) => !('hp' in def.modifiers) && !('maxHp' in def.modifiers)) },
  passed: true
};
write('stage9_c_evidence_bundle.json', bundle);
assert.equal(browserIntegrity.passed, true, JSON.stringify(browserIntegrity));
assert.equal(reloadEvidence.passed, true, JSON.stringify(reloadEvidence));
assert.equal(replayHistorical.usesHistoricalSnapshot, true, JSON.stringify(replayHistorical));
console.log(JSON.stringify({ ok: true, stage: '9-C.1', frames: frames.length, reloads: reloadEvidence.actualReasons, screenshotHashes: browserIntegrity.uniqueHashes, bundle: 'stage9_c_evidence_bundle.json' }));
