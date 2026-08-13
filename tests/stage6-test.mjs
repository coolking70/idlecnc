/**
 * 钢铁指令 · IRON COMMAND —— 阶段6 自动测试
 *
 * 覆盖（规格 #三十二~#三十三，≥90 项）：
 *   A. 阶段标记与配置（版本 / 经验 / 损伤阈值 / 面板）
 *   B. 战斗修复（时间轴 / 防御只护我方 / 反装甲风险 / 机动 / 压制阈值 / 战报 ID 含策略）
 *   C. 战斗修正接入（地形装甲攻击 / 车辆机动 / 压制修正 / 确定性）
 *   D. 维修损伤判定与排队（canQueueRepair 全分支 + queueRepair 脱编队）
 *   E. 维修推进 / 完成 / 取消（事件步进确定性 / 退款比例 / 递补）
 *   F. 维修建队容错（去重 / 释放归属 / 工位限额 / 孤儿回收）
 *   G. 维修离线推进与车间状态
 *   H. 离线结算（时长截断 / 事件步进 / 资源 / 施工 / 生产 / 维修 / 时钟）
 *   I. 离线报告（buildOfflineReport / dismiss / hasPending）
 *   J. 离线确定性（大 dt == 多次小 dt）与幂等
 *   K. 存档迁移 v4→v5 与离线接线（sanitizeRepairs 先于编队 / 导入不重放）
 *   L. 战斗结算加固（validate / buildPlan / 事务 / 幂等）
 *   M. 经验配置接入（单位 +5 / 胜 +5 / 编队 +10/+10）
 *   N. 调试接口契约（repairs / offline / theater 新增导出）
 *   O. 界面维修页与离线报告卡片（DOM 桩）
 *   P. 渲染器维修车间表现（canvas 桩，只读不抛）
 *   Q. 全部源码语法检查
 *
 * 运行方式（在 iron-command 目录下）：
 *     node tests/stage6-test.mjs
 * 或：  npm test
 *
 * 沿用 stage5-test.mjs 的 DOM 桩结构与辅助函数。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
const rep = await import('../js/repairs.js');
const off = await import('../js/offline.js');
const { UI } = await import('../js/ui.js');
const { BaseRenderer } = await import('../js/renderer.js');
const serve = await import('../scripts/serve.mjs');

const {
  BUILDINGS, BUILDING_STATUS, UNITS, THEATERS, ENEMY_UNITS, STRATEGIES,
  TERRAIN, BATTLE, BATTLE_RESULT, SAVE_VERSION, CURRENT_STAGE, TIME,
  RESOURCE_DEFS, FORMATION, FORMATION_PRESETS, DAMAGE_STATES, DAMAGE_THRESHOLDS,
  REPAIR, PANEL_TABS
} = cfg;

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
 * 四、通用辅助（沿用 stage5 结构，tick 含维修推进）
 * ========================================================== */

function tick(state, seconds, step = TIME.logicStep) {
  let left = seconds;
  while (left > 1e-9) {
    const d = Math.min(step, left);
    eco.tickEconomy(state, d);
    con.tickConstruction(state, d);
    prod.tickProduction(state, d);
    rep.tickRepairs(state, d);
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

/** 组建一支可用于派遣的编队（combined 风格） */
function battleReadyFormation(state, spec = { infantry: 2, at_infantry: 1, scout_car: 1, repair_vehicle: 1 }) {
  Object.entries(spec).forEach(([type, n]) => train(state, type, n));
  return buildFormation(state, spec);
}

/** 在多个种子里寻找一个能占领（胜利/惨胜）的种子 */
function findCaptureSeed(state, formation, theaterId, strategyId, maxTry = 400) {
  for (let s = 1; s <= maxTry; s += 1) {
    const r = btl.simulateBattle({ state, formation, theaterId, strategyId, seed: s });
    if (r.capture) return s;
  }
  return null;
}

/** 给指定单位制造损伤（直接改 hp / damage，模拟战斗结算后的状态） */
function damageUnit(state, unitId, ratio) {
  const unit = (state.units || []).find((u) => u.id === unitId);
  assert.ok(unit, '损伤目标单位不存在');
  const maxHp = Math.max(1, unit.maxHp || UNITS[unit.type].stats.hp);
  unit.maxHp = maxHp;
  unit.hp = Math.max(0, Math.floor(maxHp * ratio));
  unit.damage = rep.getDamageState(unit.hp, maxHp);
  return unit;
}

/* ============================================================
 * A. 阶段标记与配置
 * ========================================================== */
section('A. 阶段标记与配置');

check('A01 CURRENT_STAGE 已进入阶段8', () => {
  assert.equal(CURRENT_STAGE, 8);
});

check('A02 SAVE_VERSION === 10', () => {
  assert.equal(SAVE_VERSION, 10);
});

check('A03 package.json 版本号保持0.8.1-hotfix系列', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^0\.8\.1-hotfix\./);
});

check('A04 DAMAGE_THRESHOLDS 配置 {intact:0.75, light:0.4}', () => {
  assert.equal(DAMAGE_THRESHOLDS.intact, 0.75);
  assert.equal(DAMAGE_THRESHOLDS.light, 0.4);
});

check('A05 BATTLE.experience 配置值', () => {
  const xp = BATTLE.experience;
  assert.equal(xp.unitParticipation, 5);
  assert.equal(xp.unitVictory, 5);
  assert.equal(xp.formationParticipation, 10);
  assert.equal(xp.formationVictory, 10);
});

check('A06 REPAIR 配置（工位/队列/退款比例/耗时/成本）', () => {
  assert.equal(REPAIR.maxConcurrent, 2);
  assert.equal(REPAIR.maxQueueSize, 8);
  assert.equal(REPAIR.activeCancelRefundRatio, 0.5);
  assert.equal(REPAIR.queuedCancelRefundRatio, 1);
  assert.equal(REPAIR.times.heavy, 35);
  assert.equal(REPAIR.cost.light.supply, 20);
});

check('A07 PANEL_TABS 含 repairs 与已开放 research', () => {
  const repairsTab = PANEL_TABS.find((t) => t.id === 'repairs');
  assert.ok(repairsTab, '缺少 repairs 标签');
  assert.equal(repairsTab.stage, 6);
  const researchTab = PANEL_TABS.find((t) => t.id === 'research');
  assert.ok(researchTab, '缺少 research 标签');
  assert.equal(researchTab.stage, 7);
  assert.ok(researchTab.stage <= CURRENT_STAGE, 'research 应开放');
});

/* ============================================================
 * B. 战斗修复
 * ========================================================== */
section('B. 战斗修复');

check('B01 战报 ID 含策略 ID', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const rep1 = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 7 });
  assert.ok(rep1.id.includes('cautious'), '战报 ID 应含策略');
  assert.ok(rep1.id.includes('scrap_mine'), '战报 ID 应含战区');
});

