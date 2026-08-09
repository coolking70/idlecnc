/**
 * Mission / deployment presentation metadata.
 *
 * This module deliberately contains no eligibility, cost, cooldown, or
 * battle-rule calculations.  Those values must come from theater.js and
 * operations.js; this module only gives the UI stable labels for facts that
 * have already been calculated by the authority layer.
 */

export const MISSION_KIND_LABEL = Object.freeze({
  campaign: '战役任务',
  operation: '重复任务'
});

export const DISPATCH_CODE_LABEL = Object.freeze({
  ready: '资格满足',
  theater_not_captured: '目标战区尚未占领',
  cooldown: '任务冷却中',
  resource: '资源不足',
  battle_active: '已有作战进行中',
  formation_invalid: '编队当前不可用',
  formation_not_found: '未找到出击编队',
  formation_busy: '编队不是待命状态',
  formation_empty: '编队没有单位',
  insufficient: '资源不足',
  locked: '战区尚未解锁',
  captured: '战区已被占领',
  unknown_operation: '未知重复任务',
  unknown_theater: '未知战区',
  unknown_strategy: '未选择有效策略',
  state_invalid: '游戏状态无效'
});

export function missionKindLabel(kind) {
  return MISSION_KIND_LABEL[kind] || '未知任务类型';
}

export function dispatchCodeLabel(check = {}) {
  return DISPATCH_CODE_LABEL[check.code] || (check.ok ? '资格满足' : '派遣被阻止');
}

export function dispatchEligibilityText(check = {}) {
  if (check.ok) return '资格满足，可进入部署确认';
  const label = dispatchCodeLabel(check);
  return check.reason ? `${label}：${check.reason}` : label;
}

export function operationCooldownText(operation = null) {
  if (!operation) return '首次战役任务：无重复任务冷却';
  if (Number(operation.cooldownRemaining) > 0) {
    return `冷却中：剩余 ${operation.cooldownText || `${Math.ceil(operation.cooldownRemaining)} 秒`}`;
  }
  const next = Number(operation.cooldownUntil);
  return next > 0 ? `已就绪：当前游戏时间 ${next} 秒后可再次执行` : '已就绪：完成后进入任务冷却';
}

export function unitStatusLabel(status) {
  return {
    assigned: '待命',
    ready: '待命',
    deployed: '出击中',
    repairing: '维修中',
    destroyed: '已损毁',
    lost: '永久损失'
  }[status] || status || '未知状态';
}
