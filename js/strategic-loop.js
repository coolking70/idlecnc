/**
 * strategic-loop.js —— Stage 10-E：战略循环闭合权威层
 *
 * 闭环：Doctrine → Auto Operations → PATROL/RECON/SECURITY → Theater
 * Pressure → 正式任务成本变化 → 战斗结果反向改变 Theater Pressure。
 *
 * 一、任务成本 modifier（连续、确定性）：
 *   supplyMultiplier = 1 + (threat-50)*0.003 - control*0.0015 - security*0.001
 *                     clamp 0.75 ~ 1.40
 *   intelMultiplier  = 1 - recon*0.0025   clamp 0.75 ~ 1.00
 *   初始 pressure（threat=50，其余 0）时两个倍率均为 1，旧任务成本完全不变。
 *   首次战区出击（theater.getMissionCost）与 repeat Operation
 *   （operations.getOperationCost）都调用本权威，UI 不得复制公式。
 *
 * 二、正式战斗结果 → Pressure（离散、确定性，全部 clamp 0~100）：
 *   VICTORY  threat-10 control+10 security+5
 *   PYRRHIC  threat-4  control+5  security+2
 *   WITHDRAW threat+5  control-4  security-3
 *   DEFEAT   threat+10 control-8  security-5
 *   WIPED    threat+15 control-12 security-8
 *   recon 不因战斗结果直接变化。
 *   挂接点：theater.settleActiveBattle 的 exactly-once 结算提交块
 *   （settled 标记 + battleSettlementLedger + settlementReceipt 三重防护），
 *   并在 settlementReceipt 上盖章；replay / 查看战报 / skip return /
 *   save-load 路径都不会再次调用结算提交块。
 *
 * 禁止 Math.random / Date.now 参与任何战略计算。
 */

import { BATTLE_RESULT } from './config.js';
import { theaterPressureView, PRESSURE_METRICS } from './theater-pressure.js';
import { safeNumber } from './utils.js';

/** 任务成本 modifier 规则（集中在此，UI / theater / operations 不复制公式） */
export const STRATEGIC_COST = {
  supply: {
    threatPerPoint: 0.003,     // threat 每高出基准 1 点的补给成本上浮
    threatBaseline: 50,
    controlPerPoint: 0.0015,   // control 每点补贴成本下降
    securityPerPoint: 0.001,
    min: 0.75,
    max: 1.4
  },
  intel: {
    reconPerPoint: 0.0025,     // recon 每点的情报成本下降
    min: 0.75,
    max: 1.0
  }
};

/** 战斗结果 → 战区压力离散变化（recon 不变） */
export const STRATEGIC_BATTLE_OUTCOME = {
  [BATTLE_RESULT.VICTORY]: { threat: -10, control: 10, security: 5 },
  [BATTLE_RESULT.PYRRHIC]: { threat: -4, control: 5, security: 2 },
  [BATTLE_RESULT.WITHDRAW]: { threat: 5, control: -4, security: -3 },
  [BATTLE_RESULT.DEFEAT]: { threat: 10, control: -8, security: -5 },
  [BATTLE_RESULT.WIPED]: { threat: 15, control: -12, security: -8 }
};

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 战区战略任务成本 modifier（纯函数）。
 * @returns {{
 *   supplyMultiplier:number, intelMultiplier:number,
 *   sources:{threat:number, control:number, security:number, reconIntel:number}
 * }}
 *   sources 为各项对成本的百分比贡献（+0.12 = +12%），供 Inspector 说明使用。
 */
export function getStrategicMissionModifiers(state, theaterId) {
  const pressure = theaterPressureView(state, theaterId);
  const rule = STRATEGIC_COST.supply;
  const threatTerm = (pressure.threat - rule.threatBaseline) * rule.threatPerPoint;
  const controlTerm = -pressure.control * rule.controlPerPoint;
  const securityTerm = -pressure.security * rule.securityPerPoint;
  const supplyMultiplier = clampRange(1 + threatTerm + controlTerm + securityTerm, rule.min, rule.max);
  const intelMultiplier = clampRange(1 - pressure.recon * STRATEGIC_COST.intel.reconPerPoint, STRATEGIC_COST.intel.min, STRATEGIC_COST.intel.max);
  return {
    supplyMultiplier,
    intelMultiplier,
    sources: {
      threat: threatTerm,
      control: controlTerm,
      security: securityTerm,
      reconIntel: pressure.recon * STRATEGIC_COST.intel.reconPerPoint * -1
    }
  };
}

/** 主要成本来源的可读摘要（纯函数，供 Inspector / 日志复用） */
export function describeStrategicSources(modifiers) {
  const pct = (value) => `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value * 100))}%`;
  // 按整百分比过滤：初始态势（及游戏自然漂移的零头）显示为“基准态势”
  const visible = (value) => Math.round(value * 100) !== 0;
  const parts = [];
  if (visible(modifiers.sources.threat)) parts.push(`Threat ${pct(modifiers.sources.threat)}`);
  if (visible(modifiers.sources.control)) parts.push(`Control ${pct(modifiers.sources.control)}`);
  if (visible(modifiers.sources.security)) parts.push(`Security ${pct(modifiers.sources.security)}`);
  if (visible(modifiers.sources.reconIntel)) parts.push(`Recon Intel ${pct(modifiers.sources.reconIntel)}`);
  return parts.join(' · ') || '基准态势（无修正）';
}

/**
 * 战斗结算反向修改战区压力（exactly-once 由调用点保证，内部再做凭证幂等防护）。
 * @param {object} state canonical state
 * @param {{theaterId:string, result:string, receipt?:object}} input 正式结算信息
 * @returns {{applied:boolean, delta:object|null, summary:object|null, logText:string}}
 */
export function applyStrategicSettlementPressure(state, input) {
  const empty = { applied: false, delta: null, summary: null, logText: '' };
  if (!isObject(state) || !isObject(input)) return empty;
  const delta = STRATEGIC_BATTLE_OUTCOME[input.result];
  if (!delta || !input.theaterId) return empty;
  // 凭证幂等：同一 settlementReceipt 只应用一次（replay / 重复调用安全）
  if (isObject(input.receipt) && input.receipt.strategicPressure) return empty;

  const pressure = theaterPressureView(state, input.theaterId);
  const summary = {};
  PRESSURE_METRICS.forEach((metric) => {
    const before = pressure[metric];
    const after = clampRange(before + safeNumber(delta[metric], 0), 0, 100);
    const actual = Math.round((after - before) * 1e9) / 1e9;
    summary[metric] = actual;
  });

  if (!isObject(state.theaterPressure)) state.theaterPressure = {};
  const row = isObject(state.theaterPressure[input.theaterId])
    ? state.theaterPressure[input.theaterId]
    : (state.theaterPressure[input.theaterId] = {});
  PRESSURE_METRICS.forEach((metric) => {
    row[metric] = clampRange(safeNumber(row[metric], pressure[metric]) + safeNumber(summary[metric], 0), 0, 100);
  });
  if (isObject(input.receipt)) input.receipt.strategicPressure = { ...summary };

  const parts = [];
  ['threat', 'control', 'security'].forEach((metric) => {
    if (summary[metric]) parts.push(`${metric === 'threat' ? 'Threat' : metric === 'control' ? 'Control' : 'Security'} ${summary[metric] > 0 ? '+' : ''}${Math.round(summary[metric])}`);
  });
  return { applied: true, delta: { ...delta }, summary, logText: parts.join(' / ') };
}
