/**
 * battle-tactics.js —— 正式战斗的确定性战术编队解析器。
 *
 * 这里不创建位置、不读写状态，也不参与随机数。它只把参战单位和
 * 已锁定的研究快照翻译成“谁在前、谁掩护、谁警戒”的战术意图，供
 * 战斗求解器和通用 RTS 演出共同消费，避免两套 AI 各自猜编队。
 */

import { safeNumber, clamp } from './utils.js';

function isArmor(unit) {
  return unit?.category === 'armor' || unit?.type === 'mbt';
}

function isInfantry(unit) {
  return unit?.category === 'infantry' || unit?.type === 'at_infantry';
}

function isAntiArmor(unit) {
  return unit?.type === 'at_infantry'
    || (unit?.category !== 'armor' && unit?.category !== 'support'
      && safeNumber(unit?.antiArmor, unit?.stats?.antiArmor) >= 18);
}

function isRepair(unit) {
  return unit?.type === 'repair_vehicle' || safeNumber(unit?.repair, unit?.stats?.repair) > 0;
}

function isScout(unit) {
  return unit?.type === 'scout_car' || (unit?.category === 'vehicle' && !isArmor(unit) && !isRepair(unit));
}

function byId(rows) {
  return Object.fromEntries((rows || []).map((unit) => [unit.id, unit]));
}

function roleFor(unit, combined, strategyId) {
  if (isRepair(unit)) return 'support';
  if (isScout(unit)) return 'scout';
  if (isAntiArmor(unit)) return combined ? 'overwatch' : 'anti_armor';
  if (isArmor(unit)) return strategyId === 'breakthrough' ? 'vanguard' : 'armor_screen';
  if (isInfantry(unit)) return combined ? 'infantry_screen' : 'line';
  return 'reserve';
}

function laneFor(role, index) {
  if (role === 'vanguard' || role === 'armor_screen') return 'armor_lane';
  if (role === 'infantry_screen') return index % 2 ? 'left_support' : 'right_support';
  if (role === 'overwatch' || role === 'anti_armor') return 'overwatch_lane';
  if (role === 'support') return 'support_lane';
  if (role === 'scout') return 'recon_lane';
  return 'reserve_lane';
}

function priorityFor(unit, combined) {
  if (isRepair(unit)) return ['infantry', 'vehicle', 'armor', 'support'];
  if (isAntiArmor(unit)) return ['armor', 'vehicle', 'infantry', 'support'];
  if (isArmor(unit) && combined) return ['at_infantry', 'armor', 'vehicle', 'infantry', 'support'];
  if (isInfantry(unit) && combined) return ['at_infantry', 'infantry', 'vehicle', 'armor', 'support'];
  return null;
}

/**
 * @returns {object} 可序列化、可复现的战术意图。
 */
export function resolveBattleTactics({ friendly = [], enemy = [], strategyId = 'cautious', research = {} } = {}) {
  const friendlies = Array.isArray(friendly) ? friendly.filter(Boolean) : [];
  const armors = friendlies.filter(isArmor);
  const infantry = friendlies.filter(isInfantry);
  const antiArmor = friendlies.filter(isAntiArmor);
  const repairs = friendlies.filter(isRepair);
  const scouts = friendlies.filter(isScout);
  const combinedArms = armors.length > 0 && infantry.length > 0;
  const researchCoordination = safeNumber(research.combinedArmsCoordination, 0)
    + safeNumber(research.formationControl, 0)
    + safeNumber(research.repairScreening, 0);
  const researchEnhanced = researchCoordination > 0;
  const coordination = clamp(
    (combinedArms ? 0.35 : 0.08)
      + safeNumber(research.combinedArmsCoordination, 0)
      + safeNumber(research.formationControl, 0),
    0,
    0.85
  );
  const protection = clamp(
    researchEnhanced
      ? (combinedArms ? 0.08 : 0)
        + coordination * 0.18
        + safeNumber(research.repairScreening, 0) * (repairs.length ? 0.4 : 0)
      : 0,
    0,
    0.30
  );
  const armorAttack = clamp(researchEnhanced ? (combinedArms ? 0.04 : 0) + coordination * 0.08 : 0, 0, 0.12);
  const roleCounts = {};
  const roles = {};
  friendlies.forEach((unit, index) => {
    const role = roleFor(unit, combinedArms, strategyId);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    roles[unit.id] = {
      actorId: unit.id,
      role,
      lane: laneFor(role, index),
      order: index,
      targetPriority: priorityFor(unit, combinedArms)
    };
  });

  const enemyThreats = (Array.isArray(enemy) ? enemy : [])
    .filter((unit) => isAntiArmor(unit) || isArmor(unit))
    .map((unit) => unit.id);
  const commands = [];
  if (combinedArms) {
    commands.push({ id: 'screen', phase: 'approach', roles: ['vanguard', 'infantry_screen'], intent: '坦克先占据接敌线，步兵贴靠两翼并压制反装甲火力' });
    if (antiArmor.length) commands.push({ id: 'overwatch', phase: 'engage', roles: ['overwatch'], intent: '反装甲组保持后置警戒，优先处理敌方装甲' });
    if (repairs.length) commands.push({ id: 'support', phase: 'resolve', roles: ['support'], intent: '维修车留在掩护线后方，维持装甲战力' });
  } else if (armors.length) {
    commands.push({ id: 'armor_wedge', phase: 'approach', roles: ['vanguard', 'armor_screen'], intent: '装甲楔形推进，避免单车脱离' });
  } else if (infantry.length) {
    commands.push({ id: 'infantry_line', phase: 'approach', roles: ['line'], intent: '步兵分散展开，利用掩体逐段接敌' });
  }

  const formationId = combinedArms
    ? 'combined_arms_screen'
    : armors.length ? 'armor_wedge' : infantry.length ? 'infantry_line' : 'scattered_reserve';
  const formationName = combinedArms
    ? '步坦协同楔形'
    : armors.length ? '装甲楔形' : infantry.length ? '步兵展开线' : '分散预备队';

  return {
    id: formationId,
    name: formationName,
    combinedArms,
    researchEnhanced,
    strategyId,
    roles,
    roleCounts,
    commands,
    enemyThreats,
    metrics: {
      armorCount: armors.length,
      infantryCount: infantry.length,
      antiArmorCount: antiArmor.length,
      repairCount: repairs.length,
      scoutCount: scouts.length,
      coordination: Number(coordination.toFixed(4)),
      protection: Number(protection.toFixed(4)),
      armorAttack: Number(armorAttack.toFixed(4))
    },
    modifiers: {
      armorProtection: Number(protection.toFixed(4)),
      armorAttack: Number(armorAttack.toFixed(4)),
      infantrySupport: Number((combinedArms ? coordination * 0.05 : 0).toFixed(4))
    },
    targetPriorities: Object.fromEntries(
      friendlies.filter((unit) => priorityFor(unit, combinedArms)).map((unit) => [unit.id, priorityFor(unit, combinedArms)])
    )
  };
}

export function tacticalRole(tactics, actorId) {
  return tactics?.roles?.[actorId] || null;
}

export const BATTLE_TACTICS_API = { resolveBattleTactics, tacticalRole };
