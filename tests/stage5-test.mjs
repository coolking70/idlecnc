/**
 * 钢铁指令 · IRON COMMAND —— 阶段5 自动测试
 *
 * 覆盖（规格 #四十二）：
 *   A. 阶段标记与阶段4/3 兼容回归（四类问题修复回归）
 *   B. 战区配置与解锁链
 *   C. 战前情报（雷达决定精度）
 *   D. 派遣资格校验（canDispatch 全分支）
 *   E. 派遣与活动战斗生命周期（推进 / 结算幂等 / 关闭）
 *   F. 确定性求解器（同种子同结果、纯函数、战地抢救规则）
 *   G. 占领奖励与持续收益
 *   H. 存档迁移 v3→v4（sanitize 系列 + migrate round-trip）
 *   I. UI 战区页 / 战报页构建（DOM 桩）
 *   J. 战斗渲染器（canvas 桩，只读、不抛异常）
 *   K. 调试接口 / 模块导出契约
 *   L. 全部源码语法检查
 *
 * 运行方式（在 iron-command 目录下）：
 *     node tests/stage5-test.mjs
 * 或：  npm test
 *
 * 说明：脚本在 Node 环境用最小 DOM / window 桩运行，只测试逻辑层与渲染层只读行为，
 *       不依赖浏览器。DOM 桩内联于本文件（真实 file:// 模块），避免 data: URL 的
 *       fileURLToPath 兼容问题。沿用 stage4-test.mjs 的桩结构与辅助函数。
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
    this.value = '';
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
  removeEventListener() {},
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
const fmt = await import('../js/formations.js');
const th = await import('../js/theater.js');
const btl = await import('../js/battle.js');
const save = await import('../js/save.js');
const { UI } = await import('../js/ui.js');
const { BaseRenderer } = await import('../js/renderer.js');
const { BattleRenderer } = await import('../js/battle-renderer.js');
const serve = await import('../scripts/serve.mjs');

const {
  BUILDINGS, BUILDING_STATUS, UNITS, THEATERS, ENEMY_UNITS, STRATEGIES,
  TERRAIN, BATTLE, BATTLE_RESULT, SAVE_VERSION, CURRENT_STAGE, TIME,
  RESOURCE_DEFS, FORMATION, FORMATION_PRESETS
} = cfg;

const THEATER_IDS = Object.keys(THEATERS);

/* ============================================================
 * 三、断言与统计工具
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

/* ============================================================
 * 四、通用辅助
 * ========================================================== */

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

/** 完备基地：兵营 + 装甲工厂 + 雷达站 */
function readyBase() {
  const s = fresh();
  withBuildings(s, ['barracks', 'armor_factory', 'radar_station']);
  s.resources.supply = 5000;
  s.resources.alloy = 5000;
  s.resources.intel = 999;
  return s;
}

function train(state, type, n = 1) {
  for (let i = 0; i < n; i += 1) {
    const r = prod.queueUnit(state, type);
    assert.ok(r.ok, `训练 ${UNITS[type].name} 失败：${r.reason || ''}`);
    prod.tickProduction(state, UNITS[type].buildTime + 0.1);
  }
}

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

/** 制作一个“吸收一切调用”的 2D 上下文桩 */
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

/** 组建一支可用于派遣的编队（combined 风格，含反装甲 + 侦察 + 维修） */
function battleReadyFormation(state, spec = { infantry: 2, at_infantry: 1, scout_car: 1, repair_vehicle: 1 }) {
  Object.entries(spec).forEach(([type, n]) => train(state, type, n));
  return buildFormation(state, spec);
}

/** 在多个种子里寻找一个能占领（胜利/惨胜）的种子，保证确定性测试可复现 */
function findCaptureSeed(state, formation, theaterId, strategyId, maxTry = 400) {
  for (let s = 1; s <= maxTry; s += 1) {
    const rep = btl.simulateBattle({ state, formation, theaterId, strategyId, seed: s });
    if (rep.capture) return s;
  }
  return null;
}

function deepCloneReport(rep) {
  return JSON.parse(JSON.stringify(rep));
}

/* ============================================================
 * A. 阶段标记与阶段4/3 兼容回归（四类问题修复回归）
 * ========================================================== */
section('A. 阶段标记与阶段4/3 兼容回归');

check('A01 CURRENT_STAGE 已升级到阶段5（向后兼容 >= 5）', () => {
  assert.ok(CURRENT_STAGE >= 5, `CURRENT_STAGE=${CURRENT_STAGE} 应 >= 5`);
});

check('A02 SAVE_VERSION 已升级到 4（向后兼容 >= 4）', () => {
  assert.ok(SAVE_VERSION >= 4, `SAVE_VERSION=${SAVE_VERSION} 应 >= 4`);
});

check('A03 阶段4回归：创建编队/默认名序数/上限仍生效', () => {
  const s = fresh();
  const r = fmt.createFormation(s);
  assert.ok(r.ok, r.reason);
  assert.equal(r.formation.name, '第一战斗群');
  for (let i = 0; i < FORMATION.maxFormations - 1; i += 1) assert.ok(fmt.createFormation(s).ok);
  const r2 = fmt.canCreateFormation(s);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, fmt.FORMATION_CODE.LIMIT_REACHED);
});

