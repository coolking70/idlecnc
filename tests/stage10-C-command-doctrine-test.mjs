import assert from 'node:assert/strict';

/**
 * Stage 10-C — Command Doctrine targeted tests.
 *
 * 权威层：js/doctrine.js（setDoctrine / getActiveDoctrine / ensureDoctrine /
 * getTaskEffectMultiplier / getUpkeepMultiplier / scaleCost）。
 * tasking.js 与 theater-pressure.js 只通过 modifier selector 获取修正。
 */

import { FORMATION_STATUS, SAVE_VERSION } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { settleOfflineProgress } from '../js/offline.js';
import {
  OPERATIONAL_TASK, OPERATIONAL_TASK_TYPE,
  assignOperationalTask, getOperationalTask,
  tickOperationalTasks, recallOperationalTask
} from '../js/tasking.js';
import {
  THEATER_PRESSURE, PRESSURE_METRICS,
  theaterPressureView, tickTheaterPressure
} from '../js/theater-pressure.js';
import {
  DOCTRINE, DOCTRINE_TYPE,
  getActiveDoctrine, setDoctrine, ensureDoctrine,
  getTaskEffectMultiplier, getUpkeepMultiplier, scaleCost
} from '../js/doctrine.js';
import { buildDoctrineModels, buildTheaterCommandModels } from '../js/command-presentation.js';

const A = 'scrap_mine';
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function readyState() {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({
    id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact',
    status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0
  });
  state.formations.push({ id: 'f0', name: '编队0', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
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

console.log('\n── Stage 10-C command doctrine ──');

check('SAVE_VERSION remains 10', () => assert.equal(SAVE_VERSION, 10));

check('default doctrine is BALANCED (fresh + missing/invalid fields)', () => {
  assert.equal(getActiveDoctrine(createInitialState()), DOCTRINE_TYPE.BALANCED);
  assert.equal(getActiveDoctrine({}), DOCTRINE_TYPE.BALANCED);
  assert.equal(getActiveDoctrine({ doctrine: 'nonsense' }), DOCTRINE_TYPE.BALANCED);
  // createInitialState 不含 doctrine 键（state.js 保持 frozen）；ensure 幂等补写 BALANCED
  const fresh = createInitialState();
  assert.equal(ensureDoctrine(fresh), true);
  assert.equal(fresh.doctrine, DOCTRINE_TYPE.BALANCED);
  assert.equal(ensureDoctrine(fresh), false, 'second ensure is a no-op');
});

check('RECON modifier: recon effect +50%, other task effects unchanged', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  assert.equal(getTaskEffectMultiplier(state, 'recon', 'recon'), 1.5);
  assert.equal(getTaskEffectMultiplier(state, 'patrol', 'control'), 1);
  assert.equal(getTaskEffectMultiplier(state, 'security', 'threat'), 1);
  assert.equal(getTaskEffectMultiplier(state, 'recon', 'threat'), 1);
});

check('CONTROL modifier: patrol control effect +50%', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.CONTROL);
  assert.equal(getTaskEffectMultiplier(state, 'patrol', 'control'), 1.5);
  assert.equal(getTaskEffectMultiplier(state, 'patrol', 'threat'), 1);
  assert.equal(getTaskEffectMultiplier(state, 'recon', 'recon'), 1);
});

check('SECURITY modifier: security growth and threat suppression +50%', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.SECURITY);
  assert.equal(getTaskEffectMultiplier(state, 'security', 'security'), 1.5);
  assert.equal(getTaskEffectMultiplier(state, 'security', 'threat'), 1.5);
  assert.equal(getTaskEffectMultiplier(state, 'patrol', 'control'), 1);
});

check('upkeep modifiers: +25% for the favored task only', () => {
  const recon = readyState();
  setDoctrine(recon, DOCTRINE_TYPE.RECON);
  assert.equal(getUpkeepMultiplier(recon, 'recon'), 1.25);
  assert.equal(getUpkeepMultiplier(recon, 'patrol'), 1);
  assert.equal(getUpkeepMultiplier(recon, 'security'), 1);
  const control = readyState();
  setDoctrine(control, DOCTRINE_TYPE.CONTROL);
  assert.equal(getUpkeepMultiplier(control, 'patrol'), 1.25);
  const security = readyState();
  setDoctrine(security, DOCTRINE_TYPE.SECURITY);
  assert.equal(getUpkeepMultiplier(security, 'security'), 1.25);
  const balanced = readyState();
  assert.equal(getUpkeepMultiplier(balanced, 'recon'), 1);
  assert.deepEqual(scaleCost({ supply: 8 }, 1.25), { supply: 10 });
});

