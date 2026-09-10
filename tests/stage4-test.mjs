/**
 * 钢铁指令 · IRON COMMAND —— 阶段4 自动测试
 *
 * 覆盖：
 *   A. 阶段标记与阶段1/2/3 兼容回归
 *   B. 编队创建 / 默认名序数 / 命名校验 / 上限
 *   C. 重命名 / 解散（成员返还库存、释放指挥容量）
 *   D. 成员加入 / 移除 / 双向归属
 *   E. 指挥容量动态计算与超限
 *   F. 预设模板原子性（combined/armor/recon 指挥消耗 4/6/3）
 *   G. 编队评估提示（5 类）
 *   H. 编队汇总属性
 *   I. 存档迁移与编队容错（sanitizeFormations，v2→v3）
 *   J. UI 编队页构建（DOM 桩）
 *   K. 渲染器集结区（canvas 桩，只读、不抛异常）
 *   L. 调试接口契约（formations 导出面 == in-game __IRON_COMMAND__）
 *   M. 本地服务器（scripts/serve.mjs：防穿越 403、content-type、实际请求）
 *   N. 全部源码语法检查
 *
 * 运行方式（在 iron-command 目录下）：
 *     node tests/stage4-test.mjs
 * 或：  npm test
 *
 * 说明：脚本在 Node 环境用最小 DOM / window 桩运行，只测试逻辑层与渲染层只读行为，
 *       不依赖浏览器。沿用 stage3-test.mjs 的桩结构与辅助函数（async 版 check）。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JS_DIR = path.join(ROOT, 'js');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

/* ============================================================
 * 一、最小 DOM / window 桩（save.js 需要 localStorage，ui.js 需要 document）
 * ========================================================== */

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.filter(Boolean).forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    if (on === undefined) on = !this.set.has(c);
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  get value() { return Array.from(this.set).join(' '); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._text = '';
    this._html = '';
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = new ClassList();
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this._listeners = {};
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
  appendChild(n) { this.children.push(n); return n; }
  append(...n) { n.forEach((x) => this.children.push(x)); }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  setAttribute(k, v) { this[`attr_${k}`] = v; }
  getAttribute(k) { return this[`attr_${k}`]; }
  closest() { return null; }
  click() { (this._listeners.click || []).forEach((fn) => fn({ target: this })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get offsetWidth() { return 180; }
  get offsetHeight() { return 60; }
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) { const r = c.find && c.find(pred); if (r) return r; }
    return null;
  }
  findAll(pred, out = []) {
    if (pred(this)) out.push(this);
    this.children.forEach((c) => c.findAll && c.findAll(pred, out));
    return out;
  }
}

const registry = new Map();
function ensure(id) {
  if (!registry.has(id)) { const e = new El('div'); e.id = id; registry.set(id, e); }
  return registry.get(id);
}
[
  'val-supply', 'cap-supply', 'rate-supply', 'val-alloy', 'cap-alloy', 'rate-alloy',
  'val-intel', 'cap-intel', 'rate-intel', 'val-power', 'cap-power', 'rate-power',
  'val-command', 'cap-command', 'rate-command', 'game-clock', 'game-day', 'stat-chip',
  'log-list', 'log-count', 'panel-tabs', 'panel-body', 'toast', 'zone-legend',
  'speed-controls', 'btn-save', 'btn-load', 'btn-new', 'base-canvas', 'canvas-tip'
].forEach(ensure);

globalThis.document = {
  createElement: (tag) => new El(tag),
  createTextNode: (t) => { const e = new El('#text'); e._text = String(t); return e; },
  createDocumentFragment: () => new El('#fragment'),
  addEventListener() {},
  readyState: 'complete',
  body: new El('body'),
  querySelector(sel) {
    if (sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
    const m = sel.match(/^\.res\[data-res="(\w+)"\]$/);
    if (m) return ensure(`res-${m[1]}`);
    return null;
  },
  querySelectorAll() { return []; }
};

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  devicePixelRatio: 1,
  setTimeout: () => 0,
  clearTimeout: () => {},
  confirm: () => true,
  addEventListener() {},
  requestAnimationFrame() { return 0; }
};

/* ============================================================
 * 二、载入被测模块
 * ========================================================== */

const cfg = await import('../js/config.js');
const st = await import('../js/state.js');
const eco = await import('../js/economy.js');
const con = await import('../js/construction.js');
const prod = await import('../js/production.js');
const save = await import('../js/save.js');
const events = await import('../js/events.js');
const fmt = await import('../js/formations.js');
const { UI } = await import('../js/ui.js');
const { BaseRenderer } = await import('../js/renderer.js');
const serve = await import('../scripts/serve.mjs');

const {
  BUILDINGS, BUILDING_STATUS, UNITS, PRODUCTION, TIME,
  FORMATION, FORMATION_PRESETS, FORMATION_STATUS, FORMATION_WARNINGS,
  BASE_LAYOUT, CURRENT_STAGE, SAVE_VERSION
} = cfg;

/* ============================================================
 * 三、断言与统计工具（async 版，支持服务器实时请求）
 * ========================================================== */

let pass = 0;
let fail = 0;
const failures = [];
const pending = [];

function check(name, fn) { pending.push({ name, fn }); }
function section(title) { console.log(`\n── ${title} ──`); }

async function run() {
  for (const c of pending) {
    try {
      await c.fn();
      pass += 1;
      console.log(`  PASS  ${c.name}`);
    } catch (err) {
      fail += 1;
      failures.push({ name: c.name, message: err && err.message ? err.message : String(err) });
      console.log(`  FAIL  ${c.name}`);
      console.log(`        → ${err && err.message ? err.message.split('\n')[0] : err}`);
    }
  }
}

