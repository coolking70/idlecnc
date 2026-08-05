/**
 * 钢铁指令 · IRON COMMAND —— 阶段3 自动测试
 *
 * 覆盖：阶段标记、阶段1/2 回归、单位解锁、生产资格与错误码、入队扣费与防连点、
 *       队列上限、暂停与速度、完成结算、单位实例、取消返还、库存统计、
 *       存档迁移与容错、无主施工建筑恢复、全文件语法检查。
 *
 * 运行方式（在 iron-command 目录下）：
 *     node tests/stage3-test.mjs
 * 或：  npm test
 *
 * 说明：脚本在 Node 环境用最小 DOM / window 桩运行，只测试逻辑层，不需要浏览器。
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JS_DIR = path.join(ROOT, 'js');

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
  /** 测试辅助：递归查找 */
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
const { UI } = await import('../js/ui.js');

const { BUILDINGS, BUILDING_STATUS, UNITS, PRODUCTION, TIME } = cfg;

/* ============================================================
 * 三、断言与统计工具
 * ========================================================== */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    fail += 1;
    failures.push({ name, message: err && err.message ? err.message : String(err) });
    console.log(`  FAIL  ${name}`);
    console.log(`        → ${err && err.message ? err.message.split('\n')[0] : err}`);
  }
}
function section(title) { console.log(`\n── ${title} ──`); }

/** 固定步长推进：经济 + 施工 + 生产（与 main.js 的逻辑循环一致） */
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

/** 新开一局 */
function fresh() {
  const s = st.resetState();
  eco.recalcDerived(s);
  return s;
}

/** 资源拉满，直接建成指定建筑（跳过施工等待） */
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

/** 一局：兵营 + 装甲工厂都建成，资源充足 */
function readyBase() {
  const s = fresh();
  withBuildings(s, ['barracks', 'armor_factory']);
  s.resources.supply = 5000;
  s.resources.alloy = 5000;
  return s;
}

console.log('════════════════════════════════════════════');
console.log('  钢铁指令 阶段3 自动测试');
console.log('════════════════════════════════════════════');

/* ============================================================
 * 1. 阶段标记与阶段1/2 回归
 * ========================================================== */
section('一、阶段标记与阶段1/2 回归');

check('01 CURRENT_STAGE 已升级（向后兼容 >= 3）', () => {
  assert.ok(cfg.CURRENT_STAGE >= 3, `CURRENT_STAGE=${cfg.CURRENT_STAGE} 应 >= 3`);
});

check('02 SAVE_VERSION 已升级（向后兼容 >= 2）', () => {
  assert.ok(cfg.SAVE_VERSION >= 2, `SAVE_VERSION=${cfg.SAVE_VERSION} 应 >= 2`);
});

check('03 阶段1回归：初始建筑/电力/指挥容量/产量正确', () => {
  const s = fresh();
  assert.equal(s.buildings.length, 2, '初始应有指挥中心 + 发电站');
  assert.equal(s.power.produced, 30);
  assert.equal(s.power.used, 0);
  assert.equal(s.command.capacity, 6);
  assert.equal(s.rates.supply, 2);
  assert.equal(s.caps.supply, 5000);
  const before = s.resources.supply;
  tick(s, 10);
  assert.ok(Math.abs((s.resources.supply - before) - 20) < 0.01, '10秒后补给应 +20');
});

check('04 阶段2回归：五种建筑均可建成且电力不超载', () => {
  const s = fresh();
  s.resources.supply = 99999; s.resources.alloy = 99999; s.resources.intel = 999;
  ['supply_depot', 'alloy_plant', 'barracks', 'armor_factory', 'radar_station'].forEach((id) => {
    const r = con.requestBuild(s, id);
    assert.ok(r.ok, `${BUILDINGS[id].name} 应可批准建设：${r.reason || ''}`);
    tick(s, BUILDINGS[id].buildTime + 0.1);
    const b = s.buildings.find((x) => x.type === id);
    assert.ok(b && b.status === BUILDING_STATUS.OPERATIONAL, `${BUILDINGS[id].name} 应已建成`);
  });
  assert.equal(s.buildings.length, 7);
  assert.equal(s.power.used, 25);
  assert.ok(s.power.used <= s.power.produced, '电力不应超载');
  assert.equal(eco.powerFactor(s), 1);
});

check('05 阶段2回归：取消施工返还 50% 且工地移除', () => {
  const s = fresh();
  con.requestBuild(s, 'supply_depot');
  tick(s, 5);
  const r = con.cancelConstruction(s);
  assert.ok(r.ok);
  assert.equal(r.refund.alloy, 100);
  assert.equal(r.refund.supply, 50);
  assert.equal(s.construction.current, null);
  assert.equal(s.buildings.length, 2);
});

/* ============================================================
 * 2. 单位解锁
 * ========================================================== */
section('二、建筑解锁单位');

check('06 兵营建成后解锁步兵班与反装甲班', () => {
  const s = fresh();
  withBuildings(s, ['barracks']);
  assert.ok(s.unlocks.units.includes('infantry'));
  assert.ok(s.unlocks.units.includes('at_infantry'));
  assert.ok(!s.unlocks.units.includes('mbt'), '未建装甲工厂不应解锁主战坦克');
});