check('A04 阶段4回归：编队指令容量校验仍生效（超限被拒）', () => {
  const s = readyBase();
  train(s, 'mbt', 3); // 3×2 = 6 指挥，恰好用满初始 6 点
  train(s, 'infantry', 1); // 额外 1 点，用于验证超限被拒
  const f = buildFormation(s, { mbt: 3 });
  assert.equal(s.command.used, 6, '6 点指挥应被用满');
  const r = fmt.addUnit(s, f.id, fmt.getAvailableUnits(s, 'infantry')[0].id);
  assert.equal(r.ok, false, '超出指挥容量应被拒绝');
  assert.equal(r.code, fmt.FORMATION_CODE.CAPACITY);
});

check('A05 阶段4回归：读档恢复 production / units（版本随 SAVE_VERSION 迁移）', () => {
  store.clear();
  const s = readyBase();
  train(s, 'infantry', 1);
  prod.queueUnit(s, 'mbt');
  prod.tickProduction(s, 12);
  assert.ok(save.saveGame(s, { silent: true }));
  const loaded = save.loadGame();
  assert.ok(loaded.ok, loaded.reason);
  assert.equal(loaded.state.version, SAVE_VERSION, '读档后版本号应迁移到当前 SAVE_VERSION');
  assert.ok(loaded.state.production.current, '当前生产应恢复');
  assert.equal(loaded.state.units.length, 1, '库存应保留');
});

check('A06 阶段3回归：损坏编队数据被自动修复（sanitizeFormations 双向归属）', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  // 故意制造“编队引用不存在的单位”
  s.formations = [{ id: 'f1', name: '测试', status: 'idle', unitIds: ['ghost'], theaterId: null, strategy: null }];
  s.units[0].formationId = 'f1';
  assert.doesNotThrow(() => fmt.sanitizeFormations(s, {}));
  const f = s.formations.find((x) => x.id === 'f1');
  assert.ok(f, '编队应保留');
  assert.equal(f.unitIds.length, 0, '非法成员应被剔除');
});

/* ============================================================
 * B. 战区配置与解锁链
 * ========================================================== */
section('B. 战区配置与解锁链');

check('B01 THEATERS 含 3 个战区且顺序稳定', () => {
  assert.deepEqual(THEATER_IDS, ['scrap_mine', 'border_road', 'enemy_outpost']);
});

check('B02 三个战区难度递增（1→2→3）', () => {
  assert.equal(THEATERS.scrap_mine.difficulty, 1);
  assert.equal(THEATERS.border_road.difficulty, 2);
  assert.equal(THEATERS.enemy_outpost.difficulty, 3);
});

check('B03 scrap_mine 无前置且初始即解锁', () => {
  const s = fresh();
  assert.deepEqual(THEATERS.scrap_mine.requires, []);
  assert.equal(th.isUnlocked(s, 'scrap_mine'), true);
});

check('B04 border_road 前置为 [scrap_mine]', () => {
  assert.deepEqual(THEATERS.border_road.requires, ['scrap_mine']);
});

check('B05 enemy_outpost 前置为 [border_road]', () => {
  assert.deepEqual(THEATERS.enemy_outpost.requires, ['border_road']);
});

check('B06 初始状态 border_road / enemy_outpost 未解锁', () => {
  const s = fresh();
  assert.equal(th.isUnlocked(s, 'border_road'), false);
  assert.equal(th.isUnlocked(s, 'enemy_outpost'), false);
});

check('B07 占领前置后，后续战区自动解锁', () => {
  const s = fresh();
  s.theaters.scrap_mine.captured = true;
  assert.equal(th.isUnlocked(s, 'border_road'), true);
  s.theaters.border_road.captured = true;
  assert.equal(th.isUnlocked(s, 'enemy_outpost'), true);
});

check('B08 未解锁时 lockReasonOf 给出中文提示', () => {
  const s = fresh();
  const reason = th.lockReasonOf(s, 'border_road');
  assert.ok(reason.includes('废弃矿区'), `应包含前置战区名，实际：${reason}`);
});

check('B09 listTheaters 数量与配置一致且字段完整', () => {
  const s = fresh();
  const list = th.listTheaters(s);
  assert.equal(list.length, THEATER_IDS.length);
  list.forEach((v) => {
    assert.ok(v.id && v.name && v.terrain && v.captureIncome, '战区视图字段缺失');
    assert.equal(v.unlocked !== undefined, true);
    assert.equal(typeof v.concealment, 'number');
  });
});

check('B10 ENEMY_UNITS 三类敌人均存在', () => {
  assert.ok(ENEMY_UNITS.enemy_infantry && ENEMY_UNITS.enemy_at && ENEMY_UNITS.enemy_light_armor);
});

check('B11 STRATEGIES 三套策略含 cost 字段', () => {
  assert.deepEqual(Object.keys(STRATEGIES), ['cautious', 'breakthrough', 'recon_by_fire']);
  Object.values(STRATEGIES).forEach((s) => {
    assert.ok('cost' in s, '策略应含 cost 字段');
    assert.ok(s.mods && typeof s.mods === 'object');
  });
});

check('B12 listStrategies 顺序与配置一致', () => {
  const list = th.listStrategies();
  assert.deepEqual(list.map((x) => x.id), ['cautious', 'breakthrough', 'recon_by_fire']);
});

/* ============================================================
 * C. 战前情报（雷达决定精度）
 * ========================================================== */
section('C. 战前情报（雷达决定精度）');

check('C01 无雷达：情报为估算（accurate=false，数量用区间）', () => {
  const s = fresh(); // 仅指挥中心 + 发电站，无雷达
  const intel = th.getTheaterIntel(s, 'scrap_mine');
  assert.equal(intel.accurate, false);
  assert.equal(intel.radar, false);
  intel.units.forEach((u) => {
    assert.equal(u.count, null, '无雷达时数量应为 null');
    assert.ok(u.countText.includes('约'), '无雷达数量应为“约 x-y”');
  });
});