/** 固定步长推进：经济 + 施工 + 生产 */
function tick(state, seconds, step = TIME.logicStep) {
  let left = seconds;
  while (left > 1e-9) {
    const d = Math.min(step, left);
    eco.tickEconomy(state, d);
    con.tickConstruction(state, d);
    prod.tickProduction(state, d);
    left -= d;
  }
}

function fresh() {
  const s = st.resetState();
  eco.recalcDerived(s);
  return s;
}

function withBuildings(state, types) {
  state.resources.supply = 99999;
  state.resources.alloy = 99999;
  state.resources.intel = 999;
  types.forEach((t) => {
    con.requestBuild(state, t);
    tick(state, BUILDINGS[t].buildTime + 0.1);
  });
  eco.recalcDerived(state);
  return state;
}

function readyBase() {
  const s = fresh();
  withBuildings(s, ['barracks', 'armor_factory']);
  s.resources.supply = 5000;
  s.resources.alloy = 5000;
  return s;
}

/** 顺序生产 n 个指定单位（绕过队列并发，逐个结算） */
function train(state, type, n = 1) {
  for (let i = 0; i < n; i += 1) {
    const r = prod.queueUnit(state, type);
    assert.ok(r.ok, `训练 ${UNITS[type].name} 失败：${r.reason || ''}`);
    prod.tickProduction(state, UNITS[type].buildTime + 0.1);
  }
}

/** 按 {type: count} 组建一支编队并返回该编队对象 */
function buildFormation(state, spec, name) {
  const r = fmt.createFormation(state, name);
  assert.ok(r.ok, `建编队失败：${r.reason || ''}`);
  const f = r.formation;
  Object.entries(spec).forEach(([type, count]) => {
    for (let i = 0; i < count; i += 1) {
      const u = fmt.getAvailableUnits(state, type)[0];
      assert.ok(u, `缺少可用的 ${UNITS[type].name} 库存`);
      const ar = fmt.addUnit(state, f.id, u.id);
      assert.ok(ar.ok, `加入 ${UNITS[type].name} 失败：${ar.reason || ''}`);
    }
  });
  return f;
}

/** 制作一个“吸收一切调用”的 2D 上下文桩，使渲染器可在无浏览器下运行 */
function makeCtx() {
  const storeVals = {};
  const noop = () => {};
  return new Proxy({}, {
    get(_t, prop) {
      if (Object.prototype.hasOwnProperty.call(storeVals, prop)) return storeVals[prop];
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      return noop;
    },
    set(_t, prop, v) { storeVals[prop] = v; return true; }
  });
}

function makeCanvas() {
  const ctx = makeCtx();
  return {
    width: 0, height: 0,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 960, height: 600, left: 0, top: 0 }),
    addEventListener() {}
  };
}

console.log('════════════════════════════════════════════');
console.log('  钢铁指令 阶段4 自动测试');
console.log('════════════════════════════════════════════');

/* ============================================================
 * A. 阶段标记与阶段1/2/3 兼容回归
 * ========================================================== */
section('A. 阶段标记与阶段1/2/3 兼容回归');

check('A01 CURRENT_STAGE 已升级（向后兼容 >= 4）', () => {
  assert.ok(cfg.CURRENT_STAGE >= 4, `CURRENT_STAGE=${cfg.CURRENT_STAGE} 应 >= 4`);
});

check('A02 SAVE_VERSION 已升级（向后兼容 >= 3）', () => {
  assert.ok(cfg.SAVE_VERSION >= 3, `SAVE_VERSION=${cfg.SAVE_VERSION} 应 >= 3`);
});

check('A03 阶段1回归：初始建筑/指挥容量正确', () => {
  const s = fresh();
  assert.equal(s.buildings.length, 2, '初始应有指挥中心 + 发电站');
  assert.equal(s.command.capacity, 6, '初始指挥容量上限应为 6');
  assert.equal(s.command.used, 0, '无编队时指挥占用应为 0');
});

check('A04 阶段3回归：生产步兵班扣补给100并生成单位', () => {
  const s = readyBase();
  const before = s.resources.supply;
  prod.queueUnit(s, 'infantry');
  assert.ok(Math.abs((before - s.resources.supply) - 100) < 0.01);
  prod.tickProduction(s, 10.05);
  assert.equal(s.units.length, 1, '阶段3生产逻辑未被破坏');
});

check('A05 阶段3回归：队列上限 5 仍生效', () => {
  const s = readyBase();
  for (let i = 0; i < 5; i += 1) assert.ok(prod.queueUnit(s, 'infantry').ok);
  const r6 = prod.queueUnit(s, 'infantry');
  assert.equal(r6.ok, false);
  assert.equal(r6.code, 'queue_full');
});

check('A06 阶段3回归：读档恢复 production / units（版本随 SAVE_VERSION 迁移）', () => {
  store.clear();
  const s = readyBase();
  train(s, 'infantry', 1);
  prod.queueUnit(s, 'mbt');
  prod.tickProduction(s, 12);
  assert.ok(save.saveGame(s, { silent: true }));
  const loaded = save.loadGame();
  assert.ok(loaded.ok, loaded.reason);
  assert.equal(loaded.state.version, cfg.SAVE_VERSION, '读档后版本号应迁移到当前 SAVE_VERSION');
  assert.ok(loaded.state.production.current, '当前生产应恢复');
  assert.equal(loaded.state.units.length, 1, '库存应保留');
});