check('07 装甲工厂建成后解锁侦察车/主战坦克/维修车', () => {
  const s = readyBase();
  ['scout_car', 'mbt', 'repair_vehicle'].forEach((u) => {
    assert.ok(s.unlocks.units.includes(u), `${UNITS[u].name} 应已解锁`);
  });
  assert.equal(s.unlocks.units.length, 5, '共解锁 5 种单位');
});

check('08 解锁列表不会出现重复项', () => {
  const s = readyBase();
  con.completeConstruction(s, { id: 'ghost', type: 'barracks', elapsed: 25, duration: 25 });
  assert.equal(s.unlocks.units.filter((u) => u === 'infantry').length, 1);
});

/* ============================================================
 * 3. 生产资格判断与错误码
 * ========================================================== */
section('三、生产资格判断与错误码');

check('09 未知单位类型 → code=unknown', () => {
  const s = readyBase();
  const r = prod.canQueueUnit(s, 'not_exist');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown');
  assert.equal(r.reason, '未知单位类型');
});

check('10 未建兵营 → code=producer_missing 且提示“需要先建成兵营”', () => {
  const s = fresh();
  const r = prod.canQueueUnit(s, 'infantry');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'locked', '首要原因应为未解锁');
  assert.ok(r.reasons.includes('尚未解锁该单位'));
  assert.ok(r.reasons.includes('需要先建成兵营'));
});

check('11 未解锁装甲单位 → 提示“需要先建成装甲工厂”', () => {
  const s = fresh();
  withBuildings(s, ['barracks']);
  const r = prod.canQueueUnit(s, 'mbt');
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('尚未解锁该单位'));
  assert.ok(r.reasons.includes('需要先建成装甲工厂'));
});

check('12 生产建筑未完工 → code=producer_offline', () => {
  const s = fresh();
  s.resources.supply = 99999; s.resources.alloy = 99999;
  con.requestBuild(s, 'barracks');       // 施工中，不是 operational
  s.unlocks.units.push('infantry');      // 人为解锁，隔离出 producer_offline 场景
  const r = prod.canQueueUnit(s, 'infantry');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'producer_offline');
  assert.ok(r.reason.includes('兵营'), `实际文案：${r.reason}`);
});

check('13 资源不足 → code=resource 且带缺口数量', () => {
  const s = readyBase();
  s.resources.supply = 10;
  s.resources.alloy = 0;
  const r = prod.canQueueUnit(s, 'infantry');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'resource');
  assert.equal(r.reason, '补给不足，缺少90');
});

check('14 条件齐备 → ok=true, code=ready', () => {
  const s = readyBase();
  const r = prod.canQueueUnit(s, 'infantry');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.code, 'ready');
  assert.equal(r.reasons.length, 0);
});

check('15 canProduce() 别名与 canQueueUnit 行为一致', () => {
  const s = readyBase();
  const a = prod.canQueueUnit(s, 'mbt');
  const b = prod.canProduce(s, 'mbt');
  assert.equal(a.ok, b.ok);
  assert.equal(a.code, b.code);
});

/* ============================================================
 * 4. 入队、扣费、防连点、队列上限
 * ========================================================== */
section('四、入队 / 扣费 / 队列上限');

check('16 入队立即扣除资源并开始生产', () => {
  const s = readyBase();
  const supply0 = s.resources.supply;
  const r = prod.queueUnit(s, 'infantry');
  assert.ok(r.ok, r.reason);
  assert.ok(Math.abs((supply0 - s.resources.supply) - 100) < 0.01, '应扣除补给 100');
  assert.ok(s.production.current, '应立即进入当前生产线');
  assert.equal(s.production.current.type, 'infantry');
  assert.equal(s.production.current.elapsed, 0);
  assert.equal(s.production.current.duration, 10);
  assert.deepEqual(s.production.current.costPaid, { supply: 100 });
});

check('17 多资源单位扣费正确（反装甲班：补给130 合金30）', () => {
  const s = readyBase();
  const sup0 = s.resources.supply; const al0 = s.resources.alloy;
  prod.queueUnit(s, 'at_infantry');
  assert.ok(Math.abs((sup0 - s.resources.supply) - 130) < 0.01);
  assert.ok(Math.abs((al0 - s.resources.alloy) - 30) < 0.01);
});

check('18 队列上限 5（含当前），第 6 次入队被拒且不扣费', () => {
  const s = readyBase();
  for (let i = 0; i < 5; i += 1) {
    const r = prod.queueUnit(s, 'infantry');
    assert.ok(r.ok, `第 ${i + 1} 项应入队成功：${r.reason || ''}`);
  }
  assert.equal(s.production.queue.length, 4, '等待队列应为 4 项');
  const supplyBefore = s.resources.supply;
  const r6 = prod.queueUnit(s, 'infantry');
  assert.equal(r6.ok, false);
  assert.equal(r6.code, 'queue_full');
  assert.equal(r6.reason, '生产队列已满：最多5项');
  assert.equal(s.resources.supply, supplyBefore, '被拒绝时不得扣费');
  assert.equal(s.production.queue.length, 4);
});

