/**
 * battle.js —— 自动战斗求解器（阶段5主体）
 *
 * 铁律：
 *  1. 战斗结果由本模块一次性算完，输出「事件序列 + 战报」；
 *  2. renderer 只播放事件，禁止让动画、碰撞、帧率反过来影响结果；
 *  3. 相同 seed + 相同编队 + 相同策略 → 完全相同的结果（使用 createRng）；
 *  4. 绝不修改传入的 state / formation / 真实单位实例。
 */

import {
  BATTLE, BATTLE_RESULT, STRATEGIES, THEATERS, OPERATIONS, ENEMY_UNITS, TERRAIN,
  BUILDINGS, BUILDING_STATUS, UNITS
} from './config.js';
import { createRng, randomSeed, clamp, safeNumber } from './utils.js';
import { BATTLE_COMMANDS } from './events.js';
import { getResearchModifiers } from './research.js';
import { getUnitRank, getUnitEffectiveStats } from './units.js';
import { countCombatCapable, determineBattleOutcome } from './battle-outcome.js';
import { chooseTargetDeterministically } from './battle-targeting.js';
import { resolveBattleTactics, tacticalRole } from './battle-tactics.js';

/** 战斗事件类型 */
export const BATTLE_EVENT = {
  PHASE: 'phase',
  MOVE: 'move',
  FIRE: 'fire',
  DAMAGE: 'damage',
  SUPPRESS: 'suppress',
  REPAIR: 'repair',
  DESTROY: 'destroy',
  RETREAT: 'retreat',
  REVEAL: 'reveal',
  AMBUSH: 'ambush',
  RESULT: 'result'
};

/** 四个战斗阶段 */
export const BATTLE_PHASE = {
  SCOUT: 'scout',
  APPROACH: 'approach',
  ENGAGE: 'engage',
  RESOLVE: 'resolve'
};

function clone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
}

/** 由真实单位 / 敌方模板生成战斗快照 */
function makeSnapshot(side, id, realId, type, name, category, shape, hp, stats, extra = {}) {
  return {
    id, side, realId: realId || null, type, name, category, shape,
    hp: safeNumber(hp, stats.hp), maxHp: safeNumber(stats.hp, 100),
    attack: safeNumber(stats.attack, 0),
    antiArmor: safeNumber(stats.antiArmor, 0),
    defense: safeNumber(stats.defense, 0),
    scouting: safeNumber(stats.scouting, 0),
    mobility: safeNumber(stats.mobility, 0),
    repair: safeNumber(stats.repair, 0),
    suppressed: 0, alive: hp > 0,
    callsign: extra.callsign || null,
    rankId: extra.rankId || null,
    rankName: extra.rankName || null,
    rankModifiers: extra.rankModifiers ? { ...extra.rankModifiers } : null,
    experience: safeNumber(extra.experience, 0),
    battles: Math.max(0, Math.floor(safeNumber(extra.battles, 0)))
  };
}

function isRadarOperational(state) {
  if (state && state.buildings && !Array.isArray(state.buildings) && state.buildings.radarOperational !== undefined) {
    return state.buildings.radarOperational === true;
  }
  return (state.buildings || []).some(
    (b) => b.type === 'radar_station' && b.status === BUILDING_STATUS.OPERATIONAL
  );
}

/** 创建空战报骨架（确定性，不依赖 Date.now） */
export function createEmptyReport({ seed, theaterId, strategyId, formation, missionKind = 'campaign', missionId = theaterId }) {
  const theater = THEATERS[theaterId] || null;
  const strategy = STRATEGIES[strategyId] || null;
  const seedNum = Number.isFinite(seed) ? (seed >>> 0) : 0;
  return {
    // 战报 ID 必须包含策略：同种子 + 同编队 + 同战区 + 不同策略 → 不同结果，ID 不得冲突
    id: missionKind === 'operation'
      ? `battle_${seedNum}_${(formation && formation.id) || 'unknown'}_operation_${missionId || 'unknown'}_${strategyId || 'unknown'}`
      : `battle_${seedNum}_${(formation && formation.id) || 'unknown'}_${theaterId || 'unknown'}_${strategyId || 'unknown'}`,
    seed: seedNum,
    theaterId: theaterId || null,
    theaterName: theater ? theater.name : '未知战区',
    terrain: theater ? theater.terrain : 'unknown',
    strategyId: strategyId || null,
    missionKind,
    missionId,
    strategyName: strategy ? strategy.name : '未选择',
    formationId: formation ? formation.id : null,
    formationName: formation ? formation.name : '未知编队',
    startedAt: seedNum,
    initial: { friendly: [], enemy: [] },
    final: { friendly: [], enemy: [] },
    phases: [],
    events: [],
    rounds: [],
    losses: { friendly: [], enemy: [] },
    result: BATTLE_RESULT.VICTORY,
    reasons: { advantages: [], problems: [] },
    rewards: {},
    capture: false,
    duration: BATTLE.baseDuration,
    summary: '',
    scout: { friendlyScouting: 0, ambushChance: 0, revealChance: 0, revealHighThreat: false, firstStrike: 'enemy' },
    modifiers: {},
    tactics: null
  };
}

