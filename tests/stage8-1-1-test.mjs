/** 阶段8.1.1：撤退结算与重复报错紧急修复。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import * as battle from '../js/battle.js';
import * as theater from '../js/theater.js';
import * as save from '../js/save.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let total = 0;
let passed = 0;
const failures = [];

function check(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}\n        → ${err.message}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshBattle() {
  const s = stateApi.createInitialState();
  const radar = stateApi.createBuilding('radar_station');
  radar.status = cfg.BUILDING_STATUS.OPERATIONAL;
  radar.progress = 1;
  s.buildings.push(radar);
  s.units = ['u-0', 'u-1'].map((id) => ({
    id,
    type: 'infantry',
    hp: cfg.UNITS.infantry.stats.hp,
    maxHp: cfg.UNITS.infantry.stats.hp,
    damage: 'intact',
    status: 'assigned',
    formationId: 'f-retreat',
    experience: 0,
    battles: 0,
    callsign: null,
    createdAt: 1
  }));
  s.formations = [{
    id: 'f-retreat',
    name: '撤退测试编队',
    status: cfg.FORMATION_STATUS.IDLE,
    unitIds: ['u-0', 'u-1'],
    experience: 0,
    battles: 0
  }];
  economy.recalcDerived(s);
  return s;
}

function dispatchWithdrawal() {
  const s = freshBattle();
  const result = theater.dispatchFormation(s, 'f-retreat', 'scrap_mine', 'cautious', 1);
  assert.equal(result.ok, true, result.reason);
  assert.ok(s.activeBattle);
  assert.equal(s.activeBattle.report.result, cfg.BATTLE_RESULT.WITHDRAW);
  return s;
}

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.1.1 自动测试');
console.log('════════════════════════════════════════════');

console.log('\n── A. 版本、契约与真实撤退求解 ──');
check('A01 CURRENT_STAGE 保持8', () => assert.equal(cfg.CURRENT_STAGE, 8));
check('A02 SAVE_VERSION 已递增到9', () => assert.equal(cfg.SAVE_VERSION, 9));
check('A03 package 版本保持0.8.1-hotfix系列', () => assert.match(JSON.parse(readFileSync(path.join(ROOT, 'package.json'))).version, /^0\.8\.1-hotfix\./));
check('A04 RETREAT 事件常量存在', () => assert.equal(battle.BATTLE_EVENT.RETREAT, 'retreat'));
check('A05 结算阻断码公开', () => assert.equal(theater.THEATER_CODE.SETTLEMENT_BLOCKED, 'settlement_blocked'));
check('A06 安全关闭 API 公开', () => assert.equal(typeof theater.abortInvalidBattle, 'function'));
check('A07 永久错误分类为阻断', () => {
  assert.equal(theater.shouldBlockSettlement({ code: theater.THEATER_CODE.REPORT_INVALID }), true);
  assert.equal(theater.shouldBlockSettlement({ code: theater.THEATER_CODE.SETTLEMENT_FAILED }), true);
});
check('A08 时序错误保留重试', () => {
  assert.equal(theater.shouldBlockSettlement({ code: theater.THEATER_CODE.BATTLE_NOT_FINISHED }), false);
});
check('A09 固定种子由正式求解器得到WITHDRAW', () => {
  const s = freshBattle();
  const report = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 1 });
  assert.equal(report.result, cfg.BATTLE_RESULT.WITHDRAW);
});
check('A10 正式求解器的撤退战报包含RETREAT', () => {
  const s = freshBattle();
  const report = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 1 });
  assert.ok(report.events.some((event) => event.type === battle.BATTLE_EVENT.RETREAT));
});
check('A11 RETREAT位于RESULT之前', () => {
  const s = freshBattle();
  const report = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 1 });
  const retreat = report.events.findIndex((event) => event.type === battle.BATTLE_EVENT.RETREAT);
  const result = report.events.findIndex((event) => event.type === battle.BATTLE_EVENT.RESULT);
  assert.ok(retreat >= 0 && retreat < result);
});
check('A12 战斗事件时间轴单调不减', () => {
  const s = freshBattle();
  const report = battle.simulateBattle({ state: s, formation: s.formations[0], theaterId: 'scrap_mine', strategyId: 'cautious', seed: 1 });
  for (let i = 1; i < report.events.length; i += 1) assert.ok(report.events[i].t >= report.events[i - 1].t);
});

console.log('\n── B. 撤退结算与幂等阻断 ──');
check('B01 派遣生成活动战斗且初始化阻断字段', () => {
  const s = dispatchWithdrawal();
  const ab = s.activeBattle;
  assert.equal(ab.settlementAttempted, false);
  assert.equal(ab.settlementBlocked, false);
  assert.equal(ab.settlementError, null);
  assert.deepEqual(ab.loggedErrors, []);
});
check('B02 撤退报告通过完整性校验', () => {
  const s = dispatchWithdrawal();
  assert.equal(theater.validateBattleReportForSettlement(s, s.activeBattle).ok, true);
});
check('B03 撤退结算成功', () => {
  const s = dispatchWithdrawal();
  const result = theater.settleActiveBattle(s);
  assert.equal(result.ok, true, result.reason);
  assert.equal(s.activeBattle.settled, true);
});
check('B04 撤退不占领战区', () => {
  const s = dispatchWithdrawal();
  theater.settleActiveBattle(s);
  assert.equal(s.theaters.scrap_mine.captured, false);
});
check('B05 撤退不发放首次占领奖励', () => {
  const s = dispatchWithdrawal();
  theater.settleActiveBattle(s);
  assert.deepEqual(s.activeBattle.granted, {});
});
check('B06 撤退仍记录参与经验/战斗次数', () => {
  const s = dispatchWithdrawal();
  theater.settleActiveBattle(s);
  assert.ok(s.units.some((unit) => unit.battles === 1 && unit.experience > 0));
});
check('B07 重复结算不重复写报告', () => {
  const s = dispatchWithdrawal();
  theater.settleActiveBattle(s);
  const reports = s.battles.length;
  const receipt = JSON.stringify(s.activeBattle.settlementReceipt);
  const again = theater.settleActiveBattle(s);
  assert.equal(again.ok, true);
  assert.equal(s.battles.length, reports);
  assert.equal(JSON.stringify(s.activeBattle.settlementReceipt), receipt);
});
check('B08 未到时不能提前结算且不阻断', () => {
  const s = dispatchWithdrawal();
  const result = theater.settleActiveBattle(s);
  // settleActiveBattle is intentionally a direct settlement API; elapsed is already
  // solved at dispatch time in this project, so the report is eligible immediately.
  assert.equal(result.ok, true);
  assert.equal(s.activeBattle.settlementBlocked, false);
});
check('B09 缺RETREAT的撤退战报会被永久阻断', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const result = theater.settleActiveBattle(s);
  assert.equal(result.ok, false);
  assert.equal(result.code, theater.THEATER_CODE.REPORT_INVALID);
  assert.equal(s.activeBattle.settlementAttempted, true);
  assert.equal(s.activeBattle.settlementBlocked, true);
});
check('B10 阻断后tick返回settlement_blocked', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  const elapsed = s.activeBattle.elapsed;
  const result = theater.tickActiveBattle(s, 999);
  assert.equal(result.code, theater.THEATER_CODE.SETTLEMENT_BLOCKED);
  assert.equal(s.activeBattle.elapsed, elapsed);
});
check('B11 阻断后重复settle不再重试', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  const first = theater.settleActiveBattle(s);
  const second = theater.settleActiveBattle(s);
  assert.equal(first.code, theater.THEATER_CODE.REPORT_INVALID);
  assert.equal(second.code, theater.THEATER_CODE.SETTLEMENT_BLOCKED);
});
check('B12 同一结算失败最多记录一次', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  const matching = s.log.filter((entry) => String(entry.text || entry.message || '').includes('战斗结算被拒绝'));
  theater.settleActiveBattle(s);
  theater.tickActiveBattle(s, 999);
  theater.tickActiveBattle(s, 999);
  const matchingAgain = s.log.filter((entry) => String(entry.text || entry.message || '').includes('战斗结算被拒绝'));
  assert.equal(matching.length, 1);
  assert.equal(matchingAgain.length, 1);
  assert.equal(s.activeBattle.settlementErrorLogged, true);
});

console.log('\n── C. 安全关闭与状态保护 ──');
check('C01 未阻断战斗不能安全关闭', () => {
  const s = dispatchWithdrawal();
  const result = theater.abortInvalidBattle(s);
  assert.equal(result.code, theater.THEATER_CODE.SETTLEMENT_NOT_BLOCKED);
  assert.ok(s.activeBattle);
});
check('C02 安全关闭不应用奖励、损失或占领', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  const units = clone(s.units);
  const theaters = clone(s.theaters);
  const result = theater.abortInvalidBattle(s);
  assert.equal(result.ok, true);
  assert.deepEqual(s.theaters, theaters);
  assert.deepEqual(s.units.map((u) => ({ id: u.id, hp: u.hp, experience: u.experience, battles: u.battles })), units.map((u) => ({ id: u.id, hp: u.hp, experience: u.experience, battles: u.battles })));
});
check('C03 安全关闭恢复编队待命和成员assigned', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  assert.equal(theater.abortInvalidBattle(s).ok, true);
  assert.equal(s.activeBattle, null);
  assert.equal(s.formations[0].status, cfg.FORMATION_STATUS.IDLE);
  assert.equal(s.formations[0].theaterId, null);
  assert.ok(s.units.every((unit) => unit.status === 'assigned'));
});
check('C04 安全关闭只写一条安全关闭日志', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  const before = s.log.filter((entry) => String(entry.text || entry.message || '').includes('异常战斗已安全关闭')).length;
  theater.abortInvalidBattle(s);
  const after = s.log.filter((entry) => String(entry.text || entry.message || '').includes('异常战斗已安全关闭')).length;
  assert.equal(before, 0);
  assert.equal(after, 1);
});
check('C05 安全关闭后再次调用不产生新日志', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  theater.abortInvalidBattle(s);
  const logs = s.log.length;
  assert.equal(theater.abortInvalidBattle(s).code, theater.THEATER_CODE.NO_BATTLE);
  assert.equal(s.log.length, logs);
});
check('C06 debug接口源码接入安全关闭', () => {
  const source = readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  assert.ok(source.includes('abortInvalidBattle: () =>'));
});

console.log('\n── D. 旧存档确定性迁移 ──');
check('D01 旧撤退报告缺RETREAT可由快照重建', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const originalCost = clone(s.activeBattle.cost);
  const migrated = save.migrate(clone({ ...s, version: 6 }), {});
  assert.ok(migrated.activeBattle);
  assert.equal(migrated.activeBattle.settlementBlocked, false);
  assert.equal(migrated.activeBattle.report.result, cfg.BATTLE_RESULT.WITHDRAW);
  assert.ok(migrated.activeBattle.report.events.some((event) => event.type === battle.BATTLE_EVENT.RETREAT));
  assert.deepEqual(migrated.activeBattle.cost, originalCost);
});
check('D02 迁移不重复扣费/增加尝试次数', () => {
  const s = dispatchWithdrawal();
  const supply = s.resources.supply;
  const attempts = s.theaters.scrap_mine.attempts;
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const migrated = save.migrate(clone({ ...s, version: 6 }), {});
  assert.equal(migrated.resources.supply, supply);
  assert.equal(migrated.theaters.scrap_mine.attempts, attempts);
  assert.equal(migrated.activeBattle.settlementAttempted, false);
});
check('D03 迁移同步重建后的duration与elapsed边界', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  s.activeBattle.duration = 1;
  s.activeBattle.elapsed = 999;
  const migrated = save.migrate(clone({ ...s, version: 6 }), {});
  assert.equal(migrated.activeBattle.duration, migrated.activeBattle.report.duration);
  assert.ok(migrated.activeBattle.elapsed <= migrated.activeBattle.duration);
});
check('D04 无法重建的旧撤退报告会阻断而不丢失活动战斗', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.dispatchSnapshot = null;
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const migrated = save.migrate(clone({ ...s, version: 6 }), {});
  assert.ok(migrated.activeBattle);
  assert.equal(migrated.activeBattle.settlementBlocked, true);
  assert.equal(migrated.activeBattle.settlementAttempted, true);
  assert.equal(migrated.activeBattle.settlementErrorLogged, false);
});
check('D05 无法重建迁移不重复刷错误日志', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.dispatchSnapshot = null;
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const data = clone({ ...s, version: 6 });
  const firstReport = {};
  const first = save.migrate(data, firstReport);
  const secondReport = {};
  const second = save.migrate(data, secondReport);
  const firstMessages = (first.log || []).filter((entry) => String(entry.text || entry.message || '').includes('撤退战报无法确定性重建'));
  const secondMessages = (second.log || []).filter((entry) => String(entry.text || entry.message || '').includes('撤退战报无法确定性重建'));
  assert.equal(firstMessages.length, 0);
  assert.equal(secondMessages.length, 0);
  assert.ok(firstReport.notes.some((note) => note.includes('阻断')));
});
check('D06 已阻断字段可通过迁移往返保留', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  const data = clone({ ...s, version: cfg.SAVE_VERSION });
  const migrated = save.migrate(data, {});
  assert.equal(migrated.activeBattle.settlementBlocked, true);
  assert.equal(migrated.activeBattle.settlementAttempted, true);
  assert.equal(typeof migrated.activeBattle.settlementError, 'string');
  assert.equal(migrated.activeBattle.settlementErrorLogged, true);
  assert.ok(migrated.activeBattle.loggedErrors.length >= 1);
});
check('D07 正常撤退迁移后仍可结算一次', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.events = s.activeBattle.report.events.filter((event) => event.type !== battle.BATTLE_EVENT.RETREAT);
  const migrated = save.migrate(clone({ ...s, version: 6 }), {});
  const result = theater.settleActiveBattle(migrated);
  assert.equal(result.ok, true, result.reason);
  assert.equal(migrated.battles.length, 1);
});

console.log('\n── E. 代码边界与无副作用 ──');
check('E01 结算失败不生成历史战报', () => {
  const s = dispatchWithdrawal();
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  assert.equal(s.battles.length, 0);
});
check('E02 结算失败不改变单位HP', () => {
  const s = dispatchWithdrawal();
  const hp = s.units.map((unit) => unit.hp);
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  assert.deepEqual(s.units.map((unit) => unit.hp), hp);
});
check('E03 结算失败不增加经验', () => {
  const s = dispatchWithdrawal();
  const xp = s.units.map((unit) => unit.experience);
  s.activeBattle.report.id = 'tampered-report';
  theater.settleActiveBattle(s);
  assert.deepEqual(s.units.map((unit) => unit.experience), xp);
});
check('E04 错误状态字段会自动补齐', () => {
  const s = dispatchWithdrawal();
  delete s.activeBattle.settlementAttempted;
  delete s.activeBattle.settlementBlocked;
  delete s.activeBattle.settlementError;
  delete s.activeBattle.loggedErrors;
  theater.tickActiveBattle(s, 0);
  assert.equal(s.activeBattle.settlementAttempted, false);
  assert.equal(s.activeBattle.settlementBlocked, false);
  assert.deepEqual(s.activeBattle.loggedErrors, []);
});
check('E05 未阻断tick仍能推进播放时间', () => {
  const s = dispatchWithdrawal();
  const before = s.activeBattle.elapsed;
  theater.tickActiveBattle(s, 1);
  assert.equal(s.activeBattle.elapsed, before + 1);
});
check('E06 文件未触碰视觉模块', () => {
  const source = readFileSync(path.join(ROOT, 'js/theater.js'), 'utf8');
  assert.equal(source.includes('battle-renderer'), false);
  assert.equal(source.includes('battle-camera'), false);
});

console.log('\n════════════════════════════════════════════');
console.log(`  测试总数：${total}    通过：${passed}    失败：${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.log(`  FAIL ${failure.name}: ${failure.err.stack || failure.err}`));
  process.exitCode = 1;
} else {
  console.log('  全部通过 ✔');
}
console.log('════════════════════════════════════════════');