check('19 连点 10 次不会超扣、不会超出上限', () => {
  const s = readyBase();
  const supply0 = s.resources.supply;
  let okCount = 0;
  for (let i = 0; i < 10; i += 1) {
    if (prod.queueUnit(s, 'infantry').ok) okCount += 1;
  }
  assert.equal(okCount, 5, '最多只能成功 5 次');
  assert.ok(Math.abs((supply0 - s.resources.supply) - 500) < 0.01, '总扣费应为 5 × 100');
  assert.equal((s.production.current ? 1 : 0) + s.production.queue.length, 5);
});

check('20 资源不足时入队被拒绝且资源不变', () => {
  const s = readyBase();
  s.resources.supply = 50; s.resources.alloy = 0;
  const before = { ...s.resources };
  const r = prod.queueUnit(s, 'infantry');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'resource');
  assert.deepEqual({ ...s.resources }, before);
  assert.equal(s.production.current, null);
});

check('21 排队任务写入等待队列而不是立即开工', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  prod.queueUnit(s, 'infantry');
  assert.equal(s.production.current.type, 'mbt');
  assert.equal(s.production.queue.length, 1);
  assert.equal(s.production.queue[0].type, 'infantry');
  assert.equal(s.production.queue[0].elapsed, 0, '等待任务不应推进');
});

/* ============================================================
 * 5. 推进、暂停、速度、完成结算
 * ========================================================== */
section('五、推进 / 暂停 / 完成结算');

check('22 暂停（dt=0）时进度完全不推进', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  tick(s, 4);
  const p = prod.currentProgress(s);
  for (let i = 0; i < 20; i += 1) prod.tickProduction(s, 0);
  assert.equal(prod.currentProgress(s), p, '暂停时进度不得变化');
  assert.equal(s.units.length, 0);
});

check('23 1× 推进 5 秒 → 步兵班进度 50%', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  tick(s, 5);
  assert.ok(Math.abs(prod.currentProgress(s) - 0.5) < 0.002, `实际=${prod.currentProgress(s)}`);
});

check('24 帧率无关：不同步长下完成数量一致', () => {
  const a = readyBase(); prod.queueUnit(a, 'infantry'); tick(a, 10.05, 0.05);
  const b = readyBase(); prod.queueUnit(b, 'infantry'); tick(b, 10.05, 0.2);
  assert.equal(a.units.length, b.units.length);
  assert.equal(a.units.length, 1);
  assert.equal(a.stats.unitsBuilt, b.stats.unitsBuilt);
});

check('25 完成时只生成 1 个单位、unitsBuilt 只 +1、日志只写一次', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  tick(s, 10.05);
  assert.equal(s.units.length, 1, '应生成 1 个单位');
  assert.equal(s.stats.unitsBuilt, 1);
  assert.equal(s.production.current, null);
  const doneLogs = s.log.filter((l) => l.text.includes('训练完成')).length;
  assert.equal(doneLogs, 1, '完成日志只应写一次');
});

check('26 重复调用 completeProduction 不重复生成/不重复计数', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  const job = s.production.current;
  tick(s, 10.05);
  prod.completeProduction(s, job);
  prod.completeProduction(s, job);
  assert.equal(s.units.length, 1);
  assert.equal(s.stats.unitsBuilt, 1);
});

check('27 单帧超长 dt 顺序完成多个任务且不越界', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  prod.queueUnit(s, 'infantry');
  prod.queueUnit(s, 'infantry');
  prod.tickProduction(s, 9999);
  assert.equal(s.units.length, 3, '三项都应完成');
  assert.equal(s.stats.unitsBuilt, 3);
  assert.equal(s.production.current, null);
  assert.equal(s.production.queue.length, 0);
});

check('28 当前项完成后自动开工下一项且从 0 开始', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');   // 10 秒
  prod.queueUnit(s, 'mbt');        // 30 秒
  tick(s, 10.05);
  assert.ok(s.production.current, '应自动开工下一项');
  assert.equal(s.production.current.type, 'mbt');
  assert.ok(s.production.current.elapsed < 0.2, '新任务应从 0 开始计时');
  assert.equal(s.production.queue.length, 0);
  assert.equal(s.units.length, 1);
});

check('29 队列全部完成后生产线空闲并写入空闲日志', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  tick(s, 10.05);
  assert.equal(s.production.current, null);
  assert.ok(s.log.some((l) => l.text.includes('已空闲')), '应写入空闲日志');
});

/* ============================================================
 * 6. 单位实例
 * ========================================================== */
section('六、单位实例');