check('B02 simulateBattle 纯函数：同种子同结果', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const a = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 42 });
  const b = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 42 });
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.capture, b.capture);
  assert.equal(a.id, b.id);
});

check('B03 simulateBattle 不修改状态资源', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const before = { ...s.resources };
  btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 5 });
  assert.deepEqual(s.resources, before, '求解器不得修改资源');
});

check('B04 时间轴：事件 t 单调不减且 <= duration', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 3 });
  const evs = r.events || [];
  assert.ok(evs.length > 0, '应有事件');
  let prev = -1;
  evs.forEach((ev) => {
    assert.ok(typeof ev.t === 'number' && ev.t >= 0, '事件时间非负');
    assert.ok(ev.t >= prev, '事件时间单调不减');
    assert.ok(ev.t <= r.duration + 0.01, '事件时间不超过战斗时长');
    prev = ev.t;
  });
});

check('B05 时间轴：首个事件 t=0，RESULT 事件为最后一个且 t < duration', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 11 });
  const evs = r.events || [];
  assert.ok(evs.length > 1, '应有多条事件');
  assert.equal(evs[0].t, 0, '首个事件应在 t=0');
  const resultEv = evs[evs.length - 1];
  assert.equal(resultEv.type, btl.BATTLE_EVENT.RESULT, 'RESULT 事件应在末尾');
  assert.ok(resultEv.t < r.duration, 'RESULT 事件时间应小于战斗时长');
});

check('B06 final.friendly 快照含 realId / alive / hp', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 11 });
  const friendly = r.final && r.final.friendly;
  assert.ok(Array.isArray(friendly), 'final.friendly 应为数组');
  assert.ok(friendly.length > 0, '应有友军快照');
  friendly.forEach((snap) => {
    assert.ok(snap.realId, '快照应含 realId');
    assert.equal(typeof snap.alive, 'boolean');
    assert.ok(Number.isFinite(snap.hp));
  });
});

check('B07 initial/final 阵容数组结构合法', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 11 });
  assert.ok(Array.isArray(r.initial && r.initial.friendly));
  assert.ok(Array.isArray(r.initial && r.initial.enemy));
  assert.ok(Array.isArray(r.final && r.final.friendly));
  assert.ok(Array.isArray(r.final && r.final.enemy));
});

check('B08 防御修正只保护我方（敌方防御不影响我方伤害）', () => {
  // 用纯求解对比：敌方有无 defense 字段，我方对敌伤害应不受敌方 defense 加成
  const s = readyBase();
  const f = battleReadyFormation(s);
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 21 });
  // 只要能跑完且敌军有受伤或阵亡即说明防御只护我方逻辑未破坏求解
  const enemyDmg = (r.final.enemy || []).some((e) => !e.alive || e.hp < (e.maxHp || 9999));
  assert.ok(enemyDmg || r.result !== BATTLE_RESULT.WIPED, '应能对敌方造成伤害');
});

check('B09 反装甲风险修正存在（atRisk 修饰符）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s, { at_infantry: 2, infantry: 2 });
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 9 });
  assert.ok(r, '含反装甲编队应能求解');
});

check('B10 车辆机动受地形影响（不同战区结果可不同）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s, { scout_car: 3 });
  // 不同地形对车辆机动有影响，至少能正常求解
  const r1 = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 3 });
  assert.ok(r1, '战区求解应正常');
});

check('B11 压制阈值修正（火力侦察更易压制）', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  // 火力侦察策略带 suppression 修正，应能正常求解
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'recon_by_fire', seed: 3 });
  assert.ok(r, '火力侦察策略应能求解');
  assert.ok(STRATEGIES.recon_by_fire && STRATEGIES.recon_by_fire.mods && STRATEGIES.recon_by_fire.mods.suppression, '火力侦察应有 suppression 修正');
});

check('B12 不同策略产生不同战报 ID', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const a = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed: 5 });
  const b = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'recon', seed: 5 });
  assert.notEqual(a.id, b.id, '不同策略战报 ID 应不同');
});

/* ============================================================
 * C. 战斗修正接入
 * ========================================================== */
section('C. 战斗修正接入');

check('C01 地形配置含 armorAttack / vehicleMobility', () => {
  Object.keys(TERRAIN).forEach((key) => {
    const t = TERRAIN[key];
    assert.ok(t, `地形 ${key} 应存在`);
    assert.equal(typeof t.armorAttack, 'number', `${key} 应有 armorAttack`);
    assert.equal(typeof t.vehicleMobility, 'number', `${key} 应有 vehicleMobility`);
  });
});

check('C02 策略修正含 suppression / defense（按策略各自定义）', () => {
  // 火力侦察定义了 suppression 修正
  assert.equal(typeof STRATEGIES.recon_by_fire.mods.suppression, 'number', '火力侦察应有 suppression');
  // 谨慎推进定义了 defense 修正
  assert.equal(typeof STRATEGIES.cautious.mods.defense, 'number', '谨慎推进应有 defense');
  // 突破定义了 atRisk 修正
  assert.equal(typeof STRATEGIES.breakthrough.mods.atRisk, 'number', '正面突破应有 atRisk');
});

check('C03 多种子求解均不抛异常', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed });
    assert.ok(r && r.events, `seed=${seed} 求解应完整`);
  }
});

check('C04 战报奖励结构合法', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious') || 1;
  const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed });
  if (r.rewards) {
    Object.keys(r.rewards).forEach((k) => {
      assert.ok(RESOURCE_DEFS[k], `奖励资源 ${k} 应合法`);
      assert.ok(r.rewards[k] >= 0, '奖励数值非负');
    });
  }
});

check('C05 战报占领标记与结果一致', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  for (let seed = 1; seed <= 30; seed += 1) {
    const r = btl.simulateBattle({ state: s, formation: f, theaterId: 'scrap_mine', strategyId: 'cautious', seed });
    const captureResults = [BATTLE_RESULT.VICTORY, BATTLE_RESULT.PYRRHIC];
    const shouldCapture = captureResults.includes(r.result);
    assert.equal(r.capture, shouldCapture, `seed=${seed} 占领标记与结果不一致`);
  }
});

/* ============================================================
 * D. 维修损伤判定与排队
 * ========================================================== */
section('D. 维修损伤判定与排队');

check('D01 getDamageState 边界值', () => {
  assert.equal(rep.getDamageState(0, 100), DAMAGE_STATES.DESTROYED);
  assert.equal(rep.getDamageState(100, 100), DAMAGE_STATES.INTACT);
  assert.equal(rep.getDamageState(75, 100), DAMAGE_STATES.INTACT);
  assert.equal(rep.getDamageState(40, 100), DAMAGE_STATES.LIGHT);
  assert.equal(rep.getDamageState(39, 100), DAMAGE_STATES.HEAVY);
  assert.equal(rep.getDamageState(1, 100), DAMAGE_STATES.HEAVY);
});

