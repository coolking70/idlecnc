/** 阶段8.1：RTS 展示、镜头与结算后返航流程。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfg from '../js/config.js';
import * as st from '../js/state.js';
import * as econ from '../js/economy.js';
import * as theater from '../js/theater.js';
import { createBattleVisualPlan, getVisualActorsAtTime, getVisualEffectsAtTime, validateVisualPlan, BATTLE_WORLD } from '../js/battle-visual-director.js';
import { CAMERA_MODES, createBattleCamera, getBattleCamera, setBattleCameraMode, validateBattleCamera } from '../js/battle-camera.js';
import { BattleRenderer } from '../js/battle-renderer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let total = 0; let passed = 0; const failures = [];
function check(name, fn) { total += 1; try { fn(); passed += 1; console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`); } catch (err) { failures.push({ name, err }); console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}\n        → ${err.message}`); } }
function freshBattle() {
  const s = st.createInitialState();
  s.buildings.push({ id: 'radar-1', type: 'radar_station', status: cfg.BUILDING_STATUS.OPERATIONAL, progress: 1 });
  s.units = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'].map((type, i) => ({ id: `u-${i}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'f', experience: 0, battles: 0, createdAt: 1 }));
  s.formations = [{ id: 'f', name: '阶段8.1测试编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: s.units.map((u) => u.id), experience: 0, battles: 0 }];
  econ.recalcDerived(s); return s;
}
function reportFixture(terrain = 'open') { return { seed: 1234, duration: 48, terrain, theaterId: terrain, initial: { friendly: [{ id: 'f1', side: 'friendly', realId: 'u1', type: 'infantry', category: 'infantry', shape: 'infantry', hp: 100, maxHp: 100 }, { id: 'f2', side: 'friendly', type: 'mbt', category: 'armor', shape: 'tank', hp: 180, maxHp: 180 }, { id: 'f3', side: 'friendly', type: 'repair', category: 'support', shape: 'repair', hp: 80, maxHp: 80 }], enemy: [{ id: 'e1', side: 'enemy', type: 'infantry', category: 'infantry', shape: 'infantry', hp: 100, maxHp: 100 }, { id: 'e2', side: 'enemy', type: 'armor', category: 'armor', shape: 'tank', hp: 180, maxHp: 180 }] }, events: [{ id: 'fire1', type: 'fire', t: 12, actorId: 'f2', targetId: 'e2', amount: 0 }, { id: 'damage1', type: 'damage', t: 13, actorId: 'f2', targetId: 'e2', amount: 40 }, { id: 'destroy1', type: 'destroy', t: 31, actorId: 'f2', targetId: 'e1', amount: 0 }, { id: 'repair1', type: 'repair', t: 35, actorId: 'f3', targetId: 'f2', amount: 8 }] }; }
function canvasStub() { const gradient = { addColorStop() {} }; const ctx = new Proxy({ createLinearGradient: () => gradient, setLineDash() {} }, { get(target, key) { if (key in target) return target[key]; return (...args) => {}; }, set(target, key, value) { target[key] = value; return true; } }); return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: 920, height: 520 }) }; }

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.1 自动测试');
console.log('════════════════════════════════════════════');

console.log('\n── A. 阶段标记与视觉模块 ──');
check('A01 CURRENT_STAGE 已晋升为9', () => assert.equal(cfg.CURRENT_STAGE, 9));
check('A02 SAVE_VERSION 已递增到10', () => assert.equal(cfg.SAVE_VERSION, 10));
check('A03 package 版本已晋升为0.9.0', () => assert.equal(JSON.parse(readFileSync(path.join(ROOT, 'package.json'))).version, '0.9.0'));
check('A04 战场世界坐标为1200×700', () => assert.deepEqual(BATTLE_WORLD, { width: 1200, height: 700 }));
check('A05 导演/镜头/渲染器公开函数存在', () => { assert.equal(typeof createBattleVisualPlan, 'function'); assert.equal(typeof createBattleCamera, 'function'); assert.equal(typeof BattleRenderer, 'function'); });
check('A06 计划确定性：同一战报得到完全相同JSON', () => assert.deepEqual(createBattleVisualPlan(reportFixture()), createBattleVisualPlan(reportFixture())));
check('A07 创建计划不修改战报', () => { const r = reportFixture(); const before = JSON.stringify(r); createBattleVisualPlan(r); assert.equal(JSON.stringify(r), before); });
check('A08 计划校验通过且路线不是单线', () => { const p = createBattleVisualPlan(reportFixture()); assert.equal(validateVisualPlan(p).ok, true); assert.ok(new Set(p.actors.map((a) => a.route[0].y)).size >= 3); });

console.log('\n── B. RTS 展示结构与权威事件 ──');
check('B01 步兵显示4名成员', () => { const a = createBattleVisualPlan(reportFixture()).actors.find((x) => x.id === 'f1'); assert.equal(a.visualMembers.length, 4); });
check('B02 反装甲组显示3名成员', () => { const r = reportFixture(); r.initial.friendly.push({ id: 'f4', side: 'friendly', category: 'at_infantry', shape: 'at', hp: 70, maxHp: 70 }); const a = createBattleVisualPlan(r).actors.find((x) => x.id === 'f4'); assert.equal(a.visualMembers.length, 3); });
check('B03 装甲/侦察/维修车各自有独立类别', () => { const p = createBattleVisualPlan(reportFixture()); assert.deepEqual(p.actors.filter((a) => a.side === 'friendly').map((a) => a.category), ['infantry', 'tank', 'repair']); });
check('B04 中段至少有3个友军持续可见', () => { const p = createBattleVisualPlan(reportFixture()); assert.ok(getVisualActorsAtTime(p, 24).filter((a) => a.side === 'friendly' && a.alive).length >= 3); });
check('B05 只有DAMAGE改变hp', () => { const p = createBattleVisualPlan(reportFixture()); const before = getVisualActorsAtTime(p, 12).find((a) => a.id === 'e2').hp; const after = getVisualActorsAtTime(p, 14).find((a) => a.id === 'e2').hp; assert.equal(before, 180); assert.equal(after, 140); });
check('B06 DESTROY才让目标死亡', () => { const p = createBattleVisualPlan(reportFixture()); assert.equal(getVisualActorsAtTime(p, 30).find((a) => a.id === 'e1').alive, true); assert.equal(getVisualActorsAtTime(p, 32).find((a) => a.id === 'e1').alive, false); });
check('B07 装饰命中不带权威标记', () => { const p = createBattleVisualPlan(reportFixture()); assert.ok(p.decorative.some((x) => x.type === 'cover_hit')); assert.ok(getVisualEffectsAtTime(p, 24).every((x) => x.type !== 'cover_hit' || x.authoritative === false)); });
check('B08 FIRE/REPAIR不直接修改hp', () => { const p = createBattleVisualPlan(reportFixture()); const hp = getVisualActorsAtTime(p, 36).find((a) => a.id === 'e2').hp; assert.equal(hp, 140); assert.ok(getVisualEffectsAtTime(p, 36).some((x) => x.type === 'repair' && x.authoritative === false)); });
check('B09 计划中没有round展示阶段', () => { const p = createBattleVisualPlan(reportFixture()); assert.deepEqual(p.phases.map((x) => x.id), ['scout', 'approach', 'engage', 'resolve']); });
check('B10 地形道具随open/fortified变化', () => { const open = createBattleVisualPlan(reportFixture('open')); const fort = createBattleVisualPlan(reportFixture('fortified')); assert.notDeepEqual(open.map.props.map((x) => x.kind), fort.map.props.map((x) => x.kind)); });

console.log('\n── C. 镜头与只读渲染 ──');
check('C01 镜头支持总览/聚焦/打击/结果', () => { const p = createBattleVisualPlan(reportFixture()); const c = createBattleCamera(p); [CAMERA_MODES.overview, CAMERA_MODES.focus, CAMERA_MODES.impact, CAMERA_MODES.result].forEach((m) => { setBattleCameraMode(c, m, 'f2'); assert.equal(c.mode, m); }); });
check('C02 镜头结果模式回到战场中心', () => { const p = createBattleVisualPlan(reportFixture()); const c = createBattleCamera(p); setBattleCameraMode(c, CAMERA_MODES.result); const x = getBattleCamera(c, p, 20); assert.ok(Math.abs(x.x - 600) < 100); });
check('C03 镜头状态可校验', () => { const c = createBattleCamera(createBattleVisualPlan(reportFixture())); assert.equal(validateBattleCamera(c).ok, true); });
check('C04 渲染器多帧不抛异常', () => { const oldWindow = globalThis.window; globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }; const renderer = new BattleRenderer(canvasStub()); const ab = { id: 'b1', theaterName: '测试战区', elapsed: 24, duration: 48, playing: true, settled: false, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5, report: reportFixture() }; renderer.render(ab, .016); renderer.setCameraMode(CAMERA_MODES.focus, 'f2'); renderer.render(ab, .016); renderer.reset(); renderer.destroy(); globalThis.window = oldWindow; });
check('C05 渲染器不修改战报或活动战斗', () => { const oldWindow = globalThis.window; globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }; const renderer = new BattleRenderer(canvasStub()); const ab = { id: 'b2', elapsed: 12, duration: 48, playing: true, settled: false, report: reportFixture() }; const before = JSON.stringify(ab); renderer.render(ab, .1); assert.equal(JSON.stringify(ab), before); renderer.destroy(); globalThis.window = oldWindow; });
check('C06 旧round文本不再作为战场主视图提示', () => { const source = readFileSync(path.join(ROOT, 'js/battle-renderer.js'), 'utf8'); assert.equal(source.includes('第${'), false); assert.ok(source.includes('TACTICAL BATTLE')); });
check('C07 全局结果控件在HTML中存在', () => { const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.ok(html.includes('battle-overlay-controls') && html.includes('battle-view-report') && html.includes('battle-skip-return')); });
check('C08 基地图例与战术视图chip已接线', () => { const source = readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'); assert.ok(source.includes('视图：战术战场 / TACTICAL BATTLE') && source.includes('this.refs.legend.hidden = battle')); });

console.log('\n── D. 结算、返航与迁移 ──');
check('D01 派遣初始进入battle展示阶段', () => { const s = freshBattle(); const r = theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 801); assert.equal(r.ok, true); assert.equal(s.activeBattle.presentationPhase, 'battle'); });
check('D02 结算后进入returning且返航计时归零', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 802); theater.settleActiveBattle(s); assert.equal(s.activeBattle.presentationPhase, 'returning'); assert.equal(s.activeBattle.returnElapsed, 0); assert.equal(s.activeBattle.returnDuration, 5); });
check('D03 返航两秒仍保留activeBattle', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 803); theater.settleActiveBattle(s); theater.tickBattleReturn(s, 2); assert.ok(s.activeBattle && s.activeBattle.settled); assert.equal(s.activeBattle.returnElapsed, 2); });
check('D04 五秒返航自动清空活动战斗', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 804); theater.settleActiveBattle(s); const before = s.battles.length; theater.tickBattleReturn(s, 5); assert.equal(s.activeBattle, null); assert.equal(s.battles.length, before); });
check('D05 跳过返航不重复结算或发奖', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 805); theater.settleActiveBattle(s); const receipt = JSON.stringify(s.activeBattle.settlementReceipt); const reports = s.battles.length; theater.skipBattleReturn(s); assert.equal(s.activeBattle, null); assert.equal(s.battles.length, reports); assert.equal(receipt.length > 0, true); });
check('D06 旧close API仍能兼容跳过返航', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 806); theater.settleActiveBattle(s); assert.equal(theater.closeBattleResult(s).ok, true); assert.equal(s.activeBattle, null); });
check('D07 未结算不能跳过返航', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 807); assert.equal(theater.skipBattleReturn(s).code, theater.THEATER_CODE.BATTLE_NOT_FINISHED); });
check('D08 旧结算存档补齐returning字段且不重复结算', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 808); theater.settleActiveBattle(s); delete s.activeBattle.presentationPhase; delete s.activeBattle.returnElapsed; delete s.activeBattle.returnDuration; const battles = s.battles.length; const r = theater.sanitizeActiveBattle(s); assert.equal(r.activeFormationId, 'f'); assert.equal(s.activeBattle.presentationPhase, 'returning'); assert.equal(s.activeBattle.returnElapsed, 0); assert.equal(s.battles.length, battles); });
check('D09 自动完成后编队回到idle', () => { const s = freshBattle(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 809); theater.settleActiveBattle(s); theater.tickBattleReturn(s, 5); assert.equal(s.formations[0].status, cfg.FORMATION_STATUS.IDLE); assert.ok(s.units.every((u) => u.status === 'assigned' || u.hp <= 0)); });
check('D10 主循环源码接入tickBattleReturn', () => { const source = readFileSync(path.join(ROOT, 'js/main.js'), 'utf8'); assert.ok(source.includes('tickBattleReturn(state, step)') && source.includes('skipBattleReturn')); });

console.log('\n════════════════════════════════════════════');
console.log(`  测试总数：${total}    通过：${passed}    失败：${failures.length}`);
if (failures.length) { failures.forEach((f) => console.log(`  FAIL ${f.name}: ${f.err.stack || f.err}`)); process.exitCode = 1; } else console.log('  全部通过 ✔');
console.log('════════════════════════════════════════════');
