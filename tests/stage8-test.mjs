/** 钢铁指令 · 阶段8自动测试（零依赖，覆盖完整性 / 老兵 / 重复任务 / 离线）。 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cfg from '../js/config.js';
import * as st from '../js/state.js';
import * as econ from '../js/economy.js';
import * as production from '../js/production.js';
import * as research from '../js/research.js';
import * as repairs from '../js/repairs.js';
import * as units from '../js/units.js';
import * as integrity from '../js/integrity.js';
import * as battle from '../js/battle.js';
import * as theater from '../js/theater.js';
import * as operations from '../js/operations.js';
import * as offline from '../js/offline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let total = 0; let passed = 0; const failures = [];
function check(name, fn) {
  total += 1;
  try { fn(); passed += 1; console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}\n        → ${err.message}`); }
}
function fresh() { const s = st.createInitialState(); econ.recalcDerived(s); return s; }
function operational(s, type) { const b = st.createBuilding(type); b.status = cfg.BUILDING_STATUS.OPERATIONAL; b.progress = 1; s.buildings.push(b); return b; }
function addUnit(s, type = 'infantry', id = `u-${s.units.length + 1}`, experience = 0) {
  const def = cfg.UNITS[type];
  const unit = { id, type, hp: def.stats.hp, maxHp: def.stats.hp, damage: 'intact', status: 'assigned', formationId: 'f', callsign: null, experience, battles: 0, createdAt: 1 };
  s.units.push(unit); return unit;
}
function battleState(count = 4) {
  const s = fresh(); operational(s, 'radar_station');
  for (let i = 0; i < count; i += 1) addUnit(s, 'infantry', `u-${i + 1}`);
  s.formations = [{ id: 'f', name: '铁拳编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: s.units.map((u) => u.id), experience: 0, battles: 0 }];
  econ.recalcDerived(s); return s;
}
function capturedOperationState() { const s = battleState(5); s.theaters.scrap_mine.captured = true; econ.recalcDerived(s); return s; }

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8 自动测试');
console.log('════════════════════════════════════════════');

console.log('\n── A. 阶段标记、配置与公开契约 ──');
check('A01 CURRENT_STAGE 为8', () => assert.equal(cfg.CURRENT_STAGE, 8));
check('A02 SAVE_VERSION 为7', () => assert.equal(cfg.SAVE_VERSION, 7));
check('A03 package 版本保持0.8.1-hotfix系列', () => assert.match(JSON.parse(readFileSync(path.join(ROOT, 'package.json'))).version, /^0\.8\.1-hotfix\./));
check('A04 四档老兵配置阈值递增', () => assert.deepEqual(Object.values(cfg.UNIT_RANKS).map((x) => x.minExperience), [0, 10, 30, 60]));
check('A05 老兵配置含战斗与后勤修正', () => { const r = cfg.UNIT_RANKS.elite.modifiers; assert.ok(r.attack > 1 && r.repair > 1); });
check('A06 保留三个旧重复任务并支持阶段9扩展', () => { assert.ok(Object.keys(cfg.OPERATIONS).length >= 6); assert.deepEqual(Object.keys(cfg.OPERATIONS).slice(0, 3), ['salvage_run', 'convoy_escort', 'outpost_sweep']); });
check('A07 旧重复任务冷却顺序保持且新任务继续递增', () => { const cooldowns = Object.values(cfg.OPERATIONS).map((x) => x.cooldown); assert.deepEqual(cooldowns.slice(0, 3), [300, 600, 900]); assert.ok(cooldowns.slice(3).every((value, index) => value > cooldowns[index + 2])); });
check('A08 每个重复任务绑定已知战区', () => Object.values(cfg.OPERATIONS).forEach((x) => assert.ok(cfg.THEATERS[x.theaterId])));
check('A09 部队分页阶段8开放', () => assert.ok(cfg.PANEL_TABS.some((x) => x.id === 'units' && x.stage <= cfg.CURRENT_STAGE)));
check('A10 操作公开 API 含成本与冷却', () => { assert.equal(typeof operations.getOperationCost, 'function'); assert.equal(typeof operations.operationCooldown, 'function'); });

console.log('\n── B. 科研依赖闭包与版本历史 ──');
check('B01 初始科研历史含revision0', () => { const s = fresh(); assert.deepEqual(s.research.history[0].completed, []); assert.equal(s.research.history[0].revision, 0); });
check('B02 非闭合科技被过滤', () => assert.deepEqual(integrity.validateCompletedTechnologyClosure(['alloy_recycling']), []));
check('B03 闭合科技按配置顺序保留', () => assert.deepEqual(integrity.validateCompletedTechnologyClosure(['alloy_recycling', 'logistics_optimization']), ['logistics_optimization', 'alloy_recycling']));
check('B04 科研历史验证通过初始状态', () => { const s = fresh(); assert.equal(integrity.validateResearchHistory(s.research.history, s.research.revision).ok, true); });
check('B05 重复revision被历史验证拒绝', () => { const s = fresh(); s.research.history.push({ revision: 0, completed: [], gameTime: 1 }); assert.equal(integrity.validateResearchHistory(s.research.history, 0).ok, false); });
check('B06 科研历史限制64条', () => { const s = fresh(); s.research.history = Array.from({ length: 70 }, (_, i) => ({ revision: i, completed: [], gameTime: i })); s.research.revision = 69; research.sanitizeResearch(s); assert.ok(s.research.history.length <= 64); });
check('B07 非法当前科研任务被移除', () => { const s = fresh(); s.research.current = { id: 'bad', techId: 'alloy_recycling', researchRevision: 0, createdGameTime: s.time.game, elapsed: 0 }; research.sanitizeResearch(s); assert.equal(s.research.current, null); });
check('B08 非法等待科研任务被移除', () => { const s = fresh(); s.research.queue = [{ id: 'bad', techId: 'expanded_storage', researchRevision: 0, createdGameTime: s.time.game }]; research.sanitizeResearch(s); assert.equal(s.research.queue.length, 0); });
check('B09 科研完成会产生新revision', () => { const s = fresh(); operational(s, 'radar_station'); operational(s, 'research_center'); s.resources = { supply: 5000, alloy: 5000, intel: 500 }; econ.recalcDerived(s); research.queueResearch(s, 'logistics_optimization'); research.tickResearch(s, 100); assert.equal(s.research.revision, 1); });
check('B10 科研历史公开查询为拷贝', () => { const s = fresh(); const h = research.getResearchHistory(s); h[0].completed.push('x'); assert.deepEqual(s.research.history[0].completed, []); });

console.log('\n── C. 生产 / 维修可信科研绑定 ──');
check('C01 生产任务写入researchRevision', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; s.research.completed = ['standardized_training']; econ.recalcDerived(s); production.queueUnit(s, 'infantry'); assert.ok(Number.isInteger(s.production.current.researchRevision)); });
check('C02 生产任务写入createdGameTime', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; econ.recalcDerived(s); production.queueUnit(s, 'infantry'); assert.equal(s.production.current.createdGameTime, s.time.game); });
check('C03 生产任务不信任后续科技', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; econ.recalcDerived(s); production.queueUnit(s, 'infantry'); s.research.completed = ['standardized_training']; production.sanitizeProduction(s); assert.equal(s.production.current.duration, 10); });
check('C04 维修任务写入科研版本', () => { const s = fresh(); const u = addUnit(s); u.hp = 30; u.status = 'ready'; u.formationId = null; s.research.completed = ['tactical_datalink', 'field_maintenance']; const r = repairs.queueRepair(s, u.id); assert.ok(r.ok && Number.isInteger(r.job.researchRevision)); });
check('C05 维修任务写入创建时间', () => { const s = fresh(); const u = addUnit(s); u.hp = 30; u.status = 'ready'; u.formationId = null; const r = repairs.queueRepair(s, u.id); assert.equal(r.job.createdGameTime, s.time.game); });
check('C06 维修任务不信任后续科技', () => { const s = fresh(); const u = addUnit(s); u.hp = 30; u.status = 'ready'; u.formationId = null; repairs.queueRepair(s, u.id); s.research.completed = ['tactical_datalink', 'field_maintenance']; repairs.sanitizeRepairs(s); assert.equal(s.repairs[0].duration, 35); });
check('C07 旧生产快照可迁移但不缩短非法任务', () => { const s = fresh(); const b = operational(s, 'barracks'); s.unlocks.units = ['infantry']; s.production.current = { id: 'old', type: 'infantry', sourceBuildingId: b.id, elapsed: 0, duration: 1, durationBase: 10, researchSnapshot: ['standardized_training'], costPaid: { ...cfg.UNITS.infantry.cost } }; production.sanitizeProduction(s); assert.ok(s.production.current.duration >= 1); });
check('C08 科研修正只影响新任务', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; production.queueUnit(s, 'infantry'); s.research.completed = ['standardized_training']; production.queueUnit(s, 'infantry'); assert.equal(s.production.current.duration, 10); assert.equal(s.production.queue[0].duration, 8.5); });

console.log('\n── D. 单位档案、呼号与老兵等级 ──');
check('D01 经验0为新兵', () => assert.equal(units.getUnitRank(0).id, 'recruit'));
check('D02 经验10为训练有素', () => assert.equal(units.getUnitRank(10).id, 'trained'));
check('D03 经验30为老兵', () => assert.equal(units.getUnitRank(30).id, 'veteran'));
check('D04 经验60为精锐', () => assert.equal(units.getUnitRank(60).id, 'elite'));
check('D05 等级进度返回下一档', () => { const p = units.getRankProgress(12); assert.equal(p.nextRankId, 'veteran'); assert.equal(p.remaining, 18); });
check('D06 呼号规范化并限制长度', () => { const s = fresh(); const u = addUnit(s); assert.equal(units.renameUnit(s, u.id, '  铁拳Alpha-超长呼号  ').ok, true); assert.equal(u.callsign.length, 12); });
check('D07 空呼号恢复为空', () => { const s = fresh(); const u = addUnit(s); units.renameUnit(s, u.id, '  '); assert.equal(u.callsign, null); });
check('D08 单位显示名包含呼号', () => { const s = fresh(); const u = addUnit(s); u.callsign = '铁拳'; assert.ok(units.formatUnitDisplayName(u).includes('铁拳')); });
check('D09 战斗属性使用等级修正', () => { const s = fresh(); const u = addUnit(s, 'infantry', 'x', 60); assert.ok(units.getUnitEffectiveStats(u).attack > cfg.UNITS.infantry.stats.attack); });
check('D10 等级不修改真实maxHp', () => { const s = fresh(); const u = addUnit(s, 'infantry', 'x', 60); assert.equal(units.getUnitEffectiveStats(u).hp, cfg.UNITS.infantry.stats.hp); });
check('D11 单位容错清理呼号与生命', () => { const s = fresh(); const u = addUnit(s); u.callsign = '  A  '; u.hp = 999; units.sanitizeUnits(s); assert.equal(u.callsign, 'A'); assert.equal(u.hp, u.maxHp); });
check('D12 单位排序按经验降序', () => { const s = fresh(); const a = addUnit(s, 'infantry', 'a', 1); const b = addUnit(s, 'infantry', 'b', 20); assert.equal(units.sortUnits([a, b], 'experience')[0].id, 'b'); });

console.log('\n── E. 战斗快照与完整性校验 ──');
check('E01 派遣写入dispatchSnapshot', () => { const s = battleState(); const r = theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 11); assert.ok(r.ok && s.activeBattle.dispatchSnapshot); });
check('E02 派遣快照含研究revision', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 12); assert.ok(Number.isInteger(s.activeBattle.dispatchSnapshot.research.revision)); });
check('E03 派遣快照含单位等级', () => { const s = battleState(); s.units[0].experience = 60; theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 13); assert.equal(s.activeBattle.dispatchSnapshot.units[0].rankId, 'elite'); });
check('E04 派遣快照含呼号', () => { const s = battleState(); s.units[0].callsign = '先锋'; theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 14); assert.equal(s.activeBattle.dispatchSnapshot.units[0].callsign, '先锋'); });
check('E05 派遣后重建战报完全一致', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 15); const ab = s.activeBattle; const rebuilt = battle.rebuildBattleFromDispatchSnapshot(ab.dispatchSnapshot, ab.seed); assert.equal(integrity.compareBattleReports(rebuilt, ab.report).ok, true); });
check('E06 结算前修改实时单位不影响重建', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 16); s.units[0].hp = 1; assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, true); });
check('E07 修改最终生命值会被拒绝', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 17); s.activeBattle.report.final.friendly[0].hp = 1; assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, false); });
check('E08 alive非布尔值会被拒绝', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 18); s.activeBattle.report.final.friendly[0].alive = 1; assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, false); });
check('E09 删除敌军会被拒绝', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 19); s.activeBattle.report.final.enemy.pop(); assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, false); });
check('E10 结果与最终阵容冲突会被拒绝', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 20); s.activeBattle.report.result = cfg.BATTLE_RESULT.VICTORY; s.activeBattle.report.capture = true; s.activeBattle.report.final.friendly.forEach((u) => { u.hp = 0; u.alive = false; }); assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, false); });
check('E11 活动战斗确定性接口报告一致', () => { const s = battleState(); theater.dispatchFormation(s, 'f', 'scrap_mine', 'cautious', 21); const rebuilt = battle.rebuildBattleFromDispatchSnapshot(s.activeBattle.dispatchSnapshot, 21); assert.equal(integrity.compareBattleReports(rebuilt, s.activeBattle.report).ok, true); });
check('E12 战报奖励不依赖实时资源', () => { const a = battleState(); const b = battleState(); a.resources.supply = 10; b.resources.supply = 9000; const ra = battle.simulateBattle({ state: a, formation: a.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 22 }); const rb = battle.simulateBattle({ state: b, formation: b.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 22 }); assert.deepEqual(ra.rewards, rb.rewards); });
check('E13 事件时间单调', () => { const s = battleState(); const r = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 23 }); for (let i = 1; i < r.events.length; i += 1) assert.ok(r.events[i].t >= r.events[i - 1].t); });
check('E14 战报初始友军全部存活', () => { const s = battleState(); const r = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 24 }); assert.ok(r.initial.friendly.every((u) => u.alive === true)); });

console.log('\n── F. 重复任务派遣、结算与冷却 ──');
check('F01 未占领战区禁止重复任务', () => { const s = battleState(); assert.equal(operations.canDispatchOperation(s, 'f', 'salvage_run', 'cautious').code, operations.OPERATION_CODE.THEATER_NOT_CAPTURED); });
check('F02 占领战区后重复任务可派遣', () => { const s = capturedOperationState(); assert.equal(operations.canDispatchOperation(s, 'f', 'salvage_run', 'cautious').ok, true); });
check('F03 重复任务成本含供应倍率', () => { const s = capturedOperationState(); const a = operations.getOperationCost(s, 'f', 'salvage_run', 'cautious'); assert.ok(a.cost.supply > 0 && a.breakdown.supplyMultiplier === 4); });
check('F04 重复任务成本不使用随机数', () => { const s = capturedOperationState(); const a = operations.getOperationCost(s, 'f', 'salvage_run', 'cautious'); const b = operations.getOperationCost(s, 'f', 'salvage_run', 'cautious'); assert.deepEqual(a, b); });
check('F05 重复任务ID含operation', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 25 }); assert.ok(s.activeBattle.id.includes('_operation_salvage_run_')); });
check('F06 操作战报明确missionKind', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 26 }); assert.equal(s.activeBattle.report.missionKind, 'operation'); });
check('F07 操作战报不占领战区', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 27 }); assert.equal(s.activeBattle.report.capture, false); });
check('F08 操作战报可通过完整性校验', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 28 }); assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, true); });
check('F09 操作结算发放确定性奖励', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 29 }); const before = s.resources.alloy; const r = theater.settleActiveBattle(s); assert.ok(r.ok && s.resources.alloy >= before); });
check('F10 操作结算增加胜利次数', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 30 }); theater.settleActiveBattle(s); assert.equal(s.operations.salvage_run.victories, 1); });
check('F11 操作结算写入冷却', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 31 }); theater.settleActiveBattle(s); assert.equal(s.operations.salvage_run.cooldownUntil, s.time.game + cfg.OPERATIONS.salvage_run.cooldown); });
check('F12 冷却期间禁止再次派遣', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 32 }); theater.settleActiveBattle(s); theater.closeBattleResult(s); assert.equal(operations.canDispatchOperation(s, 'f', 'salvage_run', 'cautious').code, operations.OPERATION_CODE.COOLDOWN); });
check('F13 推进游戏时间解除冷却', () => { const s = capturedOperationState(); s.operations.salvage_run.cooldownUntil = s.time.game + 5; s.time.game += 5; assert.equal(operations.operationCooldown(s, 'salvage_run').remaining, 0); });
check('F14 操作记录尝试次数只在派遣增加', () => { const s = capturedOperationState(); assert.equal(s.operations.salvage_run.attempts, 0); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 33 }); assert.equal(s.operations.salvage_run.attempts, 1); });
check('F15 操作失败也保留结果记录', () => { const s = capturedOperationState(); theater.dispatchOperation(s, 'f', 'salvage_run', 'cautious', { seed: 34 }); theater.settleActiveBattle(s); assert.ok(s.operations.salvage_run.lastResult); });
check('F16 未知操作拒绝', () => { const s = capturedOperationState(); assert.equal(operations.canDispatchOperation(s, 'f', 'nope', 'cautious').ok, false); });

console.log('\n── G. 离线世界时间与重复任务就绪 ──');
check('G01 离线按段推进世界时间', () => { const s = fresh(); const before = s.time.game; offline.settleOfflineProgress(s, 120); assert.equal(s.time.game, before + 120); });
check('G02 离线不增加累计游玩时间', () => { const s = fresh(); const before = s.time.played; offline.settleOfflineProgress(s, 120); assert.equal(s.time.played, before); });
check('G03 离线报告暴露operationsReady', () => { const s = fresh(); s.operations.salvage_run.cooldownUntil = s.time.game + 10; offline.settleOfflineProgress(s, 20, { createReport: true }); assert.ok(s.offline.operationsReady.includes('salvage_run')); });
check('G04 离线就绪不篡改冷却记录', () => { const s = fresh(); s.operations.salvage_run.cooldownUntil = s.time.game + 10; offline.settleOfflineProgress(s, 20); assert.equal(s.operations.salvage_run.cooldownUntil, s.time.game - 10); });
check('G05 离线科研使用世界时间', () => { const s = fresh(); s.research.current = null; s.research.queue = []; const before = s.time.game; offline.settleOfflineProgress(s, 60); assert.ok(s.time.game > before); });
check('G06 离线分段日志带不同时间', () => { const s = fresh(); operational(s, 'barracks'); s.unlocks.units = ['infantry']; econ.recalcDerived(s); production.queueUnit(s, 'infantry'); offline.settleOfflineProgress(s, 20, { createReport: true }); const times = s.log.map((x) => x.gameTime).filter((x) => Number.isFinite(x)); assert.ok(new Set(times).size >= 2); });
check('G07 重复离线令牌幂等', () => { const s = fresh(); const a = offline.settleOfflineProgress(s, 100, { token: 'stage8', createReport: true }); const time = s.time.game; const b = offline.settleOfflineProgress(s, 100, { token: 'stage8', createReport: true }); assert.ok(a.settled && b.alreadySettled && s.time.game === time); });
check('G08 活动战斗离线保持暂停', () => { const s = fresh(); s.activeBattle = { id: 'x', elapsed: 3 }; offline.settleOfflineProgress(s, 60); assert.equal(s.activeBattle.elapsed, 3); });

console.log('\n── H. 存档容错、UI接线与文档 ──');
check('H01 operations缺失可重建全部配置记录', () => { const s = fresh(); delete s.operations; const r = operations.sanitizeOperations(s); assert.equal(r.repaired, true); assert.equal(Object.keys(s.operations).length, Object.keys(cfg.OPERATIONS).length); });
check('H02 未知操作记录被移除', () => { const s = fresh(); s.operations.nope = { attempts: 99 }; operations.sanitizeOperations(s); assert.equal(s.operations.nope, undefined); });
check('H03 操作胜利数不超过尝试数', () => { const s = fresh(); s.operations.salvage_run = { attempts: 1, victories: 99 }; operations.sanitizeOperations(s); assert.equal(s.operations.salvage_run.victories, 1); });
check('H04 单位重复ID被清理', () => { const s = fresh(); const u = addUnit(s); s.units.push({ ...u }); units.sanitizeUnits(s); assert.equal(s.units.length, 1); });
check('H05 战斗完整性模块导出比较器', () => assert.equal(typeof integrity.compareBattleReports, 'function'));
check('H06 theater导出重复任务派遣', () => assert.equal(typeof theater.dispatchOperation, 'function'));
check('H07 battle导出快照重建', () => assert.equal(typeof battle.rebuildBattleFromDispatchSnapshot, 'function'));
check('H08 UI含部队档案页', () => { const text = readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'); assert.ok(text.includes('_buildUnitsPage') && text.includes('unit-callsign')); });
check('H09 UI含重复任务卡片', () => assert.ok(readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8').includes('operation-card')));
check('H10 renderer含老兵标记', () => assert.ok(readFileSync(path.join(ROOT, 'js/renderer.js'), 'utf8').includes('_drawVeteranMarker')));
check('H11 README已进入阶段8', () => { const text = readFileSync(path.join(ROOT, 'README.md'), 'utf8'); assert.ok(text.includes('阶段8') || text.includes('0.8.0')); });
check('H12 全部JS通过基础读取与源码契约检查', () => readdirSync(path.join(ROOT, 'js')).filter((x) => x.endsWith('.js')).forEach((file) => assert.ok(readFileSync(path.join(ROOT, 'js', file), 'utf8').length > 100)));

console.log('\n════════════════════════════════════════════');
console.log(`  测试总数：${total}    通过：${passed}    失败：${failures.length}`);
if (failures.length) { console.log('失败项目：'); failures.forEach((x) => console.log(`  - ${x.name}`)); process.exitCode = 1; }
else console.log('  全部通过 ✔');
console.log('════════════════════════════════════════════');