check('30 单位实例字段完整且数值来自 UNITS 配置', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  tick(s, 30.05);
  const u = s.units[0];
  assert.equal(u.type, 'mbt');
  assert.equal(u.hp, UNITS.mbt.stats.hp);
  assert.equal(u.maxHp, UNITS.mbt.stats.hp);
  assert.equal(u.damage, 'intact');
  assert.equal(u.status, 'ready');
  assert.equal(u.formationId, null);
  assert.equal(u.experience, 0);
  assert.equal(u.battles, 0);
  assert.ok(Number.isFinite(u.createdAt));
  const factory = s.buildings.find((b) => b.type === 'armor_factory');
  assert.equal(u.sourceBuildingId, factory.id, '应记录来源建筑');
});

check('31 连续生产的单位实例 ID 唯一', () => {
  const s = readyBase();
  for (let i = 0; i < 5; i += 1) prod.queueUnit(s, 'infantry');
  prod.tickProduction(s, 9999);
  assert.equal(s.units.length, 5);
  const ids = new Set(s.units.map((u) => u.id));
  assert.equal(ids.size, 5, 'ID 不应重复');
});

check('32 单位实例可 JSON 序列化（可存档）', () => {
  const s = readyBase();
  prod.queueUnit(s, 'scout_car');
  tick(s, 18.05);
  const text = JSON.stringify(s.units[0]);
  const back = JSON.parse(text);
  assert.equal(back.type, 'scout_car');
  assert.equal(back.hp, UNITS.scout_car.stats.hp);
});

check('33 五种单位都能被正确生产出来', () => {
  const s = readyBase();
  s.resources.supply = 99999; s.resources.alloy = 99999;
  Object.keys(UNITS).forEach((id) => {
    const r = prod.queueUnit(s, id);
    assert.ok(r.ok, `${UNITS[id].name} 应可入队：${r.reason || ''}`);
    prod.tickProduction(s, UNITS[id].buildTime + 1);
  });
  assert.equal(s.units.length, 5);
  const types = s.units.map((u) => u.type).sort();
  assert.deepEqual(types, Object.keys(UNITS).slice().sort());
});

/* ============================================================
 * 7. 取消生产与返还
 * ========================================================== */
section('七、取消生产与返还');

check('34 取消当前生产返还 50% 成本', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');            // 补给220 合金300
  tick(s, 12);
  const sup = s.resources.supply; const al = s.resources.alloy;
  const r = prod.cancelCurrentProduction(s);
  assert.ok(r.ok);
  assert.equal(r.refund.supply, 110);
  assert.equal(r.refund.alloy, 150);
  assert.ok(Math.abs((s.resources.supply - sup) - 110) < 0.01);
  assert.ok(Math.abs((s.resources.alloy - al) - 150) < 0.01);
  assert.equal(s.production.current, null);
  assert.equal(s.units.length, 0, '取消不得生成单位');
  assert.equal(s.stats.unitsBuilt, 0, '取消不得增加统计');
});

check('35 取消等待任务返还 100% 且不影响当前生产', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  prod.queueUnit(s, 'at_infantry');    // 补给130 合金30
  tick(s, 5);
  const curElapsed = s.production.current.elapsed;
  const jobId = s.production.queue[0].id;
  const sup = s.resources.supply; const al = s.resources.alloy;
  const r = prod.cancelQueuedProduction(s, jobId);
  assert.ok(r.ok);
  assert.equal(r.refund.supply, 130);
  assert.equal(r.refund.alloy, 30);
  assert.ok(Math.abs((s.resources.supply - sup) - 130) < 0.01);
  assert.equal(s.production.queue.length, 0);
  assert.equal(s.production.current.type, 'mbt', '当前生产不受影响');
  assert.equal(s.production.current.elapsed, curElapsed, '当前进度不应被重置');
});

check('36 连续点击取消不会重复返还', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  prod.cancelCurrentProduction(s);
  const after = s.resources.supply;
  const r2 = prod.cancelCurrentProduction(s);
  const r3 = prod.cancelCurrentProduction(s);
  assert.equal(r2.ok, false);
  assert.equal(r3.ok, false);
  assert.equal(s.resources.supply, after, '重复取消不应再次返还');
});

check('37 取消等待任务用不存在的 ID 返回失败对象而不抛异常', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry');
  const r = prod.cancelQueuedProduction(s, 'job_not_exist');
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

check('38 返还被资源上限钳制，不会溢出', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  s.resources.supply = s.caps.supply;
  s.resources.alloy = s.caps.alloy;
  prod.cancelCurrentProduction(s);
  assert.ok(s.resources.supply <= s.caps.supply);
  assert.ok(s.resources.alloy <= s.caps.alloy);
});

check('39 取消当前后自动开工下一项等待任务', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  prod.queueUnit(s, 'infantry');
  prod.cancelCurrentProduction(s);
  assert.ok(s.production.current, '应自动开工下一项');
  assert.equal(s.production.current.type, 'infantry');
  assert.equal(s.production.queue.length, 0);
});

/* ============================================================
 * 8. 库存
 * ========================================================== */
section('八、单位库存');

check('40 inventoryCount 实时按类型统计', () => {
  const s = readyBase();
  s.resources.supply = 99999; s.resources.alloy = 99999;
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);
  prod.queueUnit(s, 'mbt');      prod.tickProduction(s, 99);
  const inv = prod.inventoryCount(s);
  assert.equal(inv.infantry, 2);
  assert.equal(inv.mbt, 1);
  assert.equal(inv.scout_car, undefined);
  assert.equal(s.units.length, 3);
});

