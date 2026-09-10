/**
 * doctrine.js —— Stage 10-C：指挥方针（Command Doctrine）权威层
 *
 * 全局长期战略倾向：同一时间只启用一种，玩家可随时切换。
 *
 * 设计边界：
 *  - 当前 doctrine 保存在 canonical state.doctrine（字符串 id）；
 *    新游戏默认 BALANCED，老存档读取时自动回落 BALANCED；
 *  - 数值规则（效果倍率 / 维护倍率 / 文案）全部集中在本模块，
 *    tasking.js 与 theater-pressure.js 只通过 modifier selector 获取修正，
 *    不硬编码任何 Doctrine 细节；
 *  - 切换只影响切换之后的推进（每个 tick 实时读取当前 doctrine），
 *    不追溯、不重算历史结果；
 *  - 纯 game-time 驱动：online / offline 走同一条 modifier 路径，结果一致；
 *    暂停时调用方 dt=0，天然无变化；
 *  - 本轮不涉及战斗伤害 / 命中 / resolver / capture / reward / salvage，
 *    也没有冷却、切换成本或多 Doctrine 叠加。
 */

import { safeNumber } from './utils.js';

export const DOCTRINE_TYPE = {
  BALANCED: 'balanced',
  RECON: 'recon',
  CONTROL: 'control',
  SECURITY: 'security'
};

/** 数值与文案规则（倍率为乘法修正，BALANCED 全部 1×） */
export const DOCTRINE = {
  types: [DOCTRINE_TYPE.BALANCED, DOCTRINE_TYPE.RECON, DOCTRINE_TYPE.CONTROL, DOCTRINE_TYPE.SECURITY],
  labels: {
    [DOCTRINE_TYPE.BALANCED]: '均衡方针 BALANCED',
    [DOCTRINE_TYPE.RECON]: '侦察方针 RECON',
    [DOCTRINE_TYPE.CONTROL]: '控制方针 CONTROL',
    [DOCTRINE_TYPE.SECURITY]: '警戒方针 SECURITY'
  },
  shortLabels: {
    [DOCTRINE_TYPE.BALANCED]: 'BALANCED',
    [DOCTRINE_TYPE.RECON]: 'RECON',
    [DOCTRINE_TYPE.CONTROL]: 'CONTROL',
    [DOCTRINE_TYPE.SECURITY]: 'SECURITY'
  },
  descs: {
    [DOCTRINE_TYPE.BALANCED]: '不设倾向：所有作战任务按基础规则执行，无额外修正。',
    [DOCTRINE_TYPE.RECON]: '侦察优先：RECON 任务的战区侦察掌握增长 +50%，RECON 周期维护消耗 +25%。',
    [DOCTRINE_TYPE.CONTROL]: '控制优先：PATROL 任务的战区控制力增长 +50%，PATROL 周期维护消耗 +25%。',
    [DOCTRINE_TYPE.SECURITY]: '警戒优先：SECURITY 任务的安全度增长与威胁压制 +50%，SECURITY 周期维护消耗 +25%。'
  },
  /** 任务对战区压力指标的效果倍率：doctrine → taskType → metric → multiplier */
  taskEffectMultiplier: {
    [DOCTRINE_TYPE.RECON]: {
      recon: { recon: 1.5 }
    },
    [DOCTRINE_TYPE.CONTROL]: {
      patrol: { control: 1.5 }
    },
    [DOCTRINE_TYPE.SECURITY]: {
      security: { security: 1.5, threat: 1.5 }
    }
  },
  /** 任务周期维护（upkeep）倍率：doctrine → taskType → multiplier */
  upkeepMultiplier: {
    [DOCTRINE_TYPE.RECON]: { recon: 1.25 },
    [DOCTRINE_TYPE.CONTROL]: { patrol: 1.25 },
    [DOCTRINE_TYPE.SECURITY]: { security: 1.25 }
  }
};

export const DOCTRINE_CODE = {
  OK: 'ok',
  STATE_INVALID: 'state_invalid',
  UNKNOWN_DOCTRINE: 'unknown_doctrine'
};

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), doctrine: null, ...extra };
}

function pass(extra = {}) {
  return { ok: true, code: DOCTRINE_CODE.OK, reason: '', ...extra };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 读取当前启用的 doctrine（只读；非法 / 缺失一律回落 BALANCED，不写 state） */
export function getActiveDoctrine(state) {
  const raw = isObject(state) ? state.doctrine : null;
  return DOCTRINE.types.includes(raw) ? raw : DOCTRINE_TYPE.BALANCED;
}

/** 幂等初始化：把缺失 / 非法的 doctrine 规范化写入 canonical state（老存档 → BALANCED） */
export function ensureDoctrine(state) {
  if (!isObject(state)) return false;
  const current = getActiveDoctrine(state);
  if (state.doctrine === current) return false;
  state.doctrine = current;
  return true;
}

/**
 * 切换 doctrine：立即生效（之后的 tick 使用新倍率），无冷却、无成本、不追溯。
 * @returns {{ok:boolean, code:string, reason:string, doctrine?:string, previous?:string}}
 */
export function setDoctrine(state, doctrineId) {
  if (!isObject(state)) return fail(DOCTRINE_CODE.STATE_INVALID, '状态无效');
  if (!DOCTRINE.types.includes(doctrineId)) {
    return fail(DOCTRINE_CODE.UNKNOWN_DOCTRINE, `未知指挥方针：${String(doctrineId)}`);
  }
  const previous = getActiveDoctrine(state);
  state.doctrine = doctrineId;
  return pass({ doctrine: doctrineId, previous });
}

/**
 * 任务对战区压力某指标的效果倍率（selector，纯函数；默认 1）。
 * theater-pressure.js 在每个 tick 调用，切换 doctrine 后自动使用新倍率。
 */
export function getTaskEffectMultiplier(state, taskType, metric) {
  const doctrine = getActiveDoctrine(state);
  const entry = (DOCTRINE.taskEffectMultiplier[doctrine] || {})[taskType];
  const multiplier = isObject(entry) ? entry[metric] : null;
  return Number.isFinite(Number(multiplier)) && Number(multiplier) > 0 ? Number(multiplier) : 1;
}

/**
 * 任务周期维护倍率（selector，纯函数；默认 1）。
 * tasking.js 在每次周期结算时调用。
 */
export function getUpkeepMultiplier(state, taskType) {
  const doctrine = getActiveDoctrine(state);
  const multiplier = (DOCTRINE.upkeepMultiplier[doctrine] || {})[taskType];
  return Number.isFinite(Number(multiplier)) && Number(multiplier) > 0 ? Number(multiplier) : 1;
}

/** 按倍率缩放一个成本对象（返回新对象，不改入参） */
export function scaleCost(cost, multiplier) {
  const scaled = {};
  Object.keys(cost || {}).forEach((key) => {
    scaled[key] = safeNumber(cost[key], 0) * multiplier;
  });
  return scaled;
}
