/**
 * state.js —— 全局游戏状态（唯一状态来源）
 *
 * 约定：
 *  1. 任何模块都通过 getState() 读取状态，不要各自持有副本；
 *  2. 派生数值（产量、上限、电力、指挥容量）由 economy.recalcDerived() 统一计算；
 *  3. 状态必须是 JSON 可序列化的，方便存档。
 */

import {
  SAVE_VERSION, TIME, ECONOMY, BUILDINGS, BUILDING_STATUS, THEATERS, OPERATIONS
} from './config.js';
import { uid } from './utils.js';

/** 创建一份全新的初始状态（新游戏） */
export function createInitialState() {
  const state = {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    savedAt: 0,
    saveRevision: 0,

    /** 时间与速度 */
    time: {
      game: TIME.startSeconds,   // 基地时钟（游戏秒）
      played: 0,                 // 累计游玩的游戏秒
      speed: TIME.defaultSpeed,  // 0 / 1 / 2 / 4
      lastSpeed: TIME.defaultSpeed
    },

    /** 资源（浮点存储，显示时向下取整） */
    resources: {
      supply: ECONOMY.start.supply,
      alloy: ECONOMY.start.alloy,
      intel: ECONOMY.start.intel
    },

    /** 派生：上限 / 产量 / 电力 / 指挥容量（由 economy 计算，勿手改） */
    caps: { supply: ECONOMY.baseCaps.supply, alloy: ECONOMY.baseCaps.alloy, intel: ECONOMY.baseCaps.intel },
    rates: { supply: ECONOMY.baseRates.supply, alloy: ECONOMY.baseRates.alloy, intel: ECONOMY.baseRates.intel },
    power: { produced: 0, used: 0 },
    command: { capacity: 0, used: 0 },

    /** 建筑列表 */
    buildings: [],

    /** 建设队列（阶段2） */
    construction: { current: null, queue: [] },

    /** 生产队列（阶段3） */
    production: { current: null, queue: [] },

    /** 单位库存（阶段3） */
    units: [],

    /** 编队（阶段4） */
    formations: [],

    /** 维修队列（阶段6） */
    repairs: [],

    /** 战区占领与首胜记录（阶段5） */
    theaters: {},

    /** 战斗记录（阶段5） */
    battles: [],

    /** 当前活动战斗（同一时间最多一场；阶段5） */
    activeBattle: null,

    /** Stage E-A：生产战斗会话与 exactly-once 结算账本。 */
    activeBattleSessionId: null,
    battleSessionSequence: 0,
    battleSessions: {},
    battleSettlementLedger: {},

    /** 解锁标记（建筑/单位/科技） */
    unlocks: { units: [], techs: [] },

    /** 科研队列（效果由 completed + config 动态计算） */
    research: {
      current: null, queue: [], completed: [], revision: 0,
      history: [{ revision: 0, completed: [], gameTime: TIME.startSeconds }]
    },

    /** 已占领战区的可重复作战状态。 */
    operations: Object.keys(OPERATIONS).reduce((all, id) => {
      all[id] = { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null };
      return all;
    }, {}),

    /** 离线结算账本，防止同一来源时间或令牌重复结算 */
    offlineLedger: { lastToken: null, lastSourceSavedAt: 0, lastSettledAt: 0 },

    /** 底部消息栏 */
    log: [],

    /** 离线报告（阶段6结算，阶段1仅记录时长） */
    offline: null,

    /** 设置 */
    settings: { autoSave: true, showFps: true },

    /** 统计 */
    stats: { battlesFought: 0, victories: 0, unitsBuilt: 0, buildingsBuilt: 0 }
  };

  // 初始建筑：指挥中心 + 小型发电站
  Object.values(BUILDINGS).forEach((def) => {
    if (def.initial) state.buildings.push(createBuilding(def.id));
  });

  // 初始化战区记录
  Object.keys(THEATERS).forEach((id) => {
    state.theaters[id] = { id, captured: false, firstRewardTaken: false, attempts: 0, victories: 0 };
  });

  return state;
}

/** 创建一个建筑实例 */
export function createBuilding(typeId, status = BUILDING_STATUS.OPERATIONAL) {
  const def = BUILDINGS[typeId];
  return {
    id: uid('bld'),
    type: typeId,
    status,
    progress: status === BUILDING_STATUS.OPERATIONAL ? 1 : 0,
    builtAt: Date.now(),
    level: 1,
    /** 渲染用：建成瞬间的动画计时 */
    fx: { spawn: status === BUILDING_STATUS.OPERATIONAL ? 0 : 1 },
    slot: def && def.slot ? { ...def.slot } : { gx: 0, gy: 0, w: 2, h: 2, height: 24 }
  };
}

/* ------------------------------------------------------------
 * 状态单例访问
 * ---------------------------------------------------------- */

let current = createInitialState();

/** 获取当前状态 */
export function getState() {
  return current;
}

/** 替换整个状态（读档 / 新游戏时使用） */
export function setState(next) {
  if (!next || typeof next !== 'object') {
    console.warn('[state] setState 收到非法状态，已忽略。');
    return current;
  }
  current = next;
  return current;
}

/** 重置为新游戏状态 */
export function resetState() {
  current = createInitialState();
  return current;
}

/* ------------------------------------------------------------
 * 常用查询辅助（只读，不产生副作用）
 * ---------------------------------------------------------- */

/** 是否已建成某类型建筑 */
export function hasBuilding(state, typeId) {
  return state.buildings.some(
    (b) => b.type === typeId && b.status === BUILDING_STATUS.OPERATIONAL
  );
}

/** 获取某类型建筑实例（含在建） */
export function findBuilding(state, typeId) {
  return state.buildings.find((b) => b.type === typeId) || null;
}

/** 已建成建筑数量 */
export function countOperational(state) {
  return state.buildings.filter((b) => b.status === BUILDING_STATUS.OPERATIONAL).length;
}

/** 剩余电力 */
export function powerFree(state) {
  return state.power.produced - state.power.used;
}

/** 剩余指挥容量 */
export function commandFree(state) {
  return state.command.capacity - state.command.used;
}
