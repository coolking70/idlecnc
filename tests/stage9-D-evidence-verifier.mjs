import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EQUIPMENT, EQUIPMENT_RULES, SAVE_VERSION, SALVAGE_RULES } from '../js/config.js';
import { deriveSalvageOffer } from '../js/battle-salvage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashFile = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

function fail(errors, code, detail = null) { errors.push({ code, detail }); }

function stateFromFrame(frame) {
  const state = frame?.state || {};
  const session = state.authoritativeSession;
  const report = session?.formalReport;
  if (!session || !report || !state.settlementLedger) return null;
  return {
    battleSessions: { [session.battleSessionId]: session },
    battles: [report],
    battleSettlementLedger: { [session.settlementId]: state.settlementLedger },
    equipment: {
      inventory: Array.isArray(state.equipmentInventory) ? state.equipmentInventory : [],
      bindings: state.equipment || {},
      salvageClaims: state.salvageClaims && typeof state.salvageClaims === 'object' ? state.salvageClaims : {}
    }
  };
}

function verifyFrame(frame, index, errors, { checkFiles = false } = {}) {
  if (!frame?.imageSha256 || frame.imageSha256 !== frame.screenshot?.sha256) fail(errors, 'screenshot_declared_hash', index);
  if (checkFiles && (!frame.screenshot?.path || hashFile(frame.screenshot.path) !== frame.imageSha256)) fail(errors, 'screenshot_actual_hash', index);
  const state = stateFromFrame(frame);
  if (!state) { fail(errors, 'authoritative_frame_state_missing', index); return; }
  const session = state.battleSessions[Object.keys(state.battleSessions)[0]];
  const expected = deriveSalvageOffer(state, session.battleSessionId);
  const captured = frame.state.salvage || {};
  const fields = ['salvageId', 'offerHash', 'outcome', 'equipmentId', 'roll', 'chance', 'state', 'instanceId'];
  fields.forEach((field) => { if (captured[field] !== (expected[field] ?? null)) fail(errors, 'salvage_true_value', { index, field, captured: captured[field], expected: expected[field] ?? null }); });
  if (!expected.ok) fail(errors, 'salvage_offer_invalid', { index, code: expected.code });
  const authoritative = frame.state.authoritativeSession;
  if (!authoritative.deploymentHash || authoritative.deploymentHash !== session.deploymentHash) fail(errors, 'deployment_hash_binding', index);
  if (frame.state.sessionId !== session.battleSessionId || frame.state.settlementId !== session.settlementId || frame.state.formalReportHash !== session.formalReportHash) fail(errors, 'session_identity', index);
  if (expected.outcome === 'equipment') {
    const claimed = expected.claimed === true;
    if (claimed) {
      const claim = frame.state.salvageClaims?.[expected.salvageId];
      const instance = state.equipment.inventory.find((row) => row?.id === expected.instanceId);
      if (!claim || claim.offerHash !== expected.offerHash || claim.equipmentId !== expected.equipmentId || claim.instanceId !== expected.instanceId || instance?.equipmentId !== expected.equipmentId || instance?.provenance?.kind !== 'battle_salvage' || instance.provenance.salvageId !== expected.salvageId) fail(errors, 'claim_receipt_binding', index);
    }
  }
  if (frame.semantic.includes('replay') && frame.claimControlPresent !== false) fail(errors, 'replay_claim_control', index);
}

