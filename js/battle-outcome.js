import { BATTLE_RESULT } from './config.js';

export function isCombatCapableUnit(unit) {
  return Boolean(
    unit
    && unit.alive === true
    && Number.isFinite(Number(unit.hp))
    && Number(unit.hp) > 0
    && Number.isFinite(Number(unit.attack))
    && Number(unit.attack) > 0
  );
}

export function countCombatCapable(units) {
  return (Array.isArray(units) ? units : []).filter(isCombatCapableUnit).length;
}

export function sumCombatHp(units) {
  return (Array.isArray(units) ? units : []).filter(isCombatCapableUnit)
    .reduce((sum, unit) => sum + Number(unit.hp), 0);
}

export function determineBattleOutcome({
  friendly = [], enemy = [], friendlyInitial = friendly.length, friendlyInitialHp = 0,
  friendlyFinalHp = 0, permanentLost = 0
} = {}) {
  const friendlyCombat = countCombatCapable(friendly);
  const enemyCombat = countCombatCapable(enemy);
  const friendlyAliveAny = (Array.isArray(friendly) ? friendly : []).filter((unit) => unit?.alive === true && Number(unit.hp) > 0).length;
  if (friendlyCombat === 0) return friendlyAliveAny === 0 ? BATTLE_RESULT.WIPED : BATTLE_RESULT.DEFEAT;
  if (enemyCombat === 0) {
    const pctLost = friendlyInitial > 0 ? permanentLost / friendlyInitial : 0;
    const pctHp = friendlyInitialHp > 0 ? (friendlyInitialHp - friendlyFinalHp) / friendlyInitialHp : 0;
    const loneLeft = friendlyCombat === 1 && friendlyInitial > 1;
    return pctLost >= 0.5 || pctHp >= 0.6 || loneLeft ? BATTLE_RESULT.PYRRHIC : BATTLE_RESULT.VICTORY;
  }
  // 双方仍有可战斗单位时，战斗在最大回合数处以撤退收束；
  // 只有我方完全失去战斗能力才进入 defeat / wiped 分支。
  return BATTLE_RESULT.WITHDRAW;
}

export function validateOutcomeSnapshot({
  friendly = [], enemy = [], result, missionKind = 'campaign', capture = false,
  rewards = {}, events = []
} = {}) {
  const problems = [];
  const friendlyCombat = countCombatCapable(friendly);
  const enemyCombat = countCombatCapable(enemy);
  const known = Object.values(BATTLE_RESULT).includes(result);
  if (!known) problems.push('战斗结果非法');
  const success = result === BATTLE_RESULT.VICTORY || result === BATTLE_RESULT.PYRRHIC;
  if (success) {
    if (friendlyCombat < 1) problems.push('胜利结果但我方没有可战斗单位');
    if (enemyCombat > 0) problems.push('胜利结果但敌方仍有可战斗单位');
    if (missionKind === 'operation' && capture !== false) problems.push('重复任务胜利不能占领');
    if (missionKind !== 'operation' && capture !== true) problems.push('战役胜利必须占领');
  } else if (result === BATTLE_RESULT.WIPED) {
    if (friendlyCombat > 0) problems.push('全灭结果但我方仍有可战斗单位');
    if (capture !== false) problems.push('全灭结果不能占领');
  } else if (result === BATTLE_RESULT.DEFEAT) {
    if (enemyCombat < 1) problems.push('失败结果但敌方没有可战斗单位');
    if (capture !== false) problems.push('失败结果不能占领');
  } else if (result === BATTLE_RESULT.WITHDRAW) {
    if (capture !== false) problems.push('撤退结果不能占领');
    const retreats = (Array.isArray(events) ? events : []).filter((event) => event?.type === 'retreat');
    if (retreats.length !== 1) problems.push('撤退结果必须恰好包含一个retreat事件');
    if (Array.isArray(events) && events.length && events.at(-1)?.type !== 'result') problems.push('撤退结果最后必须是result');
  }
  if (!success && rewards && Object.keys(rewards).length > 0) problems.push('失败/撤退/全灭结果不能发放奖励');
  return { ok: problems.length === 0, reason: problems[0] || '', problems, friendlyCombat, enemyCombat };
}
