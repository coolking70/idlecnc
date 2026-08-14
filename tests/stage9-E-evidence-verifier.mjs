import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDING_STATUS, EQUIPMENT, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS, OPERATIONS, PRODUCTION, SAVE_VERSION, SALVAGE_RULES, THEATERS, UNITS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { createUnit, queueEquipment, tickProduction } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { equipEquipment, getEquipmentComposition } from '../js/equipment.js';
import { buildDispatchSnapshot, dispatchOperation, tickActiveBattle } from '../js/theater.js';
import { claimBattleSalvage, deriveSalvageOffer } from '../js/battle-salvage.js';
import { canonicalHash } from '../js/production-battle-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(failures, pathName, expected, actual) {
  failures.push({ path: pathName, expected, actual });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolveEvidenceFile(evidenceRoot, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null;
  const rootPath = path.resolve(evidenceRoot);
  const resolved = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function verifyEvidenceFiles(candidate, failures, evidenceRoot) {
  [
    'stage9_e_machine_evidence.json',
    'stage9_e_browser_capture_manifest.json',
    'stage9_e_evidence.json',
    'stage9_e_strong_evidence_verdict.json',
    'stage9_e_tamper_results.json',
  ].forEach((name) => {
    const filePath = resolveEvidenceFile(evidenceRoot, name);
    if (!filePath || !fs.existsSync(filePath)) fail(failures, `files.${name}`, 'exists under evidence root', 'missing or unsafe');
  });

  const frames = candidate.browserManifest?.scenes?.[0]?.frames || [];
  const actualHashes = [];
  frames.forEach((item, index) => {
    const screenshotPath = item?.screenshot?.path;
    if (typeof screenshotPath !== 'string' || !screenshotPath.startsWith('screenshots/stage9-E/')) {
      fail(failures, `files.frame[${index}].path`, 'screenshots/stage9-E/*.png', screenshotPath);
      return;
    }
    const filePath = resolveEvidenceFile(evidenceRoot, screenshotPath);
    if (!filePath || path.extname(filePath).toLowerCase() !== '.png' || !fs.existsSync(filePath)) {
      fail(failures, `files.frame[${index}].png`, 'safe existing PNG', screenshotPath);
      return;
    }
    const bytes = fs.readFileSync(filePath);
    const actualHash = sha256(bytes);
    actualHashes.push(actualHash);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      fail(failures, `files.frame[${index}].pngSignature`, 'PNG signature', 'invalid');
    }
    if (actualHash !== item.imageSha256) fail(failures, `files.frame[${index}].imageSha256`, actualHash, item.imageSha256);
    if (actualHash !== item.screenshot.sha256) fail(failures, `files.frame[${index}].screenshot.sha256`, actualHash, item.screenshot.sha256);
  });
  if (actualHashes.length !== frames.length || new Set(actualHashes).size !== frames.length) {
    fail(failures, 'files.actualScreenshotHashes', 'one unique hash per frame', { frameCount: frames.length, actualHashes });
  }
}

function sourceFilesChanged() {
  return execFileSync('git', ['diff', '--name-only', '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6', '--'], { cwd: root, encoding: 'utf8' })
    .split('\n').map((row) => row.trim()).filter(Boolean);
}

function recomputeIntegration() {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  state.research.completed = ['modular_assembly', 'field_maintenance', 'composite_armor', 'expanded_storage'];
  state.unlocks.units = Object.keys(UNITS);
  state.buildings.push({ id: 'stage9-e-armor-factory', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 });
  ['mbt', 'mbt', 'mbt', 'mbt', 'mbt'].forEach((type, index) => {
    const unit = createUnit(type, `stage9-e-unit-${index}`);
    unit.id = `stage9-e-unit-${index}`;
    state.units.push(unit);
  });
  const spare = createUnit('infantry', 'stage9-e-unit-5'); spare.id = 'stage9-e-unit-5'; state.units.push(spare);
  const formation = createFormation(state, 'Stage 9-E integrated campaign').formation;
  formation.id = 'stage9-e-formation';
  state.units.slice(0, 5).forEach((unit) => { unit.formationId = formation.id; unit.status = 'assigned'; formation.unitIds.push(unit.id); });
  recalcDerived(state); state.command.capacity = 999; state.theaters.river_crossing.captured = true;
  const queued = queueEquipment(state, 'anti_armor_sights');
  tickProduction(state, 18);
  const production = state.equipment.inventory.find((item) => item.provenance?.kind === 'production');
  const mounted = equipEquipment(state, state.units[0].id, production.id);
  const snapshot = buildDispatchSnapshot(state, formation, 'river_crossing', 'cautious', 'operation', 'river_ferry');
  const before = canonicalHash(state.equipment);
  const dispatched = dispatchOperation(state, formation.id, 'river_ferry', 'cautious', { seed: 6 });
  if (!dispatched.ok) return { ok: false, error: dispatched.reason };
  const sessionId = dispatched.activeBattle.battleSessionId;
  tickActiveBattle(state, state.activeBattle.duration + 1);
  const afterSettlement = canonicalHash(state.equipment);
  const offer = deriveSalvageOffer(state, sessionId);
  const claim = claimBattleSalvage(state, sessionId);
  return {
    ok: queued.ok && mounted.ok && offer.ok && offer.outcome === 'equipment' && claim.ok,
    productionId: production.id, productionEquipmentHash: before, settlementEquipmentHash: afterSettlement,
    settlementUntouched: before === afterSettlement, snapshot, sessionId,
    missionKind: dispatched.activeBattle.missionKind, missionId: dispatched.activeBattle.missionId,
    deploymentHash: state.battleSessions[sessionId].deploymentHash, formalReportHash: state.battleSessions[sessionId].formalReportHash,
    salvage: offer, claim, salvageId: claim.instance?.id || null, salvageEquipmentId: offer.equipmentId,
    equipmentComposition: getEquipmentComposition(state.equipment, state.units.slice(0, 5).map((unit) => unit.id))
  };
}