check('C02 有雷达：情报精确（accurate=true，数量为数字）', () => {
  const s = readyBase(); // 含 radar_station
  assert.equal(th.hasRadar(s), true);
  const intel = th.getTheaterIntel(s, 'scrap_mine');
  assert.equal(intel.accurate, true);
  intel.units.forEach((u) => {
    assert.equal(typeof u.count, 'number', '有雷达时数量应为数字');
    assert.ok(!u.countText.includes('约'), '有雷达数量应为精确值');
  });
});

check('C03 无雷达：高威胁单位用“疑似”模糊描述', () => {
  const s = fresh();
  const intel = th.getTheaterIntel(s, 'border_road');
  assert.ok(intel.units.some((u) => u.threat && u.label.includes('疑似')), '高威胁单位应标“疑似”');
});

check('C04 有雷达：笔记标记雷达在线', () => {
  const s = readyBase();
  const intel = th.getTheaterIntel(s, 'scrap_mine');
  assert.ok(intel.notes.some((n) => n.includes('雷达站在线')), '应提示雷达在线');
});

check('C05 隐蔽度决定伏击等级（enemy_outpost → high）', () => {
  const s = fresh();
  const intel = th.getTheaterIntel(s, 'enemy_outpost');
  assert.equal(intel.ambushLevel, 'high', 'concealment=14 应判为高');
});

check('C06 地形效果文案随战区地形生成', () => {
  const s = fresh();
  const intelFort = th.getTheaterIntel(s, 'enemy_outpost'); // fortified
  assert.ok(intelFort.terrainEffects.some((t) => t.includes('敌方防御')), '防御阵地应含敌方防御×');
  const intelRoad = th.getTheaterIntel(s, 'border_road'); // road
  assert.ok(intelRoad.terrainEffects.some((t) => t.includes('车辆机动') || t.includes('伏击')), '公路应含机动/伏击文案');
});

/* ============================================================
 * D. 派遣资格校验（canDispatch 全分支）
 * ========================================================== */
section('D. 派遣资格校验');

check('D01 状态无效 → STATE_INVALID', () => {
  const r = th.canDispatch(null, 'f1', 'scrap_mine', 'cautious');
  assert.equal(r.ok, false);
  assert.equal(r.code, th.THEATER_CODE.STATE_INVALID);
});

check('D02 未知战区 → UNKNOWN_THEATER', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const r = th.canDispatch(s, f.id, 'ghost_theater', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.UNKNOWN_THEATER);
});

check('D03 未知策略 → UNKNOWN_STRATEGY', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'no_such_strategy');
  assert.equal(r.code, th.THEATER_CODE.UNKNOWN_STRATEGY);
});

check('D04 已有活动战斗 → BATTLE_ACTIVE', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const d1 = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.ok(d1.ok, d1.reason || '派遣应成功');
  // canDispatch 在检查编队内容前就会因已有活动战斗返回 BATTLE_ACTIVE
  const f2 = fmt.createFormation(s).formation; // 空编队即可
  const r = th.canDispatch(s, f2.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.BATTLE_ACTIVE);
});

check('D05 已占领战区 → CAPTURED', () => {
  const s = readyBase();
  s.theaters.scrap_mine.captured = true;
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.CAPTURED);
});

check('D06 未解锁战区 → LOCKED 并带原因', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const r = th.canDispatch(s, f.id, 'border_road', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.LOCKED);
  assert.ok(r.reason.includes('废弃矿区'));
});

check('D07 编队不存在 → FORMATION_NOT_FOUND', () => {
  const s = fresh();
  const r = th.canDispatch(s, 'no_formation', 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.FORMATION_NOT_FOUND);
});

check('D08 编队非 idle → FORMATION_BUSY', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  f.status = 'fighting';
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.FORMATION_BUSY);
});

check('D09 空编队 → FORMATION_EMPTY', () => {
  const s = fresh();
  const f = buildFormation(s, {});
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.FORMATION_EMPTY);
});

check('D10 编队含维修中单位 → UNIT_UNAVAILABLE', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  s.units[0].status = 'repairing';
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.UNIT_UNAVAILABLE);
});

check('D11 编队无攻击单位（仅维修车） → NO_COMBAT_UNIT', () => {
  const s = readyBase();
  train(s, 'repair_vehicle', 1);
  const f = buildFormation(s, { repair_vehicle: 1 });
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.NO_COMBAT_UNIT);
});

check('D12 资源不足 → INSUFFICIENT 并带 missing', () => {
  const s = readyBase();
  train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1);
  const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1 });
  s.resources.supply = 0;
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.INSUFFICIENT);
  assert.ok(r.missing && r.missing.length > 0, '应列出缺少的资源');
});

check('D13 全条件满足 → READY 且成本正确', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.ok, true);
  assert.equal(r.code, th.THEATER_CODE.READY);
  // 成本 = 维持和 × 补给系数(5) × 策略倍率(1)
  const upkeepSum = f.unitIds.reduce((sum, uid) => {
    const u = s.units.find((x) => x.id === uid);
    return sum + UNITS[u.type].upkeep;
  }, 0);
  assert.equal(r.cost.supply, Math.round(upkeepSum * 5), '补给成本应 = 维持和 × 5');
});

check('D14 recon_by_fire 在成本上叠加情报 5', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const base = th.getMissionCost(s, f.id, 'scrap_mine', 'cautious');
  const recon = th.getMissionCost(s, f.id, 'scrap_mine', 'recon_by_fire');
  assert.equal(recon.cost.intel, 5, 'recon_by_fire 应额外消耗情报 5');
  // 补给成本应一致（upkeep 倍率均为 1，仅 strategy.cost 不同）
  assert.equal(recon.cost.supply, base.cost.supply, '两者补给成本应相同');
});