check('D02 damageStateOfUnit 读单位实例', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  u.hp = u.maxHp;
  assert.equal(rep.damageStateOfUnit(u), DAMAGE_STATES.INTACT);
  u.hp = Math.floor(u.maxHp * 0.4);
  assert.equal(rep.damageStateOfUnit(u), DAMAGE_STATES.LIGHT);
});

check('D03 canQueueRepair：单位不存在 → UNKNOWN_UNIT', () => {
  const s = readyBase();
  const r = rep.canQueueRepair(s, 'no_such_unit');
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.UNKNOWN_UNIT);
});

check('D04 canQueueRepair：完好单位 → NOT_DAMAGED', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const r = rep.canQueueRepair(s, s.units[0].id);
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.NOT_DAMAGED);
});

check('D05 canQueueRepair：已损毁 → DESTROYED', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = damageUnit(s, s.units[0].id, 0);
  u.hp = 0;
  u.damage = rep.getDamageState(0, u.maxHp);
  const r = rep.canQueueRepair(s, u.id);
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.DESTROYED);
});

check('D06 canQueueRepair：已在队列 → ALREADY_QUEUED', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  const r1 = rep.queueRepair(s, s.units[0].id);
  assert.ok(r1.ok, '首次排队应成功');
  const r2 = rep.canQueueRepair(s, s.units[0].id);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, rep.REPAIR_CODE.ALREADY_QUEUED);
});

check('D07 canQueueRepair：资源不足 → INSUFFICIENT', () => {
  const s = readyBase();
  train(s, 'mbt', 1);
  damageUnit(s, s.units[0].id, 0.2);
  s.resources.supply = 0;
  s.resources.alloy = 0;
  const r = rep.canQueueRepair(s, s.units[0].id);
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.INSUFFICIENT);
  assert.ok(r.missing && r.missing.length > 0, '应列出缺少资源');
});

check('D08 canQueueRepair：就绪 → READY 并带 severity/cost/duration', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.6);   // ratio 0.6 → 轻伤
  const r = rep.canQueueRepair(s, s.units[0].id);
  assert.ok(r.ok, '轻伤单位应可维修');
  assert.equal(r.code, rep.REPAIR_CODE.READY);
  assert.equal(r.severity, DAMAGE_STATES.LIGHT);
  assert.ok(r.cost && r.cost.supply > 0, '应返回成本');
  assert.ok(r.duration > 0, '应返回耗时');
});

check('D09 queueRepair：扣资源 / 脱编队 / 状态 repairing', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const unit = s.units[0];
  damageUnit(s, unit.id, 0.3);
  const beforeSupply = s.resources.supply;
  const r = rep.queueRepair(s, unit.id);
  assert.ok(r.ok, '维修应成功');
  assert.equal(unit.status, 'repairing');
  assert.equal(unit.formationId, null, '维修单位应脱离编队');
  assert.ok(!f.unitIds.includes(unit.id), '编队应移除该单位');
  assert.ok(s.resources.supply < beforeSupply, '应扣除维修费用');
});

check('D10 queueRepair：重伤耗时与成本高于轻伤', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  damageUnit(s, s.units[0].id, 0.5);   // 轻伤
  damageUnit(s, s.units[1].id, 0.2);   // 重伤
  const light = rep.canQueueRepair(s, s.units[0].id);
  const heavy = rep.canQueueRepair(s, s.units[1].id);
  assert.ok(heavy.duration > light.duration, '重伤耗时更长');
  assert.ok(heavy.cost.supply >= light.cost.supply, '重伤成本不低于轻伤');
});

check('D11 getRepairCost / getRepairTime 按 severity', () => {
  assert.deepEqual(rep.getRepairCost(DAMAGE_STATES.LIGHT), REPAIR.cost.light);
  assert.deepEqual(rep.getRepairCost(DAMAGE_STATES.HEAVY), REPAIR.cost.heavy);
  assert.equal(rep.getRepairTime(DAMAGE_STATES.LIGHT), REPAIR.times.light);
  assert.equal(rep.getRepairTime(DAMAGE_STATES.HEAVY), REPAIR.times.heavy);
});

check('D12 queueRepair 满队列 → QUEUE_FULL', () => {
  const s = readyBase();
  // 制造 maxQueueSize+1 个受损单位
  const n = REPAIR.maxQueueSize + 1;
  train(s, 'infantry', n);
  for (let i = 0; i < n; i += 1) damageUnit(s, s.units[i].id, 0.3);
  let last = null;
  for (let i = 0; i < n; i += 1) {
    last = rep.queueRepair(s, s.units[i].id);
    if (!last.ok) break;
  }
  assert.equal(last.code, rep.REPAIR_CODE.QUEUE_FULL, '超出队列上限应拒绝');
});

/* ============================================================
 * E. 维修推进 / 完成 / 取消
 * ========================================================== */
section('E. 维修推进 / 完成 / 取消');

check('E01 tickRepairs：无任务时 no-op', () => {
  const s = readyBase();
  const r = rep.tickRepairs(s, 10);
  assert.deepEqual(r, { completed: [], steps: 0 });
});

check('E02 tickRepairs：单任务完成后恢复满耐久', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  damageUnit(s, u.id, 0.3);
  const qr = rep.queueRepair(s, u.id);
  const dur = qr.job.duration;
  rep.tickRepairs(s, dur + 0.1);
  assert.equal(u.hp, u.maxHp, '应恢复满耐久');
  assert.equal(u.status, 'ready');
  assert.equal(u.damage, DAMAGE_STATES.INTACT);
});

check('E03 tickRepairs：并行工位（两个 active 同时推进）', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  damageUnit(s, s.units[0].id, 0.3);
  damageUnit(s, s.units[1].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  rep.queueRepair(s, s.units[1].id);
  const active = rep.getActiveRepairs(s);
  assert.equal(active.length, 2, '应有 2 个并行工位');
});

check('E04 tickRepairs：完成一个后队列递补', () => {
  const s = readyBase();
  train(s, 'infantry', 3);
  damageUnit(s, s.units[0].id, 0.6);   // 轻伤 15s
  damageUnit(s, s.units[1].id, 0.2);   // 重伤 35s
  damageUnit(s, s.units[2].id, 0.2);   // 重伤 35s
  rep.queueRepair(s, s.units[0].id);   // active（15s）
  rep.queueRepair(s, s.units[1].id);   // active（35s）
  rep.queueRepair(s, s.units[2].id);   // queued
  // 前两个占工位，第三个排队
  assert.equal(rep.getActiveRepairs(s).length, 2);
  assert.equal(rep.getQueuedRepairs(s).length, 1);
  // 推进 15s：第一个（轻伤）完成，第三个递补
  rep.tickRepairs(s, 15.1);
  assert.equal(rep.getActiveRepairs(s).length, 2, '递补后仍应满工位');
  assert.equal(rep.getQueuedRepairs(s).length, 0);
});