function verifySource(candidate, failures) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const configSource = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (candidate.stage !== '9-E') fail(failures, 'bundle.stage', '9-E', candidate.stage);
  if (!configSource.includes("export const CURRENT_STAGE = 9;")) fail(failures, 'source.CURRENT_STAGE', '9', 'missing');
  if (!configSource.includes("export const CURRENT_STAGE_LABEL = 'Stage 9 · Expanded Campaign & Equipment';")) fail(failures, 'source.CURRENT_STAGE_LABEL', 'stable Stage 9 label', 'missing');
  if (SAVE_VERSION !== 10) fail(failures, 'source.SAVE_VERSION', 10, SAVE_VERSION);
  if (packageJson.version !== '0.9.0') fail(failures, 'package.version', '0.9.0', packageJson.version);
  const metadata = candidate.metadata || {};
  const expectedMetadata = { currentStage: 9, currentStageLabel: 'Stage 9 · Expanded Campaign & Equipment', saveVersion: 10, packageVersion: '0.9.0' };
  Object.entries(expectedMetadata).forEach(([key, expected]) => { if (metadata[key] !== expected) fail(failures, `bundle.metadata.${key}`, expected, metadata[key]); });
  ['Stage 9', '6 个战区', '6 个重复任务', '装备生产', '回放', '离线推进'].forEach((needle) => { if (!readme.includes(needle)) fail(failures, `README.${needle}`, 'present', 'missing'); });
  if (!/战场(回收|打捞)/.test(readme)) fail(failures, 'README.battleSalvage', 'battle salvage wording', 'missing');
  if (Object.keys(THEATERS).length !== 6) fail(failures, 'config.theaterCount', 6, Object.keys(THEATERS).length);
  if (Object.keys(OPERATIONS).length !== 6) fail(failures, 'config.operationCount', 6, Object.keys(OPERATIONS).length);
  if (Object.keys(EQUIPMENT).length !== 8) fail(failures, 'config.equipmentCount', 8, Object.keys(EQUIPMENT).length);
  const starters = Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'starter');
  const production = Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production');
  if (starters.length !== 3) fail(failures, 'config.starterCount', 3, starters.length);
  if (production.length !== 5) fail(failures, 'config.productionCount', 5, production.length);
  if (EQUIPMENT_RULES.maxSlotsPerUnit !== 2 || EQUIPMENT_RULES.starterInventory !== 3) fail(failures, 'config.equipmentRules', 'slots=2,starter=3', EQUIPMENT_RULES);
  production.forEach((def) => { Object.keys(def.modifiers).forEach((key) => { if (!EQUIPMENT_STAT_KEYS.includes(key) || key === 'hp' || key === 'maxHp') fail(failures, `config.equipment.${def.id}.modifier.${key}`, 'legal non-hp key', key); }); });
  if (SALVAGE_RULES.poolKind !== 'production') fail(failures, 'config.salvage.poolKind', 'production', SALVAGE_RULES.poolKind);
  if (PRODUCTION.maxConcurrent !== 1 || PRODUCTION.maxQueueSize !== 5) fail(failures, 'config.production.queueLimits', '1/5', PRODUCTION);
  const sourceRules = candidate.sourceRules || {};
  const expectedRules = { theaterCount: 6, operationCount: 6, equipmentCount: 8, starterCount: 3, productionCount: 5, maxSlotsPerUnit: 2, salvageRulesVersion: SALVAGE_RULES.version, salvagePoolKind: SALVAGE_RULES.poolKind };
  Object.entries(expectedRules).forEach(([key, expected]) => { if (sourceRules[key] !== expected) fail(failures, `bundle.sourceRules.${key}`, expected, sourceRules[key]); });
  const coreEquipment = candidate.coreEvidence?.equipment || {};
  [['definitionCount', 8], ['starterCount', 3], ['productionCount', 5], ['maxSlots', 2]].forEach(([key, expected]) => { if (coreEquipment[key] !== expected) fail(failures, `core.equipment.${key}`, expected, coreEquipment[key]); });
}