/**
 * 战斗求解主入口（纯函数）
 */
export function simulateBattle(params) {
  const p = params || {};
  const state = p.state || { units: [], buildings: [] };
  const formation = p.formation || { id: 'unknown', name: '未知编队', unitIds: [] };
  const theaterId = p.theaterId || (p.dispatchSnapshot && p.dispatchSnapshot.theaterId);
  const strategyId = p.strategyId;
  const seed = Number.isFinite(p.seed) ? (p.seed >>> 0) : randomSeed();

  const missionKind = p.missionKind || (p.dispatchSnapshot && p.dispatchSnapshot.missionKind) || 'campaign';
  const missionId = p.missionId || (p.dispatchSnapshot && p.dispatchSnapshot.missionId) || theaterId;
  const missionConfig = p.missionConfig || (missionKind === 'operation' ? OPERATIONS[missionId] : null);
  const theater = THEATERS[theaterId] || null;
  const strategy = STRATEGIES[strategyId] || null;
  if (!theater || !strategy) {
    const rep = createEmptyReport({ seed, theaterId, strategyId, formation, missionKind, missionId });
    rep.summary = '战区或策略配置缺失，无法求解。';
    return rep;
  }
  const terrain = TERRAIN[theater.terrain] || TERRAIN.open;
  const rng = createRng(seed);
  const rewardRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const snapshotResearch = p.dispatchSnapshot && p.dispatchSnapshot.research;
  const research = getResearchModifiers({ research: { completed: snapshotResearch && snapshotResearch.completed ? snapshotResearch.completed : (state.research && state.research.completed) || [] } });

  // 友军快照（只读真实单位，不修改）
  const snapshotUnits = p.dispatchSnapshot && Array.isArray(p.dispatchSnapshot.units) ? p.dispatchSnapshot.units : null;
  const friendly = (snapshotUnits || (formation.unitIds || []).map((uid) => {
    const u = (state.units || []).find((x) => x && x.id === uid);
    if (!u || !UNITS[u.type]) return null;
    const rank = getUnitRank(u);
    return { ...u, stats: getUnitEffectiveStats(u), rank };
  }).filter(Boolean)).map((u) => {
    const def = UNITS[u.type];
    if (!def) return null;
    const stats = u.stats && u.stats.base ? { ...u.stats, hp: safeNumber(u.stats.hp, def.stats.hp) } : (u.stats || def.stats);
    const rank = u.rank || { id: u.rankId, name: u.rankName, modifiers: u.rankModifiers || {} };
    const name = u.callsign ? `${u.callsign}（${def.name}）` : (u.name || def.name);
    return makeSnapshot('friendly', `unit_${u.id}`, u.id, u.type, name, def.category, def.shape,
      safeNumber(u.hp, def.stats.hp), stats, {
        callsign: u.callsign, rankId: rank.id, rankName: rank.name, rankModifiers: rank.modifiers,
        experience: u.experience, battles: u.battles
      });
  }).filter(Boolean);

  // 敌军实例（ID 由 seed 与战区配置确定，可复现）
  const enemy = [];
  const enemyConfig = missionConfig && missionConfig.enemy ? missionConfig.enemy : (theater.enemy || {});
  Object.keys(enemyConfig).forEach((typeId) => {
    const count = safeNumber(enemyConfig[typeId], 0);
    const def = ENEMY_UNITS[typeId];
    if (!def || count <= 0) return;
    for (let i = 1; i <= count; i += 1) {
      enemy.push(makeSnapshot('enemy', `${typeId}_${i}`, null, typeId, def.name, def.category, def.shape,
        def.stats.hp, def.stats));
    }
  });

  // 敌军数量在上面的配置展开后才完整；把威胁列表补回同一份确定性战术意图。
  const resolvedTactics = resolveBattleTactics({ friendly, enemy, strategyId, research });

  const mods = strategy.mods || {};
  const modifiers = {
    scouting: mods.scouting || 1,
    defense: mods.defense || 1,
    damage: mods.damage || 1,
    ambush: mods.ambush || 0,
    firstPhaseAttack: mods.firstPhaseAttack || 1,
    armorAttack: mods.armorAttack || 1,
    infantryAttack: mods.infantryAttack || 1,
    suppression: mods.suppression || 1,
    revealChance: mods.revealChance || 0,
    upkeep: mods.upkeep || 1,
    atRisk: mods.atRisk || 0,
    research: { ...research }
  };

  const hasRadar = isRadarOperational(state);
  const radarFx = (BUILDINGS.radar_station && BUILDINGS.radar_station.effects) || {};
  const radarScout = hasRadar ? safeNumber(radarFx.scouting, 0) : 0;
  const radarAmbushResist = hasRadar ? safeNumber(radarFx.ambushResist, 0) : 0;
  const radarIntel = hasRadar ? safeNumber(radarFx.intelAccuracy, 0) : 0;

  const events = [];
  const pushEvent = (type, actor, target, value, text) => {
    events.push({ t: 0, type, actor: actor || null, target: target || null, value: safeNumber(value, 0), text });
  };

  // ---------- 阶段1：侦察 ----------
  const friendlyScouting = friendly.reduce((s, u) => s + u.scouting, 0)
    * modifiers.scouting * research.battleScoutingMultiplier + radarScout;
  const scoutScore = friendlyScouting - theater.concealment;
  const revealChance = clamp(
    0.45 + scoutScore * 0.03 + (modifiers.revealChance || 0) + radarIntel * 0.05, 0.10, 0.95
  );
  const ambushChance = clamp(
    0.35 + theater.concealment * 0.02 - friendlyScouting * 0.015 - radarAmbushResist
      + (modifiers.ambush || 0) + (terrain.ambushBias || 0), 0.05, 0.75
  );

  const enemyRevealed = rng.chance(revealChance);
  const ambushed = rng.chance(ambushChance);
  const highThreatExists = enemy.some((e) => e.category === 'at_infantry' || e.category === 'armor' || e.category === 'vehicle');
  const revealHighThreat = highThreatExists
    ? (enemyRevealed || rng.chance(clamp(revealChance + (strategyId === 'recon_by_fire' ? 0.2 : 0), 0, 1)))
    : false;

  let firstStrike = 'enemy';
  if (ambushed) firstStrike = 'enemy';
  else if (enemyRevealed && scoutScore >= 0) firstStrike = 'friendly';

  pushEvent(BATTLE_EVENT.PHASE, null, null, 0, '侦察阶段开始');
  if (enemyRevealed) {
    const counts = {};
    enemy.forEach((e) => { counts[e.name] = (counts[e.name] || 0) + 1; });
    Object.keys(counts).forEach((nm) => {
      pushEvent(BATTLE_EVENT.REVEAL, null, null, counts[nm], `发现敌方单位：${nm} ×${counts[nm]}`);
    });
  } else {
    pushEvent(BATTLE_EVENT.REVEAL, null, null, 0, '敌方部署未被完全侦知');
  }
  if (revealHighThreat) {
    pushEvent(BATTLE_EVENT.REVEAL, null, null, 0, '提前发现敌方高威胁单位');
  }
  if (ambushed) {
    pushEvent(BATTLE_EVENT.AMBUSH, null, null, 0, `${formation.name}遭遇敌方伏击`);
  }
  const scoutSummary = `侦察判定：情报可信度 ${enemyRevealed ? '高' : '低'}，`
    + `${ambushed ? '遭遇伏击' : '未遭伏击'}，先手方：${firstStrike === 'friendly' ? '我方' : '敌方'}。`;

  // ---------- 阶段2：接敌 ----------
  pushEvent(BATTLE_EVENT.PHASE, null, null, 0, '接敌阶段开始');
  const approachSummary = `地形为${terrain.name}：`
    + `${terrain.armorAttack !== 1 ? `装甲攻击×${terrain.armorAttack}，` : ''}`
    + `${terrain.vehicleMobility !== 1 ? `车辆机动×${terrain.vehicleMobility}，` : ''}`
    + `${terrain.enemyDefense !== 1 ? `敌方防御×${terrain.enemyDefense}，` : ''}`
    + `${terrain.friendlyAttack !== 1 ? `我方攻击×${terrain.friendlyAttack}，` : ''}`
    + `先手方：${firstStrike === 'friendly' ? '我方' : '敌方'}。`;

  // ---------- 阶段3：交火 ----------
  pushEvent(BATTLE_EVENT.PHASE, null, null, 0, '交火阶段开始');

  const initialFriendly = friendly.map(clone);
  const initialEnemy = enemy.map(clone);

  const aliveCombat = (side) => countCombatCapable(side === 'friendly' ? friendly : enemy);
  /**
   * 单次攻击伤害。
   * 阶段6：策略与地形修正必须真实参与计算（此前只写在文案里）：
   *   - modifiers.defense      → 我方单位作为目标时的有效防御（谨慎推进 ×1.15）
   *   - modifiers.atRisk       → 敌方反装甲小组打我方装甲的额外风险（正面突破 +0.30）
   *   - terrain.armorAttack    → 装甲单位攻击力受地形影响（开阔地 ×1.10）
   */
  function computeDamage(attacker, target, opts, rngRef) {
    const { modifiers: m, terrain: ter, firstStrike: fs, isFirstRound } = opts;
    const offensive = target.category === 'armor'
      ? Math.max(attacker.attack * 0.55, attacker.antiArmor)
      : attacker.attack;
    const counter = ((BATTLE.counters[attacker.category] || {})[target.category]) ?? 1;
    // 策略防御修正只保护我方单位
    let defenseMod = target.side === 'friendly' ? (m.defense || 1) : 1;
    const armorResearch = target.side === 'friendly'
      && (target.category === 'armor' || target.category === 'vehicle')
      ? research.armorBattleDefenseMultiplier : 1;
    const targetRole = tacticalRole(resolvedTactics, target.id);
    const armorProtected = target.side === 'friendly'
      && (target.category === 'armor' || target.category === 'vehicle')
      && resolvedTactics.combinedArms
      && friendly.some((unit) => unit.alive && unit.id !== target.id && (unit.category === 'infantry' || unit.type === 'at_infantry'));
    const supportProtected = target.side === 'friendly'
      && targetRole?.role === 'support'
      && resolvedTactics.combinedArms
      && friendly.some((unit) => unit.alive && (unit.category === 'armor' || unit.type === 'mbt'));
    if (armorProtected) defenseMod *= 1 + resolvedTactics.modifiers.armorProtection;
    if (supportProtected) defenseMod *= 1 + resolvedTactics.modifiers.infantrySupport;
    const effectiveDefense = Math.max(0, target.defense * defenseMod * armorResearch);
    const mitigation = 100 / (100 + effectiveDefense * 2);
    let attackMod = 1;
    attackMod *= (m.damage || 1);
    if (attacker.category === 'armor') {
      attackMod *= (m.armorAttack || 1);
      attackMod *= (ter.armorAttack || 1);      // 地形对装甲攻击的修正
    }
    if (attacker.category === 'infantry') attackMod *= (m.infantryAttack || 1);
    if (attacker.side === 'friendly' && (attacker.category === 'armor' || attacker.type === 'mbt')
      && resolvedTactics.combinedArms
      && friendly.some((unit) => unit.alive && unit.id !== attacker.id && (unit.category === 'infantry' || unit.type === 'at_infantry'))) {
      attackMod *= 1 + resolvedTactics.modifiers.armorAttack;
    }
    if (attacker.side === 'friendly') attackMod *= (ter.friendlyAttack || 1);
    if (target.side === 'enemy') attackMod *= (2 - (ter.enemyDefense || 1));
    if (isFirstRound && attacker.side === fs) attackMod *= (m.firstPhaseAttack || 1);
    if (attacker.suppressed > 0) attackMod *= BATTLE.suppress.factor;
    // 正面突破：我方装甲暴露在敌方反装甲火力下的额外风险
    if (attacker.side === 'enemy' && attacker.category === 'at_infantry'
      && target.side === 'friendly' && target.category === 'armor') {
      attackMod *= (1 + (m.atRisk || 0));
    }
    const variance = rngRef.range(0.85, 1.15);
    return Math.max(1, Math.round(offensive * counter * attackMod * mitigation * variance));
  }

  /** 有效机动力：车辆 / 装甲受地形机动修正影响，决定行动顺序 */
  function effectiveMobility(unit) {
    const isWheeled = unit.category === 'vehicle' || unit.category === 'armor';
    return unit.mobility * (isWheeled ? (terrain.vehicleMobility || 1) : 1);
  }

  /** 压制判定阈值：火力侦察提升压制效果（阈值更低 → 更容易压制） */
  function suppressThreshold(attacker) {
    const base = BATTLE.suppress.threshold;
    if (attacker.side !== 'friendly') return base;
    const sup = modifiers.suppression || 1;
    return sup > 0 ? base / sup : base;
  }

  const MAX = BATTLE.maxRounds;
  let round = 0;
  let ended = false;
  const rounds = [];
  const losses = { friendly: [], enemy: [] };

  while (round < MAX && !ended) {
    round += 1;
    const combatants = [...friendly, ...enemy].filter((u) => u.alive);
    combatants.sort((a, b) => {
      if (round === 1) {
        const af = a.side === firstStrike ? 1 : 0;
        const bf = b.side === firstStrike ? 1 : 0;
        if (af !== bf) return bf - af;
      }
      const am = effectiveMobility(a);
      const bm = effectiveMobility(b);
      if (bm !== am) return bm - am;
      if (b.scouting !== a.scouting) return b.scouting - a.scouting;
      return a.id < b.id ? -1 : 1;
    });

    let roundActions = 0;
    for (const actor of combatants) {
      if (!actor.alive) continue;
      if (actor.repair > 0 && actor.attack === 0) continue; // 维修车在阶段末行动
      const targets = (actor.side === 'friendly' ? enemy : friendly).filter((u) => u.alive);
      if (targets.length === 0) break;
      const tacticalPriority = resolvedTactics.researchEnhanced
        ? resolvedTactics.targetPriorities?.[actor.id]
        : null;
      const target = chooseTargetDeterministically(actor, targets, rng, {
        sortImplementation: p.targetSortImplementation || 'native',
        categoryPriority: tacticalPriority
      });
      const isFirstRound = (round === 1);
      const dmg = computeDamage(actor, target, { modifiers, terrain, firstStrike, strategyId, isFirstRound }, rng);
      target.hp -= dmg;
      pushEvent(BATTLE_EVENT.FIRE, actor.id, target.id, 0, `${actor.name}向${target.name}开火`);
      pushEvent(BATTLE_EVENT.DAMAGE, actor.id, target.id, dmg, `${target.name}受到${dmg}点伤害`);
      if (actor.suppressed > 0) actor.suppressed -= 1;
      if (dmg >= target.maxHp * suppressThreshold(actor) && target.alive) {
        target.suppressed = 1;
        pushEvent(BATTLE_EVENT.SUPPRESS, actor.id, target.id, 0, `${target.name}被压制，下次攻击下降`);
      }
      if (target.hp <= 0 && target.alive) {
        target.hp = 0;
        target.alive = false;
        pushEvent(BATTLE_EVENT.DESTROY, actor.id, target.id, 0, `${target.name}被摧毁`);
        losses[target.side].push({
          id: target.id, realId: target.realId, type: target.type, name: target.name, side: target.side
        });
      }
      roundActions += 1;
    }

    // 维修阶段：每辆存活维修车修复一辆受损友军（优先装甲，其次车辆，不修步兵）
    const medics = [...friendly, ...enemy].filter((u) => u.alive && u.repair > 0);
    for (const medic of medics) {
      const allies = (medic.side === 'friendly' ? friendly : enemy)
        .filter((u) => u.alive && u.id !== medic.id && u.hp < u.maxHp && u.repair === 0 && u.category !== 'infantry');
      if (allies.length === 0) continue;
      allies.sort((a, b) => {
        const rank = (c) => (c.category === 'armor' ? 0 : c.category === 'vehicle' ? 1 : 2);
        return rank(a) - rank(b);
      });
      const patient = allies[0];
      const heal = Math.max(1, Math.round(medic.repair * BATTLE.repairRatio));
      const before = patient.hp;
      patient.hp = Math.min(patient.maxHp, patient.hp + heal);
      const real = patient.hp - before;
      if (real > 0) {
        pushEvent(BATTLE_EVENT.REPAIR, medic.id, patient.id, real, `${medic.name}修复${patient.name}耐久${real}点`);
      }
    }

    rounds.push({ index: round, summary: `第${round}轮交火，双方共${roundActions}次攻击`, actions: roundActions });

    if (aliveCombat('enemy') === 0 || aliveCombat('friendly') === 0) ended = true;
  }

  // ---------- 阶段4：结算（战地抢救） ----------
  pushEvent(BATTLE_EVENT.PHASE, null, null, 0, '结算阶段开始');
  const survivors = friendly.filter((u) => u.alive);
  const survivingMedics = survivors.filter((u) => u.repair > 0);
  const survivingRepairPower = survivingMedics.reduce((s, u) => s + u.repair, 0);
  if (survivingRepairPower > 0) {
    losses.friendly.forEach((loss) => {
      const def = UNITS[loss.type];
      const cat = def ? def.category : null;
      if (cat !== 'armor' && cat !== 'vehicle') return; // 仅装甲车/车辆可抢救
      if (loss.recovered) return;
      const chance = clamp(survivingRepairPower / 100, 0, BATTLE.recovery.maxChance);
      if (rng.chance(chance)) {
        const recoveredHp = Math.max(1, Math.round(def.stats.hp * BATTLE.recovery.hpRatio));
        loss.recovered = true;
        loss.recoveredHp = recoveredHp;
        const snap = friendly.find((u) => u.realId === loss.realId);
        if (snap) { snap.hp = recoveredHp; snap.alive = true; }
        const medic = survivingMedics[0];
        pushEvent(BATTLE_EVENT.REPAIR, medic.id, loss.id, recoveredHp,
          `${loss.name}被战地维修分队抢救回收（耐久恢复至${recoveredHp}）`);
      }
    });
  }

  // 结果判定
  const friendlyInitial = friendly.length;
  const friendlyInitialHp = friendly.reduce((s, u) => s + u.maxHp, 0);
  const friendlyFinalHp = friendly.filter((u) => u.alive).reduce((s, u) => s + Math.max(0, u.hp), 0);
  const permanentLost = losses.friendly.filter((l) => !l.recovered).length;

  const result = determineBattleOutcome({
    friendly, enemy, friendlyInitial, friendlyInitialHp, friendlyFinalHp, permanentLost
  });

  const successful = (result === BATTLE_RESULT.VICTORY || result === BATTLE_RESULT.PYRRHIC);
  const capture = missionKind === 'campaign' && successful;
  const rewards = {};
  if (successful) {
    if (missionKind === 'operation' && missionConfig && missionConfig.rewards) {
      Object.keys(missionConfig.rewards).forEach((key) => {
        const range = missionConfig.rewards[key] || {};
        rewards[key] = rewardRng.int(Math.ceil(safeNumber(range.min, 0)), Math.floor(safeNumber(range.max, 0)));
      });
    } else Object.assign(rewards, theater.firstReward || {});
  }

  // 优势 / 问题
  const advantages = [];
  const problems = [];
  if (enemyRevealed) advantages.push('侦察充分，提前发现敌方部署');
  if (friendly.some((u) => u.category === 'infantry') && friendly.some((u) => u.category === 'armor')) {
    advantages.push('步兵为装甲单位提供了掩护');
  }
  const repairEvents = events.filter((e) => e.type === BATTLE_EVENT.REPAIR).length;
  if (repairEvents > 0) advantages.push(`维修车在交火中恢复了耐久`);
  if (ambushed) problems.push('遭遇敌方伏击，先手被夺');
  if (friendly.some((u) => u.category === 'armor') && enemy.some((e) => e.category === 'at_infantry')) {
    problems.push('主战坦克遭到反装甲小组集中攻击');
  }
  if (friendly.reduce((s, u) => s + u.scouting, 0) < 8) problems.push('编队缺少足够的远程侦察能力');

  const duration = Math.round(BATTLE.baseDuration * (mods.timeScale || 1));

  // 先生成全部事件（含最终结果事件），再统一分配时间。
  // 阶段5的写法先分配时间再补 RESULT，会让最后一个事件停在 t=0，
  // 导致回放临近结束时跳回开头 —— 阶段6修复。
  // 撤退是战报的权威事件：它必须位于 RESULT 之前，但不改变任何战斗数据。
  if (result === BATTLE_RESULT.WITHDRAW
    && !events.some((event) => event && event.type === BATTLE_EVENT.RETREAT)) {
    pushEvent(BATTLE_EVENT.RETREAT, null, null, 0, '我方编队脱离接触并有序撤退');
  }
  pushEvent(BATTLE_EVENT.RESULT, null, null, 0, `战斗结果：${resultLabel(result)}`);

  // 时间轴归一化：单调不减、首个为 0、最后一个严格小于 duration
  const total = events.length;
  events.forEach((event, index) => {
    event.t = total > 1 ? Number(((index / (total - 1)) * duration * 0.95).toFixed(2)) : 0;
  });

  const report = createEmptyReport({ seed, theaterId, strategyId, formation, missionKind, missionId });
  report.initial = { friendly: initialFriendly, enemy: initialEnemy };
  report.final = { friendly: friendly.map(clone), enemy: enemy.map(clone) };
  report.phases = [
    { id: BATTLE_PHASE.SCOUT, title: '侦察阶段', summary: scoutSummary, details: [] },
    { id: BATTLE_PHASE.APPROACH, title: '接敌阶段', summary: approachSummary, details: [] },
    { id: BATTLE_PHASE.ENGAGE, title: '交火阶段', summary: `共进行 ${round} 轮交火`, details: rounds.map((r) => r.summary) },
    { id: BATTLE_PHASE.RESOLVE, title: '结算阶段', summary: `结果：${resultLabel(result)}`, details: [] }
  ];
  report.events = events;
  report.rounds = rounds;
  report.losses = losses;
  report.result = result;
  report.reasons = { advantages, problems };
  report.rewards = rewards;
  report.capture = capture;
  report.duration = duration;
  report.summary = `${formation.name}在${theater.name}的作战以${resultLabel(result)}告终。`
    + `我方损失 ${permanentLost} 个单位，敌方损失 ${losses.enemy.length} 个单位。`;
  report.scout = {
    friendlyScouting, ambushChance, revealChance, revealHighThreat, firstStrike
  };
  report.modifiers = modifiers;
  report.tactics = resolvedTactics;
  report.experienceMultiplier = missionKind === 'operation'
    ? safeNumber(missionConfig && missionConfig.experienceMultiplier, 1) : 1;
  return report;
}