/* ============================================================
 * E. 派遣与活动战斗生命周期
 * ========================================================== */
section('E. 派遣与活动战斗生命周期');

check('E01 dispatchFormation 成功创建 activeBattle（playing=true）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.ok(r.ok);
  assert.ok(s.activeBattle);
  assert.equal(s.activeBattle.playing, true);
  assert.equal(s.activeBattle.settled, false);
});

check('E02 dispatchFormation 扣除了任务成本', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const before = s.resources.supply;
  const r = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const cost = r.activeBattle.cost.supply;
  assert.ok(cost > 0);
  assert.equal(before - s.resources.supply, cost, '应扣除补给成本');
});

check('E03 派遣把编队置为 FIGHTING、成员置为 deployed', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(f.status, 'fighting');
  f.unitIds.forEach((uid) => {
    assert.equal(s.units.find((u) => u.id === uid).status, 'deployed');
  });
});

check('E04 派遣增加了战区 attempts', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  assert.equal(s.theaters.scrap_mine.attempts, 0);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(s.theaters.scrap_mine.attempts, 1);
});

check('E05 getActiveBattle 返回同一对象', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(th.getActiveBattle(s), s.activeBattle);
});

check('E06 初始 isBattleFinished 为 false', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(th.isBattleFinished(s), false);
});

check('E07 tickActiveBattle 推进 elapsed（未到时继续 playing）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const d = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const dur = d.activeBattle.duration;
  th.tickActiveBattle(s, dur - 1); // 未到终点
  assert.ok(s.activeBattle.elapsed > 0 && s.activeBattle.elapsed < dur, `elapsed 应在 (0,${dur})`);
  assert.equal(s.activeBattle.settled, false);
});

check('E08 tickActiveBattle 到时自动结算', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const dur = s.activeBattle.duration;
  th.tickActiveBattle(s, dur + 1);
  assert.equal(s.activeBattle.settled, true, '到时后应自动结算');
  assert.equal(th.isBattleFinished(s), true);
});

check('E09 settleActiveBattle 幂等（重复调用不重复扣血/发奖）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const beforeUnits = s.units.length;
  const beforeAlloy = s.resources.alloy;
  // 再调用两次
  th.settleActiveBattle(s);
  th.settleActiveBattle(s);
  assert.equal(s.units.length, beforeUnits, '单位数不应因重复结算而改变');
  assert.equal(s.resources.alloy, beforeAlloy, '奖励不应因重复结算重复发放');
});

check('E10 结算后编队转为 RETURNING', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  assert.equal(f.status, 'returning');
});

check('E11 closeBattleResult 复位编队为 idle 并清空 activeBattle', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const r = th.closeBattleResult(s);
  assert.ok(r.ok);
  assert.equal(s.activeBattle, null);
  assert.equal(f.status, 'idle');
});

check('E12 closeBattleResult 把成员恢复为 assigned', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  th.closeBattleResult(s);
  f.unitIds.forEach((uid) => {
    assert.equal(s.units.find((u) => u.id === uid).status, 'assigned');
  });
});

/* ============================================================
 * F. 确定性求解器
 * ========================================================== */
section('F. 确定性求解器（同种子同结果）');

check('F01 相同 seed + 编队 + 策略 → 完全相同战报', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const a = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 12345 });
  const b = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 12345 });
  assert.deepEqual(deepCloneReport(a), deepCloneReport(b), '同一 seed 必须完全一致');
});

check('F02 不同 seed 不影响结构完整性（均含四阶段与事件）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  for (const seed of [1, 2, 7, 99]) {
    const rep = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed });
    assert.equal(rep.phases.length, 4, '应始终 4 个阶段');
    assert.ok(rep.events.length > 0, '事件序列不应为空');
  }
});

check('F03 战报关键字段完整（losses/rewards/capture/result）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const rep = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 5 });
  assert.ok('losses' in rep && 'rewards' in rep && 'capture' in rep && 'result' in rep);
  assert.ok(Array.isArray(rep.losses.friendly) && Array.isArray(rep.losses.enemy));
  assert.ok(Object.values(BATTLE_RESULT).includes(rep.result), `result 必须是合法枚举，实际：${rep.result}`);
});

check('F04 resultLabel 覆盖五类结果中文', () => {
  assert.equal(btl.resultLabel(BATTLE_RESULT.VICTORY), '胜利');
  assert.equal(btl.resultLabel(BATTLE_RESULT.PYRRHIC), '惨胜');
  assert.equal(btl.resultLabel(BATTLE_RESULT.DEFEAT), '失败');
  assert.equal(btl.resultLabel(BATTLE_RESULT.WITHDRAW), '主动撤退');
  assert.equal(btl.resultLabel(BATTLE_RESULT.WIPED), '编队失去战斗能力');
});

check('F05 BATTLE_RESULT 五类常量存在', () => {
  assert.deepEqual(Object.keys(BATTLE_RESULT), ['VICTORY', 'PYRRHIC', 'DEFEAT', 'WITHDRAW', 'WIPED']);
});

