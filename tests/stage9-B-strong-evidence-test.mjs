import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

import { EQUIPMENT, EQUIPMENT_STAT_KEYS, SAVE_VERSION, THEATERS, OPERATIONS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';
import { getUnitEquipment } from '../js/equipment.js';
import { canonicalHash } from '../js/production-battle-session.js';

const root = process.cwd();
const clone = (value) => JSON.parse(JSON.stringify(value));
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function recompute() {
  const state = createInitialState();
  const unit = { id: 'independent-effective-unit', type: 'infantry', hp: 100, maxHp: 100, experience: 30, battles: 0, status: 'ready', createdAt: 0 };
  state.units = [unit]; state.equipment.bindings = { [unit.id]: ['equipment-starter-1', 'equipment-starter-3'] };
  const effective = getUnitEffectiveStats(unit, state.equipment);
  const stats = Object.fromEntries(EQUIPMENT_STAT_KEYS.concat(['hp']).map((key) => [key, effective[key]]));
  const snapshotState = createInitialState();
  const snapshotUnit = { id: 'stage9-b-unit-0', type: 'infantry', hp: 100, maxHp: 100, experience: 0, battles: 0, status: 'ready', createdAt: 0 };
  snapshotState.units = [snapshotUnit]; snapshotState.equipment.bindings = { [snapshotUnit.id]: ['equipment-starter-1'] };
  const formation = { id: 'stage9-b-formation', name: 'Snapshot', unitIds: [snapshotUnit.id], status: 'idle', experience: 0 };
  snapshotState.formations = [formation];
  const snapshot = buildDispatchSnapshot(snapshotState, formation, 'scrap_mine', 'cautious');
  return { stats, equipment: getUnitEquipment(snapshotState.equipment, snapshotUnit.id), snapshot: snapshot.units[0] };
}

export function verifyStage9BEvidence(candidate, { checkFiles = false } = {}) {
  const errors = [];
  const fail = (code, detail = null) => errors.push({ code, detail });
  const machine = candidate?.machine || {};
  const browser = candidate?.browser || {};
  const manifest = browser.browser || {};
  const frames = browser.scenes?.[0]?.frames || [];
  const recomputed = recompute();
  const core = candidate?.core || {};
  const effective = core.evidence?.effectiveEvidence;
  const snapshot = core.evidence?.snapshotEvidence;
  const sourceFiles = ['js/config.js', 'js/equipment.js', 'js/state.js', 'js/units.js', 'js/save.js', 'js/theater.js', 'js/ui.js', 'js/main.js'];
  const source = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const baseline = '27c115848bea9aaa965fa46b784940a9949537e4';
  const committed = execFileSync('git', ['diff', '--name-only', `${baseline}..HEAD`], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const changed = [...new Set([...committed, ...working])].sort();

  if (candidate?.stage !== '9-B') fail('stage');
  if (SAVE_VERSION !== 9) fail('save_version', SAVE_VERSION);
  if (machine.frameCount !== 8 || frames.length !== 8) fail('frame_count', { machine: machine.frameCount, frames: frames.length });
  if (machine.productionEntry !== true || machine.fixtureLoaderUsed !== false || machine.dispatchApiUsed !== false || machine.replayApiUsed !== false || machine.offlineApiUsed !== false || machine.equipmentApiUsed !== false) fail('machine_provenance');
  if (browser.productionEntry !== true || browser.fixtureLoaderUsed !== false || browser.dispatchApiUsed !== false || browser.replayApiUsed !== false || browser.offlineApiUsed !== false || browser.equipmentApiUsed !== false) fail('browser_provenance');
  if (manifest.captureCount !== 8 || manifest.uniqueImageHashes !== 8) fail('capture_counts');
  if ((manifest.pageErrors || []).length || (manifest.consoleErrors || []).length) fail('browser_errors');
  const expectedSemantic = (machine.frames || []).map((row) => row.semantic).join('|');
  if (frames.map((row) => row.semantic).join('|') !== expectedSemantic) fail('semantic_frame_order');
  const hashes = new Set();
  frames.forEach((frame) => {
    if (!frame.imageSha256 || hashes.has(frame.imageSha256)) fail('duplicate_frame_hash', frame.file);
    hashes.add(frame.imageSha256);
    if (frame.screenshot?.sha256 !== frame.imageSha256) fail('screenshot_hash_mismatch', frame.file);
    if (checkFiles && frame.screenshot?.path) {
      const filePath = path.join(root, frame.screenshot.path);
      if (!fs.existsSync(filePath)) fail('missing_screenshot', frame.file);
      else if (crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') !== frame.imageSha256) fail('screenshot_hash_mismatch', frame.file);
    }
  });
  const reloads = browser.realReloads || [];
  const reasons = reloads.map((row) => row.reason);
  if (reasons.join('|') !== 'equipment_panel_mounted|running_battle|result|replay') fail('reload_reasons', reasons);
  const afterLoaderIds = reloads.map((row) => row.afterLoaderId).filter(Boolean);
  reloads.forEach((row) => {
    if (!(Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin))) fail('reload_time_origin', row.reason);
    if (!row.beforeLoaderId || !row.afterLoaderId || row.beforeLoaderId === row.afterLoaderId) fail('reload_loader_id', row.reason);
    if (row.timeOriginChanged !== (Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin))) fail('reload_declared_value', row.reason);
  });
  if (afterLoaderIds.length !== new Set(afterLoaderIds).size) fail('reload_loader_duplicate');
  const actions = browser.actionProvenance || [];
  if (!actions.length || actions.some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) fail('action_provenance');
  const required = ['equip-equipment', 'unequip-equipment', 'confirm-dispatch', 'replay-report'];
  required.forEach((action) => { if (!actions.some((row) => String(row.selector).includes(`data-action="${action}"`))) fail('missing_ui_action', action); });
  if (!browser.coverage?.equipmentPanelMounted || !browser.coverage?.mountAction || !browser.coverage?.unmountAction || !browser.coverage?.runningAttempt || !browser.coverage?.resultAttempt || !browser.coverage?.replayAttempt) fail('coverage');
  const runningFrames = [frames[2], frames[3]];
  if (!runningFrames.every((frame) => frame.state?.activeBattle?.battleSessionId && frame.state?.activeBattle?.deploymentHash && frame.state?.activeBattle?.formalReportHash && frame.state?.activeBattle?.replayReadOnly === false)) fail('running_state_binding');
  if (runningFrames[0]?.state?.activeBattle?.battleSessionId !== runningFrames[1]?.state?.activeBattle?.battleSessionId) fail('running_session_changed');
  if (runningFrames[0]?.state?.activeBattle?.deploymentHash !== runningFrames[1]?.state?.activeBattle?.deploymentHash) fail('running_deployment_hash_changed');
  if (runningFrames[0]?.state?.activeBattle?.formalReportHash !== runningFrames[1]?.state?.activeBattle?.formalReportHash) fail('running_report_hash_changed');
  const resultFrames = [frames[4], frames[5]];
  if (!resultFrames.every((frame) => frame.state?.activeBattle?.settled === true && Number(frame.state?.ledgerCount) >= 1)) fail('result_state_binding');
  if (resultFrames[0]?.state?.ledgerCount !== resultFrames[1]?.state?.ledgerCount) fail('settlement_ledger_changed');
  const replayFrames = [frames[6], frames[7]];
  if (!replayFrames.every((frame) => frame.state?.activeBattle?.replayReadOnly === true && frame.state?.activeBattle?.deploymentHash && frame.state?.activeBattle?.formalReportHash)) fail('replay_state_binding');
  if (replayFrames[0]?.state?.activeBattle?.deploymentHash !== replayFrames[1]?.state?.activeBattle?.deploymentHash) fail('replay_deployment_hash_changed');
  if (replayFrames[0]?.state?.activeBattle?.formalReportHash !== replayFrames[1]?.state?.activeBattle?.formalReportHash) fail('replay_report_hash_changed');
  if (!replayFrames.every((frame) => Object.values(frame.state?.equipment || {}).flat().includes('equipment-starter-2'))) fail('replay_equipment_changed');
  const canonicalSessionId = runningFrames[0]?.state?.sessionId;
  const canonicalReportId = runningFrames[0]?.state?.activeBattle?.reportId;
  const canonicalSettlementId = runningFrames[0]?.state?.activeBattle?.settlementId;
  [runningFrames[1], ...resultFrames, ...replayFrames].forEach((frame) => {
    if (frame?.state?.sessionId !== canonicalSessionId) fail('session_binding_changed', frame?.semantic);
    if (frame?.state?.activeBattle?.battleSessionId !== runningFrames[0]?.state?.activeBattle?.battleSessionId) fail('active_session_binding_changed', frame?.semantic);
    if (frame?.state?.activeBattle?.reportId !== canonicalReportId) fail('report_binding_changed', frame?.semantic);
    if (frame?.state?.activeBattle?.settlementId !== canonicalSettlementId) fail('settlement_binding_changed', frame?.semantic);
  });
  if (!runningFrames.every((frame) => equal(frame.state?.equipment, runningFrames[0]?.state?.equipment))) fail('running_equipment_changed');
  if (resultFrames[0]?.state?.reportCount !== 1 || resultFrames[1]?.state?.reportCount !== 1) fail('report_count_changed');
  if (!effective || !equal(effective.actual, recomputed.stats)) fail('effective_stats_true_value', { expected: recomputed.stats, actual: effective?.actual });
  if (!snapshot || !equal(snapshot.parsedStats, recomputed.snapshot.stats)) fail('snapshot_stats_true_value');
  if (!equal(snapshot.equipmentComposition, recomputed.snapshot.equipment)) fail('snapshot_equipment_true_value');
  if (snapshot.unitId !== 'stage9-b-unit-0') fail('snapshot_unit_binding');
  if (snapshot.deploymentHashInput !== canonicalHash({ stats: recomputed.snapshot.stats, equipment: recomputed.snapshot.equipment })) fail('snapshot_hash_input');
  const migration = core.evidence?.migrationEvidence;
  if (!migration || !migration.oldSaveCreatesNothing || migration.oldSaveEquipment?.inventory?.length !== 0 || migration.danglingUnitReferenceRemoved !== true || migration.danglingEquipmentReferenceRemoved !== true) fail('migration_true_value');
  const saveDiff = core.evidence?.saveDiffEvidence;
  if (!saveDiff || saveDiff.settlementEquipmentUnchanged !== true || (saveDiff.mountChangedPaths || []).some((path) => !path.startsWith('equipment.'))) fail('save_diff_true_value');
  if (core.evidence?.replayEvidence?.replayAfterCurrentEquipmentChanged?.usesHistoricalSnapshot !== true) fail('historical_replay_true_value');
  if (core.evidence?.isolationEvidence?.resultPanel?.ledgerUnchanged !== true) fail('isolation_ledger_true_value');
  if (!Object.values(EQUIPMENT).every((def) => def.acquisition?.kind && !('hp' in def.modifiers) && !('maxHp' in def.modifiers))) fail('equipment_model');
  if (recomputed.stats.hp !== 100) fail('hp_affected');
  if (Object.keys(THEATERS).length !== 6 || Object.keys(OPERATIONS).length !== 6) fail('stage9a_regression');
  const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
  const forbidden = ['js/battle.js', 'js/theater.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'experiments/battle-sandbox/universal-planner/universal-planner.js'];
  if (changed.some((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix)) || (file.startsWith('tests/lib/') && file !== allowedPerformanceHelper))) fail('authority_changed', changed);
  if (!source.includes('getUnitEffectiveStats(unit, state && state.equipment)') || !source.includes('sanitizeEquipment(merged)') || !source.includes("dataset.action = 'equip-equipment'")) fail('source_binding');
  if (Number(candidate.performance?.scenarios?.effectiveStats?.p95Ms) >= 16.7 || Number(candidate.performance?.scenarios?.snapshot?.p95Ms) >= 16.7) fail('performance_budget');
  if (!candidate.performance?.environment?.platform || !candidate.performance?.environment?.arch || !candidate.performance?.environment?.cpuModel || !candidate.performance?.environment?.cpuCount || !candidate.performance?.environment?.nodeVersion) fail('performance_environment');
  return { ok: errors.length === 0, errors };
}

const bundle = read('stage9_b_evidence_bundle.json');
const verdict = verifyStage9BEvidence(bundle, { checkFiles: true });
assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
const output = { stage: '9-B', independentRecompute: true, checks: { model: true, effectiveStats: true, snapshot: true, reloads: true, ui: true, authority: true, performance: true }, browserErrors: [], tamperAuditPending: true, passed: true };
fs.writeFileSync(path.join(root, 'stage9_b_strong_evidence_verdict.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: bundle.browser.browser.captureCount, reloads: bundle.browser.realReloads.length }));
