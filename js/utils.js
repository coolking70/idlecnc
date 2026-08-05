/**
 * utils.js —— 通用工具函数
 * 不依赖任何其它业务模块，避免循环依赖。
 */

/** 数值钳制 */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return value < min ? min : (value > max ? max : value);
}

/** 线性插值 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/** 安全取数：非法数字回退到默认值 */
export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 整数格式化（带千分位） */
export function formatInt(value) {
  const n = Math.floor(safeNumber(value, 0));
  return n.toLocaleString('zh-CN');
}

/** 速率格式化：整数省略小数，小数保留一位 */
export function formatRate(value) {
  const n = safeNumber(value, 0);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${n >= 0 ? '+' : ''}${text}/s`;
}

/** 游戏时钟：秒 → HH:MM:SS（超过24小时自动回绕，并返回天数） */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(safeNumber(totalSeconds, 0)));
  const day = Math.floor(s / 86400);
  const rest = s % 86400;
  const hh = String(Math.floor(rest / 3600)).padStart(2, '0');
  const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, '0');
  const ss = String(rest % 60).padStart(2, '0');
  return { text: `${hh}:${mm}:${ss}`, short: `${hh}:${mm}`, day };
}

/** 时长格式化：秒 → “2小时16分钟” */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(safeNumber(totalSeconds, 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${m}分钟`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

/** 真实时间戳 → 本地时间字符串 */
export function formatWallClock(timestamp) {
  const t = safeNumber(timestamp, 0);
  if (t <= 0) return '——';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 生成唯一 ID */
let _uidSeq = 0;
export function uid(prefix = 'id') {
  _uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_uidSeq.toString(36)}`;
}

/** 字符串哈希（用于把文本转成随机种子） */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  const text = String(str);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * 确定性伪随机数生成器（mulberry32）
 * 战斗系统要求：相同种子 + 相同编队 + 相同策略 → 完全相同的结果。
 */
export function createRng(seed) {
  let a = (safeNumber(seed, 1) >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  rng.range = (min, max) => min + rng() * (max - min);
  rng.pick = (arr) => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);
  rng.chance = (p) => rng() < p;
  return rng;
}

/** 随机战斗种子（玩家可见、可复现） */
export function randomSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
}

/** 二维确定性噪声（0~1），用于地面纹理，保证每次绘制一致 */
export function noise01(x, y) {
  const h = hashString(`${x}:${y}`);
  return (h % 10000) / 10000;
}

/** 深拷贝（仅处理 JSON 可序列化数据） */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    console.warn('[utils] deepClone 失败：', err);
    return null;
  }
}

/** 稳定序列化：对象键按字典序排列，数组保持业务顺序。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** DOM 查询（带存在性检查） */
export function qs(selector, root = document) {
  if (!root || typeof root.querySelector !== 'function') return null;
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.from(root.querySelectorAll(selector));
}

/** 创建元素 */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

/** 安全设置文本（元素不存在时静默跳过） */
export function setText(node, text) {
  if (!node) return;
  const value = String(text);
  if (node.textContent !== value) node.textContent = value;
}

/** 安全切换类名 */
export function toggleClass(node, className, on) {
  if (!node || !className) return;
  node.classList.toggle(className, Boolean(on));
}

/** 把成本对象转成可读文本，如 “合金200 · 补给100” */
export function formatCost(cost, resourceDefs) {
  if (!cost) return '免费';
  const parts = Object.keys(cost)
    .filter((k) => safeNumber(cost[k], 0) > 0)
    .map((k) => {
      const name = resourceDefs && resourceDefs[k] ? resourceDefs[k].name : k;
      return `${name}${formatInt(cost[k])}`;
    });
  return parts.length ? parts.join(' · ') : '免费';
}