function verifyCore(candidate, failures) {
  const core = candidate.coreEvidence || {};
  if (core.checkCount < 22) fail(failures, 'core.checkCount', '>=22', core.checkCount);
  if (core.independentRecompute !== true) fail(failures, 'core.independentRecompute', true, core.independentRecompute);
  const recomputed = recomputeIntegration();
  if (!recomputed.ok) fail(failures, 'recomputeIntegration', true, recomputed.error || recomputed);
  if (core.equipment?.productionInstanceId !== recomputed.productionId) fail(failures, 'core.equipment.productionInstanceId', recomputed.productionId, core.equipment?.productionInstanceId);
  if (core.equipment?.salvageInstanceId !== recomputed.salvageId) fail(failures, 'core.equipment.salvageInstanceId', recomputed.salvageId, core.equipment?.salvageInstanceId);
  if (core.equipment?.salvageEquipmentId !== recomputed.salvageEquipmentId) fail(failures, 'core.equipment.salvageEquipmentId', recomputed.salvageEquipmentId, core.equipment?.salvageEquipmentId);
  if (core.integration?.missionKind !== 'operation' || core.integration?.missionId !== 'river_ferry' || core.integration?.seed !== 6) fail(failures, 'core.integration.identity', 'operation/river_ferry/6', core.integration);
  if (core.integration?.salvageRulesVersion !== SALVAGE_RULES.version) fail(failures, 'core.integration.salvageRulesVersion', SALVAGE_RULES.version, core.integration?.salvageRulesVersion);
  ['sessionId', 'formalReportHash', 'deploymentHash', 'settlementEquipmentHash', 'productionEquipmentHash'].forEach((key) => {
    if (core.integration?.[key] !== recomputed[key]) fail(failures, `core.integration.${key}`, recomputed[key], core.integration?.[key]);
  });
  if (core.boundaries?.settlementMutatesEquipment !== false || core.boundaries?.claimDiffEquipmentOnly !== true || core.boundaries?.replayReadOnly !== true || core.boundaries?.dropsPreexistingNotImplemented !== true) fail(failures, 'core.boundaries', 'frozen boundaries', core.boundaries);
  return recomputed;
}

function frame(candidate, phase) { return (candidate.browserManifest?.scenes?.[0]?.frames || []).find((item) => item.phase === phase) || null; }