check('F06 战地抢救仅对装甲/车辆生效（不变式：recovered 单位类别只可能是 armor/vehicle）', () => {
  const s = readyBase();
  // 构造“含装甲、车辆、步兵、维修车”的编队（指挥 ≤ 6），跨多种子收集所有损失，校验抢救不变式
  const f = battleReadyFormation(s, { mbt: 1, infantry: 1, scout_car: 1, repair_vehicle: 1 });
  let checked = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    const rep = btl.simulateBattle({ state: s, formation: f, theaterId: 'enemy_outpost', strategyId: 'breakthrough', seed });
    (rep.losses.friendly || []).forEach((loss) => {
      checked += 1;
      if (loss.recovered) {
        const cat = (UNITS[loss.type] || {}).category;
        assert.ok(cat === 'armor' || cat === 'vehicle', `抢救单位类别应为装甲/车辆，实际：${cat}`);
      }
    });
  }
  assert.ok(checked > 0, '至少应收集到若干损失以验证逻辑');
});

check('F07 simulateBattle 是纯函数：不修改传入 state / formation / 真实单位', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const snapUnits = JSON.stringify(s.units);
  const snapForm = JSON.stringify({ id: f.id, unitIds: f.unitIds, status: f.status });
  btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 42 });
  assert.equal(JSON.stringify(s.units), snapUnits, 'state.units 不应被修改');
  assert.equal(JSON.stringify({ id: f.id, unitIds: f.unitIds, status: f.status }), snapForm, 'formation 不应被修改');
});

check('F08 雷达改变侦察判定：有/无雷达同 seed 下先手可能不同（确定性但受状态影响）', () => {
  const mk = () => {
    const s = readyBase();
    const f = battleReadyFormation(s);
    return { s, f };
  };
  const withRadar = mk();
  const noRadar = (() => {
    const s = fresh(); // 无雷达
    withBuildings(s, ['barracks', 'armor_factory']);
    train(s, 'infantry', 2); train(s, 'at_infantry', 1); train(s, 'scout_car', 1); train(s, 'repair_vehicle', 1);
    const f = buildFormation(s, { infantry: 2, at_infantry: 1, scout_car: 1, repair_vehicle: 1 });
    return { s, f };
  })();
  const repR = btl.simulateBattle({ state: withRadar.s, formation: withRadar.f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 7 });
  const repN = btl.simulateBattle({ state: noRadar.s, formation: noRadar.f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 7 });
  // 确定性：在各自状态下结果固定
  assert.equal(repR.scout.firstStrike === 'friendly' || repR.scout.firstStrike === 'enemy', true);
  assert.equal(repN.scout.ambushChance >= repR.scout.ambushChance, true, '无雷达伏击概率应不低于有雷达');
});

/* ============================================================
 * G. 占领奖励与持续收益
 * ========================================================== */
section('G. 占领奖励与持续收益');

check('G01 首胜占领：rec.captured = true，victories +1', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  assert.ok(seed !== null, '应能找到可占领的种子');
  const r = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  assert.equal(f.status, 'returning');
  assert.equal(s.theaters.scrap_mine.captured, true);
  assert.equal(s.theaters.scrap_mine.victories, 1);
  assert.ok(r.ok);
});

check('G02 首占发放 firstReward 且 firstRewardTaken = true', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  const reward = THEATERS.scrap_mine.firstReward; // { alloy: 300 }
  const beforeAlloy = s.resources.alloy;
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  assert.equal(s.theaters.scrap_mine.firstRewardTaken, true);
  // 占领收益计入：合金增加至少为奖励值（扣除可能上限钳制，但基地上限充足）
  assert.ok(s.resources.alloy - beforeAlloy >= reward.alloy - 1, `应获得首占奖励合金${reward.alloy}`);
});

check('G03 已占领战区拒绝再次派遣，首占奖励不会被重复发放', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  assert.equal(s.theaters.scrap_mine.firstRewardTaken, true, '首占奖励应已发放');
  th.closeBattleResult(s);
  // 编队已复位 idle，再次尝试进攻已占领战区应被拒绝，因此无法再次触发发奖
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.CAPTURED, '已占领战区应拒绝再次派遣');
  assert.equal(s.theaters.scrap_mine.firstRewardTaken, true, '首占奖励标记应锁定');
});

check('G04 占领后 recalcDerived 把 captureIncome 计入 rates（scrap_mine → alloyPerSec +1）', () => {
  const s = readyBase();
  const baseAlloy = s.rates.alloy;
  s.theaters.scrap_mine.captured = true;
  eco.recalcDerived(s);
  assert.equal(s.rates.alloy, baseAlloy + THEATERS.scrap_mine.captureIncome.alloyPerSec, '占领后合金产量应 +1/s');
});

check('G05 未占领不计收益，且收益一律由配置计算（不信任存档 income）', () => {
  const s = fresh();
  const baseAlloy = s.rates.alloy;
  eco.recalcDerived(s);
  assert.equal(s.rates.alloy, baseAlloy, '未占领时产量不变');
  // 伪造存档 income 字段，迁移后应被忽略
  s.theaters.scrap_mine.income = { alloyPerSec: 999 };
  th.sanitizeTheaters(s);
  assert.equal(s.theaters.scrap_mine.income, undefined, '迁移应丢弃 income 字段');
});

check('G06 占领 border_road → supplyPerSec +1', () => {
  const s = readyBase();
  s.theaters.border_road.captured = true;
  const baseSupply = s.rates.supply;
  eco.recalcDerived(s);
  assert.equal(s.rates.supply, baseSupply + (THEATERS.border_road.captureIncome.supplyPerSec || 0));
});

check('G07 getReports 历史战报按最新在前', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const reports = th.getReports(s);
  assert.ok(reports.length >= 1);
  assert.equal(reports[0].id, s.activeBattle.report.id, '最新战报应排在最前');
});

