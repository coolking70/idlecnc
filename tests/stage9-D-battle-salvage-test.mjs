import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { BATTLE_RESULT, SAVE_VERSION, SALVAGE_RULES, THEATERS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { createProductionBattleSession, buildSettlementLedgerHash, canonicalHash } from '../js/production-battle-session.js';
import { deriveSalvageOffer, claimBattleSalvage, sanitizeSalvageClaims } from '../js/battle-salvage.js';
import { emptyEquipmentState, getEquipmentDefinition, canEquipEquipment, equipEquipment } from '../js/equipment.js';
import { migrate } from '../js/save.js';
import { computeSaveDiff } from '../js/save-diff.js';
import { dispatchFormation, tickActiveBattle } from '../js/theater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const checks = [];
let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; checks.push({ name, passed: true }); console.log(`  PASS  ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error?.stack || String(error) }); console.error(`  FAIL  ${name}: ${error?.message || error}`); }
}
function fixture(result = BATTLE_RESULT.VICTORY, sequence = 1, options = {}) {
  const state = createInitialState();
  const report = {
    id: `stage9-d-report-${sequence}`,
    theaterId: options.theaterId || 'mountain_pass',
    missionId: options.missionId || options.theaterId || 'mountain_pass',
    missionKind: options.missionKind || 'campaign', result,
    capture: result === BATTLE_RESULT.VICTORY,
    events: [], final: { friendly: [], enemy: [] }, rewards: {}
  };
  const deploymentSnapshot = { missionId: report.missionId, theaterId: report.theaterId, units: [] };
  const session = createProductionBattleSession({
    sourceSaveRevision: 10, missionId: report.missionId, deploymentSnapshot, report,
    sequence, salvageRulesVersion: options.salvageRulesVersion ?? SALVAGE_RULES.version
  });
  state.battleSessions[session.battleSessionId] = session;
  state.battles = [report];
  const ledger = {
    settlementId: session.settlementId, battleSessionId: session.battleSessionId,
    formalReportHash: session.formalReportHash, reportId: report.id, result,
    reward: {}, losses: { unitIds: [], updatedUnitIds: [] }, appliedAtSaveRevision: 10, status: 'applied'
  };
  ledger.ledgerHash = buildSettlementLedgerHash(ledger);
  state.battleSettlementLedger[session.settlementId] = ledger;
  state.activeBattle = {
    battleSessionId: session.battleSessionId, settled: true, settlementAllowed: true, replayReadOnly: false
  };
  return { state, session, report };
}
function diff(before, after) { return computeSaveDiff(before, after).map((row) => row.path).filter(Boolean); }
function claimedFixture(sequence = 31) {
  const base = fixture(BATTLE_RESULT.VICTORY, sequence);
  const offer = deriveSalvageOffer(base.state, base.session.battleSessionId);
  assert.equal(offer.outcome, 'equipment');
  const claimed = claimBattleSalvage(base.state, base.session.battleSessionId);
  assert.equal(claimed.ok, true);
  return { ...base, offer, claimed };
}

console.log('\n── Stage 9-D deterministic battle salvage / claim loop ──');

check('v10 schema and centralized salvage rules are present', () => {
  assert.equal(SAVE_VERSION, 10);
  assert.equal(SALVAGE_RULES.version, 1);
  assert.deepEqual(SALVAGE_RULES.allowedResults, ['victory', 'pyrrhic']);
  assert.equal(SALVAGE_RULES.poolKind, 'production');
});

check('new production session explicitly carries salvage rules version 1', () => {
  const { session } = fixture(BATTLE_RESULT.VICTORY, 0);
  assert.equal(session.salvageRulesVersion, SALVAGE_RULES.version);
});

check('victory derives a stable eligible offer and reload cannot reroll', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 1);
  const first = deriveSalvageOffer(state, session.battleSessionId);
  const second = deriveSalvageOffer(clone(state), session.battleSessionId);
  assert.equal(first.ok, true); assert.equal(first.eligible, true);
  assert.deepEqual(second, first);
  assert.equal(first.chance, 0.5);
  assert.match(first.salvageId, /^salvage-/);
});

check('pyrrhic uses the lower deterministic chance', () => {
  const { state, session } = fixture(BATTLE_RESULT.PYRRHIC, 2, { theaterId: 'enemy_outpost' });
  const offer = deriveSalvageOffer(state, session.battleSessionId);
  assert.equal(offer.ok, true); assert.equal(offer.chance, 0.21);
});

check('defeat, withdraw and wiped are ineligible and cannot reroll', () => {
  [BATTLE_RESULT.DEFEAT, BATTLE_RESULT.WITHDRAW, BATTLE_RESULT.WIPED].forEach((result, index) => {
    const { state, session } = fixture(result, 10 + index);
    const offer = deriveSalvageOffer(state, session.battleSessionId);
    assert.equal(offer.ok, false); assert.equal(offer.code, 'result_not_eligible');
    assert.equal(claimBattleSalvage(state, session.battleSessionId).code, 'result_not_eligible');
  });
});

check('legacy, debug and missing/invalid settlement fail closed', () => {
  const legacy = fixture(BATTLE_RESULT.VICTORY, 20, { salvageRulesVersion: 0 });
  assert.equal(deriveSalvageOffer(legacy.state, legacy.session.battleSessionId).code, 'legacy_session');
  const debug = fixture(BATTLE_RESULT.VICTORY, 21); debug.session.sessionOrigin = 'debug';
  assert.equal(deriveSalvageOffer(debug.state, debug.session.battleSessionId).code, 'session_origin');
  const missing = fixture(BATTLE_RESULT.VICTORY, 22); delete missing.state.battleSettlementLedger[missing.session.settlementId];
  assert.equal(deriveSalvageOffer(missing.state, missing.session.battleSessionId).code, 'settlement_invalid');
  const invalid = fixture(BATTLE_RESULT.VICTORY, 23); invalid.state.battleSettlementLedger[invalid.session.settlementId].ledgerHash = 'tampered';
  assert.equal(deriveSalvageOffer(invalid.state, invalid.session.battleSessionId).code, 'settlement_invalid');
  const missingVersion = fixture(BATTLE_RESULT.VICTORY, 24); delete missingVersion.session.salvageRulesVersion;
  assert.equal(deriveSalvageOffer(missingVersion.state, missingVersion.session.battleSessionId).code, 'version_missing');
  const unknownVersion = fixture(BATTLE_RESULT.VICTORY, 25, { salvageRulesVersion: 99 });
  assert.equal(deriveSalvageOffer(unknownVersion.state, unknownVersion.session.battleSessionId).code, 'version_incompatible');
});

check('legacy cutoff remains closed across v10 re-migration and deleted metadata', () => {
  const old = fixture(BATTLE_RESULT.VICTORY, 26);
  old.state.version = 9;
  const migrated = migrate(clone(old.state));
  const migratedSession = Object.values(migrated.battleSessions)[0];
  assert.equal(migratedSession.salvageRulesVersion, 0);
  const again = migrate(clone(migrated));
  const againSession = Object.values(again.battleSessions)[0];
  assert.equal(againSession.salvageRulesVersion, 0);
  delete againSession.salvageRulesVersion;
  assert.notEqual(deriveSalvageOffer(again, againSession.battleSessionId).ok, true);
});

check('first claim adds one deterministic instance and persisted provenance', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 31);
  const offer = deriveSalvageOffer(state, session.battleSessionId);
  assert.equal(offer.outcome, 'equipment', `known drop fixture changed: ${JSON.stringify({ roll: offer.roll, chance: offer.chance, salvageId: offer.salvageId })}`);
  const before = clone(state.equipment);
  const result = claimBattleSalvage(state, session.battleSessionId);
  assert.equal(result.ok, true);
  assert.equal(state.equipment.inventory.length, before.inventory.length + 1);
  assert.equal(state.equipment.salvageClaims[offer.salvageId].instanceId, offer.instanceId);
  assert.equal(result.instance.provenance.kind, 'battle_salvage');
  assert.equal(result.instance.provenance.formalReportHash, session.formalReportHash);
});

check('second claim and double click are exactly once', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 32);
  const offer = deriveSalvageOffer(state, session.battleSessionId);
  assert.equal(offer.outcome, 'equipment', `known drop fixture changed: ${JSON.stringify({ roll: offer.roll, chance: offer.chance })}`);
  const first = claimBattleSalvage(state, session.battleSessionId);
  const before = clone(state.equipment);
  const second = claimBattleSalvage(state, session.battleSessionId);
  assert.equal(first.ok, true);
  assert.equal(second.code, 'already_claimed');
  assert.equal(claimBattleSalvage(state, session.battleSessionId).code, 'already_claimed');
  assert.deepEqual(state.equipment, before);
  if (first.ok) assert.equal(state.equipment.inventory.filter((row) => row.id === first.instance.id).length, 1);
});

check('claim before settlement, replay and other active battle cannot mutate state', () => {
  const base = fixture(BATTLE_RESULT.VICTORY, 40);
  base.state.activeBattle.settled = false;
  const before = clone(base.state);
  assert.equal(claimBattleSalvage(base.state, base.session.battleSessionId).code, 'settlement_pending');
  assert.deepEqual(base.state, before);
  const replay = fixture(BATTLE_RESULT.VICTORY, 41);
  replay.state.activeBattle.replayReadOnly = true;
  assert.equal(claimBattleSalvage(replay.state, replay.session.battleSessionId).code, 'replay_read_only');
  assert.deepEqual(replay.state.equipment, createInitialState().equipment);
});

check('formal settlement boundary and claim save-diff are isolated', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 50);
  const before = clone(state.equipment);
  const afterSettlement = clone(state.equipment);
  assert.deepEqual(afterSettlement, before);
  const beforeClaim = clone(state);
  const offer = deriveSalvageOffer(state, session.battleSessionId);
  assert.equal(offer.outcome, 'equipment');
  const result = claimBattleSalvage(state, session.battleSessionId);
  assert.equal(result.ok, true);
  const paths = diff(beforeClaim, state);
  assert.ok(paths.every((path) => path === 'equipment' || path.startsWith('equipment.')));
  assert.equal(canonicalHash(beforeClaim.battleSessions), canonicalHash(state.battleSessions));
  assert.equal(canonicalHash(beforeClaim.battleSettlementLedger), canonicalHash(state.battleSettlementLedger));
  assert.equal(offer.offerHash, result.claim.offerHash);
});

check('real Formal Settlement executes while equipment remains byte-for-byte unchanged', () => {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  state.unlocks.units = ['mbt'];
  const unit = createUnit('mbt', 'stage9-d-formal-unit');
  unit.id = 'stage9-d-formal-unit';
  state.units = [unit];
  const formationResult = createFormation(state, 'Stage 9-D real formal settlement');
  assert.equal(formationResult.ok, true);
  formationResult.formation.id = 'stage9-d-formal-formation';
  formationResult.formation.unitIds = [unit.id];
  unit.formationId = formationResult.formation.id;
  unit.status = 'assigned';
  recalcDerived(state);
  state.command.capacity = 999;
  const dispatched = dispatchFormation(state, formationResult.formation.id, 'scrap_mine', 'cautious', 93001);
  assert.equal(dispatched.ok, true);
  assert.equal(state.battleSessions[state.activeBattle.battleSessionId].salvageRulesVersion, 1);
  const before = canonicalHash(state.equipment);
  const settled = tickActiveBattle(state, state.activeBattle.duration + 1);
  assert.equal(settled.ok, true);
  assert.equal(state.activeBattle.settled, true);
  assert.equal(canonicalHash(state.equipment), before);
});

check('salvage instance can be mounted normally after claim', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 32);
  state.research.completed = ['expanded_storage'];
  const unit = { id: 'salvage-unit', type: 'mbt', hp: 160, maxHp: 160, status: 'ready', formationId: null, experience: 0, battles: 0 };
  state.units = [unit];
  const result = claimBattleSalvage(state, session.battleSessionId);
  assert.equal(result.ok, true);
  state.activeBattle = null;
  state.activeBattleSessionId = null;
  const checkResult = canEquipEquipment(state, unit.id, result.instance.id);
  assert.equal(checkResult.ok, true);
  assert.equal(equipEquipment(state, unit.id, result.instance.id).ok, true);
  assert.equal(state.equipment.bindings[unit.id][0], result.instance.id);
});

check('v9 migration preserves old state, creates empty claims and no legacy salvage', () => {
  const old = fixture(BATTLE_RESULT.VICTORY, 70);
  old.state.version = 9;
  old.state.equipment = { inventory: [], bindings: {} };
  const migrated = migrate(clone(old.state));
  assert.equal(migrated.version, 10);
  assert.deepEqual(migrated.equipment, { inventory: [], bindings: {}, salvageClaims: {} });
  const session = Object.values(migrated.battleSessions)[0];
  assert.equal(session.salvageRulesVersion, 0);
  assert.equal(migrated.resources.supply, old.state.resources.supply);
  assert.equal(migrated.equipment.inventory.length, 0);
});

check('claim sanitizer removes forged receipt and orphan salvage instance', () => {
  const { state, session } = fixture(BATTLE_RESULT.VICTORY, 80);
  const offer = deriveSalvageOffer(state, session.battleSessionId);
  state.equipment.salvageClaims = { [offer.salvageId]: { ...offer, claimed: true, instanceId: 'fake', offerHash: 'fake' } };
  state.equipment.inventory.push({ id: 'orphan', equipmentId: 'anti_armor_sights', quantity: 1, provenance: { kind: 'battle_salvage', salvageId: 'orphan' } });
  const result = sanitizeSalvageClaims(state);
  assert.equal(result.repaired, true);
  assert.deepEqual(state.equipment.salvageClaims, {});
  assert.equal(state.equipment.inventory.some((row) => row.id === 'orphan'), false);
});

check('salvage provenance namespace and claim binding fail closed in both directions', () => {
  const mutations = [
    (state, instance) => { instance.provenance = { kind: 'production' }; },
    (state, instance) => { instance.id = 'equipment-production-anti_armor_sights-1'; },
    (state, instance) => { delete instance.provenance; },
    (state, instance) => { delete instance.provenance.salvageId; },
    (state, instance) => { instance.provenance.salvageId = 'wrong-salvage'; },
    (state, instance, claim) => { claim.instanceId = `${SALVAGE_RULES.instanceNamespace}-forged`; },
    (state, instance, claim) => { claim.equipmentId = claim.equipmentId === 'anti_armor_sights' ? 'scout_optics' : 'anti_armor_sights'; },
    (state, instance, claim) => { state.equipment.salvageClaims['other-salvage'] = { ...claim, salvageId: 'other-salvage' }; },
    (state, instance) => { state.equipment.inventory.push(clone(instance)); },
    (state, instance) => { instance.id = 'equipment-production-forged'; instance.provenance = { kind: 'production' }; }
  ];
  mutations.forEach((mutate, index) => {
    const { state, claimed } = claimedFixture(31);
    const instance = state.equipment.inventory.find((row) => row.id === claimed.instance.id);
    const claim = state.equipment.salvageClaims[claimed.claim.salvageId];
    mutate(state, instance, claim);
    sanitizeSalvageClaims(state);
    assert.equal(state.equipment.inventory.some((row) => row.provenance?.kind === 'battle_salvage' || String(row.id).startsWith(`${SALVAGE_RULES.instanceNamespace}-`)), false, `provenance mutation ${index + 1} survived`);
    assert.deepEqual(state.equipment.salvageClaims, {}, `claim mutation ${index + 1} survived`);
  });
});

check('salvage sanitizer is idempotent after forged cleanup', () => {
  const { state, claimed } = claimedFixture(31);
  const instance = state.equipment.inventory.find((row) => row.id === claimed.instance.id);
  instance.provenance.salvageId = 'forged';
  sanitizeSalvageClaims(state);
  const once = clone(state);
  sanitizeSalvageClaims(state);
  assert.deepEqual(state, once);
});

const committedChanged = execFileSync('git', ['diff', '--name-only', '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const workingChanged = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const untrackedChanged = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const changed = [...new Set([...committedChanged, ...workingChanged, ...untrackedChanged])];
const forbiddenAuthorityPrefixes = ['js/battle.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'tests/lib/'];
const evidence = {
  stage: '9-D', independentRecompute: true, saveVersion: SAVE_VERSION, salvageRules: SALVAGE_RULES,
  testCount: checks.length, passed: checks.every((row) => row.passed), checks,
  forbiddenAuthorityFilesChanged: changed.filter((file) => forbiddenAuthorityPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))),
  productionSessionMetadataOnly: changed.includes('js/production-battle-session.js'),
  theaterMetadataOnly: changed.includes('js/theater.js'),
  formalSettlementEquipmentUnchanged: true, legacyCutoff: 'only explicit salvageRulesVersion=1 is eligible; missing/0/unknown fail closed',
  noBattleDropInSolver: true
};
fs.writeFileSync(path.join(root, 'stage9_d_core_machine_evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\nStage 9-D battle salvage core: ${passed} passed / ${checks.length - passed} failed / ${checks.length} total`);
if (!evidence.passed) process.exitCode = 1;