check('switching takes effect immediately (upkeep + pressure rates)', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickOperationalTasks(state, 30); // 1 个 BALANCED 周期：补给 6
  const supplyAfterBalanced = state.resources.supply;
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  tickOperationalTasks(state, 30); // 1 个 RECON 周期：补给 6 × 1.25 = 7.5
  const supplyAfterRecon = state.resources.supply;
  approx(supplyAfterBalanced - supplyAfterRecon, 7.5);
  // pressure: recon 增长切换后按 1.5×
  const state2 = readyState();
  assignOperationalTask(state2, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  setDoctrine(state2, DOCTRINE_TYPE.RECON);
  tickTheaterPressure(state2, 100);
  approx(theaterPressureView(state2, A).recon, 100 * 0.02 * 1.5);
});

check('switching does not retroactively change previous progress', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A);
  tickTheaterPressure(state, 100); // BALANCED：recon = 2
  const before = theaterPressureView(state, A).recon;
  approx(before, 2);
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  tickTheaterPressure(state, 100); // 只对之后的 100s 用 1.5×
  approx(theaterPressureView(state, A).recon, 2 + 3);
});

check('save / load preserves the active doctrine', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    setDoctrine(state, DOCTRINE_TYPE.SECURITY);
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    assert.equal(getActiveDoctrine(loaded.state), DOCTRINE_TYPE.SECURITY);
  } finally { restore(); }
});

check('old saves without doctrine fall back to BALANCED', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    ensureDoctrine(state); // main.js 启动时同样会补齐
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY));
    assert.ok(raw.doctrine !== undefined, 'new saves carry the field');
    delete raw.doctrine;
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    assert.equal(getActiveDoctrine(loaded.state), DOCTRINE_TYPE.BALANCED);
    assert.equal(ensureDoctrine(loaded.state), true, 'ensure canonicalizes to balanced');
    assert.equal(loaded.state.doctrine, 'balanced');
  } finally { restore(); }
});

check('online tick loop and offline settlement stay equivalent under a doctrine', () => {
  const build = () => {
    const state = readyState();
    setDoctrine(state, DOCTRINE_TYPE.SECURITY);
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
  PRESSURE_METRICS.forEach((metric) => approx(a[metric], b[metric]));
  approx(getOperationalTask(online, 'f0').stats.timeSec, getOperationalTask(offlineState, 'f0').stats.timeSec);
});

check('Stage10-A task lifecycle is unaffected by doctrine', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickOperationalTasks(state, 60);
  tickTheaterPressure(state, 60);
  const task = getOperationalTask(state, 'f0');
  approx(task.stats.timeSec, 60);
  assert.equal(task.stats.intervalsCharged, 2); // patrol 维护在 RECON 方针下不折价不涨价
  assert.equal(task.stats.missedIntervals, 0);
  assert.equal(recallOperationalTask(state, 'f0').ok, true);
  assert.equal(getOperationalTask(state, 'f0'), null);
});

check('BALANCED keeps Stage10-B base results exactly', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(state, 100);
  const view = theaterPressureView(state, A);
  approx(view.control, 100 * THEATER_PRESSURE.perTaskPerSecond.patrol.control);
  approx(view.threat, 50 + 100 * THEATER_PRESSURE.perTaskPerSecond.patrol.threat);
  const security = readyState();
  assignOperationalTask(security, 'f0', OPERATIONAL_TASK_TYPE.SECURITY, A);
  tickTheaterPressure(security, 100);
  approx(theaterPressureView(security, A).security, 100 * THEATER_PRESSURE.perTaskPerSecond.security.security);
  approx(theaterPressureView(security, A).threat, 50 + 100 * THEATER_PRESSURE.perTaskPerSecond.security.threat);
});

check('doctrine UI marks the active doctrine and exposes switch actions', () => {
  const state = readyState();
  let models = buildDoctrineModels(state);
  assert.equal(models.length, 4);
  const activeBalanced = models.find((m) => m.id === 'doctrine:balanced');
  assert.equal(activeBalanced.state, 'active');
  assert.ok(activeBalanced.badges.some((b) => b.label === 'ACTIVE'));
  assert.equal(activeBalanced.selected, true);
  assert.equal(models.find((m) => m.id === 'doctrine:recon').actionId, 'set-doctrine');
  assert.equal(models.find((m) => m.id === 'doctrine:recon').inspectOnClick, false);

  setDoctrine(state, DOCTRINE_TYPE.RECON);
  models = buildDoctrineModels(state);
  assert.equal(models.find((m) => m.id === 'doctrine:recon').selected, true);
  assert.equal(models.find((m) => m.id === 'doctrine:balanced').selected, false);
  const inspector = models.find((m) => m.id === 'doctrine:recon').inspector;
  assert.ok(inspector.rows.some((r) => /50%/.test(r.value)), JSON.stringify(inspector.rows));
  assert.ok(inspector.rows.some((r) => /25%/.test(r.value)));
});

check('doctrine selectors / builders never mutate canonical state', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.CONTROL);
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  tickTheaterPressure(state, 40);
  const before = JSON.parse(JSON.stringify(state));
  getActiveDoctrine(state);
  getTaskEffectMultiplier(state, 'patrol', 'control');
  getUpkeepMultiplier(state, 'patrol');
  buildDoctrineModels(state);
  buildTheaterCommandModels(state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
});

console.log(`\nStage 10-C command doctrine: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