check('G08 BATTLE.maxReports 限制（超出被裁剪）', () => {
  const s = fresh();
  s.battles = [];
  for (let i = 0; i < BATTLE.maxReports + 5; i += 1) {
    s.battles.push({ id: `battle_${i}`, events: [], final: {}, result: BATTLE_RESULT.VICTORY });
  }
  th.sanitizeBattles(s);
  assert.equal(s.battles.length, BATTLE.maxReports, `战报应被裁剪到 ${BATTLE.maxReports}`);
});

/* ============================================================
 * H. 存档迁移 v3→v4
 * ========================================================== */
section('H. 存档迁移 v3→v4');

check('H01 旧存档 version=3 迁移后 version = SAVE_VERSION(4)', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const old = JSON.parse(JSON.stringify(s));
  old.version = 3;
  delete old.theaters; // 旧存档可能缺战区字段，由迁移补齐
  const report = {};
  const merged = save.migrate(old, report);
  assert.equal(merged.version, SAVE_VERSION);
  assert.equal(merged.theaters.scrap_mine.captured, false);
});

check('H02 sanitizeTheaters 补齐缺失战区记录', () => {
  const s = { theaters: {} };
  const fix = th.sanitizeTheaters(s);
  assert.equal(fix.repaired, true);
  THEATER_IDS.forEach((id) => assert.ok(s.theaters[id], `应补齐 ${id}`));
});

check('H03 sanitizeTheaters 剔除未知战区记录', () => {
  const s = { theaters: { scrap_mine: { captured: false }, ghost_x: { captured: true } } };
  const fix = th.sanitizeTheaters(s);
  assert.equal(fix.repaired, true);
  assert.ok(s.theaters.scrap_mine);
  assert.equal(s.theaters.ghost_x, undefined, '未知战区应被剔除');
});

check('H04 sanitizeTheaters 丢弃存档 income 字段（不信任）', () => {
  const s = { theaters: { scrap_mine: { captured: true, income: { alloyPerSec: 999 } } } };
  const fix = th.sanitizeTheaters(s);
  assert.equal(fix.repaired, true);
  assert.equal(s.theaters.scrap_mine.income, undefined);
});

check('H05 sanitizeBattles 过滤无效战报（缺 events/final）', () => {
  const bad = { id: 'x' }; // 缺 events / final
  const good = { id: 'y', events: [{ t: 0, type: 'phase' }], final: { friendly: [], enemy: [] } };
  const s = { battles: [bad, good, 'garbage', null] };
  const fix = th.sanitizeBattles(s);
  assert.equal(fix.repaired, true);
  assert.deepEqual(s.battles.map((b) => b.id), ['y'], '仅保留结构完整的战报');
});

check('H06 sanitizeBattles 去重并限长', () => {
  const s = { battles: [] };
  for (let i = 0; i < BATTLE.maxReports + 3; i += 1) s.battles.push({ id: `r${i}`, events: [{ t: 0 }], final: {} });
  s.battles.push({ id: 'r0', events: [{ t: 0 }], final: {} }); // 重复
  const fix = th.sanitizeBattles(s);
  assert.equal(fix.repaired, true);
  assert.equal(s.battles.length, BATTLE.maxReports);
});

check('H07 sanitizeActiveBattle 丢弃无效活动战斗（战区不存在）', () => {
  const s = { activeBattle: { theaterId: 'ghost', strategyId: 'cautious', report: { events: [], final: {} }, formationId: 'f1' }, formations: [] };
  const fix = th.sanitizeActiveBattle(s);
  assert.equal(fix.repaired, true);
  assert.equal(s.activeBattle, null);
  assert.equal(fix.activeFormationId, null);
});

check('H08 sanitizeActiveBattle 在 sanitizeFormations 之前调用（activeFormationId 透传）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  // 模拟存档：把 activeBattle 与编队一并写入
  const saved = JSON.parse(JSON.stringify(s));
  const report = {};
  const bf = th.sanitizeActiveBattle(saved);
  // 之后调用 sanitizeFormations 应保留该编队的 fighting 状态而非复位
  fmt.sanitizeFormations(saved, { activeFormationId: bf.activeFormationId });
  assert.equal(saved.formations.find((x) => x.id === f.id).status, 'fighting', '战斗中的编队不应被复位');
});

check('H09 sanitizeActiveBattle 修复已结算战斗：编队转 RETURNING', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  th.tickActiveBattle(s, s.activeBattle.duration + 1); // 已结算
  const saved = JSON.parse(JSON.stringify(s));
  saved.formations.find((x) => x.id === f.id).status = 'idle'; // 存档里被错误复位
  th.sanitizeActiveBattle(saved);
  assert.equal(saved.formations.find((x) => x.id === f.id).status, 'returning', '已结算战斗编队应修正为返回');
});

check('H10 完整 round-trip：v3 存档 → 保存 → 读档 v4（战区/战报/活动战斗保留）', () => {
  store.clear();
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1); // 已结算但未关闭
  assert.ok(save.saveGame(s, { silent: true }));
  // 改写为“旧版本”存档再读档
  const raw = JSON.parse(store.get(save.SAVE_KEY) || '{}');
  raw.version = 3;
  store.set(save.SAVE_KEY, JSON.stringify(raw));
  const loaded = save.loadGame();
  assert.ok(loaded.ok, loaded.reason);
  assert.equal(loaded.state.version, SAVE_VERSION);
  assert.equal(loaded.state.theaters.scrap_mine.captured, true, '占领状态应保留');
  assert.ok(loaded.state.battles.length >= 1, '战报应保留');
  assert.ok(loaded.state.activeBattle, '活动战斗应保留');
  assert.equal(loaded.state.activeBattle.settled, true, '已结算状态应保留');
});