check('41 availableUnits 只返回空闲单位', () => {
  const s = readyBase();
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);
  s.units[0].formationId = 'f1';
  s.units[0].status = 'assigned';
  assert.equal(prod.availableUnits(s).length, 1);
});

check('42 库存单位不占用指挥容量', () => {
  const s = readyBase();
  const usedBefore = s.command.used;
  s.resources.supply = 99999; s.resources.alloy = 99999;
  for (let i = 0; i < 4; i += 1) { prod.queueUnit(s, 'mbt'); prod.tickProduction(s, 99); }
  eco.recalcDerived(s);
  assert.equal(s.units.length, 4);
  assert.equal(s.command.used, usedBefore, '库存不得占用指挥容量');
});

/* ============================================================
 * 9. 进度查询接口
 * ========================================================== */
section('九、进度查询接口');

check('43 空闲时 getProductionProgress 返回 null', () => {
  const s = readyBase();
  assert.equal(prod.getProductionProgress(s), null);
  assert.equal(prod.currentProgress(s), null);
});

check('44 生产中返回完整进度信息且不含 undefined', () => {
  const s = readyBase();
  prod.queueUnit(s, 'mbt');
  tick(s, 12);
  const p = prod.getProductionProgress(s);
  assert.equal(p.name, '主战坦克');
  assert.equal(p.typeId, 'mbt');
  assert.equal(p.duration, 30);
  assert.equal(p.percent, 40);
  assert.ok(Math.abs(p.remaining - 18) < 0.06, `剩余=${p.remaining}`);
  assert.equal(p.sourceBuildingName, '装甲工厂');
  assert.ok(!JSON.stringify(p).includes('undefined'));
});

/* ============================================================
 * 10. 存档：保存 / 恢复 / 迁移 / 容错
 * ========================================================== */
section('十、存档与迁移');

check('45 生产半途保存后读档：进度、队列、库存都被还原', () => {
  store.clear();
  const s = readyBase();
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);   // 先攒 1 个库存
  prod.queueUnit(s, 'mbt');
  prod.queueUnit(s, 'at_infantry');
  tick(s, 12);
  const beforePct = prod.getProductionProgress(s).percent;
  assert.ok(save.saveGame(s, { silent: true }), '保存应成功');

  const loaded = save.loadGame();
  assert.ok(loaded.ok, loaded.reason);
  const s2 = loaded.state;
  assert.equal(s2.version, cfg.SAVE_VERSION, '存档版本应迁移到当前 SAVE_VERSION');
  assert.ok(s2.production.current, '当前生产应被恢复');
  assert.equal(s2.production.current.type, 'mbt');
  assert.equal(prod.getProductionProgress(s2).percent, beforePct, '进度应保持');
  assert.equal(s2.production.queue.length, 1);
  assert.equal(s2.production.queue[0].type, 'at_infantry');
  assert.equal(s2.units.length, 1, '库存应保留');
  assert.equal(s2.units[0].type, 'infantry');
  // 读档后继续推进能正常完成
  tick(s2, 18.5);
  assert.equal(s2.units.length, 2, '恢复后应能继续完成生产');
});

check('46 阶段2 旧档（version 1，无 production/units）可正常加载', () => {
  const old = {
    version: 1,
    createdAt: Date.now() - 100000,
    savedAt: Date.now() - 1000,
    time: { game: 30000, played: 500, speed: 2, lastSpeed: 2 },
    resources: { supply: 800, alloy: 700, intel: 15 },
    buildings: [
      { id: 'b1', type: 'command_center', status: 'operational', progress: 1 },
      { id: 'b2', type: 'power_plant', status: 'operational', progress: 1 },
      { id: 'b3', type: 'barracks', status: 'operational', progress: 1 }
    ],
    construction: { current: null, queue: [] },
    unlocks: { units: [], techs: [] },
    log: [],
    stats: { buildingsBuilt: 1 }
  };
  const report = {};
  const m = save.migrate(old, report);
  assert.equal(m.version, cfg.SAVE_VERSION, '应迁移到当前 SAVE_VERSION');
  assert.deepEqual(m.production, { current: null, queue: [] }, '应补齐生产结构');
  assert.deepEqual(m.units, [], '应补齐单位库存');
  assert.equal(m.time.lastSpeed, 2, '阶段2 的 lastSpeed 恢复不应被破坏');
  assert.ok(m.unlocks.units.includes('infantry'), '兵营应重新校准出解锁');
  assert.ok(m.unlocks.units.includes('at_infantry'));
});

