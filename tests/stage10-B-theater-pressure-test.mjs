import assert from 'node:assert/strict';

/**
 * Stage 10-B — Dynamic Theater Pressure targeted tests.
 *
 * 权威层：js/theater-pressure.js（tickTheaterPressure / theaterPressureView /
 * ensureTheaterPressure / theaterTaskCounts）。规则常量集中在权威层，
 * 不进入 Stage9 frozen config.js。
 */

import { FORMATION_STATUS, SAVE_VERSION } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { settleOfflineProgress } from '../js/offline.js';
import {
  OPERATIONAL_TASK_TYPE, assignOperationalTask, recallOperationalTask,
  getOperationalTask, tickOperationalTasks
} from '../js/tasking.js';
import {
  THEATER_PRESSURE, PRESSURE_METRICS,
  theaterPressureView, ensureTheaterPressure, theaterTaskCounts, tickTheaterPressure
} from '../js/theater-pressure.js';
import { buildTheaterCommandModels } from '../js/command-presentation.js';

const A = 'scrap_mine';
const B = 'border_road';
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function readyState({ formations = 1 } = {}) {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  for (let i = 0; i < formations; i += 1) {
    const id = `f${i}`;
    state.units.push({
      id: `u${i}`, type: 'mbt', hp: 100, maxHp: 100, damage: 'intact',
      status: 'assigned', formationId: id, experience: 0, battles: 0, callsign: null, createdAt: i
    });
    state.formations.push({ id, name: `编队${i}`, unitIds: [`u${i}`], status: FORMATION_STATUS.IDLE, createdAt: i });
  }
  recalcDerived(state);
  return state;
}