check('H11 loadGame 返回 theaterRepaired / battleRepaired / upgraded 布尔字段', () => {
  store.clear();
  const s = readyBase();
  assert.ok(save.saveGame(s, { silent: true }));
  const loaded = save.loadGame();
  assert.equal(typeof loaded.theaterRepaired, 'boolean');
  assert.equal(typeof loaded.battleRepaired, 'boolean');
  assert.equal(typeof loaded.upgraded, 'boolean');
});

check('H12 损坏的 activeBattle 不导致 loadGame 白屏（返回 ok 或失败均可，但不抛）', () => {
  store.clear();
  const s = readyBase();
  assert.ok(save.saveGame(s, { silent: true }));
  const raw = JSON.parse(store.get(save.SAVE_KEY) || '{}');
  raw.activeBattle = { theaterId: 'ghost', strategyId: 'cautious' }; // 非法
  store.set(save.SAVE_KEY, JSON.stringify(raw));
  assert.doesNotThrow(() => {
    const loaded = save.loadGame();
    assert.ok(typeof loaded.ok === 'boolean');
  });
});

/* ============================================================
 * I. UI 战区页 / 战报页构建（DOM 桩）
 * ========================================================== */
section('I. UI 战区页 / 战报页构建（DOM 桩）');

const theaterHandlers = {
  onSpeedChange() {}, onSave() {}, onLoad() {}, onNewGame() {}, onTabChange() {},
  onBuild() {}, onCancelConstruction() {}, onProduce() {}, onCancelCurrentProduction() {},
  onCancelQueuedProduction() {}, onSelectFormation() {}, onCreateFormation() {},
  onApplyPreset() {}, onDisbandFormation() {}, onRenameFormation() {}, onAddUnit() {},
  onRemoveUnit() {}, onDispatch() {}, onCloseBattle() {}, onSelectTheater() {}, onSelectReport() {}
};

check('I01 new UI 含战区/战报 handlers 不抛', () => {
  let ui = null;
  assert.doesNotThrow(() => { ui = new UI(theaterHandlers); });
  assert.ok(ui && ui.refs.th && ui.refs.rp, '战区与战报页引用应存在');
});

check('I02 refreshTheater 不抛，且战区卡片数 = THEATERS 数', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const ui = new UI(theaterHandlers);
  assert.doesNotThrow(() => ui.refreshTheater(s));
  assert.ok(ui.refs.th.list, '战区列表容器应存在');
  assert.equal(ui.refs.th.list.children.length, THEATER_IDS.length, '战区卡片数应等于战区数');
});

check('I03 派遣控制台结构完整（编队下拉 / 策略 / 成本 / 派遣按钮）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const ui = new UI(theaterHandlers);
  ui.refreshTheater(s);
  const t = ui.refs.th;
  assert.ok(t.dsSelect, '编队下拉应存在');
  assert.ok(t.strategyCards && Object.keys(t.strategyCards).length === 3, '应有三张策略卡');
  assert.ok(t.dsCost, '成本区应存在');
  assert.ok(t.dsBtn, '派遣按钮应存在');
});

check('I04 资源不足时派遣按钮被禁用', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  s.resources.supply = 0;
  const ui = new UI(theaterHandlers);
  ui.refreshTheater(s);
  assert.equal(ui.refs.th.dsBtn.disabled, true, '资源不足应禁用派遣');
});

check('I05 有活动战斗时“当前作战”面板显示且进度可推进', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const ui = new UI(theaterHandlers);
  ui.refreshTheater(s);
  assert.equal(ui.refs.th.battleBox.hidden, false, '作战中应显示当前作战面板');
  th.tickActiveBattle(s, s.activeBattle.duration * 0.5);
  assert.doesNotThrow(() => ui.refreshBattle(s));
  assert.ok(ui.refs.th.battleBar, '进度条元素应存在');
});

check('I06 结算后展示结果横幅与“返回基地”按钮', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const ui = new UI(theaterHandlers);
  ui.refreshTheater(s);
  assert.equal(ui.refs.th.battleBox.hidden, false);
  assert.equal(ui.refs.th.result.hidden, false, '应展示结果横幅');
  assert.equal(ui.refs.th.battleActions.hidden, false, '应展示返回基地/查看战报按钮');
});

check('I07 refreshReports 不抛，且有战报时行数 = 战报数', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const ui = new UI(theaterHandlers);
  assert.doesNotThrow(() => ui.refreshTheater(s));
  assert.ok(ui.refs.rp.list, '战报列表容器应存在');
  assert.equal(ui.refs.rp.list.children.length, th.getReports(s).length, '战报行数应等于战报数');
});

check('I08 战报详情渲染不抛且统计赋值正确', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.tickActiveBattle(s, s.activeBattle.duration + 1);
  const ui = new UI(theaterHandlers);
  ui.refreshTheater(s);
  assert.equal(ui.refs.rp.statTag.textContent, `${th.getReports(s).length} 份`);
  assert.doesNotThrow(() => ui._renderReportDetail(ui.refs.rp.detail, th.getReports(s)[0]));
});

/* ============================================================
 * J. 战斗渲染器（canvas 桩，只读、不抛异常）
 * ========================================================== */
section('J. 战斗渲染器（canvas 桩）');

check('J01 new BattleRenderer(canvas) 不抛', () => {
  const canvas = makeCanvas();
  let r = null;
  assert.doesNotThrow(() => { r = new BattleRenderer(canvas); });
  assert.ok(r);
});