/** 从不可变派遣快照重建战斗输入，供结算前确定性重验。 */
export function rebuildBattleFromDispatchSnapshot(dispatchSnapshot, seed) {
  const snapshot = clone(dispatchSnapshot);
  if (!snapshot) return null;
  const formation = snapshot.formation || { id: snapshot.formationId, name: '未知编队', unitIds: [] };
  return simulateBattle({
    state: { units: snapshot.units || [], buildings: snapshot.buildings || [], research: snapshot.research || { completed: [] } },
    formation,
    theaterId: snapshot.theaterId,
    strategyId: snapshot.strategyId,
    missionKind: snapshot.missionKind || 'campaign',
    missionId: snapshot.missionId || snapshot.theaterId,
    missionConfig: snapshot.operation || null,
    dispatchSnapshot: snapshot,
    seed: Number(seed) >>> 0
  });
}

/** 结果 → 中文标签 */
export function resultLabel(result) {
  switch (result) {
    case BATTLE_RESULT.VICTORY: return '胜利';
    case BATTLE_RESULT.PYRRHIC: return '惨胜';
    case BATTLE_RESULT.DEFEAT: return '失败';
    case BATTLE_RESULT.WITHDRAW: return '主动撤退';
    case BATTLE_RESULT.WIPED: return '编队失去战斗能力';
    default: return '未知';
  }
}

/**
 * 预留：战斗中的指挥命令通道（阶段5之后可接入）
 * 目前只登记命令，不改变任何结果，保证接口稳定。
 */
export function issueCommand(battleContext, command, payload) {
  if (!battleContext || !command) return { ok: false, reason: '无效命令' };
  if (!Object.values(BATTLE_COMMANDS).includes(command)) {
    return { ok: false, reason: '未知命令类型' };
  }
  battleContext.pendingCommands = battleContext.pendingCommands || [];
  battleContext.pendingCommands.push({ command, payload: payload || null, at: Date.now() });
  return { ok: true };
}