check('A07 阶段3回归：损坏生产数据被自动修复且不抛', () => {
  const s = readyBase();
  s.production = { current: { id: 'j1', type: 'ghost', elapsed: 1, duration: 10, sourceBuildingId: 'x', costPaid: {} }, queue: [] };
  s.units = ['broken', { id: 'u1', type: 'ghost' }];
  assert.doesNotThrow(() => prod.sanitizeProduction(s));
});

check('A08 无主施工建筑仍能被恢复（阶段3修复项保留）', () => {
  const s = fresh();
  s.buildings.push({
    id: 'orphan', type: 'barracks', status: BUILDING_STATUS.UNDER_CONSTRUCTION,
    progress: 0.4, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { ...BUILDINGS.barracks.slot }
  });
  s.construction = { current: null, queue: [] };
  const fix = con.sanitizeConstruction(s);
  assert.equal(fix.repaired, true);
  assert.ok(s.construction.current, '施工任务应重建');
  assert.equal(s.buildings.find((x) => x.id === 'orphan').status, BUILDING_STATUS.UNDER_CONSTRUCTION, '不得白嫖落成');
});

/* ============================================================
 * B. 编队创建 / 默认名序数 / 命名校验 / 上限
 * ========================================================== */
section('B. 编队创建 / 命名 / 上限');

check('B01 创建空编队成功，默认名为「第一战斗群」', () => {
  const s = fresh();
  const r = fmt.createFormation(s);
  assert.ok(r.ok, r.reason);
  assert.equal(r.formation.name, '第一战斗群');
  assert.equal(s.formations.length, 1);
});

check('B02 连续默认名序数递增且不重复', () => {
  const s = fresh();
  const names = [];
  for (let i = 0; i < 4; i += 1) names.push(fmt.createFormation(s).formation.name);
  assert.deepEqual(names, ['第一战斗群', '第二战斗群', '第三战斗群', '第四战斗群']);
});

check('B03 自定义名被规范化（去首尾空格、截断到 20 字）', () => {
  const s = fresh();
  const r = fmt.createFormation(s, '  阿尔法特遣队  ');
  assert.ok(r.ok);
  assert.equal(r.formation.name, '阿尔法特遣队');
  const longName = '一二三四五六七八九十十一十二十三十四十五十六';
  const r2 = fmt.createFormation(s, longName);
  assert.equal(r2.formation.name.length, 20, '应截断到 20 字');
});

check('B04 空名 → NAME_INVALID', () => {
  const s = fresh();
  const r = fmt.createFormation(s, '   ');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.NAME_INVALID);
});

check('B05 达到上限（6）后无法再建，返回 LIMIT_REACHED', () => {
  const s = fresh();
  for (let i = 0; i < FORMATION.maxFormations; i += 1) assert.ok(fmt.createFormation(s).ok);
  const r = fmt.canCreateFormation(s);
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.LIMIT_REACHED);
  const r2 = fmt.createFormation(s, '超额');
  assert.equal(r2.ok, false);
  assert.equal(s.formations.length, FORMATION.maxFormations, '编队数量不得超限');
});

check('B06 默认名跳过已被占用的序数', () => {
  const s = fresh();
  fmt.createFormation(s, '第二战斗群');            // 人为占用“第二”
  const r = fmt.createFormation(s);                 // 应回退到“第一”
  assert.equal(r.formation.name, '第一战斗群');
});

/* ============================================================
 * C. 重命名 / 解散
 * ========================================================== */
section('C. 重命名 / 解散');

check('C01 重命名成功', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const r = fmt.renameFormation(s, f.id, '赤狼群');
  assert.ok(r.ok, r.reason);
  assert.equal(s.formations[0].name, '赤狼群');
});

check('C02 改名为空 → NAME_INVALID', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const r = fmt.renameFormation(s, f.id, '  ');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.NAME_INVALID);
});

check('C03 重命名为原名视为不变（不报错）', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const r = fmt.renameFormation(s, f.id, f.name);
  assert.ok(r.ok);
  assert.equal(r.unchanged, true);
});

check('C04 解散编队：成员返回库存（formationId 清空、status=ready）', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  const f = buildFormation(s, { infantry: 2 });
  const ids = f.unitIds.slice();
  const r = fmt.disbandFormation(s, f.id);
  assert.ok(r.ok, r.reason);
  assert.equal(r.released, 2);
  assert.ok(!s.formations.includes(f), '编队应从列表移除');
  ids.forEach((id) => {
    const u = s.units.find((x) => x.id === id);
    assert.equal(u.formationId, null, '单位应脱离编队');
    assert.equal(u.status, 'ready', '单位应回库存');
  });
});

check('C05 解散后释放指挥容量', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  const f = buildFormation(s, { infantry: 2 });
  assert.equal(s.command.used, 2, '编入后占用 2 点');
  fmt.disbandFormation(s, f.id);
  assert.equal(s.command.used, 0, '解散后应释放占用');
});

check('C06 解散不存在的编队 → NOT_FOUND', () => {
  const s = fresh();
  const r = fmt.disbandFormation(s, 'no_such');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.NOT_FOUND);
});

/* ============================================================
 * D. 成员加入 / 移除 / 双向归属
 * ========================================================== */
section('D. 成员加入 / 移除 / 双向归属');