check('J02 render 活动战斗多帧不抛', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const r = new BattleRenderer(makeCanvas());
  assert.doesNotThrow(() => {
    for (let i = 0; i < 10; i += 1) r.render(s.activeBattle, 0.05);
  });
});

check('J03 reset() 不抛', () => {
  const r = new BattleRenderer(makeCanvas());
  assert.doesNotThrow(() => r.reset());
});

check('J04 BattleRenderer.render 不修改 activeBattle / state', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  const beforeAb = JSON.stringify(s.activeBattle);
  const beforeState = JSON.stringify({ res: s.resources, units: s.units.length });
  const r = new BattleRenderer(makeCanvas());
  for (let i = 0; i < 8; i += 1) r.render(s.activeBattle, 0.05);
  assert.equal(JSON.stringify(s.activeBattle), beforeAb, 'activeBattle 不应被渲染器修改');
  assert.equal(JSON.stringify({ res: s.resources, units: s.units.length }), beforeState, 'state 不应被渲染器修改');
});

check('J05 BattleRenderer 与 BaseRenderer 共存切换不抛', () => {
  const canvas = makeCanvas();
  const baseR = new BaseRenderer(canvas, null);
  const battleR = new BattleRenderer(canvas);
  const s = readyBase();
  const f = battleReadyFormation(s);
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious');
  assert.doesNotThrow(() => {
    baseR.render(s, 0.05, 0.05);
    battleR.render(s.activeBattle, 0.05);
    baseR.setSuspended(true);
    battleR.reset();
    baseR.setSuspended(false);
  });
});

/* ============================================================
 * K. 调试接口 / 模块导出契约
 * ========================================================== */
section('K. 调试接口 / 模块导出契约');

check('K01 theater 模块导出契约齐全（__IRON_COMMAND__ 战区相关面）', () => {
  const need = [
    'listTheaters', 'listStrategies', 'getTheaterIntel', 'getMissionCost', 'formatMissionCost',
    'canDispatch', 'getActiveBattle', 'getReports', 'hasRadar',
    'dispatchFormation', 'tickActiveBattle', 'settleActiveBattle', 'closeBattleResult',
    'getReport', 'isBattleFinished', 'sanitizeTheaters', 'sanitizeActiveBattle', 'sanitizeBattles'
  ];
  need.forEach((fn) => assert.equal(typeof th[fn], 'function', `theater.${fn} 应导出`));
});

check('K02 battle 模块导出契约齐全（simulate / resultLabel / 事件类型）', () => {
  assert.equal(typeof btl.simulateBattle, 'function');
  assert.equal(typeof btl.resultLabel, 'function');
  assert.ok(btl.BATTLE_EVENT && btl.BATTLE_PHASE);
});

check('K03 config 导出战区 / 策略 / 敌方单位 / 战斗常量', () => {
  assert.ok(THEATERS && STRATEGIES && ENEMY_UNITS && BATTLE && BATTLE_RESULT && TERRAIN);
  assert.ok('maxReports' in BATTLE);
});

check('K04 THEATER_API 聚合面含 sanitize 系列', () => {
  assert.ok(th.THEATER_API);
  ['sanitizeTheaters', 'sanitizeActiveBattle', 'sanitizeBattles'].forEach((fn) => {
    assert.equal(typeof th.THEATER_API[fn], 'function', `THEATER_API.${fn} 应存在`);
  });
});

/* ============================================================
 * L. 局部服务器与全部源码语法检查
 * ========================================================== */
section('L. 局部服务器与源码语法检查');

check('L01 scripts/serve.mjs 导出 createServer 且为 http.Server 实例', () => {
  assert.equal(typeof serve.createServer, 'function');
  const srv = serve.createServer(ROOT);
  assert.ok(srv && typeof srv.listen === 'function' && typeof srv.close === 'function');
  srv.close();
});

/** 启动一个临时服务器，返回 { server, port, close } */
function startTempServer() {
  return new Promise((resolve, reject) => {
    const srv = serve.createServer(ROOT);
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      resolve({ server: srv, port: srv.address().port });
    });
  });
}

check('L02 局部服务器：真实请求返回 200 与正确 content-type', async () => {
  const { server, port } = await startTempServer();
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, 200, '根路径应返回 200');
            assert.ok(/text\/html/i.test(res.headers['content-type'] || ''), '应声明 HTML 类型');
            assert.ok(body.includes('钢铁指令') || body.length > 0, '应返回页面内容');
            resolve();
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
    });
  } finally {
    server.close();
  }
});

check('L03 局部服务器：路径穿越 /../ 返回 403', async () => {
  const { server, port } = await startTempServer();
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/../package.json' }, (res) => {
        try {
          assert.equal(res.statusCode, 403, '路径穿越应被拒绝 (403)');
          resolve();
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  } finally {
    server.close();
  }
});

check('L04 全部 js/*.js 语法检查通过', () => {
  const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
  assert.ok(files.length >= 10, '应存在多个源码文件');
  files.forEach((f) => {
    const res = spawnSync(process.execPath, ['--check', path.join(JS_DIR, f)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `node --check ${f} 失败：${res.stderr}`);
  });
});

/* ============================================================
 * 运行
 * ========================================================== */

console.log('════════════════════════════════════════════');
console.log('  钢铁指令 阶段5 自动测试');
console.log('══════════════════════════════════════════');

await run();

console.log('\n══════════════════════════════════════════');
console.log(`  结果：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
console.log('══════════════════════════════════════════');

if (fail > 0) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(`  - ${f.name}\n      ${f.message.split('\n')[0]}`));
  process.exit(1);
} else {
  process.exit(0);
}
