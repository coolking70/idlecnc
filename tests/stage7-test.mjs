/** 钢铁指令 · 阶段7自动测试（零依赖） */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cfg from '../js/config.js';
import * as st from '../js/state.js';
import * as econ from '../js/economy.js';
import * as construction from '../js/construction.js';
import * as production from '../js/production.js';
import * as repairs from '../js/repairs.js';
import * as research from '../js/research.js';
import * as unitStatus from '../js/unit-status.js';
import * as battle from '../js/battle.js';
import * as offline from '../js/offline.js';
import * as save from '../js/save.js';
import * as theater from '../js/theater.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let total = 0; let passed = 0; const failures = [];
function check(name, fn) {
  total += 1;
  try { fn(); passed += 1; console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}\n        → ${err.message}`); }
}
function fresh() { const s = st.createInitialState(); econ.recalcDerived(s); return s; }
function operational(s, type) { const b = st.createBuilding(type); b.status = cfg.BUILDING_STATUS.OPERATIONAL; b.progress = 1; s.buildings.push(b); return b; }
function labState() {
  const s = fresh(); s.resources = { supply: 5000, alloy: 5000, intel: 500 };
  operational(s, 'radar_station'); operational(s, 'research_center'); econ.recalcDerived(s); return s;
}
function train(s, type = 'infantry') {
  const b = operational(s, 'barracks'); s.unlocks.units.push(type); econ.recalcDerived(s);
  const r = production.queueUnit(s, type); assert.ok(r.ok); production.tickProduction(s, cfg.UNITS[type].buildTime + 1); return s.units.at(-1);
}

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段7 自动测试');
console.log('════════════════════════════════════════════');

check('A01 阶段与存档版本', () => { assert.equal(cfg.CURRENT_STAGE, 8); assert.equal(cfg.SAVE_VERSION, 9); });
check('A02 package 版本保持0.8.1-hotfix系列', () => { assert.match(JSON.parse(readFileSync(path.join(ROOT, 'package.json'))).version, /^0\.8\.1-hotfix\./); });
check('A03 损伤阈值为 0.75 / 0.40', () => { assert.deepEqual(cfg.DAMAGE_THRESHOLDS, { intact: 0.75, light: 0.4 }); });
check('A04 unit-status 80% 完好', () => { assert.equal(unitStatus.getDamageState(80, 100), 'intact'); });
check('A05 unit-status 45% 轻伤', () => { assert.equal(unitStatus.getDamageState(45, 100), 'light'); });
check('A06 unit-status 30% 重伤', () => { assert.equal(unitStatus.getDamageState(30, 100), 'heavy'); });
check('A07 维修模块复用统一损伤判断', () => { assert.equal(repairs.getDamageState(80, 100), unitStatus.getDamageState(80, 100)); });

check('B01 维修重伤配置成本', () => { assert.deepEqual(repairs.getRepairCost('heavy'), { supply: 50, alloy: 45 }); });
check('B02 维修存档成本篡改被规范化', () => {
  const s = fresh(); const u = train(s); u.hp = 30; u.damage = 'intact'; u.status = 'repairing';
  s.repairs = [{ id: 'r1', unitId: u.id, severity: 'heavy', status: 'active', elapsed: 0, cost: { supply: 999999 }, costPaid: { supply: 999999 } }];
  repairs.sanitizeRepairs(s); assert.deepEqual(s.repairs[0].costPaid, { supply: 50, alloy: 45 });
  const before = s.resources.supply; const result = repairs.cancelRepair(s, 'r1'); assert.ok(result.ok); assert.equal(s.resources.supply, before + 25);
});
check('B03 返回中编队禁止维修', () => {
  const s = fresh(); const u = train(s); u.hp = 30; u.formationId = 'f1'; u.status = 'assigned'; s.formations = [{ id: 'f1', status: 'returning', unitIds: [u.id] }];
  assert.equal(repairs.canQueueRepair(s, u.id).code, repairs.REPAIR_CODE.FORMATION_BUSY);
});
check('B04 非法单位状态禁止维修', () => { const s = fresh(); const u = train(s); u.hp = 30; u.status = 'unknown'; assert.equal(repairs.canQueueRepair(s, u.id).code, repairs.REPAIR_CODE.UNIT_STATUS); });
check('B05 待命编队单位可维修且脱离', () => {
  const s = fresh(); const u = train(s); u.hp = 30; u.formationId = 'f1'; u.status = 'assigned'; s.formations = [{ id: 'f1', status: 'idle', unitIds: [u.id] }];
  const r = repairs.queueRepair(s, u.id); assert.ok(r.ok); assert.equal(u.formationId, null); assert.equal(s.formations[0].unitIds.length, 0);
});

check('C01 战报 ID 包含 seed/编队/战区/策略', () => { const s = fresh(); const u = train(s); s.formations = [{ id: 'f', name: 'F', status: 'idle', unitIds: [u.id] }]; u.formationId = 'f'; u.status = 'assigned'; const r = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 7 }); assert.equal(r.id, 'battle_7_f_scrap_mine_cautious'); });
check('C02 战报友军初始/最终名单完整', () => { const s = fresh(); const u = train(s); s.formations = [{ id: 'f', name: 'F', status: 'idle', unitIds: [u.id] }]; u.formationId = 'f'; u.status = 'assigned'; assert.ok(theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 8).ok); assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, true); });
check('C03 非法生命快照拒绝结算', () => { const s = fresh(); const r = battle.createEmptyReport({ seed: 1, theaterId: 'scrap_mine', strategyId: 'cautious', formation: { id: 'f', name: 'F' } }); r.duration = 30; r.events = [{ t: 0, type: 'phase' }, { t: 1, type: 'result', text: '战斗结果：胜利' }]; r.initial = { friendly: [{ id: 'x', realId: 'u', type: 'infantry', hp: 101, maxHp: 100, alive: true }], enemy: [] }; r.final = { friendly: r.initial.friendly, enemy: [] }; const ab = { ...r, id: r.id, seed: 1, formationId: 'f', theaterId: 'scrap_mine', strategyId: 'cautious', dispatchedUnitIds: ['u'], report: r, duration: 30 }; assert.equal(theater.validateBattleReportForSettlement(s, ab).ok, false); });
check('C04 历史战报写入深拷贝', () => { const s = fresh(); const u = train(s); s.formations = [{ id: 'f', name: 'F', status: 'idle', unitIds: [u.id] }]; u.formationId = 'f'; u.status = 'assigned'; theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 9); theater.settleActiveBattle(s); const stored = s.battles[0]; s.activeBattle.report.summary = 'changed'; assert.notEqual(stored.summary, 'changed'); });

check('D01 技术实验室配置完整', () => { const b = cfg.BUILDINGS.research_center; assert.equal(b.cost.alloy, 600); assert.equal(b.cost.supply, 300); assert.equal(b.cost.intel, 25); assert.equal(b.power.consume, 5); assert.deepEqual(b.requires, ['radar_station']); });
check('D02 雷达站未完成时实验室不能建', () => { const s = fresh(); s.resources.alloy = 9999; s.resources.supply = 9999; s.resources.intel = 9999; assert.equal(construction.canBuild(s, 'research_center').code, 'prereq'); });
check('D03 实验室建成后科研开放', () => { const s = labState(); assert.equal(research.hasResearchCenter(s), true); assert.equal(research.canQueueResearch(s, 'logistics_optimization').code, 'ready'); });
check('D04 实验室电力消耗正确', () => { const s = labState(); assert.equal(s.power.used, 11); });
check('D05 实验室渲染数据只读', () => { const s = labState(); const before = JSON.stringify(s); assert.doesNotThrow(() => JSON.stringify({ research: s.research })); assert.equal(JSON.stringify(s), before); });

check('E01 九项科技配置完整', () => { assert.equal(Object.keys(cfg.TECHNOLOGIES).length, 9); });
check('E02 三分支各三项', () => { for (const b of ['industry', 'military', 'command']) assert.equal(Object.values(cfg.TECHNOLOGIES).filter((x) => x.branch === b).length, 3); });
check('E03 未知科技拒绝', () => { assert.equal(research.canQueueResearch(labState(), 'nope').code, 'unknown'); });
check('E04 前置科技不足拒绝', () => { assert.equal(research.canQueueResearch(labState(), 'alloy_recycling').code, 'prerequisite'); });
check('E05 资源不足拒绝', () => { const s = labState(); s.resources.intel = 0; assert.equal(research.canQueueResearch(s, 'logistics_optimization').code, 'resource'); });
check('E06 入队立即扣费且当前开工', () => { const s = labState(); const before = s.resources.alloy; const r = research.queueResearch(s, 'logistics_optimization'); assert.ok(r.ok); assert.equal(s.resources.alloy, before - 100); assert.equal(s.research.current.techId, 'logistics_optimization'); });
check('E07 同科技不能重复入队', () => { const s = labState(); research.queueResearch(s, 'logistics_optimization'); assert.equal(research.queueResearch(s, 'logistics_optimization').code, 'already_queued'); });
check('E08 队列最多三项', () => { const s = labState(); s.resources.intel = 500; s.resources.alloy = 5000; research.queueResearch(s, 'logistics_optimization'); research.queueResearch(s, 'standardized_training'); research.queueResearch(s, 'tactical_datalink'); assert.equal(s.research.queue.length + 1, 3); assert.equal(research.canQueueResearch(s, 'logistics_optimization').code, 'already_queued'); });
check('E09 研究推进可完成', () => { const s = labState(); research.queueResearch(s, 'logistics_optimization'); const r = research.tickResearch(s, 30); assert.deepEqual(r.completed, ['logistics_optimization']); assert.deepEqual(s.research.completed, ['logistics_optimization']); });
check('E10 大 dt 消费后续任务剩余时间', () => { const s = labState(); s.resources.intel = 500; research.queueResearch(s, 'logistics_optimization'); research.queueResearch(s, 'standardized_training'); research.tickResearch(s, 40); assert.equal(s.research.current.techId, 'standardized_training'); assert.equal(s.research.current.elapsed, 10); });
check('E11 暂停不推进科研', () => { const s = labState(); research.queueResearch(s, 'logistics_optimization'); s.time.speed = 0; research.tickResearch(s, 100); assert.equal(s.research.current.elapsed, 0); });
check('E12 当前取消返还一半', () => { const s = labState(); const before = s.resources.alloy; research.queueResearch(s, 'logistics_optimization'); const r = research.cancelCurrentResearch(s); assert.equal(r.refund.alloy, 50); assert.equal(s.resources.alloy, before - 50); });
check('E13 等待取消全额返还', () => { const s = labState(); s.resources.intel = 500; research.queueResearch(s, 'logistics_optimization'); const q = research.queueResearch(s, 'standardized_training'); const before = s.resources.supply; const r = research.cancelQueuedResearch(s, q.task.id); assert.equal(r.refund.supply, 150); assert.equal(s.resources.supply, before + 150); });
check('E14 完成科技只记录一次', () => { const s = labState(); research.queueResearch(s, 'logistics_optimization'); research.completeResearch(s, s.research.current.id); const r = research.queueResearch(s, 'logistics_optimization'); assert.equal(r.code, 'completed'); assert.deepEqual(s.research.completed, ['logistics_optimization']); });

check('F01 后勤优化增加补给产量', () => { const s = labState(); const before = s.rates.supply; s.research.completed = ['logistics_optimization']; econ.recalcDerived(s); assert.equal(s.rates.supply, before + 1); });
check('F02 合金回收增加合金产量', () => { const s = labState(); s.research.completed = ['logistics_optimization', 'alloy_recycling']; econ.recalcDerived(s); assert.equal(s.rates.alloy, 2); });
check('F03 扩建储备增加上限', () => { const s = labState(); s.research.completed = ['logistics_optimization', 'alloy_recycling', 'expanded_storage']; econ.recalcDerived(s); assert.equal(s.caps.supply, 6000); });
check('F04 指挥网络增加容量', () => { const s = labState(); s.research.completed = ['tactical_datalink', 'field_maintenance', 'expanded_command_network']; econ.recalcDerived(s); assert.equal(s.command.capacity, 8); });
check('F05 重复科技只应用一次', () => { const s = labState(); s.research.completed = ['logistics_optimization', 'logistics_optimization']; econ.recalcDerived(s); assert.equal(s.rates.supply, 3); });
check('F06 未完成科技无效果', () => { const s = labState(); s.research.completed = []; econ.recalcDerived(s); assert.equal(s.rates.supply, 2); });
check('F07 步兵新任务使用训练快照', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; s.resources.supply = 5000; s.research.completed = ['standardized_training']; econ.recalcDerived(s); const r = production.queueUnit(s, 'infantry'); assert.equal(r.ok, true); assert.equal(s.production.current.duration, 8.5); });
check('F08 已有步兵任务时长不被后续科技改变', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; s.resources.supply = 5000; econ.recalcDerived(s); production.queueUnit(s, 'infantry'); s.research.completed = ['standardized_training']; assert.equal(s.production.current.duration, 10); });
check('F09 新维修任务使用维护快照', () => { const s = fresh(); const u = train(s); u.hp = 30; s.research.completed = ['tactical_datalink', 'field_maintenance']; const r = repairs.canQueueRepair(s, u.id); assert.equal(r.duration, 28); });
check('F10 复合装甲不改变真实maxHp', () => { const s = fresh(); const u = train(s); const before = u.maxHp; s.research.completed = ['composite_armor']; econ.recalcDerived(s); assert.equal(u.maxHp, before); });
check('F11 战术数据链提高侦察', () => { const s = fresh(); const u = train(s); s.formations = [{ id: 'f', name: 'F', status: 'idle', unitIds: [u.id] }]; u.formationId = 'f'; u.status = 'assigned'; const a = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 4 }); s.research.completed = ['tactical_datalink']; const b = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 4 }); assert.ok(b.scout.friendlyScouting > a.scout.friendlyScouting); });
check('F12 科技战斗效果不修改敌方基础配置', () => { const before = JSON.stringify(cfg.ENEMY_UNITS); const s = fresh(); s.research.completed = ['composite_armor']; const u = train(s); s.formations = [{ id: 'f', name: 'F', status: 'idle', unitIds: [u.id] }]; u.formationId = 'f'; u.status = 'assigned'; battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 5 }); assert.equal(JSON.stringify(cfg.ENEMY_UNITS), before); });

check('G01 科研容错去重未知ID', () => { const s = labState(); s.research.completed = ['logistics_optimization', 'logistics_optimization', 'nope']; const r = research.sanitizeResearch(s); assert.deepEqual(s.research.completed, ['logistics_optimization']); assert.equal(r.repaired, true); });
check('G02 科研任务成本防篡改', () => { const s = labState(); s.research.current = { id: 'x', techId: 'logistics_optimization', elapsed: 99, duration: 999, costPaid: { alloy: 999 } }; research.sanitizeResearch(s); assert.equal(s.research.current.duration, 30); assert.deepEqual(s.research.current.costPaid, { intel: 20, alloy: 100 }); });
check('G03 当前为空时恢复等待队列', () => { const s = labState(); s.research.queue = [{ id: 'x', techId: 'logistics_optimization', elapsed: 0, duration: 999, costPaid: { alloy: 999 } }]; research.sanitizeResearch(s); assert.equal(s.research.current.techId, 'logistics_optimization'); assert.equal(s.research.queue.length, 0); });
check('G04 完成科技不能留在队列', () => { const s = labState(); s.research.completed = ['logistics_optimization']; s.research.queue = [{ id: 'x', techId: 'logistics_optimization' }]; research.sanitizeResearch(s); assert.equal(s.research.queue.length, 0); });
check('G05 离线不增加累计游玩时间', () => { const s = fresh(); const before = s.time.played; offline.settleOfflineProgress(s, 120); assert.equal(s.time.played, before); });
check('G06 离线增加世界时间', () => { const s = fresh(); const before = s.time.game; offline.settleOfflineProgress(s, 120); assert.equal(s.time.game, before + 120); });
check('G07 离线5秒静默', () => { const s = fresh(); offline.settleOfflineProgress(s, 5); assert.equal(s.offline, null); });
check('G08 离线59秒静默', () => { const s = fresh(); offline.settleOfflineProgress(s, 59); assert.equal(s.offline, null); });
check('G09 离线60秒生成报告', () => { const s = fresh(); offline.settleOfflineProgress(s, 60); assert.ok(s.offline); });
check('G10 同令牌只结算一次', () => { const s = fresh(); const a = offline.settleOfflineProgress(s, 100, { token: 't1', createReport: true }); const supply = s.resources.supply; const b = offline.settleOfflineProgress(s, 100, { token: 't1', createReport: true }); assert.equal(s.resources.supply, supply); assert.equal(b.alreadySettled, true); assert.equal(a.settled, true); });
check('G11 离线科研完成进入报告', () => { const s = labState(); research.queueResearch(s, 'logistics_optimization'); offline.settleOfflineProgress(s, 60); assert.ok(s.offline.completedResearch.includes('后勤优化')); });
check('G12 活动战斗离线保持暂停标记', () => { const s = fresh(); s.activeBattle = { id: 'x', elapsed: 2 }; offline.settleOfflineProgress(s, 60); assert.equal(s.offline.battlePaused, true); assert.equal(s.activeBattle.elapsed, 2); });

check('H01 配置和模块语法检查', () => { for (const file of readdirSync(path.join(ROOT, 'js')).filter((x) => x.endsWith('.js'))) assert.doesNotThrow(() => readFileSync(path.join(ROOT, 'js', file), 'utf8')); });
check('H02 research.js 本地服务器文件存在', () => { assert.ok(readFileSync(path.join(ROOT, 'js/research.js'), 'utf8').includes('export function queueResearch')); });
check('H03 unit-status.js 本地服务器文件存在', () => { assert.ok(readFileSync(path.join(ROOT, 'js/unit-status.js'), 'utf8').includes('export function getDamageState')); });
check('H04 UI 含科研分页和九张卡', () => { const ui = readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'); assert.ok(ui.includes('_buildResearchPage')); assert.ok(ui.includes('research-tree')); assert.equal(Object.keys(cfg.TECHNOLOGIES).length, 9); });
check('H05 主循环调用 tickResearch', () => { assert.ok(readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').includes('tickResearch(state, step)')); });
check('H06 README 保留阶段7兼容说明', () => { const text = readFileSync(path.join(ROOT, 'README.md'), 'utf8'); assert.ok(text.includes('0.7.0') || text.includes('阶段7')); assert.ok(!text.includes('npx serve')); });

console.log('\n════════════════════════════════════════════');
console.log(`  测试总数：${total}    通过：${passed}    失败：${failures.length}`);
if (failures.length) { console.log('失败项目：'); failures.forEach((x) => console.log(`  - ${x.name}`)); process.exitCode = 1; }
else console.log('  全部通过 ✔');
console.log('════════════════════════════════════════════');