check('D01 加入单位成功，双向归属建立', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = fmt.createFormation(s).formation;
  const u = fmt.getAvailableUnits(s)[0];
  const r = fmt.addUnit(s, f.id, u.id);
  assert.ok(r.ok, r.reason);
  assert.equal(u.formationId, f.id);
  assert.equal(u.status, 'assigned');
  assert.ok(f.unitIds.includes(u.id));
  assert.equal(r.unitName, UNITS.infantry.name, '返回应包含单位名');
});

check('D02 加入单位后指挥占用增加该单位 command 值', () => {
  const s = readyBase();
  train(s, 'mbt', 1);
  const f = fmt.createFormation(s).formation;
  const u = fmt.getAvailableUnits(s, 'mbt')[0];
  fmt.addUnit(s, f.id, u.id);
  assert.equal(s.command.used, UNITS.mbt.command, '应占用 2 点');
});

check('D03 同一单位不能加入第二个编队 → UNIT_ASSIGNED', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f1 = fmt.createFormation(s).formation;
  const f2 = fmt.createFormation(s).formation;
  const u = fmt.getAvailableUnits(s)[0];
  assert.ok(fmt.addUnit(s, f1.id, u.id).ok);
  const r = fmt.addUnit(s, f2.id, u.id);
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.UNIT_ASSIGNED);
  assert.ok(!f2.unitIds.includes(u.id), '不得重复编入');
});

check('D04 非 ready 状态单位不能加入 → UNIT_NOT_READY', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  u.status = 'repairing';
  const f = fmt.createFormation(s).formation;
  const r = fmt.addUnit(s, f.id, u.id);
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.UNIT_REPAIRING);
});

check('D05 移除单位成功，单位返回库存', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = fmt.createFormation(s).formation;
  const u = fmt.getAvailableUnits(s)[0];
  fmt.addUnit(s, f.id, u.id);
  const r = fmt.removeUnit(s, f.id, u.id);
  assert.ok(r.ok, r.reason);
  assert.equal(u.formationId, null);
  assert.equal(u.status, 'ready');
  assert.ok(!f.unitIds.includes(u.id));
  assert.equal(r.unitName, UNITS.infantry.name, '移除也返回单位名');
});

check('D06 移除单位后指挥占用减少', () => {
  const s = readyBase();
  train(s, 'mbt', 1);
  const f = fmt.createFormation(s).formation;
  const u = fmt.getAvailableUnits(s, 'mbt')[0];
  fmt.addUnit(s, f.id, u.id);
  assert.equal(s.command.used, 2);
  fmt.removeUnit(s, f.id, u.id);
  assert.equal(s.command.used, 0);
});

check('D07 移除不存在的成员 → NOT_MEMBER', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const r = fmt.removeUnit(s, f.id, 'ghost');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.NOT_MEMBER);
});

check('D08 加入不存在的单位 → UNIT_INVALID', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const r = fmt.addUnit(s, f.id, 'ghost');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.UNIT_INVALID);
});

check('D09 双向归属完全一致（unitIds 与 unit.formationId 互为映照）', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  train(s, 'at_infantry', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1 });
  f.unitIds.forEach((id) => {
    const u = s.units.find((x) => x.id === id);
    assert.equal(u.formationId, f.id, '单位应指向该编队');
  });
  s.units.forEach((u) => {
    if (u.formationId === f.id) assert.ok(f.unitIds.includes(u.id), '编队应收录该单位');
  });
});

/* ============================================================
 * E. 指挥容量动态计算与超限
 * ========================================================== */
section('E. 指挥容量动态计算与超限');

check('E01 recalcDerived 依据编队成员计算 used（不信任存档字段）', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  const f = buildFormation(s, { infantry: 2 });
  s.command = { capacity: 6, used: 999 };         // 存档里乱写的占用
  eco.recalcDerived(s);
  assert.equal(s.command.used, 2, 'used 必须按真实成员重算');
});

check('E02 库存单位不占用指挥容量', () => {
  const s = readyBase();
  train(s, 'mbt', 3);
  assert.equal(s.units.length, 3);
  assert.equal(s.command.used, 0, '库存不得占用指挥容量');
});

check('E03 加入单位超过剩余容量 → CAPACITY', () => {
  const s = readyBase();
  train(s, 'mbt', 4);                              // 每个 2 点，共 8 > 6
  const f = fmt.createFormation(s).formation;
  fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'mbt')[0].id); // 占用 2
  fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'mbt')[0].id); // 占用 4
  fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'mbt')[0].id); // 占用 6
  const r = fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'mbt')[0].id); // 超额
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.CAPACITY);
});

check('E04 超额加入被拒且不改变任何归属', () => {
  const s = readyBase();
  train(s, 'mbt', 4);
  const f = fmt.createFormation(s).formation;
  for (let i = 0; i < 3; i += 1) fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'mbt')[0].id);
  const beforeUsed = s.command.used;
  const beforeLen = f.unitIds.length;
  const victim = fmt.getAvailableUnits(s, 'mbt')[0];
  const r = fmt.addUnit(s, f.id, victim.id);
  assert.equal(r.ok, false);
  assert.equal(s.command.used, beforeUsed, 'used 不得变化');
  assert.equal(f.unitIds.length, beforeLen, '成员不得增加');
  assert.equal(victim.formationId, null, '单位不得被部分编入');
});

check('E05 6 点容量被 3 个主战坦克（各2点）占满', () => {
  const s = readyBase();
  train(s, 'mbt', 3);
  const f = buildFormation(s, { mbt: 3 });
  assert.equal(s.command.used, 6, '3×mbt = 6 点，恰好占满');
  assert.equal(f.unitIds.length, 3);
});

/* ============================================================
 * F. 预设模板原子性（combined=4 / armor=6 / recon=3）
 * ========================================================== */
