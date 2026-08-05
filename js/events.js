/**
 * events.js —— 事件日志 + 轻量事件总线
 *
 * 事件日志：底部消息栏，最多保留 LOG.maxEntries 条。
 * 事件总线：模块之间解耦通信（例如 construction 完成后通知 renderer 播放动画）。
 */

import { LOG } from './config.js';
import { formatClock, uid } from './utils.js';

/** 日志级别 → 样式类名 */
export const LOG_LEVEL = {
  INFO: 'info',
  GOOD: 'good',
  WARN: 'warn',
  DANGER: 'danger',
  BATTLE: 'battle'
};

/**
 * 追加一条日志
 * @param {object} state 全局状态
 * @param {string} text  文本内容
 * @param {string} level 级别（LOG_LEVEL）
 */
export function logEvent(state, text, level = LOG_LEVEL.INFO) {
  if (!state || !Array.isArray(state.log)) return null;
  const clock = formatClock(state.time ? state.time.game : 0);
  const entry = {
    id: uid('log'),
    time: clock.short,
    day: clock.day,
    gameTime: Number.isFinite(Number(state.time && state.time.game)) ? Number(state.time.game) : 0,
    text: String(text),
    level
  };
  state.log.push(entry);
  // 只保留最近 N 条
  while (state.log.length > LOG.maxEntries) state.log.shift();
  emit('log:added', entry);
  return entry;
}

/** 清空日志 */
export function clearLog(state) {
  if (!state || !Array.isArray(state.log)) return;
  state.log.length = 0;
  emit('log:cleared', null);
}

/* ------------------------------------------------------------
 * 事件总线
 * ---------------------------------------------------------- */

const listeners = new Map();

/** 订阅事件，返回取消订阅函数 */
export function on(eventName, handler) {
  if (typeof handler !== 'function') return () => {};
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName).add(handler);
  return () => off(eventName, handler);
}

/** 取消订阅 */
export function off(eventName, handler) {
  const set = listeners.get(eventName);
  if (set) set.delete(handler);
}

/** 触发事件（单个监听器异常不影响其它监听器） */
export function emit(eventName, payload) {
  const set = listeners.get(eventName);
  if (!set || set.size === 0) return;
  set.forEach((handler) => {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[events] 处理 "${eventName}" 时出错：`, err);
    }
  });
}

/**
 * 预留：阶段5战斗过程中的指挥命令通道
 * 未来可通过 emit('battle:command', { type:'commit_reserve' }) 等方式接入。
 */
export const BATTLE_COMMANDS = {
  COMMIT_RESERVE: 'commit_reserve',   // 投入预备队
  CAREFUL_RETREAT: 'careful_retreat', // 谨慎撤退
  CHANGE_OBJECTIVE: 'change_objective', // 改变任务目标
  REQUEST_AIR_RECON: 'request_air_recon' // 请求空中侦察
};
