/**
 * Stage 9-D battle salvage。
 *
 * This is a post-settlement acquisition system. It reads the immutable
 * ProductionBattleSession, Formal Report and applied settlement ledger, but
 * it never participates in Formal Battle or Formal Settlement.
 */

import { BATTLE_RESULT, EQUIPMENT, SALVAGE_RULES, THEATERS } from './config.js';
import {
  canonicalHash, cloneJson, validateSessionBinding, validateSettlementLedger
} from './production-battle-session.js';
import { createSalvageEquipmentInstance, getEquipmentDefinition, isSalvageInstanceId } from './equipment.js';
import { safeNumber } from './utils.js';

const ALLOWED_RESULTS = new Set(SALVAGE_RULES.allowedResults || [BATTLE_RESULT.VICTORY, BATTLE_RESULT.PYRRHIC]);

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sessionFor(state, battleSessionId) {
  return state && object(state.battleSessions) && typeof battleSessionId === 'string'
    ? state.battleSessions[battleSessionId] || null : null;
}

function reportFor(state, session) {
  return Array.isArray(state?.battles) && session
    ? state.battles.find((report) => report && report.id === session.formalReportId) || null : null;
}

function sameSettlementUsedByAnotherSession(state, session) {
  const sessions = Object.values(state?.battleSessions || {});
  return sessions.some((row) => row && row.battleSessionId !== session.battleSessionId
    && row.settlementId === session.settlementId);
}