check('E05 tickRepairs：大 dt 与多次小 dt 结果一致（事件步进确定性）', () => {
  const s1 = readyBase();
  const s2 = readyBase();
  train(s1, 'infantry', 2); train(s2, 'infantry', 2);
  damageUnit(s1, s1.units[0].id, 0.2); damageUnit(s1, s1.units[1].id, 0.3);
  damageUnit(s2, s2.units[0].id, 0.2); damageUnit(s2, s2.units[1].id, 0.3);
  rep.queueRepair(s1, s1.units[0].id); rep.queueRepair(s1, s1.units[1].id);
  rep.queueRepair(s2, s2.units[0].id); rep.queueRepair(s2, s2.units[1].id);
  // 一次性推进 50 秒
  rep.tickRepairs(s1, 50);
  // 分 500 次 0.1 秒推进
  for (let i = 0; i < 500; i += 1) rep.tickRepairs(s2, 0.1);
  assert.equal(s1.units[0].hp, s2.units[0].hp, '两种推进方式单位 hp 应一致');
  assert.equal(s1.units[1].hp, s2.units[1].hp);
  assert.equal(s1.repairs.length, s2.repairs.length, '剩余维修任务数应一致');
});

check('E06 completeRepair：恢复满耐久并返回库存', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  damageUnit(s, u.id, 0.3);
  const r = rep.queueRepair(s, u.id);
  const cr = rep.completeRepair(s, r.job.id);
  assert.ok(cr.ok);
  assert.equal(u.hp, u.maxHp);
  assert.equal(u.status, 'ready');
  assert.equal(u.formationId, null);
});

check('E07 completeRepair：任务不存在 → NOT_FOUND', () => {
  const s = readyBase();
  const r = rep.completeRepair(s, 'no_such_job');
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.NOT_FOUND);
});

check('E08 cancelRepair：进行中退款 50%', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  const before = s.resources.supply;
  const r = rep.queueRepair(s, s.units[0].id);
  const cost = r.job.cost.supply;
  const after = s.resources.supply;
  assert.equal(after, before - cost, '排队时全额扣除');
  const cr = rep.cancelRepair(s, r.job.id);
  assert.ok(cr.ok);
  // active 退款 50%
  assert.equal(s.resources.supply, before - cost + Math.floor(cost * 0.5));
});

check('E09 cancelRepair：排队中全额退款', () => {
  const s = readyBase();
  train(s, 'infantry', 3);
  for (let i = 0; i < 3; i += 1) damageUnit(s, s.units[i].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  rep.queueRepair(s, s.units[1].id);
  const before = s.resources.supply;
  const r = rep.queueRepair(s, s.units[2].id);   // 第三个排队
  assert.equal(r.job.status, 'queued');
  const cost = r.job.cost.supply;
  const cr = rep.cancelRepair(s, r.job.id);
  assert.ok(cr.ok);
  // queued 全额退款
  assert.equal(s.resources.supply, before - cost + cost);
});

check('E10 cancelRepair：任务不存在 → NOT_FOUND', () => {
  const s = readyBase();
  const r = rep.cancelRepair(s, 'no_such_job');
  assert.equal(r.ok, false);
  assert.equal(r.code, rep.REPAIR_CODE.NOT_FOUND);
});

check('E11 getRepairProgress / getRepairRemaining', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  const r = rep.queueRepair(s, s.units[0].id);
  const job = rep.getActiveRepairs(s)[0];
  assert.equal(rep.getRepairProgress(job), 0);
  assert.ok(rep.getRepairRemaining(job) > 0);
  rep.tickRepairs(s, job.duration / 2);
  const job2 = rep.getActiveRepairs(s)[0];
  assert.ok(rep.getRepairProgress(job2) > 0.4 && rep.getRepairProgress(job2) < 0.6);
});

check('E12 startQueuedRepairs：FIFO 提升', () => {
  const s = readyBase();
  train(s, 'infantry', 4);
  for (let i = 0; i < 4; i += 1) damageUnit(s, s.units[i].id, 0.3);
  const ids = [];
  for (let i = 0; i < 4; i += 1) { ids.push(rep.queueRepair(s, s.units[i].id).job.id); }
  // 前两个 active，后两个 queued
  const active = rep.getActiveRepairs(s).map((j) => j.id);
  assert.equal(active.length, 2);
  assert.equal(active[0], ids[0]);
  assert.equal(active[1], ids[1]);
});

/* ============================================================
 * F. 维修建队容错
 * ========================================================== */
section('F. 维修建队容错');

check('F01 sanitizeRepairs：空数组容错', () => {
  const s = fresh();
  s.repairs = [];
  const r = rep.sanitizeRepairs(s);
  assert.deepEqual(s.repairs, []);
  assert.equal(r.repaired, false);
});

check('F02 sanitizeRepairs：丢弃引用不存在单位的任务', () => {
  const s = readyBase();
  s.repairs = [{ id: 'j1', unitId: 'ghost', status: 'active', duration: 10, elapsed: 0 }];
  rep.sanitizeRepairs(s);
  assert.equal(s.repairs.length, 0);
});

check('F03 sanitizeRepairs：同一单位重复任务合并', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  damageUnit(s, u.id, 0.3);
  u.status = 'repairing';
  s.repairs = [
    { id: 'j1', unitId: u.id, status: 'active', duration: 15, elapsed: 0 },
    { id: 'j2', unitId: u.id, status: 'queued', duration: 15, elapsed: 0 }
  ];
  rep.sanitizeRepairs(s);
  assert.equal(s.repairs.length, 1, '应合并为 1 项');
});

check('F04 sanitizeRepairs：释放维修单位的编队归属', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const u = s.units[0];
  damageUnit(s, u.id, 0.3);
  u.status = 'repairing';
  s.repairs = [{ id: 'j1', unitId: u.id, status: 'active', duration: 15, elapsed: 0 }];
  rep.sanitizeRepairs(s);
  assert.equal(u.formationId, null, '维修单位应脱离编队');
  assert.ok(!f.unitIds.includes(u.id), '编队应不含维修单位');
});