section('F. 预设模板原子性');

check('F01 预设指挥消耗：combined=4、armor=6、recon=3', () => {
  assert.equal(fmt.getPresetCommandCost('combined'), 4);
  assert.equal(fmt.getPresetCommandCost('armor'), 6);
  assert.equal(fmt.getPresetCommandCost('recon'), 3);
});

check('F02 canApplyPreset combined 库存足且容量足 → ok', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const r = fmt.canApplyPreset(s, 'combined');
  assert.ok(r.ok, r.reason);
  assert.equal(r.need, 4);
  assert.equal(r.unitIds.length, 4);
});

check('F03 applyPreset combined 原子组建（建1编队+4成员+双向归属）', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const r = fmt.applyPreset(s, 'combined');
  assert.ok(r.ok, r.reason);
  assert.equal(s.formations.length, 1);
  assert.equal(r.formation.unitIds.length, 4);
  assert.equal(s.command.used, 4, '占用 4 点');
  r.formation.unitIds.forEach((id) => {
    assert.equal(s.units.find((u) => u.id === id).formationId, r.formation.id);
  });
});

check('F04 applyPreset armor 需要 mbt/infantry/repair（capacity=6）', () => {
  const s = readyBase();
  train(s, 'mbt', 2); train(s, 'infantry', 1); train(s, 'repair_vehicle', 1);
  const r = fmt.applyPreset(s, 'armor');
  assert.ok(r.ok, r.reason);
  assert.equal(r.formation.unitIds.length, 4);
  assert.equal(s.command.used, 6, '占用 6 点，恰好占满');
});

check('F05 库存不足 → INSUFFICIENT（recon 需2侦察车但只有1）', () => {
  const s = readyBase();
  train(s, 'scout_car', 1); train(s, 'infantry', 1);
  const r = fmt.canApplyPreset(s, 'recon');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.INSUFFICIENT);
});

check('F06 容量不足 → CAPACITY（预设 need > 剩余）', () => {
  const s = readyBase();
  train(s, 'mbt', 3);                              // 占满 6 点
  const f = buildFormation(s, { mbt: 3 });
  train(s, 'scout_car', 2); train(s, 'infantry', 1);
  const r = fmt.canApplyPreset(s, 'recon');
  assert.equal(r.ok, false);
  assert.equal(r.code, fmt.FORMATION_CODE.CAPACITY);
});

check('F07 原子性：库存差1个时 applyPreset 不产生任何副作用', () => {
  const s = readyBase();
  train(s, 'scout_car', 1); train(s, 'infantry', 1);  // recon 缺 1 侦察车
  const before = s.formations.length;
  const r = fmt.applyPreset(s, 'recon');
  assert.equal(r.ok, false);
  assert.equal(s.formations.length, before, '不得新建编队');
  assert.equal(fmt.getAvailableUnits(s, 'scout_car').length, 1, '库存单位不得被改动');
});

check('F08 预设建成的编队状态为 idle，名称取预设名', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const r = fmt.applyPreset(s, 'combined');
  assert.equal(r.formation.status, FORMATION_STATUS.IDLE);
  assert.equal(r.formation.name, '综合战斗群');
});

/* ============================================================
 * G. 编队评估提示（5 类）
 * ========================================================== */
section('G. 编队评估提示');

check('G01 空编队 → 单条 empty 提示', () => {
  const s = fresh();
  const f = fmt.createFormation(s).formation;
  const w = fmt.getFormationWarnings(s, f);
  assert.deepEqual(w, [FORMATION_WARNINGS.messages.empty]);
});

check('G02 侦察不足（纯装甲 scouting<8）触发侦察提示', () => {
  const s = readyBase();
  train(s, 'mbt', 2);
  const f = buildFormation(s, { mbt: 2 });
  const w = fmt.getFormationWarnings(s, f);
  assert.ok(w.includes(FORMATION_WARNINGS.messages.scouting), `实际：${w.join('|')}`);
});

check('G03 装甲缺步兵 → armorNoInfantry', () => {
  const s = readyBase();
  train(s, 'mbt', 2);
  const f = buildFormation(s, { mbt: 2 });
  const w = fmt.getFormationWarnings(s, f);
  assert.ok(w.includes(FORMATION_WARNINGS.messages.armorNoInfantry));
});

check('G04 装甲缺维修车 → armorNoRepair', () => {
  const s = readyBase();
  train(s, 'mbt', 2);
  const f = buildFormation(s, { mbt: 2 });
  const w = fmt.getFormationWarnings(s, f);
  assert.ok(w.includes(FORMATION_WARNINGS.messages.armorNoRepair));
});

check('G05 反装甲不足（步兵+侦察，无装甲）触发 antiArmor', () => {
  const s = readyBase();
  train(s, 'infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 1, scout_car: 1 });
  // 无装甲 → 不触发装甲类；scouting=22≥8 不触发侦察；antiArmor=6<25 → 触发
  const w = fmt.getFormationWarnings(s, f);
  assert.ok(w.includes(FORMATION_WARNINGS.messages.antiArmor));
  assert.ok(!w.includes(FORMATION_WARNINGS.messages.armorNoInfantry), '无装甲不应触发装甲提示');
});

check('G06 均衡编队（combined）无提示', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  const w = fmt.getFormationWarnings(s, f);
  assert.equal(w.length, 0, `均衡编队不应有提示，实际：${w.join('|')}`);
});