function verifyBrowser(candidate, failures) {
  const machine = candidate.machineEvidence || {};
  const browser = candidate.browserManifest || {};
  const frames = browser.scenes?.[0]?.frames || [];
  if (machine.frameCount !== 14 || frames.length !== 14) fail(failures, 'browser.frameCount', 14, { machine: machine.frameCount, actual: frames.length });
  if (browser.browser?.uniqueImageHashes !== 14 || new Set(frames.map((item) => item.imageSha256)).size !== 14) fail(failures, 'browser.screenshotHashes', 14, { declared: browser.browser?.uniqueImageHashes, actual: new Set(frames.map((item) => item.imageSha256)).size });
  ['pageErrors', 'consoleErrors'].forEach((key) => { if ((browser.browser?.[key] || []).length !== 0) fail(failures, `browser.${key}`, [], browser.browser?.[key]); });
  ['dispatchApiUsed', 'replayApiUsed', 'offlineApiUsed', 'equipmentApiUsed', 'salvageClaimApiUsed'].forEach((key) => { if (browser[key] !== false || machine[key] !== false) fail(failures, `browser.${key}`, false, { browser: browser[key], machine: machine[key] }); });
  const reloads = browser.realReloads || [];
  const reasons = reloads.map((row) => row.reason);
  if (reloads.length !== 5 || JSON.stringify(reasons) !== JSON.stringify(['production_queue', 'completed_unmounted', 'running_battle', 'settlement_salvage_pending', 'replay'])) fail(failures, 'browser.reloadReasons', 'five exact reasons', reasons);
  const loaderIds = []; reloads.forEach((row, index) => { if (row.method !== 'Page.reload' || row.timeOriginChanged !== true || row.after?.timeOrigin <= row.before?.timeOrigin || row.beforeLoaderId === row.afterLoaderId || row.loaderChanged !== true) fail(failures, `browser.realReloads[${index}]`, 'real advancing reload', row); loaderIds.push(row.afterLoaderId); });
  if (new Set(loaderIds).size !== loaderIds.length) fail(failures, 'browser.afterLoaderIds', 'unique per reload', loaderIds);
  if ((browser.actionProvenance || []).some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) fail(failures, 'browser.actionProvenance', 'production_ui/false', browser.actionProvenance);
  const required = machine.requiredActions || [];
  const actions = browser.actionProvenance || [];
  required.forEach((action) => { if (!actions.some((row) => String(row.selector || '').includes(action) || row.action === action)) fail(failures, `browser.requiredAction.${action}`, 'real DOM action', 'missing'); });
  const op = frame(candidate, 'operation_review');
  if (op?.missionKind !== 'operation' || op?.missionId !== 'river_ferry') fail(failures, 'browser.operationReview', 'operation/river_ferry', op && { missionKind: op.missionKind, missionId: op.missionId });
  const queued = frame(candidate, 'production_queue');
  if (queued?.state?.productionInstanceIds?.length !== 0 || queued?.state?.production?.current?.kind !== 'equipment') fail(failures, 'browser.productionQueue', 'equipment in progress, no completed instance', queued?.state);
  const mounted = frame(candidate, 'equipment_mounted_dom');
  if (!mounted?.state?.equipment?.bindings?.['stage9-e-unit-0']?.includes('equipment-production-anti_armor_sights-1')) fail(failures, 'browser.productionMount', 'production instance mounted', mounted?.state?.equipment?.bindings);
  const running = frame(candidate, 'running_battle');
  if (running?.state?.activeBattle?.missionKind !== 'operation' || running?.state?.activeBattle?.missionId !== 'river_ferry' || running?.state?.salvageRulesVersion !== 1) fail(failures, 'browser.runningBattle', 'formal operation with salvage v1', running?.state);
  const pending = frame(candidate, 'settlement_salvage_pending');
  if (pending?.state?.activeBattle?.settled !== true || pending?.state?.salvage?.outcome !== 'equipment' || pending?.state?.salvage?.equipmentId !== 'mobile_repair_rig') fail(failures, 'browser.salvagePending', 'settled mobile_repair_rig offer', pending?.state);
  const claimed = frame(candidate, 'salvage_claimed');
  if (Object.keys(claimed?.state?.equipment?.salvageClaims || {}).length !== 1 || claimed?.state?.salvageInstanceIds?.length !== 1) fail(failures, 'browser.salvageClaim', 'one exact claim and instance', claimed?.state);
  const salvageMount = frame(candidate, 'salvage_mounted_dom');
  const salvageId = salvageMount?.salvageId;
  if (!salvageId || !salvageMount?.state?.equipment?.bindings?.['stage9-e-unit-5']?.includes(salvageId)) fail(failures, 'browser.salvageMount', 'salvage mounted on spare infantry', salvageMount?.state?.equipment?.bindings);
  const replay = frame(candidate, 'replay_after_real_reload');
  const historical = replay?.state?.activeBattle?.historicalEquipment || {};
  if (replay?.state?.activeBattle?.replayReadOnly !== true || !(historical['stage9-e-unit-0'] || []).includes('equipment-production-anti_armor_sights-1') || (historical['stage9-e-unit-5'] || []).length !== 0 || (replay?.state?.salvageInstanceIds || []).length !== 1) fail(failures, 'browser.historicalReplay', 'historical production-only snapshot plus current salvage inventory', replay?.state);
  return { frames: frames.length, reloads: reloads.length, actions: actions.length };
}

export function verifyStage9EEvidence(candidate, { checkFiles = false, evidenceRoot = root } = {}) {
  const failures = [];
  verifySource(candidate, failures);
  const recomputed = verifyCore(candidate, failures);
  verifyBrowser(candidate, failures);
  const changed = sourceFilesChanged();
  const forbidden = changed.filter((file) => file === 'js/battle.js' || file === 'js/save-diff.js' || file.startsWith('js/battle-presentation/universal/') || file.startsWith('tests/lib/'));
  if (forbidden.length) fail(failures, 'authority.forbiddenFilesChanged', [], forbidden);
  if (candidate.authority?.forbiddenAuthorityFilesChanged?.length) fail(failures, 'bundle.authority.forbiddenAuthorityFilesChanged', [], candidate.authority.forbiddenAuthorityFilesChanged);
  if (checkFiles) verifyEvidenceFiles(candidate, failures, evidenceRoot);
  return { passed: failures.length === 0, failures, recomputed };
}