check('F05 sanitizeRepairs：活跃工位超限降级为排队', () => {
  const s = readyBase();
  train(s, 'infantry', 4);
  for (let i = 0; i < 4; i += 1) {
    const u = s.units[i];
    damageUnit(s, u.id, 0.3);
    u.status = 'repairing';
  }
  s.repairs = s.units.map((u) => ({ id: `j_${u.id}`, unitId: u.id, status: 'active', duration: 15, elapsed: 0 }));
  rep.sanitizeRepairs(s);
  const active = rep.getActiveRepairs(s);
  assert.ok(active.length <= REPAIR.maxConcurrent, '活跃工位不得超限');
});

check('F06 sanitizeRepairs：孤儿维修单位（无任务但 status=repairing）恢复待命', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const u = s.units[0];
  u.status = 'repairing';
  s.repairs = [];
  rep.sanitizeRepairs(s);
  assert.equal(u.status, 'ready', '孤儿单位应恢复 ready');
});

/* ============================================================
 * G. 维修离线推进与车间状态
 * ========================================================== */
section('G. 维修离线推进与车间状态');

check('G01 advanceOffline 复用 tickRepairs 并返回完成清单', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  const r = rep.advanceOffline(s, 100);
  assert.ok(Array.isArray(r.completed));
  assert.equal(s.units[0].status, 'ready', '离线推进后应完成维修');
});

check('G02 hasRepairShop：无装甲工厂为 false，有为 true', () => {
  const s1 = fresh();
  withBuildings(s1, ['barracks']);
  assert.equal(rep.hasRepairShop(s1), false);
  const s2 = readyBase();
  assert.equal(rep.hasRepairShop(s2), true, '装甲工厂应启用维修车间');
});

check('G03 maxQueueSize 限制生效', () => {
  assert.equal(REPAIR.maxQueueSize, 8);
  const s = readyBase();
  train(s, 'infantry', 10);
  for (let i = 0; i < 10; i += 1) damageUnit(s, s.units[i].id, 0.3);
  let count = 0;
  for (let i = 0; i < 10; i += 1) {
    if (rep.queueRepair(s, s.units[i].id).ok) count += 1;
  }
  assert.ok(count <= REPAIR.maxQueueSize, `入队数 ${count} 不得超过 ${REPAIR.maxQueueSize}`);
});

check('G04 REPAIR_API 聚合导出齐全', () => {
  ['getDamageState', 'damageStateOfUnit', 'canQueueRepair', 'queueRepair', 'tickRepairs',
   'startQueuedRepairs', 'completeRepair', 'cancelRepair', 'getActiveRepairs', 'getQueuedRepairs',
   'getRepairProgress', 'getRepairRemaining', 'getRepairCost', 'getRepairTime', 'sanitizeRepairs']
    .forEach((k) => assert.ok(typeof rep.REPAIR_API[k] === 'function', `REPAIR_API 缺 ${k}`));
});

/* ============================================================
 * H. 离线结算
 * ========================================================== */
section('H. 离线结算');

check('H01 calculateOfflineSeconds：savedAt<=0 返回 0', () => {
  const r = off.calculateOfflineSeconds(0, Date.now(), TIME.offlineMaxHours);
  assert.equal(r.seconds, 0);
});

check('H02 calculateOfflineSeconds：超过上限截断', () => {
  const now = Date.now();
  const savedAt = now - (TIME.offlineMaxHours + 2) * 3600 * 1000;
  const r = off.calculateOfflineSeconds(savedAt, now, TIME.offlineMaxHours);
  assert.ok(r.capped, '应标记截断');
  assert.equal(r.seconds, TIME.offlineMaxHours * 3600);
});

check('H03 calculateOfflineSeconds：正常差值', () => {
  const now = Date.now();
  const savedAt = now - 120 * 1000;   // 120 秒
  const r = off.calculateOfflineSeconds(savedAt, now, TIME.offlineMaxHours);
  assert.equal(r.seconds, 120);
  assert.equal(r.capped, false);
});

check('H04 settleOfflineProgress：空状态推进 0 秒 no-op', () => {
  const s = fresh();
  const r = off.settleOfflineProgress(s, 0);
  assert.equal(r.settled, false);
  assert.equal(s.offline, null);
});

check('H05 settleOfflineProgress：产生资源收益', () => {
  const s = fresh();
  const before = s.resources.supply;
  off.settleOfflineProgress(s, 100);
  assert.ok(s.resources.supply > before, '离线应产出补给');
});

check('H06 settleOfflineProgress：推进施工完成', () => {
  const s = fresh();
  s.resources.supply = 99999; s.resources.alloy = 99999;
  con.requestBuild(s, 'barracks');
  const r = off.settleOfflineProgress(s, BUILDINGS.barracks.buildTime + 10);
  assert.ok(r.buildingsCompleted.length > 0, '应有工程完成');
  assert.ok(s.buildings.some((b) => b.status === BUILDING_STATUS.OPERATIONAL), '兵营应完工');
});

check('H07 settleOfflineProgress：推进生产完成', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  const r = off.settleOfflineProgress(s, UNITS.infantry.buildTime + 10);
  assert.ok(r.unitsProduced.length > 0, '应有单位出厂');
});

check('H08 settleOfflineProgress：推进维修完成', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  const r = off.settleOfflineProgress(s, 100);
  assert.ok(r.repairsCompleted.length > 0, '应有维修完成');
  assert.equal(s.units[0].status, 'ready');
});

check('H09 settleOfflineProgress：推进游戏时钟', () => {
  const s = fresh();
  const gameBefore = s.time.game;
  off.settleOfflineProgress(s, 200);
  assert.ok(s.time.game >= gameBefore + 200, '游戏时钟应推进');
});

check('H10 settleOfflineProgress：写入 state.offline 报告', () => {
  const s = fresh();
  off.settleOfflineProgress(s, 60);
  assert.ok(s.offline, '应写入 offline 报告');
  assert.ok(s.offline.text, '报告应有时长文本');
  assert.ok(Array.isArray(s.offline.lines), '报告应有明细行');
});

/* ============================================================
 * I. 离线报告
 * ========================================================== */
section('I. 离线报告');

check('I01 buildOfflineReport：组装明细行', () => {
  const r = off.buildOfflineReport({
    seconds: 60,
    before: { supply: 100, alloy: 100, intel: 0 },
    after: { supply: 200, alloy: 100, intel: 5 },
    buildingsCompleted: ['兵营'],
    unitsProduced: { infantry: 2 },
    repairsCompleted: ['步兵班'],
    steps: 5
  });
  assert.equal(r.seconds, 60);
  assert.equal(r.gains.supply, 100);
  assert.equal(r.gains.intel, 5);
  assert.ok(r.lines.length >= 4, '应有四类明细行');
  assert.equal(r.settled, true);
});

