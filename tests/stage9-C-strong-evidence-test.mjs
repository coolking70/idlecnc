import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { EQUIPMENT, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS, PRODUCTION, SAVE_VERSION, TECHNOLOGIES, THEATERS, OPERATIONS, UNITS } from '../js/config.js';
import { createInitialState, createBuilding } from '../js/state.js';
import { createUnit, queueEquipment, canQueueEquipment } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { equipEquipment, getUnitEquipment, canEquipEquipment } from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';
import { migrate } from '../js/save.js';
import { computeSaveDiff } from '../js/save-diff.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const starterBaseline = {
  scout_optics: { applicableTypes: ['infantry', 'at_infantry', 'scout_car'], modifiers: { scouting: 1.15, mobility: 1.03 }, acquisition: { kind: 'starter', label: '初始装备补给' } },
  reinforced_chassis: { applicableTypes: ['scout_car', 'mbt', 'repair_vehicle'], modifiers: { defense: 1.08, mobility: 1.04 }, acquisition: { kind: 'starter', label: '初始装备补给' } },
  field_toolkit: { applicableTypes: ['infantry', 'repair_vehicle'], modifiers: { repair: 1.2, defense: 1.02 }, acquisition: { kind: 'starter', label: '初始装备补给' } }
};

function fixture(techs = []) {
  const state = createInitialState();
  state.resources = { supply: 4000, alloy: 4000, intel: 400 };
  state.unlocks.units = Object.keys(UNITS); state.research.completed = techs.slice();
  state.buildings.push({ ...createBuilding('armor_factory'), id: 'stage9-c-strong-factory', status: 'operational', progress: 1 });
  recalcDerived(state); state.resources = { supply: 4000, alloy: 4000, intel: 400 };
  return state;
}