check('G07 getFormationWarnings 只读，不修改 state', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  const f = buildFormation(s, { infantry: 2 });
  const snap = JSON.stringify({ units: s.units, f: f.unitIds, used: s.command.used });
  fmt.getFormationWarnings(s, f);
  fmt.getFormationWarnings(s, f.id);
  assert.equal(JSON.stringify({ units: s.units, f: f.unitIds, used: s.command.used }), snap);
});

/* ============================================================
 * H. 编队汇总属性
 * ========================================================== */
section('H. 编队汇总属性');

check('H01 getFormationStats 汇总数值正确', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  const stt = fmt.getFormationStats(s, f);
  assert.equal(stt.count, 4);
  assert.equal(stt.command, 4);
  assert.equal(stt.attack, 12 * 2 + 18 + 6);
  assert.equal(stt.antiArmor, 4 * 2 + 25 + 2);
  assert.equal(stt.scouting, 2 * 2 + 2 + 20);
  assert.equal(stt.byType.infantry, 2);
  assert.equal(stt.byType.at_infantry, 1);
  assert.equal(stt.byType.scout_car, 1);
  assert.equal(stt.byCategory.infantry, 3);
  assert.equal(stt.byCategory.vehicle, 1);
});

check('H02 getFormationCommandCost 等于 stats.command', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  assert.equal(fmt.getFormationCommandCost(s, f), fmt.getFormationStats(s, f).command);
});

/* ============================================================
 * I. 存档迁移与编队容错（sanitizeFormations）
 * ========================================================== */
section('I. 存档迁移与编队容错');