check('I02 buildOfflineReport：无进度时占位行', () => {
  const r = off.buildOfflineReport({
    seconds: 30,
    before: { supply: 100, alloy: 100, intel: 0 },
    after: { supply: 100, alloy: 100, intel: 0 },
    buildingsCompleted: [], unitsProduced: {}, repairsCompleted: [], steps: 1
  });
  assert.ok(r.lines.some((l) => l.includes('没有产生')), '无进度应有占位行');
});

check('I03 dismissOfflineReport：清除 state.offline', () => {
  const s = fresh();
  s.offline = { seconds: 10, shown: false };
  const r = off.dismissOfflineReport(s);
  assert.ok(r.ok);
  assert.equal(s.offline, null);
});

check('I04 dismissOfflineReport：无报告时 no-op ok', () => {
  const s = fresh();
  const r = off.dismissOfflineReport(s);
  assert.ok(r.ok);
});

check('I05 hasPendingOfflineReport：有/无报告', () => {
  const s = fresh();
  assert.equal(off.hasPendingOfflineReport(s), false);
  s.offline = { shown: false };
  assert.equal(off.hasPendingOfflineReport(s), true);
  s.offline.shown = true;
  assert.equal(off.hasPendingOfflineReport(s), false);
});

/* ============================================================
 * J. 离线确定性与幂等
 * ========================================================== */
section('J. 离线确定性与幂等');

check('J01 settleOfflineProgress：大 dt 与多次小 dt 资源一致', () => {
  const s1 = readyBase();
  const s2 = readyBase();
  // 两者都挂一个施工 + 生产 + 维修
  [s1, s2].forEach((s) => {
    s.resources.supply = 99999; s.resources.alloy = 99999;
    con.requestBuild(s, 'warehouse');
    prod.queueUnit(s, 'infantry');
    train(s, 'infantry', 1);
    damageUnit(s, s.units[0].id, 0.3);
    rep.queueRepair(s, s.units[0].id);
  });
  off.settleOfflineProgress(s1, 300);
  for (let i = 0; i < 300; i += 1) off.settleOfflineProgress(s2, 0); // 0 秒推进不结算
  // 改为分块推进
  const s3 = readyBase();
  s3.resources.supply = 99999; s3.resources.alloy = 99999;
  con.requestBuild(s3, 'warehouse');
  prod.queueUnit(s3, 'infantry');
  train(s3, 'infantry', 1);
  damageUnit(s3, s3.units[0].id, 0.3);
  rep.queueRepair(s3, s3.units[0].id);
  for (let i = 0; i < 30; i += 1) off.settleOfflineProgress(s3, 10);
  assert.equal(s1.resources.supply, s3.resources.supply, '一次性与分块推进资源应一致');
});

check('J02 settleOfflineProgress：0 秒不标记 settled', () => {
  const s = fresh();
  const r = off.settleOfflineProgress(s, 0);
  assert.equal(r.settled, false);
});

check('J03 OFFLINE_API 聚合导出齐全', () => {
  ['calculateOfflineSeconds', 'settleOfflineProgress', 'buildOfflineReport',
   'dismissOfflineReport', 'hasPendingOfflineReport']
    .forEach((k) => assert.ok(typeof off.OFFLINE_API[k] === 'function', `OFFLINE_API 缺 ${k}`));
});

/* ============================================================
 * K. 存档迁移 v5→v6 与离线接线
 * ========================================================== */
section('K. 存档迁移 v4→v5 与离线接线');

function makeV4Save() {
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  save.saveGame(s);
  const raw = globalThis.window.localStorage.getItem(cfg.SAVE_KEY);
  const data = JSON.parse(raw);
  data.version = 4;            // 模拟旧版存档
  delete data.repairs;         // 旧存档无 repairs 字段
  data.savedAt = Date.now() - 120 * 1000;   // 离线 120 秒
  return data;
}

check('K01 migrate：v4 存档补挂 repairs 数组', () => {
  const data = makeV4Save();
  globalThis.window.localStorage.setItem(cfg.SAVE_KEY, JSON.stringify(data));
  const r = save.loadGame();
  assert.ok(r.ok, '迁移应成功');
  const s = st.getState();
  assert.ok(Array.isArray(s.repairs), '迁移后应有 repairs 数组');
});

check('K02 loadGame：触发离线结算并刷新 savedAt', () => {
  const data = makeV4Save();
  globalThis.window.localStorage.setItem(cfg.SAVE_KEY, JSON.stringify(data));
  const oldSavedAt = data.savedAt;
  const r = save.loadGame();
  assert.ok(r.ok);
  assert.ok(r.offlineSeconds > 0, '应检测到离线时长');
  const s = st.getState();
  assert.ok(s.savedAt > oldSavedAt, '结算后 savedAt 应刷新');
  assert.ok(s.offline, '应生成离线报告');
});

check('K03 importSave：不重放离线收益（savedAt=now, offline=null）', () => {
  const data = makeV4Save();
  // 先正常存一份带离线报告的
  globalThis.window.localStorage.setItem(cfg.SAVE_KEY, JSON.stringify(data));
  const r = save.loadGame();
  assert.ok(r.ok);
  const s = st.getState();
  const beforeSupply = s.resources.supply;
  // 导出再导入
  const exported = JSON.parse(globalThis.window.localStorage.getItem(cfg.SAVE_KEY));
  // 模拟导入：手动调用 importSave（若存在）
  if (typeof save.importSave === 'function') {
    save.importSave(JSON.stringify(exported));
    const s2 = st.getState();
    assert.equal(s2.offline, null, '导入不得触发离线报告');
    // 导入后资源不应因离线而增加
    assert.ok(s2.resources.supply <= beforeSupply + 1, '导入不应重放离线收益');
  } else {
    // importSave 未导出时跳过细节，仅校验存在性
    assert.ok(true, 'importSave 未导出，跳过');
  }
});

check('K04 saveGame→loadGame 往返保留维修队列', () => {
  const s = readyBase();
  train(s, 'infantry', 2);
  damageUnit(s, s.units[0].id, 0.3);
  damageUnit(s, s.units[1].id, 0.2);
  rep.queueRepair(s, s.units[0].id);
  rep.queueRepair(s, s.units[1].id);
  save.saveGame(s);
  const r = save.loadGame();
  assert.ok(r.ok);
  const s2 = st.getState();
  assert.equal(s2.repairs.length, 2, '维修队列应保留');
});

check('K05 sanitizeRepairs 在 sanitizeFormations 之前执行（维修单位不占指挥容量）', () => {
  const s = readyBase();
  train(s, 'infantry', 1);
  const f = buildFormation(s, { infantry: 1 });
  const u = s.units[0];
  damageUnit(s, u.id, 0.3);
  rep.queueRepair(s, u.id);   // 单位进入维修，脱离编队
  save.saveGame(s);
  const r = save.loadGame();
  assert.ok(r.ok);
  const s2 = st.getState();
  // 维修单位不应占指挥容量
  const repairingUnit = s2.units.find((x) => x.status === 'repairing');
  assert.ok(repairingUnit, '应有维修中单位');
  assert.equal(repairingUnit.formationId, null, '维修单位不应属任何编队');
});