function sourceChangedFiles() {
  return execFileSync('git', ['diff', 'e72eedac27423902b94ebab69b2fa053ca99b112', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function verifyCatalog(fail) {
  if (Object.keys(EQUIPMENT).length < 8) fail('catalog_count');
  Object.entries(starterBaseline).forEach(([id, expected]) => { if (!equal({ applicableTypes: EQUIPMENT[id]?.applicableTypes, modifiers: EQUIPMENT[id]?.modifiers, acquisition: EQUIPMENT[id]?.acquisition }, expected)) fail('starter_definition', id); });
  const production = Object.values(EQUIPMENT).filter((def) => def?.acquisition?.kind === 'production');
  Object.keys(UNITS).forEach((type) => { if (production.filter((def) => def.applicableTypes.includes(type)).length < 2) fail('unit_coverage', type); });
  production.forEach((def) => {
    if (!def.requiresTech || !TECHNOLOGIES[def.requiresTech]) fail('tech_reference', def.id);
    if (def.acquisition.building !== 'armor_factory' || !(def.acquisition.buildTime > 0)) fail('production_acquisition', def.id);
    if (Object.keys(def.modifiers).some((key) => !EQUIPMENT_STAT_KEYS.includes(key) || key === 'hp' || key === 'maxHp')) fail('illegal_modifier', def.id);
  });
  for (let i = 1; i < production.length; i += 1) {
    if (!(production[i].acquisition.buildTime > production[i - 1].acquisition.buildTime && production[i].acquisition.cost.supply > production[i - 1].acquisition.cost.supply && production[i].acquisition.cost.alloy > production[i - 1].acquisition.cost.alloy)) fail('production_curve', `${production[i - 1].id}->${production[i].id}`);
  }
}

function verifyBrowser(candidate, fail, checkFiles) {
  const machine = candidate.machine || {};
  const browser = candidate.browser || {};
  const frames = browser.scenes?.flatMap((scene) => scene.frames || []) || [];
  const frameStates = frames.map((frame) => frame.state || {});
  if (machine.stage !== '9-C' || machine.frameCount !== 9 || frames.length !== 9) fail('frame_count');
  if (machine.frames?.map((row) => row.semantic).join('|') !== frames.map((row) => row.semantic).join('|')) fail('semantic_frame_order');
  ['dispatchApiUsed', 'replayApiUsed', 'offlineApiUsed', 'equipmentApiUsed'].forEach((key) => { if (browser[key] !== false || machine[key] !== false) fail('api_provenance', key); });
  if (browser.browser?.captureCount !== 9 || browser.browser?.uniqueImageHashes !== 9) fail('capture_count');
  const hashes = new Set();
  frames.forEach((frame) => {
    if (!frame.imageSha256 || hashes.has(frame.imageSha256) || frame.imageSha256 !== frame.screenshot?.sha256) fail('screenshot_hash_declared', frame.file);
    hashes.add(frame.imageSha256);
    if (checkFiles && (!frame.screenshot?.path || hashFile(frame.screenshot.path) !== frame.imageSha256)) fail('screenshot_hash_actual', frame.file);
  });
  if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('browser_errors');
  const required = ['produce-equipment', 'cancel-production-current', 'cancel-production-queue', 'equip-equipment', 'unequip-equipment', 'confirm-dispatch', 'replay-report'];
  const actions = browser.actionProvenance || [];
  required.forEach((action) => { if (!actions.some((row) => String(row.selector).includes(`data-action="${action}"`))) fail('required_ui_action', action); });
  if (!actions.length || actions.some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) fail('ui_provenance');
  const reloads = browser.realReloads || [];
  const expectedReasons = ['production_queue', 'completed_unmounted', 'running_battle', 'replay'];
  if (reloads.map((row) => row.reason).join('|') !== expectedReasons.join('|')) fail('reload_reasons');
  const afterLoaderIds = reloads.map((row) => row.afterLoaderId);
  reloads.forEach((row) => {
    const timeChanged = Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin);
    if (!timeChanged || !row.beforeLoaderId || !row.afterLoaderId || row.beforeLoaderId === row.afterLoaderId || row.timeOriginChanged !== timeChanged) fail('reload_true_value', row.reason);
  });
  if (new Set(afterLoaderIds).size !== afterLoaderIds.length) fail('reload_loader_duplicate');
  if (!browser.coverage?.productionEntry || !browser.coverage?.enqueueAction || !browser.coverage?.cancelAction || !browser.coverage?.completionObserved || !browser.coverage?.completedUnmounted || !browser.coverage?.mountAction || !browser.coverage?.runningAttempt || !browser.coverage?.replayAttempt) fail('ui_coverage');
  if (frameStates[0]?.production?.current?.equipmentId !== 'anti_armor_sights' || frameStates[1]?.production?.current?.equipmentId !== 'anti_armor_sights') fail('queue_state');
  if (frameStates[0]?.inventoryCount !== 3 || frameStates[1]?.inventoryCount !== 3) fail('queue_inventory_early');
  if (frameStates[2]?.inventoryCount !== 4 || frameStates[3]?.inventoryCount !== 4 || Object.keys(frameStates[2]?.equipment || {}).length || Object.keys(frameStates[3]?.equipment || {}).length) fail('completed_unmounted_state');
  if (!frameStates[4]?.equipment?.['stage9-c-browser-unit']?.includes('equipment-production-anti_armor_sights-1')) fail('mount_state');
  const running = [frameStates[5], frameStates[6]];
  if (!running.every((state) => state.activeBattle?.replayReadOnly === false && state.activeBattle?.battleSessionId && state.activeBattle?.deploymentHash && state.activeBattle?.formalReportHash)) fail('running_binding');
  if (running[0].activeBattle.battleSessionId !== running[1].activeBattle.battleSessionId || running[0].activeBattle.deploymentHash !== running[1].activeBattle.deploymentHash || running[0].activeBattle.formalReportHash !== running[1].activeBattle.formalReportHash || !equal(running[0].equipment, running[1].equipment)) fail('running_isolation');
  const replay = [frameStates[7], frameStates[8]];
  if (!replay.every((state) => state.activeBattle?.replayReadOnly === true && state.activeBattle?.historicalEquipment?.['stage9-c-browser-unit']?.some((item) => item.equipmentId === 'anti_armor_sights'))) fail('replay_historical_equipment');
  if (replay[0].activeBattle.battleSessionId !== running[0].activeBattle.battleSessionId || replay[1].activeBattle.battleSessionId !== running[0].activeBattle.battleSessionId || replay[0].activeBattle.formalReportHash !== running[0].activeBattle.formalReportHash || replay[1].activeBattle.formalReportHash !== running[0].activeBattle.formalReportHash || replay[0].activeBattle.deploymentHash !== running[0].activeBattle.deploymentHash || replay[0].activeBattle.deploymentHash !== replay[1].activeBattle.deploymentHash || !equal(replay[0].equipment, replay[1].equipment)) fail('replay_isolation');
  if (replay[0].reportCount !== 1 || replay[1].reportCount !== 1 || replay[0].ledgerCount !== 1 || replay[1].ledgerCount !== 1) fail('settlement_ledger_isolation');
}

export function verifyStage9CEvidence(candidate, { checkFiles = false } = {}) {
  const errors = [];
  const fail = (code, detail = null) => errors.push({ code, detail });
  if (candidate?.stage !== '9-C') fail('stage');
  if (SAVE_VERSION !== 9 || candidate?.saveVersion !== 9) fail('save_version');
  verifyCatalog(fail);
  const productionEvidence = candidate?.core?.acquisition?.production;
  if (!productionEvidence || productionEvidence.kind !== 'production' || !equal(productionEvidence.costPaid, EQUIPMENT.anti_armor_sights.acquisition.cost) || productionEvidence.duration !== EQUIPMENT.anti_armor_sights.acquisition.buildTime) fail('production_true_value');
  const gateEvidence = candidate?.core?.techGate;
  if (!gateEvidence || gateEvidence.blocked?.code !== 'equipment_tech_prerequisite' || gateEvidence.blocked?.missingTech !== 'modular_assembly' || gateEvidence.blocked?.reason !== '需要先完成“模块化装配”') fail('tech_gate_true_value');
  const effective = (() => { const state = createInitialState(); const unit = createUnit('infantry', 'strong'); unit.id = 'strong-effective'; unit.experience = 30; state.units = [unit]; equipEquipment(state, unit.id, 'equipment-starter-1'); equipEquipment(state, unit.id, 'equipment-starter-3'); return getUnitEffectiveStats(unit, state.equipment); })();
  if (!equal(candidate.effectiveStats?.actual, Object.fromEntries(EQUIPMENT_STAT_KEYS.concat(['hp']).map((key) => [key, effective[key]]))) || candidate.effectiveStats?.hpInvariant !== true || effective.hp !== 100) fail('effective_stats_true_value');
  const snapshotState = createInitialState(); const snapshotUnitState = createUnit('infantry', 'strong'); snapshotUnitState.id = 'strong-snapshot'; snapshotState.units = [snapshotUnitState]; equipEquipment(snapshotState, snapshotUnitState.id, 'equipment-starter-1'); const formationResult = createFormation(snapshotState, 'strong snapshot'); formationResult.formation.unitIds = [snapshotUnitState.id]; snapshotUnitState.formationId = formationResult.formation.id; snapshotUnitState.status = 'assigned'; recalcDerived(snapshotState); snapshotState.command.capacity = 999; const expectedSnapshot = buildDispatchSnapshot(snapshotState, formationResult.formation, 'scrap_mine', 'cautious').units[0];
  if (!equal(candidate.snapshotEvidence?.parsedStats, expectedSnapshot.stats) || !equal(candidate.snapshotEvidence?.equipmentComposition, expectedSnapshot.equipment)) fail('snapshot_true_value');
  const old = fixture(); delete old.equipment; const oldMigrated = migrate(clone(old)); if (oldMigrated.equipment.inventory.length !== 0 || oldMigrated.production.current !== null) fail('migration_fabricated_state');
  const queueState = fixture(['standardized_training', 'modular_assembly']); if (!queueEquipment(queueState, 'anti_armor_sights').ok) fail('migration_fixture_queue'); const restored = migrate(clone(queueState)); if (restored.production.current?.kind !== 'equipment' || restored.production.current?.equipmentId !== 'anti_armor_sights') fail('migration_queue_restore');
  const diffState = fixture(); const unit = createUnit('infantry', 'strong-diff'); unit.id = 'strong-diff-unit'; diffState.units = [unit]; const before = clone(diffState); equipEquipment(diffState, unit.id, 'equipment-starter-1'); const paths = computeSaveDiff(before, diffState).map((row) => row.path).filter(Boolean); if (!paths.length || paths.some((value) => value !== 'equipment' && !value.startsWith('equipment.'))) fail('save_diff_equipment_boundary');
  if (candidate.core?.isolation?.settlementEquipmentUnchanged !== true || candidate.core?.isolation?.productionOfflineProgressed !== true || candidate.core?.isolation?.productionOfflineCompletedExactlyOnce !== true) fail('offline_isolation_evidence');
  verifyBrowser(candidate, fail, checkFiles);
  const perf = candidate.performance; if (!perf?.measurementValid || perf?.budgetMs !== 16.7 || perf?.warmup !== 20 || perf?.samples !== 120 || !perf.environmentGuard?.fit || !Number.isFinite(Number(perf.environmentGuard.loadBefore)) || !Number.isFinite(Number(perf.environmentGuard.loadAfter)) || !perf.environment?.platform || !perf.environment?.arch || !perf.environment?.cpuModel || !perf.environment?.cpuCount || !perf.environment?.nodeVersion) fail('performance_guard');
  ['effectiveStats', 'snapshot', 'inventory'].forEach((key) => { if (!(Number(perf.scenarios?.[key]?.p95Ms) < 16.7) || perf.scenarios[key].samples !== 120) fail('performance_budget', key); });
  const changed = sourceChangedFiles(); const forbidden = ['js/save-diff.js', 'tests/lib/', 'js/battle.js', 'js/theater.js', 'js/battle-presentation/universal/']; if (changed.some((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix)))) fail('authority_changed');
  const source = ['js/config.js', 'js/equipment.js', 'js/production.js', 'js/offline.js', 'js/save.js', 'js/ui.js', 'js/main.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'); if (!source.includes('queueEquipment') || !source.includes('getUnitEffectiveStats') || !source.includes('equipment-production-')) fail('source_binding');
  return { ok: errors.length === 0, errors };
}

const bundle = read('stage9_c_evidence_bundle.json');
const verdict = verifyStage9CEvidence(bundle, { checkFiles: true });
assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
const output = { stage: '9-C', independentRecompute: true, checks: { catalog: true, production: true, researchGate: true, migration: true, browser: true, reloads: true, historicalReplay: true, saveDiff: true, authority: true, performance: true }, tamperAuditPending: true, passed: true };
fs.writeFileSync(path.join(root, 'stage9_c_strong_evidence_verdict.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: bundle.browser.browser.captureCount, reloads: bundle.browser.realReloads.length }));