check('I01 引用不存在的单位被剔除', () => {
  const s = fresh();
  s.formations = [{ id: 'f1', name: 'X', unitIds: ['u_real', 'u_ghost'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 1 }];
  s.units = [{ id: 'u_real', type: 'infantry', hp: 100, maxHp: 100, status: 'assigned', formationId: 'f1' }];
  const fix = fmt.sanitizeFormations(s);
  const f = s.formations[0];
  assert.ok(fix.repaired);
  assert.deepEqual(f.unitIds, ['u_real'], '幽灵成员应被移除');
});

check('I02 同一单位被多支编队占用 → 只保留首支', () => {
  const s = fresh();
  s.units = [{ id: 'u1', type: 'infantry', hp: 100, maxHp: 100, status: 'assigned', formationId: 'f1' }];
  s.formations = [
    { id: 'f1', name: 'A', unitIds: ['u1'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 1 },
    { id: 'f2', name: 'B', unitIds: ['u1'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 2 }
  ];
  fmt.sanitizeFormations(s);
  assert.ok(s.formations[0].unitIds.includes('u1'));
  assert.ok(!s.formations[1].unitIds.includes('u1'), '第二支应让出该单位');
});

check('I03 非待命状态复位为 idle 并清空 strategy/theaterId', () => {
  const s = fresh();
  s.formations = [{ id: 'f1', name: 'X', unitIds: [], status: 'fighting', strategy: 'blitz', theaterId: 'scrap_mine', experience: 0, battles: 0, createdAt: 1 }];
  fmt.sanitizeFormations(s);
  const f = s.formations[0];
  assert.equal(f.status, FORMATION_STATUS.IDLE, '阶段4无战区，必须复位');
  assert.equal(f.strategy, null);
  assert.equal(f.theaterId, null);
});

check('I04 编队数量超限（>6）移除多余且释放其成员', () => {
  const s = fresh();
  s.units = [];
  s.formations = [];
  for (let i = 0; i < 8; i += 1) {
    s.formations.push({ id: `f${i}`, name: `F${i}`, unitIds: [], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: i });
  }
  const fix = fmt.sanitizeFormations(s);
  assert.ok(fix.repaired);
  assert.equal(s.formations.length, FORMATION.maxFormations, '应裁剪到上限');
});

check('I05 指挥容量超限 → 从末支编队尾部确定性移出成员回库存', () => {
  const s = fresh();
  const mk = (id) => ({ id, type: 'mbt', hp: 160, maxHp: 160, status: 'assigned', formationId: null });
  s.units = [mk('m1'), mk('m2'), mk('m3'), mk('m4')];
  s.formations = [
    { id: 'f1', name: 'A', unitIds: ['m1', 'm2'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 1 },
    { id: 'f2', name: 'B', unitIds: ['m3', 'm4'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 2 }
  ];
  fmt.sanitizeFormations(s);
  // 容量 6，总占用 8（4×mbt，各 2 点）。确定性地只从“最后一支编队”的尾部移出，
  // 移出 1 个（m4，2 点）即降到恰好 6 点，因此 m3 保留、m4 回库存。
  const f2 = s.formations.find((x) => x.id === 'f2');
  assert.equal(f2.unitIds.length, 1, '末支编队应只剩 m3');
  assert.ok(f2.unitIds.includes('m3'));
  const m3 = s.units.find((x) => x.id === 'm3');
  const m4 = s.units.find((x) => x.id === 'm4');
  assert.equal(m3.formationId, 'f2', 'm3 仍属于末支编队');
  assert.equal(m4.formationId, null, 'm4 溢出回库存');
  assert.equal(m4.status, 'ready');
  assert.equal(s.command.used, 6, '剩余占用应重算为 6（恰好不超）');
});

check('I06 容错后 command = {capacity, used} 按真实成员重算（不信任存档）', () => {
  const s = fresh();
  s.command = { capacity: 999, used: 999 };
  s.units = [{ id: 'm1', type: 'mbt', hp: 160, maxHp: 160, status: 'assigned', formationId: 'f1' }];
  s.formations = [{ id: 'f1', name: 'A', unitIds: ['m1'], status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 1 }];
  fmt.sanitizeFormations(s);
  assert.equal(s.command.capacity, 6, '容量来自建筑 effect');
  assert.equal(s.command.used, 2, 'used 来自真实成员');
});

check('I07 旧档 version 2 读档：migrate 到当前版本且补齐 formations/units 不抛', () => {
  const old = {
    version: 2,
    time: { game: 100, speed: 1, lastSpeed: 1 },
    resources: { supply: 500, alloy: 500, intel: 10 },
    buildings: [
      { id: 'b1', type: 'command_center', status: 'operational', progress: 1 },
      { id: 'b2', type: 'power_plant', status: 'operational', progress: 1 },
      { id: 'b3', type: 'barracks', status: 'operational', progress: 1 }
    ]
  };
  const report = {};
  const m = save.migrate(old, report);
  assert.equal(m.version, cfg.SAVE_VERSION, '旧档应迁移到当前 SAVE_VERSION');
  assert.deepEqual(m.formations, [], '应补齐空编队数组');
  assert.deepEqual(m.units, []);
  assert.equal(report.formationRepaired, false, '本就干净的存档不应标为已修复');
});

check('I08 带编队+成员的存档读档后完整还原', () => {
  store.clear();
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  assert.ok(save.saveGame(s, { silent: true }));
  const loaded = save.loadGame();
  assert.ok(loaded.ok, loaded.reason);
  assert.equal(loaded.state.formations.length, 1, '编队应恢复');
  const lf = loaded.state.formations[0];
  assert.equal(lf.unitIds.length, 4, '成员应恢复');
  assert.equal(loaded.state.command.used, 4, '指挥占用应重算');
  assert.equal(typeof loaded.formationRepaired, 'boolean', 'loadGame 应返回 formationRepaired 字段');
});

/* ============================================================
 * J. UI 编队页构建（DOM 桩）
 * ========================================================== */
section('J. UI 编队页构建');

const formationHandlers = {
  onProduce() {}, onCancelCurrentProduction() {}, onCancelQueuedProduction() {},
  onSelectFormation() {}, onCreateFormation() {}, onApplyPreset() {},
  onDisbandFormation() {}, onRenameFormation() {}, onAddUnit() {}, onRemoveUnit() {}
};

check('J01 new UI + refreshFormations 不抛，且自动选中首支编队', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  let ui = null;
  assert.doesNotThrow(() => {
    ui = new UI(formationHandlers);
    ui.refreshFormations(s);
  });
  assert.ok(ui.refs.fm, '编队页引用应存在');
  assert.equal(ui.selectedFormationId, f.id, '应自动选中首支编队');
});

check('J02 空编队时 refreshFormations 不抛且选中态为空', () => {
  const s = fresh();
  const ui = new UI(formationHandlers);
  assert.doesNotThrow(() => ui.refreshFormations(s));
  assert.equal(ui.selectedFormationId, null);
});

check('J03 多次刷新不抛，且编队列表/详情渲染存在', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  const f = buildFormation(s, { infantry: 2 });
  const ui = new UI(formationHandlers);
  assert.doesNotThrow(() => {
    ui.refreshFormations(s);
    ui.refreshFormations(s);
    ui.refreshFormations(s);
  });
  assert.equal(ui.selectedFormationId, f.id);
  // Stage 10-P-B 起编队页改为 Tile 网格 + Inspector，旧的 list/detail 容器已移除
  assert.ok(ui.refs.fm.gridRoot, '编队网格容器应存在');
  assert.ok(ui.refs.fm.grid, '编队网格应存在');
});

/* ============================================================
 * K. 渲染器集结区（canvas 桩，只读、不抛异常）
 * ========================================================== */
section('K. 渲染器集结区只读表现');

check('K01 new BaseRenderer(canvas) 不抛，render 空基地多帧不抛', () => {
  const canvas = makeCanvas();
  let r = null;
  assert.doesNotThrow(() => { r = new BaseRenderer(canvas, null); });
  const s = readyBase();
  assert.doesNotThrow(() => {
    for (let i = 0; i < 8; i += 1) r.render(s, 0.05, 0.05);
  });
});

check('K02 含编队+单位的基地 render 多帧不抛', () => {
  const canvas = makeCanvas();
  const r = new BaseRenderer(canvas, null);
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  r.setSelectedFormation(f.id);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 12; i += 1) r.render(s, 0.05, 0.05);
  });
});

check('K03 render 绝不修改 state（编队/单位/指挥占用前后一致）', () => {
  const canvas = makeCanvas();
  const r = new BaseRenderer(canvas, null);
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  const snap = JSON.stringify({ formations: s.formations, units: s.units, used: s.command.used });
  for (let i = 0; i < 10; i += 1) r.render(s, 0.05, 0.05);
  assert.equal(JSON.stringify({ formations: s.formations, units: s.units, used: s.command.used }), snap);
});

check('K04 编队事件只播表现，不修改 state', () => {
  const canvas = makeCanvas();
  const r = new BaseRenderer(canvas, null);
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const snap = JSON.stringify(s.formations);
  events.emit('formation:created', { formationId: f.id, name: f.name });
  events.emit('formation:unitAdded', { formationId: f.id });
  r.render(s, 0.05, 0.05);
  assert.equal(JSON.stringify(s.formations), snap, '事件不应改变编队数据');
});