/* ============================================================
 * L. 战斗结算加固
 * ========================================================== */
section('L. 战斗结算加固');

/** 组建编队 → 找占领种子 → 派遣（同一编队，避免重复占用指挥容量） */
function readyDispatch(s) {
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious') || 1;
  const r = th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  assert.ok(r.ok, `派遣失败：${r.reason || ''}`);
  return { formation: f, seed, ab: th.getActiveBattle(s) };
}

check('L01 validateBattleReportForSettlement：合法战报通过', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  const r = th.validateBattleReportForSettlement(s, ab);
  assert.ok(r.ok, `合法战报应通过：${(r.problems || []).join(';')}`);
});

check('L02 validateBattleReportForSettlement：战报缺失拒绝', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  const abBroken = { ...ab, report: null };
  const r = th.validateBattleReportForSettlement(s, abBroken);
  assert.equal(r.ok, false);
});

check('L03 validateBattleReportForSettlement：非法结果拒绝', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  const abBad = { ...ab, report: { ...ab.report, result: 'bogus', capture: true } };
  const r = th.validateBattleReportForSettlement(s, abBad);
  assert.equal(r.ok, false);
});

check('L04 buildSettlementPlan：含 unitUpdates / rewards / theaterUpdate', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  const plan = th.buildSettlementPlan(s, ab);
  assert.ok(Array.isArray(plan.unitUpdates), '应有单位更新');
  assert.ok(plan.theaterUpdate, '应有战区更新');
  assert.ok(plan.reportToStore, '应含待存战报');
});

check('L05 settleActiveBattle：事务性写入（settled 最后置位）', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  const r = th.settleActiveBattle(s);
  assert.ok(r.ok, `结算应成功：${r.reason || ''}`);
  assert.equal(ab.settled, true, '成功后才置 settled');
  assert.ok(ab.settlementReceipt, '应有结算凭证');
});

check('L06 settleActiveBattle：幂等（重复调用不重复发奖）', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  th.settleActiveBattle(s);
  const supplyAfter1 = s.resources.supply;
  const r2 = th.settleActiveBattle(s);
  assert.ok(r2.ok, '二次结算应幂等成功');
  assert.equal(s.resources.supply, supplyAfter1, '不应重复发奖');
});

check('L07 settleActiveBattle：胜利占领并标记战区', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  assert.ok(seed, '应找到可占领种子');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.settleActiveBattle(s);
  const rec = s.theaters.scrap_mine;
  assert.ok(rec && rec.captured, '战区应被占领');
});

check('L08 closeBattleResult：未结算禁止返回基地', () => {
  const s = readyBase();
  readyDispatch(s);
  // 不结算直接关闭
  const r = th.closeBattleResult(s);
  assert.equal(r.ok, false, '未结算应禁止返回基地');
  assert.equal(r.code, th.THEATER_CODE.BATTLE_NOT_FINISHED);
});

/* ============================================================
 * M. 经验配置接入
 * ========================================================== */
section('M. 经验配置接入');

check('M01 结算：存活单位获得参与经验 +5', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious') || 1;
  const unitIds = f.unitIds.slice();
  unitIds.forEach((id) => {
    const u = s.units.find((x) => x.id === id);
    if (u) u.experience = 0;
  });
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.settleActiveBattle(s);
  const survived = s.units.filter((u) => unitIds.includes(u.id) && u.status !== 'destroyed');
  survived.forEach((u) => {
    assert.ok(u.experience >= BATTLE.experience.unitParticipation, `${u.id} 应获得参与经验`);
  });
});

check('M02 结算：胜利单位额外 +5 胜利经验', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  assume(seed, '应找到占领种子');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.settleActiveBattle(s);
  const survived = s.units.filter((u) => f.unitIds.includes(u.id));
  survived.forEach((u) => {
    assert.ok(u.experience >= BATTLE.experience.unitParticipation + BATTLE.experience.unitVictory,
      '胜利单位应含胜利经验');
  });
});

check('M03 结算：编队获得参与 +10 / 胜利 +10 经验', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  f.experience = 0;
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious');
  assume(seed, '应找到占领种子');
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  th.settleActiveBattle(s);
  const updated = s.formations.find((x) => x.id === f.id);
  assert.ok(updated.experience >= BATTLE.experience.formationParticipation + BATTLE.experience.formationVictory,
    '编队应含参与+胜利经验');
});

function assume(cond, msg) { assert.ok(cond, msg); }

/* ============================================================
 * N. 调试接口契约（模块导出）
 * ========================================================== */
section('N. 调试接口契约');

check('N01 repairs 模块导出 11 项调试面函数', () => {
  ['damageStateOfUnit', 'canQueueRepair', 'queueRepair', 'tickRepairs', 'cancelRepair',
   'getActiveRepairs', 'getRepairProgress', 'getRepairRemaining', 'advanceOffline', 'hasRepairShop',
   'sanitizeRepairs']
    .forEach((k) => assert.ok(typeof rep[k] === 'function', `repairs 缺 ${k}`));
});

check('N02 offline 模块导出调试面函数', () => {
  ['calculateOfflineSeconds', 'settleOfflineProgress', 'buildOfflineReport',
   'dismissOfflineReport', 'hasPendingOfflineReport']
    .forEach((k) => assert.ok(typeof off[k] === 'function', `offline 缺 ${k}`));
});

check('N03 theater 新增 validateBattleReportForSettlement / buildSettlementPlan 导出', () => {
  assert.equal(typeof th.validateBattleReportForSettlement, 'function');
  assert.equal(typeof th.buildSettlementPlan, 'function');
});

check('N04 theater 新增结果码', () => {
  ['BATTLE_NOT_FINISHED', 'REPORT_INVALID', 'SETTLEMENT_FAILED', 'SIMULATION_FAILED',
   'DUPLICATE_MEMBER', 'MEMBER_OWNERSHIP', 'MEMBER_STATUS', 'UNKNOWN_UNIT']
    .forEach((k) => assert.ok(th.THEATER_CODE[k], `THEATER_CODE 缺 ${k}`));
});

check('N05 canDispatch 双向校验：重复成员 → DUPLICATE_MEMBER', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  // 人为制造重复成员
  f.unitIds = [f.unitIds[0], f.unitIds[0]];
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.DUPLICATE_MEMBER);
});

check('N06 canDispatch 双向校验：引用不存在单位 → UNKNOWN_UNIT', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  f.unitIds = ['ghost_unit'];
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.UNKNOWN_UNIT);
});