check('47 reconcileUnlocksFromBuildings：按建筑重建解锁并过滤非法单位', () => {
  const s = fresh();
  s.buildings.push(st.createBuilding('barracks'));
  s.buildings.push(st.createBuilding('armor_factory', BUILDING_STATUS.UNDER_CONSTRUCTION));
  s.unlocks.units = ['ghost_unit', 'infantry'];   // 含非法 ID 与重复项
  save.reconcileUnlocksFromBuildings(s);
  assert.ok(!s.unlocks.units.includes('ghost_unit'), '非法单位 ID 应被过滤');
  assert.ok(s.unlocks.units.includes('infantry'));
  assert.ok(s.unlocks.units.includes('at_infantry'));
  assert.ok(!s.unlocks.units.includes('mbt'), '未完工的装甲工厂不应解锁单位');
  assert.equal(new Set(s.unlocks.units).size, s.unlocks.units.length, '不应有重复项');
});

check('48 施工完成后解锁被重新校准（丢失的解锁会补回）', () => {
  const s = readyBase();
  s.unlocks.units = [];                    // 模拟旧档解锁丢失
  save.reconcileUnlocksFromBuildings(s);
  assert.equal(s.unlocks.units.length, 5);
  assert.ok(prod.canQueueUnit(s, 'mbt').ok, '解锁恢复后应可生产');
});

check('49 损坏的生产数据不抛异常且被自动修复（阶段4 容错）', () => {
  const s = readyBase();
  const factory = s.buildings.find((b) => b.type === 'armor_factory');
  s.production = {
    current: { id: 'j1', type: 'not_a_unit', elapsed: 5, duration: 10, sourceBuildingId: factory.id, costPaid: {} },
    queue: [
      null,
      { id: 'j2', type: 'mbt', elapsed: -5, duration: 0, sourceBuildingId: factory.id, costPaid: { alloy: 300 } },
      { id: 'j3', type: 'mbt', elapsed: 1, duration: 30, sourceBuildingId: 'no_such_building', costPaid: { alloy: 300 } },
      { id: 'j4', type: 'mbt', elapsed: 1, duration: 30, sourceBuildingId: factory.id, costPaid: { evil: 'x' } },
      { id: 'j5', type: 'mbt', elapsed: 1, duration: 30, sourceBuildingId: factory.id, costPaid: { alloy: 300, supply: 220 } },
      { id: 'j5', type: 'mbt', elapsed: 1, duration: 30, sourceBuildingId: factory.id, costPaid: { alloy: 300, supply: 220 } }
    ]
  };
  s.units = [
    { id: 'u1', type: 'infantry', hp: 100 },
    { id: 'u1', type: 'infantry', hp: 100 },        // 重复 ID
    { id: 'u2', type: 'ghost', hp: 100 },           // 非法类型
    { id: 'u3', type: 'infantry', hp: NaN },        // 非法生命值
    'not-an-object'
  ];
  let fix = null;
  assert.doesNotThrow(() => { fix = prod.sanitizeProduction(s); });
  assert.equal(fix.repaired, true);
  assert.ok(fix.notes.length > 0, '应记录修复项');
  // 非法当前任务（not_a_unit）被清除，随后因队列非空自动恢复为 j2
  assert.equal(s.production.current.id, 'j2', '队列首项（j2）应被恢复为当前任务');
  assert.equal(s.production.current.type, 'mbt', '非法类型任务应被替换');
  assert.equal(s.production.current.duration, UNITS.mbt.buildTime, '时长应规范化为单位配置');
  assert.deepEqual(s.production.current.costPaid, UNITS.mbt.cost, '成本应规范化为单位配置');
  // j3（建筑不存在）/j4（成本非法）被移除；j5 重复 ID 只保留一个
  assert.equal(s.production.queue.length, 1, '队列应只保留 j5（去重后）');
  assert.equal(s.production.queue[0].id, 'j5');
  // 单位：非法类型/非对象被移除；重复 ID 重新生成而非删除
  const ids = s.units.map((u) => u.id);
  assert.equal(s.units.length, 3, '应保留 3 个单位（u1、u1重复重生成、u3）');
  assert.ok(ids.includes('u1') && ids.includes('u3'), 'u1 与 u3 应保留');
  assert.equal(new Set(ids).size, ids.length, '单位 ID 应唯一');
  const u3 = s.units.find((u) => u.id === 'u3');
  assert.equal(u3.hp, UNITS.infantry.stats.hp, 'NaN 生命值应恢复为满血');
  s.units.forEach((u) => assert.equal(u.maxHp, UNITS[u.type].stats.hp, 'maxHp 应恢复为配置值'));
});

check('50 生产队列超上限时被裁剪到 maxQueueSize', () => {
  const s = readyBase();
  const b = s.buildings.find((x) => x.type === 'barracks');
  const mk = (i) => ({ id: `q${i}`, type: 'infantry', elapsed: 0, duration: 10, sourceBuildingId: b.id, costPaid: { supply: 100 } });
  s.production = { current: mk(0), queue: [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7)] };
  const fix = prod.sanitizeProduction(s);
  assert.equal(fix.repaired, true);
  assert.equal(s.production.queue.length, PRODUCTION.maxQueueSize - 1, '当前 + 等待 ≤ 5');
});