function localStorageShim() {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
  globalThis.localStorage = shim;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWindow = globalThis.window;
  globalThis.window = { localStorage: shim };
  return () => {
    delete globalThis.localStorage;
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  };
}

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL  ${name}: ${error?.message || error}`); }
};

console.log('\n── Stage 10-B dynamic theater pressure ──');

check('SAVE_VERSION remains 10 (pressure is additive persistence)', () => assert.equal(SAVE_VERSION, 10));

check('initial pressure defaults (threat 50 / others 0), clamped 0~100', () => {
  const state = readyState();
  const view = theaterPressureView(state, A);
  approx(view.threat, THEATER_PRESSURE.initial.threat);
  approx(view.control, 0); approx(view.recon, 0); approx(view.security, 0);
  PRESSURE_METRICS.forEach((metric) => assert.ok(view[metric] >= 0 && view[metric] <= 100));
});

check('PATROL raises control and slightly lowers threat', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(state, 100);
  const view = theaterPressureView(state, A);
  approx(view.control, 100 * THEATER_PRESSURE.perTaskPerSecond.patrol.control);
  approx(view.threat, 50 + 100 * THEATER_PRESSURE.perTaskPerSecond.patrol.threat);
});

check('RECON raises recon', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickTheaterPressure(state, 100);
  approx(theaterPressureView(state, A).recon, 100 * THEATER_PRESSURE.perTaskPerSecond.recon.recon);
});

check('SECURITY raises security and lowers threat noticeably more than PATROL', () => {
  const patrol = readyState();
  assignOperationalTask(patrol, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(patrol, 100);
  const security = readyState();
  assignOperationalTask(security, 'f0', OPERATIONAL_TASK_TYPE.SECURITY, A);
  tickTheaterPressure(security, 100);
  approx(theaterPressureView(security, A).security, 100 * THEATER_PRESSURE.perTaskPerSecond.security.security);
  assert.ok(theaterPressureView(security, A).threat < theaterPressureView(patrol, A).threat, 'security suppresses threat harder');
});

check('recall stops that formation\u2019s influence immediately', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickTheaterPressure(state, 100);
  recallOperationalTask(state, 'f0');
  const atRecall = theaterPressureView(state, A);
  tickTheaterPressure(state, 100);
  const after = theaterPressureView(state, A);
  approx(after.recon, atRecall.recon + 100 * THEATER_PRESSURE.idlePerSecond.recon);
  assert.equal(after.control, 0, 'control stays clamped at 0 after recall');
  assert.equal(theaterTaskCounts(state, A).recon, 0);
});

check('theater A never influences theater B', () => {
  const state = readyState({ formations: 2 });
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.SECURITY, A);
  tickTheaterPressure(state, 60);
  const b = theaterPressureView(state, B);
  assert.equal(b.control, 0, 'untouched theater control stays clamped at 0');
  approx(b.security, 0);
  approx(b.threat, 50 + 60 * THEATER_PRESSURE.idlePerSecond.threat);
  assert.ok(theaterPressureView(state, A).control > 1);
});

check('multiple formations on the same theater stack', () => {
  const single = readyState();
  assignOperationalTask(single, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(single, 60);
  const stacked = readyState({ formations: 2 });
  assignOperationalTask(stacked, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  assignOperationalTask(stacked, 'f1', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(stacked, 60);
  approx(theaterPressureView(stacked, A).control, 2 * theaterPressureView(single, A).control, 1e-6);
});

check('all metrics clamp to 0~100 under extreme deltas', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.SECURITY, A);
  tickTheaterPressure(state, 1e9);
  const view = theaterPressureView(state, A);
  PRESSURE_METRICS.forEach((metric) => {
    assert.equal(view[metric], Math.max(0, Math.min(100, view[metric])));
    assert.ok(view[metric] >= 0 && view[metric] <= 100);
  });
  assert.equal(view.threat, 0);
  assert.equal(view.security, 100);
  // 威胁回升同样受上界限制
  recallOperationalTask(state, 'f0');
  tickTheaterPressure(state, 1e9);
  assert.equal(theaterPressureView(state, A).threat, 100);
});

check('pause (dt = 0) does not advance pressure', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickTheaterPressure(state, 100);
  const before = JSON.stringify(state.theaterPressure);
  tickTheaterPressure(state, 0);
  assert.equal(JSON.stringify(state.theaterPressure), before);
});

check('save / load preserves pressure values', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
    tickTheaterPressure(state, 250);
    const expected = theaterPressureView(state, A);
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    const view = theaterPressureView(loaded.state, A);
    ['control', 'threat'].forEach((metric) => approx(view[metric], expected[metric]));
  } finally { restore(); }
});

check('old saves without theaterPressure initialize to defaults', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    ensureTheaterPressure(state); // main.js 启动时同样会补齐
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY));
    assert.ok(raw.theaterPressure !== undefined, 'new saves carry the field');
    delete raw.theaterPressure;
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    const view = theaterPressureView(loaded.state, A);
    approx(view.threat, THEATER_PRESSURE.initial.threat);
    approx(view.control, 0);
    // 补齐后可正常推进
    tickTheaterPressure(loaded.state, 10);
    approx(theaterPressureView(loaded.state, A).threat, 50 + 10 * THEATER_PRESSURE.idlePerSecond.threat);
  } finally { restore(); }
});

check('online tick loop and offline settlement are equivalent', () => {
  const build = () => {
    const state = readyState();
    assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.SECURITY, A);
    return state;
  };
  const online = build();
  for (let i = 0; i < 120; i += 1) {
    tickOperationalTasks(online, 5);
    tickTheaterPressure(online, 5);
  }
  const offlineState = build();
  settleOfflineProgress(offlineState, 600, { createReport: false });
  const a = theaterPressureView(online, A);
  const b = theaterPressureView(offlineState, A);
  PRESSURE_METRICS.forEach((metric) => approx(a[metric], b[metric], 1e-6));
});

check('Stage10-A task lifecycle is unaffected by pressure ticking', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  for (let i = 0; i < 12; i += 1) {
    tickOperationalTasks(state, 5);
    tickTheaterPressure(state, 5);
  }
  const task = getOperationalTask(state, 'f0');
  approx(task.stats.timeSec, 60);
  assert.equal(task.stats.intervalsCharged, 2);
  assert.equal(task.stats.missedIntervals, 0);
  const recalled = recallOperationalTask(state, 'f0');
  assert.equal(recalled.ok, true);
  assert.equal(getOperationalTask(state, 'f0'), null);
});

check('pressure views and builders never mutate canonical state', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickTheaterPressure(state, 40);
  const before = JSON.parse(JSON.stringify(state));
  theaterPressureView(state, A);
  theaterTaskCounts(state, A);
  buildTheaterCommandModels(state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
});

check('theater tile exposes THREAT / CONTROL badges and inspector shows all four metrics', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  const model = buildTheaterCommandModels(state).find((m) => m.id === `theater:${A}`);
  const labels = model.badges.map((b) => b.label).join('|');
  assert.ok(/THREAT \d+/.test(labels), labels);
  assert.ok(/CTRL \d+/.test(labels), labels);
  assert.ok(labels.includes('任务 ×1'));
  const section = model.inspector.sections.find((s) => s.title.includes('THEATER PRESSURE'));
  assert.ok(section.rows.some((r) => r.label.startsWith('Threat')));
  assert.ok(section.rows.some((r) => r.label.startsWith('Control')));
  assert.ok(section.rows.some((r) => r.label.startsWith('Recon')));
  assert.ok(section.rows.some((r) => r.label.startsWith('Security')));
});

console.log(`\nStage 10-B theater pressure: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