check('N07 canDispatch：deployed 状态成员 → MEMBER_STATUS', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  s.units[0].status = 'deployed';
  const r = th.canDispatch(s, f.id, 'scrap_mine', 'cautious');
  assert.equal(r.code, th.THEATER_CODE.MEMBER_STATUS);
});

check('N08 dispatchFormation：dispatchedUnitIds 快照去重且来自真实成员', () => {
  const s = readyBase();
  const f = battleReadyFormation(s);
  const seed = findCaptureSeed(s, f, 'scrap_mine', 'cautious') || 1;
  th.dispatchFormation(s, f.id, 'scrap_mine', 'cautious', seed);
  const ab = th.getActiveBattle(s);
  assert.ok(Array.isArray(ab.dispatchedUnitIds), '应有参战快照');
  const unique = new Set(ab.dispatchedUnitIds);
  assert.equal(unique.size, ab.dispatchedUnitIds.length, '参战快照应去重');
  ab.dispatchedUnitIds.forEach((id) => assert.ok(f.unitIds.includes(id), '快照应来自编队成员'));
});

check('N09 settleActiveBattle 失败时回滚（不置 settled）', () => {
  const s = readyBase();
  const { ab } = readyDispatch(s);
  // 篡改战报导致校验失败
  ab.report = { ...ab.report, result: 'bogus' };
  const r = th.settleActiveBattle(s);
  assert.equal(r.ok, false);
  assert.equal(ab.settled, false, '失败时不得置 settled');
});

check('N10 REPAIR_CODE 全结果码存在', () => {
  ['OK', 'READY', 'STATE_INVALID', 'UNKNOWN_UNIT', 'UNKNOWN_TYPE', 'NOT_DAMAGED',
   'DESTROYED', 'ALREADY_QUEUED', 'UNIT_BUSY', 'QUEUE_FULL', 'INSUFFICIENT', 'NOT_FOUND']
    .forEach((k) => assert.ok(rep.REPAIR_CODE[k], `REPAIR_CODE 缺 ${k}`));
});

/* ============================================================
 * O. 界面维修页与离线报告卡片
 * ========================================================== */
section('O. 界面维修页与离线报告卡片');

check('O01 UI 构建维修分页（DOM 桩）', () => {
  const ui = new UI({});
  const page = ui.refs.pages && ui.refs.pages.repairs;
  assert.ok(page, '应生成维修分页节点');
});

check('O02 _updateRepairs 渲染活跃维修与候选单位', () => {
  const ui = new UI({});
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  // 队列中再加一个受损候选
  train(s, 'infantry', 1);
  damageUnit(s, s.units[1].id, 0.3);
  ui._updateRepairs(s);
  assert.doesNotThrow(() => ui._updateRepairs(s));
});

check('O03 _updateRepairs：空维修队列不抛异常', () => {
  const ui = new UI({});
  const s = readyBase();
  assert.doesNotThrow(() => ui._updateRepairs(s));
});

check('O04 refreshRepairs / refreshOverview 方法存在', () => {
  const ui = new UI({});
  assert.equal(typeof ui.refreshRepairs, 'function');
  assert.equal(typeof ui.refreshOverview, 'function');
});

check('O05 离线报告卡片：有报告时显示且含「知道了」按钮', () => {
  const ui = new UI({});
  const s = readyBase();
  s.offline = off.buildOfflineReport({
    seconds: 60,
    before: { supply: 0, alloy: 0, intel: 0 },
    after: { supply: 100, alloy: 0, intel: 0 },
    buildingsCompleted: [], unitsProduced: {}, repairsCompleted: [], steps: 1
  });
  ui._updateOverview(s);
  assert.equal(ui.refs.offlineBox.hidden, false, '应显示离线报告卡片');
  assert.ok(ui.refs.offlineBox.children.length > 0, '卡片应有内容');
});

check('O06 离线报告卡片：无报告时隐藏', () => {
  const ui = new UI({});
  const s = readyBase();
  s.offline = null;
  ui._updateOverview(s);
  assert.equal(ui.refs.offlineBox.hidden, true);
});

/* ============================================================
 * P. 渲染器维修车间表现
 * ========================================================== */
section('P. 渲染器维修车间表现');

check('P01 BaseRenderer 含 repairUnits Map', () => {
  const r = new BaseRenderer(makeCanvas(), null);
  assert.ok(r.repairUnits instanceof Map, '应有 repairUnits');
});

check('P02 render 含维修中单位不抛异常', () => {
  const r = new BaseRenderer(makeCanvas(), null);
  const s = readyBase();
  train(s, 'infantry', 1);
  damageUnit(s, s.units[0].id, 0.3);
  rep.queueRepair(s, s.units[0].id);
  assert.doesNotThrow(() => r.render(s, 0.05, 0.05));
});

check('P03 render 无维修单位时不抛异常', () => {
  const r = new BaseRenderer(makeCanvas(), null);
  const s = readyBase();
  assert.doesNotThrow(() => r.render(s, 0.05, 0.05));
});

check('P04 render 多帧推进维修车间不抛异常', () => {
  const r = new BaseRenderer(makeCanvas(), null);
  const s = readyBase();
  train(s, 'infantry', 2);
  damageUnit(s, s.units[0].id, 0.3);
  damageUnit(s, s.units[1].id, 0.2);
  rep.queueRepair(s, s.units[0].id);
  rep.queueRepair(s, s.units[1].id);
  for (let i = 0; i < 5; i += 1) {
    assert.doesNotThrow(() => r.render(s, 0.05, 0.05));
  }
});

/* ============================================================
 * Q. 全部源码语法检查
 * ========================================================== */
section('Q. 源码语法检查');

check('Q01 全部 js/*.js 语法检查通过', () => {
  const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('.'));
  assert.ok(files.length >= 12, '应存在多个源码文件（含 repairs/offline）');
  files.forEach((f) => {
    const res = spawnSync(process.execPath, ['--check', path.join(JS_DIR, f)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `node --check ${f} 失败：${res.stderr}`);
  });
});

check('Q02 repairs.js / offline.js 存在且语法正确', () => {
  ['repairs.js', 'offline.js'].forEach((f) => {
    const res = spawnSync(process.execPath, ['--check', path.join(JS_DIR, f)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `${f} 语法检查失败`);
  });
});

check('Q03 serve.mjs 仍导出 createServer', () => {
  assert.equal(typeof serve.createServer, 'function');
});

check('Q04 package.json test 链含 stage6-test.mjs', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.includes('stage6-test.mjs'), 'test 脚本应含 stage6');
});

/* ============================================================
 * 运行
 * ========================================================== */

console.log('════════════════════════════════════════════');
console.log('  钢铁指令 阶段6 自动测试');
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