function fixed(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function hashUnit(hash, start = 0) {
  const fragment = String(hash).slice(start, start + 8);
  const integer = Number.parseInt(fragment, 16);
  return Number.isFinite(integer) ? integer / 0xffffffff : 0;
}

function resultRule(result) {
  if (result === BATTLE_RESULT.VICTORY) return SALVAGE_RULES.victory;
  if (result === BATTLE_RESULT.PYRRHIC) return SALVAGE_RULES.pyrrhic;
  return null;
}

function pool() {
  return Object.values(EQUIPMENT)
    .filter((def) => def && def.acquisition?.kind === SALVAGE_RULES.poolKind)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function invalid(code, reason, extra = {}) {
  return { ok: false, eligible: false, state: 'ineligible', code, reason, ...extra };
}

function identityFor(session, report, theater) {
  return {
    domain: 'stage9-d-battle-salvage-v1',
    battleSessionId: session.battleSessionId,
    settlementId: session.settlementId,
    formalReportHash: session.formalReportHash,
    missionId: session.missionId,
    theaterId: report.theaterId,
    missionKind: report.missionKind || 'campaign',
    result: report.result,
    difficulty: Number(theater?.difficulty || 0),
    salvageRulesVersion: SALVAGE_RULES.version
  };
}

function offerHashSource(offer) {
  const source = cloneJson(offer) || {};
  delete source.offerHash;
  return source;
}

/**
 * Recomputes the offer exclusively from authoritative saved state.
 * The returned object is safe for UI display, but UI must not recompute it.
 */
export function deriveSalvageOffer(state, battleSessionId) {
  const session = sessionFor(state, battleSessionId);
  if (!session) return invalid('session_missing', '正式战斗会话不存在');
  if (session.sessionOrigin !== 'production') return invalid('session_origin', '非正式生产会话不能产生战利品');
  if (session.salvageRulesVersion !== SALVAGE_RULES.version) {
    return invalid(
      session.salvageRulesVersion === undefined ? 'version_missing' : session.salvageRulesVersion === 0 ? 'legacy_session' : 'version_incompatible',
      '该战斗没有明确启用当前战场打捞规则'
    );
  }
  if (sameSettlementUsedByAnotherSession(state, session)) {
    return invalid('settlement_reused', '结算凭证被多个战斗会话复用');
  }

  const ledger = state?.battleSettlementLedger?.[session.settlementId];
  const ledgerCheck = validateSettlementLedger(ledger, session);
  if (!ledgerCheck.ok) return invalid('settlement_invalid', ledgerCheck.problems.join('；'), { problems: ledgerCheck.problems });

  const report = reportFor(state, session);
  if (!report) return invalid('report_missing', '正式战报不存在');
  const binding = validateSessionBinding(session, {
    report,
    deploymentSnapshot: session.deploymentSnapshot,
    battleSessionId,
    settlementId: session.settlementId,
    deploymentHash: session.deploymentHash,
    sourceReportHash: session.sourceReportHash
  });
  if (!binding.ok) return invalid('session_binding', binding.problems.join('；'), { problems: binding.problems });
  if (report.missionId && String(report.missionId) !== String(session.missionId)) {
    return invalid('mission_binding', '战斗会话与正式战报任务不一致');
  }

  const theater = THEATERS[report.theaterId];
  if (!theater) return invalid('theater_missing', '正式战报对应战区不存在');
  const rule = resultRule(report.result);
  if (!rule || !ALLOWED_RESULTS.has(report.result)) {
    return invalid('result_not_eligible', '该战斗结果不适用战场打捞', {
      battleSessionId, settlementId: session.settlementId, formalReportId: session.formalReportId,
      formalReportHash: session.formalReportHash, missionId: session.missionId,
      theaterId: report.theaterId, missionKind: report.missionKind || 'campaign', result: report.result,
      eligible: false, outcome: 'none'
    });
  }

  const identity = identityFor(session, report, theater);
  const rollHash = canonicalHash({ ...identity, purpose: 'drop-roll' });
  const poolHash = canonicalHash({ ...identity, purpose: 'equipment-pool' });
  const roll = fixed(hashUnit(rollHash), 4);
  const difficulty = Math.max(1, Number(theater.difficulty) || 1);
  const chance = fixed(Math.min(rule.cap, rule.baseChance + Math.max(0, difficulty - 1) * rule.perDifficulty), 4);
  const definitions = pool();
  const equipment = roll < chance && definitions.length
    ? definitions[Number.parseInt(poolHash.slice(0, 8), 16) % definitions.length]
    : null;
  const salvageId = `salvage-${canonicalHash({ ...identity, purpose: 'salvage-id' })}`;
  const offer = {
    salvageId,
    battleSessionId: session.battleSessionId,
    settlementId: session.settlementId,
    formalReportId: session.formalReportId,
    formalReportHash: session.formalReportHash,
    missionId: session.missionId,
    theaterId: report.theaterId,
    missionKind: report.missionKind || 'campaign',
    result: report.result,
    eligible: true,
    roll,
    chance,
    outcome: equipment ? 'equipment' : 'none',
    equipmentId: equipment ? equipment.id : null
  };
  offer.offerHash = canonicalHash(offerHashSource(offer));
  offer.instanceId = equipment ? `${SALVAGE_RULES.instanceNamespace}-${canonicalHash({ salvageId, equipmentId: equipment.id }).slice(0, 32)}` : null;
  const existing = state?.equipment?.salvageClaims?.[salvageId];
  if (existing?.claimed === true) {
    offer.claimed = true;
    offer.claim = cloneJson(existing);
    offer.state = 'claimed';
  } else {
    offer.claimed = false;
    offer.state = 'pending';
  }
  return { ok: true, ...offer };
}

function activeBattleBlocksClaim(state, battleSessionId) {
  const active = state?.activeBattle;
  // 结果页关闭后，正式战报仍可从历史页领取；replay 仍由 activeBattle
  // 明确阻断。这样 reload/关闭结果面板不会制造“只能在 transient UI 领取”的漏洞。
  if (!active) return null;
  if (active.replayReadOnly === true || active.replayContext) return { code: 'replay_read_only', reason: '只读回放期间不能领取战利品' };
  if (active.battleSessionId !== battleSessionId) return { code: 'battle_active', reason: '另一场作战正在进行' };
  if (active.settled !== true) return { code: 'settlement_pending', reason: 'Formal Settlement 尚未完成' };
  return null;
}

/** Exactly-once claim seam. Every validation runs before either inventory or claims is written. */
export function claimBattleSalvage(state, battleSessionId) {
  const block = activeBattleBlocksClaim(state, battleSessionId);
  if (block) return { ok: false, ...block };
  const offer = deriveSalvageOffer(state, battleSessionId);
  if (!offer.ok) return offer;
  if (offer.outcome !== 'equipment') return { ok: false, code: 'no_drop', reason: '本次未发现可回收装备', offer };

  const equipment = state.equipment && typeof state.equipment === 'object' ? state.equipment : null;
  if (!equipment || !Array.isArray(equipment.inventory)) return { ok: false, code: 'equipment_state_invalid', reason: '装备库存不可用' };
  const claims = equipment.salvageClaims && typeof equipment.salvageClaims === 'object' && !Array.isArray(equipment.salvageClaims)
    ? equipment.salvageClaims : {};
  const existing = claims[offer.salvageId];
  if (existing?.claimed === true) {
    const instance = equipment.inventory.find((row) => row && row.id === existing.instanceId);
    if (instance && instance.provenance?.kind === 'battle_salvage' && instance.provenance.salvageId === offer.salvageId) {
      return { ok: false, code: 'already_claimed', reason: '该战场打捞已领取', offer, instance: cloneJson(instance), claim: cloneJson(existing) };
    }
    return { ok: false, code: 'claim_corrupt', reason: '已有领取凭证但装备实例不匹配' };
  }
  if (equipment.inventory.some((row) => row && row.id === offer.instanceId)) {
    return { ok: false, code: 'instance_conflict', reason: '确定性装备实例 ID 已被占用' };
  }
  const session = sessionFor(state, battleSessionId);
  const instance = createSalvageEquipmentInstance(offer.equipmentId, offer.instanceId, safeNumber(state.time?.game, 0), {
    salvageId: offer.salvageId,
    battleSessionId: offer.battleSessionId,
    settlementId: offer.settlementId,
    formalReportHash: offer.formalReportHash,
    missionId: offer.missionId,
    theaterId: offer.theaterId,
    result: offer.result
  });
  if (!instance || !getEquipmentDefinition(instance.equipmentId) || !session) {
    return { ok: false, code: 'claim_invalid', reason: '战利品实例构造失败' };
  }
  const claim = {
    salvageId: offer.salvageId,
    battleSessionId: offer.battleSessionId,
    settlementId: offer.settlementId,
    formalReportId: offer.formalReportId,
    formalReportHash: offer.formalReportHash,
    offerHash: offer.offerHash,
    equipmentId: offer.equipmentId,
    instanceId: instance.id,
    claimed: true,
    claimedAtGameTime: safeNumber(state.time?.game, 0)
  };
  equipment.inventory.push(instance);
  equipment.salvageClaims = { ...claims, [offer.salvageId]: claim };
  return { ok: true, code: 'claimed', reason: '', offer: { ...offer, claimed: true, state: 'claimed', claim }, instance: cloneJson(instance), claim: cloneJson(claim) };
}

/**
 * Save migration sanitizer. Invalid claims are discarded rather than repaired
 * into a reward, and every surviving receipt is checked against a recomputed offer.
 */
export function sanitizeSalvageClaims(state) {
  const notes = [];
  if (!state || typeof state !== 'object') return { repaired: false, notes };
  if (!state.equipment || typeof state.equipment !== 'object') return { repaired: false, notes };
  const source = state.equipment.salvageClaims;
  const claims = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const normalized = {};
  const candidateClaims = [];
  const claimedInstanceIds = new Set();
  const claimedSalvageIds = new Set();
  const rawInstanceCounts = new Map();
  const rawSalvageCounts = new Map();
  Object.entries(claims).forEach(([salvageId, raw]) => {
    if (raw?.instanceId) rawInstanceCounts.set(raw.instanceId, (rawInstanceCounts.get(raw.instanceId) || 0) + 1);
    if (salvageId) rawSalvageCounts.set(salvageId, (rawSalvageCounts.get(salvageId) || 0) + 1);
  });
  Object.entries(claims).forEach(([salvageId, raw]) => {
    const offer = deriveSalvageOffer({ ...state, equipment: { ...state.equipment, salvageClaims: {} } }, raw?.battleSessionId);
    const valid = raw && raw.claimed === true && salvageId === raw.salvageId && offer.ok
      && offer.outcome === 'equipment' && offer.salvageId === salvageId
      && raw.offerHash === offer.offerHash && raw.equipmentId === offer.equipmentId
      && raw.battleSessionId === offer.battleSessionId
      && raw.settlementId === offer.settlementId
      && raw.formalReportId === offer.formalReportId
      && raw.formalReportHash === offer.formalReportHash
      && raw.instanceId === offer.instanceId
      && isSalvageInstanceId(raw.instanceId)
      && rawInstanceCounts.get(raw.instanceId) === 1
      && rawSalvageCounts.get(salvageId) === 1
      && !claimedInstanceIds.has(raw.instanceId)
      && !claimedSalvageIds.has(salvageId);
    if (!valid) {
      notes.push('非法、悬空或与确定性战利品不一致的领取凭证已移除。');
      return;
    }
    claimedInstanceIds.add(raw.instanceId);
    claimedSalvageIds.add(salvageId);
    candidateClaims.push({ salvageId, raw: cloneJson(raw), offer });
  });
  const inventory = Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const rowsById = new Map();
  const rowsBySalvageId = new Map();
  inventory.forEach((instance) => {
    if (!instance || (!isSalvageInstanceId(instance.id) && instance.provenance?.kind !== 'battle_salvage')) return;
    const idRows = rowsById.get(instance.id) || [];
    idRows.push(instance); rowsById.set(instance.id, idRows);
    const salvageId = instance.provenance?.salvageId;
    if (salvageId) {
      const salvageRows = rowsBySalvageId.get(salvageId) || [];
      salvageRows.push(instance); rowsBySalvageId.set(salvageId, salvageRows);
    }
  });
  const validInventory = new Set();
  candidateClaims.forEach(({ salvageId, raw, offer }) => {
    const rows = rowsById.get(raw.instanceId) || [];
    const matching = rows.filter((instance) => instance.provenance?.kind === 'battle_salvage'
      && instance.provenance.salvageId === salvageId
      && instance.provenance.battleSessionId === raw.battleSessionId
      && instance.provenance.settlementId === raw.settlementId
      && instance.provenance.formalReportHash === raw.formalReportHash
      && instance.equipmentId === raw.equipmentId
      && raw.instanceId === offer.instanceId);
    const sameSalvageRows = rowsBySalvageId.get(salvageId) || [];
    if (matching.length !== 1 || sameSalvageRows.length !== 1) {
      notes.push('战场打捞凭证与库存实例不是唯一一对，已双向移除。');
      return;
    }
    normalized[salvageId] = raw;
    validInventory.add(matching[0]);
  });
  if (JSON.stringify(source || {}) !== JSON.stringify(normalized)) notes.push('战场打捞领取凭证已规范化。');
  state.equipment.salvageClaims = normalized;
  const beforeInventory = Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  state.equipment.inventory = beforeInventory.filter((instance) => {
    if (!instance || (!isSalvageInstanceId(instance.id) && instance.provenance?.kind !== 'battle_salvage')) return true;
    const valid = validInventory.has(instance);
    if (!valid) notes.push('没有有效领取凭证的战场打捞实例已移除。');
    return valid;
  });
  return { repaired: notes.length > 0, notes };
}

export const SALVAGE_API = Object.freeze({ deriveSalvageOffer, claimBattleSalvage, sanitizeSalvageClaims });