check('51 完全损坏的存档 JSON 不会让 loadGame 抛异常', () => {
  store.clear();
  store.set(cfg.SAVE_KEY, '{ this is not json');
  let res = null;
  assert.doesNotThrow(() => { res = save.loadGame(); });
  assert.equal(res.ok, false);
  assert.ok(res.reason);
});

check('52 生产数据为字符串等非法类型时被重建为空结构', () => {
  const raw = {
    version: 2,
    time: { game: 100, speed: 1, lastSpeed: 1 },
    resources: { supply: 100, alloy: 100, intel: 1 },
    buildings: [{ id: 'b1', type: 'command_center', status: 'operational', progress: 1 }],
    production: 'broken',
    units: 'broken'
  };
  let m = null;
  assert.doesNotThrow(() => { m = save.migrate(raw, {}); });
  assert.deepEqual(m.production, { current: null, queue: [] });
  assert.deepEqual(m.units, []);
});

/* ============================================================
 * 11. 无主施工建筑恢复（阶段3必须修复项）
 * ========================================================== */
section('十一、无主施工建筑恢复');

check('53 单座无主施工建筑：重建施工任务，绝不免费落成', () => {
  const s = fresh();
  s.buildings.push({
    id: 'orphan1', type: 'alloy_plant', status: BUILDING_STATUS.UNDER_CONSTRUCTION,
    progress: 0.4, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { ...BUILDINGS.alloy_plant.slot }
  });
  s.construction = { current: null, queue: [] };
  const fix = con.sanitizeConstruction(s);
  assert.equal(fix.repaired, true);
  const b = s.buildings.find((x) => x.id === 'orphan1');
  assert.equal(b.status, BUILDING_STATUS.UNDER_CONSTRUCTION, '不得直接变成已建成');
  assert.ok(s.construction.current, '应重建施工任务');
  assert.equal(s.construction.current.id, 'orphan1');
  assert.equal(s.construction.current.duration, BUILDINGS.alloy_plant.buildTime);
  assert.ok(Math.abs(s.construction.current.elapsed - 12) < 0.01, '进度 40% → 已施工 12 秒');
  assert.ok(fix.notes.some((n) => n.includes('已恢复中断的施工任务')));
});

check('54 无主施工建筑进度非法时被钳制到 0~1', () => {
  const s = fresh();
  s.buildings.push({
    id: 'orphan2', type: 'barracks', status: BUILDING_STATUS.UNDER_CONSTRUCTION,
    progress: 9.9, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { ...BUILDINGS.barracks.slot }
  });
  s.construction = { current: null, queue: [] };
  con.sanitizeConstruction(s);
  const job = s.construction.current;
  assert.ok(job, '应重建任务');
  assert.ok(job.elapsed <= job.duration, '已施工时间不得超过总时长');
  assert.equal(s.buildings.find((x) => x.id === 'orphan2').progress, 1);
});

check('55 多座无主施工建筑：只恢复一座，其余被移除', () => {
  const s = fresh();
  ['alloy_plant', 'barracks', 'radar_station'].forEach((t, i) => {
    s.buildings.push({
      id: `orphan_${i}`, type: t, status: BUILDING_STATUS.UNDER_CONSTRUCTION,
      progress: 0.2, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { ...BUILDINGS[t].slot }
    });
  });
  s.construction = { current: null, queue: [] };
  const fix = con.sanitizeConstruction(s);
  const stillBuilding = s.buildings.filter((b) => b.status === BUILDING_STATUS.UNDER_CONSTRUCTION);
  assert.equal(stillBuilding.length, 1, '只应保留一座施工中建筑');
  assert.equal(s.construction.current.id, stillBuilding[0].id);
  assert.ok(fix.notes.some((n) => n.includes('多余施工建筑')));
  assert.equal(s.buildings.filter((b) => b.status === BUILDING_STATUS.OPERATIONAL).length, 2,
    '不得把多余工地白送成已建成建筑');
});

check('56 任务与建筑类型不匹配：清除任务后尝试重建，不白嫖落成', () => {
  const s = fresh();
  s.buildings.push({
    id: 'mis1', type: 'barracks', status: BUILDING_STATUS.UNDER_CONSTRUCTION,
    progress: 0.5, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { ...BUILDINGS.barracks.slot }
  });
  s.construction = { current: { id: 'mis1', type: 'radar_station', elapsed: 10, duration: 35 }, queue: [] };
  const fix = con.sanitizeConstruction(s);
  assert.ok(fix.notes.some((n) => n.includes('不匹配')));
  const b = s.buildings.find((x) => x.id === 'mis1');
  assert.equal(b.status, BUILDING_STATUS.UNDER_CONSTRUCTION, '不得直接落成');
  assert.ok(s.construction.current, '应按建筑真实类型重建任务');
  assert.equal(s.construction.current.type, 'barracks');
  assert.equal(s.construction.current.duration, BUILDINGS.barracks.buildTime);
});