export function verifyStage9DEvidence(candidate, { checkFiles = false } = {}) {
  const errors = [];
  if (candidate?.stage !== '9-D') fail(errors, 'stage');
  if (candidate?.saveVersion !== SAVE_VERSION || SAVE_VERSION !== 10) fail(errors, 'save_version');
  if (!equal(candidate?.salvageRules, SALVAGE_RULES)) fail(errors, 'salvage_rules_true_value');
  const expectedCatalog = Object.values(EQUIPMENT).map((def) => ({ id: def.id, applicableTypes: def.applicableTypes, modifiers: def.modifiers, acquisition: def.acquisition, requiresTech: def.requiresTech || null }));
  if (!equal(candidate?.equipmentCatalog, expectedCatalog)) fail(errors, 'catalog_true_value');
  if (candidate?.equipmentRules?.maxSlotsPerUnit !== EQUIPMENT_RULES.maxSlotsPerUnit) fail(errors, 'equipment_rule_binding');
  const machine = candidate?.machine || {};
  const browser = candidate?.browser || {};
  const frames = browser.scenes?.flatMap((scene) => scene.frames || []) || [];
  if (machine.stage !== '9-D' || machine.frameCount !== 9 || frames.length !== 9) fail(errors, 'frame_count');
  if (machine.frames?.map((row) => row.semantic).join('|') !== frames.map((row) => row.semantic).join('|')) fail(errors, 'semantic_order');
  ['dispatchApiUsed', 'replayApiUsed', 'offlineApiUsed', 'equipmentApiUsed'].forEach((key) => { if (browser[key] !== false || machine[key] !== false) fail(errors, 'api_provenance', key); });
  if (browser.browser?.captureCount !== frames.length || browser.browser?.uniqueImageHashes !== frames.length) fail(errors, 'capture_counts');
  if (new Set(frames.map((frame) => frame.imageSha256)).size !== frames.length) fail(errors, 'duplicate_screenshot_hash');
  if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail(errors, 'browser_errors');
  const requiredReasons = ['pending_result', 'claimed_result', 'replay', 'no_drop_result'];
  const reloads = browser.realReloads || [];
  if (reloads.map((row) => row.reason).join('|') !== requiredReasons.join('|')) fail(errors, 'reload_reason_coverage');
  if (new Set(reloads.map((row) => row.afterLoaderId)).size !== reloads.length) fail(errors, 'reload_loader_uniqueness');
  reloads.forEach((row) => {
    const timeChanged = Number(row.after?.timeOrigin) > Number(row.before?.timeOrigin);
    const loaderChanged = Boolean(row.beforeLoaderId && row.afterLoaderId && row.beforeLoaderId !== row.afterLoaderId);
    if (!timeChanged || !loaderChanged || row.timeOriginChanged !== timeChanged || row.loaderChanged !== loaderChanged) fail(errors, 'reload_true_value', row.reason);
  });
  const requiredActions = machine.requiredActions || [];
  requiredActions.forEach((action) => { if (!(browser.actionProvenance || []).some((row) => row.kind === 'click' && String(row.selector).includes(`data-action="${action}"`))) fail(errors, 'required_action', action); });
  if ((browser.actionProvenance || []).some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) fail(errors, 'ui_provenance');
  frames.forEach((frame, index) => verifyFrame(frame, index, errors, { checkFiles }));
  frames.forEach((frame, index) => {
    const inventory = Array.isArray(frame.state?.equipmentInventory) ? frame.state.equipmentInventory : [];
    if (frame.state?.inventoryCount !== inventory.length) fail(errors, 'inventory_count_binding', index);
  });
  if (frames[0]?.state.salvage?.outcome !== 'equipment' || frames[1]?.state.salvage?.offerHash !== frames[0]?.state.salvage?.offerHash) fail(errors, 'pending_reload_stability');
  if (frames[2]?.state.salvage?.state !== 'claimed' || frames[3]?.state.salvage?.instanceId !== frames[2]?.state.salvage?.instanceId) fail(errors, 'claim_reload_stability');
  if (frames[5]?.state.salvage?.offerHash !== frames[2]?.state.salvage?.offerHash || frames[6]?.state.salvage?.offerHash !== frames[5]?.state.salvage?.offerHash) fail(errors, 'replay_historical_offer');
  if (frames[5]?.state.activeBattle?.replayReadOnly !== true || frames[6]?.state.activeBattle?.replayReadOnly !== true) fail(errors, 'replay_read_only');
  if (frames[7]?.state.salvage?.outcome !== 'none' || frames[8]?.state.salvage?.outcome !== 'none' || frames[7]?.state.salvage?.offerHash !== frames[8]?.state.salvage?.offerHash) fail(errors, 'no_drop_reload_stability');
  if (frames[7]?.state.inventoryCount !== frames[8]?.state.inventoryCount) fail(errors, 'no_drop_inventory_stability');
  return { ok: errors.length === 0, errors, passed: errors.length === 0 };
}

export { clone };