check('K05 setSelectedFormation 单向同步选中态', () => {
  const canvas = makeCanvas();
  const r = new BaseRenderer(canvas, null);
  const s = readyBase();
  const f = fmt.createFormation(s).formation;
  r.setSelectedFormation(f.id);
  assert.equal(r.selectedFormationId, f.id);
  r.render(s, 0.05, 0.05);
  assert.equal(r.selectedFormationId, f.id, '渲染不应清除外部设置的选中态');
});

/* ============================================================
 * L. 调试接口契约（formations 导出面 == in-game __IRON_COMMAND__）
 * ========================================================== */
section('L. 调试接口契约');

const DEBUG_API = [
  'createFormation', 'renameFormation', 'disbandFormation',
  'addUnit', 'removeUnit', 'canCreateFormation', 'canAddUnit',
  'canApplyPreset', 'applyPreset', 'getAvailableUnits',
  'getFormationStats', 'getFormationWarnings', 'getFormationCommandCost',
  'getPresetCommandCost', 'resolveFormation', 'getFreeCommand',
  'nextDefaultName', 'normalizeName', 'sanitizeFormations', 'isEditable', 'statusLabel'
];

check('L01 formations 模块导出覆盖调试接口所需全部函数', () => {
  DEBUG_API.forEach((name) => {
    assert.ok(typeof fmt[name] === 'function', `缺少调试接口函数：${name}`);
  });
});

check('L02 __IRON_COMMAND__ 列出的规则常量可经由 config 取得', () => {
  assert.equal(FORMATION.maxFormations, 6);
  assert.equal(FORMATION.maxNameLength, 20);
  assert.deepEqual(FORMATION.editableStatuses, ['idle']);
  assert.ok(FORMATION_PRESETS.length >= 3, '至少 3 个预设模板');
});

/* ============================================================
 * M. 本地服务器（scripts/serve.mjs）
 * ========================================================== */
section('M. 本地服务器脚本');

check('M01 resolveRequestPath 防 ../ 穿越返回 403', () => {
  assert.equal(serve.resolveRequestPath('/../package.json').ok, false);
  assert.equal(serve.resolveRequestPath('/../package.json').status, 403);
  assert.equal(serve.resolveRequestPath('/js/../../etc/passwd').status, 403);
});

check('M02 resolveRequestPath 正常路径与目录回落 index.html', () => {
  const a = serve.resolveRequestPath('/js/config.js');
  assert.ok(a.ok, '正常路径应允许');
  assert.ok(a.file.replace(/\\/g, '/').endsWith('js/config.js'));
  const b = serve.resolveRequestPath('/');
  assert.ok(b.ok);
  assert.ok(b.file.replace(/\\/g, '/').endsWith('index.html'), '目录回落 index.html');
});

check('M03 contentTypeOf 扩展名映射正确', () => {
  assert.ok(serve.contentTypeOf('x.html').includes('text/html'));
  assert.ok(serve.contentTypeOf('x.js').includes('javascript'));
  assert.ok(serve.contentTypeOf('x.css').includes('text/css'));
  assert.ok(serve.contentTypeOf('x.json').includes('application/json'));
});

check('M04 实际启动服务器：GET / 返回 200 且为 HTML', async () => {
  const server = serve.createServer(ROOT);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  try {
    const get = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, ct: res.headers['content-type'] }));
      }).on('error', reject);
    });
    const root = await get('/');
    assert.equal(root.status, 200);
    assert.ok(root.ct.includes('text/html'), `content-type=${root.ct}`);
    assert.ok(root.body.includes('<html'), '应返回 index.html 内容');
    const js = await get('/js/config.js');
    assert.equal(js.status, 200);
    assert.ok(js.ct.includes('javascript'), 'js 应为 javascript content-type');
    const missing = await get('/no-such-file.exe');
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

check('M05 实际启动服务器：POST 被拒绝（405）且编码穿越 403', async () => {
  const server = serve.createServer(ROOT);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  try {
    const post = () => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'POST' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(await post(), 405, '非 GET/HEAD 应 405');

    const traverse = () => new Promise((resolve, reject) => {
      // 编码后的穿越路径：服务器会 decodeURIComponent 还原成 ../package.json
      http.get({ host: '127.0.0.1', port, path: '/%2e%2e/package.json' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    assert.equal(await traverse(), 403, '编码穿越应被拒绝');
  } finally {
    await new Promise((res) => server.close(res));
  }
});

/* ============================================================
 * N. 全部源码语法检查
 * ========================================================== */
section('N. 全部源码语法检查');

check('N01 js/ 目录下所有模块通过 node --check', () => {
  const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length >= 10, `应检查到足够多的模块，实际 ${files.length} 个`);
  const bad = [];
  files.forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(JS_DIR, f)], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${String(r.stderr).split('\n')[0]}`);
  });
  assert.equal(bad.length, 0, `语法错误：\n${bad.join('\n')}`);
});

check('N02 scripts/ 与 tests/ 脚本语法正常', () => {
  [path.join(SCRIPTS_DIR, 'serve.mjs'), path.join(HERE, 'stage4-test.mjs')].forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}\n${r.stderr}`);
  });
});

/* ============================================================
 * 汇总
 * ========================================================== */

await run();

console.log('\n════════════════════════════════════════════');
console.log(`  测试总数：${pass + fail}    通过：${pass}    失败：${fail}`);
if (fail > 0) {
  console.log('  失败项：');
  failures.forEach((f, i) => console.log(`   ${i + 1}. ${f.name}\n      ${f.message.split('\n')[0]}`));
} else {
  console.log('  全部通过 ✔');
}
console.log('════════════════════════════════════════════');

process.exit(fail > 0 ? 1 : 0);