check('57 未知建筑类型的无主工地被移除且绝不落成', () => {
  const s = fresh();
  s.buildings.push({
    id: 'ghost1', type: 'alien_base', status: BUILDING_STATUS.UNDER_CONSTRUCTION,
    progress: 0.7, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { gx: 0, gy: 0, w: 2, h: 2, height: 10 }
  });
  s.construction = { current: null, queue: [] };
  const fix = con.sanitizeConstruction(s);
  assert.equal(s.buildings.find((x) => x.id === 'ghost1'), undefined, '未知类型工地应被移除');
  assert.equal(s.construction.current, null);
  assert.ok(fix.notes.some((n) => n.includes('无合法施工建筑可恢复')));
});

check('58 读档时无主施工建筑恢复后能正常继续施工完成', () => {
  const raw = {
    version: 1,
    time: { game: 100, speed: 1, lastSpeed: 1 },
    resources: { supply: 500, alloy: 500, intel: 10 },
    buildings: [
      { id: 'b1', type: 'command_center', status: 'operational', progress: 1 },
      { id: 'b2', type: 'power_plant', status: 'operational', progress: 1 },
      { id: 'b3', type: 'barracks', status: 'under_construction', progress: 0.8 }
    ],
    construction: { current: null, queue: [] }
  };
  const report = {};
  const m = save.migrate(raw, report);
  eco.recalcDerived(m);
  assert.ok(m.construction.current, '读档后应恢复施工任务');
  assert.equal(m.construction.current.type, 'barracks');
  const supplyBefore = m.resources.supply;
  tick(m, 6);
  const barracks = m.buildings.find((b) => b.type === 'barracks');
  assert.equal(barracks.status, BUILDING_STATUS.OPERATIONAL, '剩余 20% 施工完成后应建成');
  assert.ok(m.resources.supply > supplyBefore - 1, '恢复施工不得重复扣费');
  save.reconcileUnlocksFromBuildings(m);
  assert.ok(m.unlocks.units.includes('infantry'), '建成后解锁应生效');
});

/* ============================================================
 * 12. UI 生产页构建（DOM 桩）
 * ========================================================== */
section('十二、生产页构建');

check('59 生产页可构建，5 张单位卡片齐全且不抛异常', () => {
  const s = readyBase();
  let ui = null;
  assert.doesNotThrow(() => {
    ui = new UI({ onProduce() {}, onCancelCurrentProduction() {}, onCancelQueuedProduction() {} });
    ui.refreshProduction(s);
  });
  const p = ui.refs.prod;
  assert.ok(p, '生产页引用应存在');
  assert.equal(Object.keys(p.cards).length, 5, '应有 5 张单位卡片');
  Object.keys(UNITS).forEach((id) => assert.ok(p.cards[id], `缺少 ${UNITS[id].name} 卡片`));
});

check('60 生产页刷新时按钮禁用状态与禁用原因正确', () => {
  const s = readyBase();
  const ui = new UI({ onProduce() {}, onCancelCurrentProduction() {}, onCancelQueuedProduction() {} });
  ui.refreshProduction(s);
  ui.refreshProduction(s);
  assert.equal(ui.refs.prod.cards.infantry.btn.disabled, false, '资源充足时按钮应可用');

  s.resources.supply = 0; s.resources.alloy = 0;
  ui.refreshProduction(s);
  const card = ui.refs.prod.cards.infantry;
  assert.equal(card.btn.disabled, true, '资源不足时按钮应禁用');
  assert.equal(card.reason.hidden, false, '应显示禁用原因');
  assert.ok(card.reason.textContent.includes('补给不足'), `实际：${card.reason.textContent}`);
});

check('61 生产中刷新：进度条百分比与库存数量正确显示', () => {
  const s = readyBase();
  const ui = new UI({ onProduce() {}, onCancelCurrentProduction() {}, onCancelQueuedProduction() {} });
  ui.refreshProduction(s);
  prod.queueUnit(s, 'infantry'); prod.tickProduction(s, 99);   // 库存 1
  prod.queueUnit(s, 'mbt');
  tick(s, 15);
  ui.refreshProduction(s);
  const p = ui.refs.prod;
  assert.equal(p.activeBox.hidden, false, '应显示生产中面板');
  assert.equal(p.idleBox.hidden, true);
  assert.equal(p.linePercent.textContent, '50%');
  assert.equal(p.lineBar.style.width, '50%');
  assert.equal(p.cards.infantry.invCount.textContent, '1', '步兵班库存应为 1');
  assert.equal(p.invTotal.textContent, '1');
});

/* ============================================================
 * 13. 语法检查
 * ========================================================== */
section('十三、全部源码语法检查');

check('62 js/ 目录下所有模块通过 node --check', () => {
  const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length >= 10, `应检查到足够多的模块，实际 ${files.length} 个`);
  const bad = [];
  files.forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(JS_DIR, f)], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${String(r.stderr).split('\n')[0]}`);
  });
  assert.equal(bad.length, 0, `语法错误：\n${bad.join('\n')}`);
});

check('63 tests/ 与自身脚本语法正常', () => {
  const r = spawnSync(process.execPath, ['--check', path.join(HERE, 'stage3-test.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, String(r.stderr));
});

/* ============================================================
 * 汇总
 * ========================================================== */

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
