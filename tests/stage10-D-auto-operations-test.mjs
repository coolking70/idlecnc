import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FORMATION_STATUS, SAVE_VERSION } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { settleOfflineProgress } from '../js/offline.js';
import {
  OPERATIONAL_TASK_TYPE, assignOperationalTask, recallOperationalTask,
  getOperationalTask, tickOperationalTasks
} from '../js/tasking.js';
import { tickTheaterPressure, theaterPressureView } from '../js/theater-pressure.js';
import { DOCTRINE_TYPE, setDoctrine } from '../js/doctrine.js';
import {
  ensureAutoOperations, isAutoOperationsEnabled, setAutoOperationsEnabled,
  planAutoOperationalAssignment, runAutoOperationsPlanner,
  releaseAutoTaskHold, autoOperationsSummary
} from '../js/auto-operations.js';
import { buildFormationCommandModels, buildOverviewCommandModels, buildDoctrineModels } from '../js/command-presentation.js';

const A = 'scrap_mine';
const B = 'border_road';
const clone = (value) => JSON.parse(JSON.stringify(value));
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function readyState({ formations = 1, unlockB = false } = {}) {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  for (let i = 0; i < formations; i += 1) {
    const formationId = `f${i}`;
    const unitId = `u${i}`;
    state.units.push({
      id: unitId, type: 'mbt', hp: 100, maxHp: 100, damage: 'intact',
      status: 'assigned', formationId, experience: 0, battles: 0, callsign: null, createdAt: i
    });
    state.formations.push({
      id: formationId, name: `编队${i}`, unitIds: [unitId],
      status: FORMATION_STATUS.IDLE, createdAt: i
    });
  }
  if (unlockB) state.theaters[A].captured = true;
  recalcDerived(state);
  return state;
}

function localStorageShim() {
  const store = new Map();
  const shim = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key), clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  };
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: shim };
  return () => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; };
}

let passed = 0;
let total = 0;
function check(name, fn) {
  total += 1;
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { console.error(`  FAIL  ${name}: ${error?.stack || error}`); process.exitCode = 1; }
}

console.log('\n── Stage 10-D Auto Operations ──');

check('SAVE_VERSION remains 10 and fresh state defaults disabled', () => {
  const state = createInitialState();
  assert.equal(SAVE_VERSION, 10);
  assert.equal(state.autoOperations, undefined, 'Stage 9 byte-frozen state factory stays unchanged');
  assert.equal(ensureAutoOperations(state), true);
  assert.deepEqual(state.autoOperations, { enabled: false });
  assert.equal(isAutoOperationsEnabled(state), false);
});

check('missing / invalid old state canonicalizes fail-closed to disabled', () => {
  const state = {};
  assert.equal(isAutoOperationsEnabled(state), false);
  assert.equal(ensureAutoOperations(state), true);
  assert.deepEqual(state.autoOperations, { enabled: false });
  assert.equal(ensureAutoOperations(state), false);
});

check('disabled planner produces no automatic behavior', () => {
  const state = readyState();
  const before = clone(state);
  assert.deepEqual(runAutoOperationsPlanner(state), { enabled: false, assigned: [], skipped: [] });
  assert.deepEqual(state, before);
});

check('enabled assigns a legal idle formation via an auto-marked Operational Task', () => {
  const state = readyState();
  setAutoOperationsEnabled(state, true);
  const result = runAutoOperationsPlanner(state);
  assert.equal(result.assigned.length, 1);
  assert.equal(getOperationalTask(state, 'f0').autoAssigned, true);
  assert.equal(state.activeBattle, null);
});

for (const [doctrine, taskType] of [
  [DOCTRINE_TYPE.RECON, OPERATIONAL_TASK_TYPE.RECON],
  [DOCTRINE_TYPE.CONTROL, OPERATIONAL_TASK_TYPE.PATROL],
  [DOCTRINE_TYPE.SECURITY, OPERATIONAL_TASK_TYPE.SECURITY]
]) {
  check(`${doctrine.toUpperCase()} doctrine prioritizes ${taskType.toUpperCase()}`, () => {
    const state = readyState();
    setDoctrine(state, doctrine);
    setAutoOperationsEnabled(state, true);
    runAutoOperationsPlanner(state);
    assert.equal(getOperationalTask(state, 'f0').type, taskType);
  });
}

check('BALANCED chooses the largest pressure gap with documented stable ties', () => {
  const state = readyState();
  state.theaterPressure = { [A]: { threat: 25, control: 70, recon: 85, security: 20 } };
  assert.equal(planAutoOperationalAssignment(state).taskType, OPERATIONAL_TASK_TYPE.SECURITY);
  state.theaterPressure[A] = { threat: 10, control: 70, recon: 5, security: 80 };
  assert.equal(planAutoOperationalAssignment(state).taskType, OPERATIONAL_TASK_TYPE.RECON);
  state.theaterPressure[A] = { threat: 5, control: 5, recon: 90, security: 90 };
  assert.equal(planAutoOperationalAssignment(state).taskType, OPERATIONAL_TASK_TYPE.PATROL);
});

check('target selection picks lowest task metric / highest security need', () => {
  const recon = readyState({ unlockB: true });
  setDoctrine(recon, DOCTRINE_TYPE.RECON);
  recon.theaterPressure = {
    [A]: { threat: 50, control: 0, recon: 60, security: 0 },
    [B]: { threat: 50, control: 0, recon: 10, security: 0 }
  };
  assert.equal(planAutoOperationalAssignment(recon).theaterId, B);
  const security = readyState({ unlockB: true });
  setDoctrine(security, DOCTRINE_TYPE.SECURITY);
  security.theaterPressure = {
    [A]: { threat: 90, control: 0, recon: 0, security: 80 },
    [B]: { threat: 20, control: 0, recon: 0, security: 0 }
  };
  assert.equal(planAutoOperationalAssignment(security).theaterId, B, 'larger max(security gap, threat) wins');
});

check('locked theaters never participate even when their pressure is worst', () => {
  const state = readyState();
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  state.theaterPressure = {
    [A]: { threat: 0, control: 100, recon: 99, security: 100 },
    [B]: { threat: 100, control: 0, recon: 0, security: 0 }
  };
  assert.equal(planAutoOperationalAssignment(state).theaterId, A);
});

check('busy / battle / repairing / empty formations are skipped', () => {
  const state = readyState({ formations: 4 });
  state.formations[0].status = FORMATION_STATUS.FIGHTING;
  state.activeBattle = { formationId: 'f1' };
  state.units.find((u) => u.id === 'u2').status = 'repairing';
  state.formations[3].unitIds = [];
  setAutoOperationsEnabled(state, true);
  assert.equal(runAutoOperationsPlanner(state).assigned.length, 0);
  state.formations.forEach((formation) => assert.equal(getOperationalTask(state, formation.id), null));
});

check('existing tasks are never overwritten or rebalanced', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.PATROL, A);
  const before = clone(getOperationalTask(state, 'f0'));
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  setAutoOperationsEnabled(state, true);
  runAutoOperationsPlanner(state);
  assert.deepEqual(getOperationalTask(state, 'f0'), before);
});

check('manual recall creates AUTO HOLD and prevents immediate reassignment', () => {
  const state = readyState();
  setAutoOperationsEnabled(state, true);
  runAutoOperationsPlanner(state);
  assert.equal(recallOperationalTask(state, 'f0').ok, true);
  assert.equal(state.formations[0].autoTaskHold, true);
  runAutoOperationsPlanner(state);
  assert.equal(getOperationalTask(state, 'f0'), null);
  assert.equal(autoOperationsSummary(state).manualHold, 1);
});

check('auto-origin recall can opt out of hold', () => {
  const state = readyState();
  assignOperationalTask(state, 'f0', OPERATIONAL_TASK_TYPE.RECON, A, { autoAssigned: true });
  recallOperationalTask(state, 'f0', { manual: false });
  assert.notEqual(state.formations[0].autoTaskHold, true);
});

check('release hold makes the formation eligible again', () => {
  const state = readyState();
  setAutoOperationsEnabled(state, true);
  runAutoOperationsPlanner(state);
  recallOperationalTask(state, 'f0');
  assert.equal(releaseAutoTaskHold(state, 'f0').ok, true);
  runAutoOperationsPlanner(state);
  assert.ok(getOperationalTask(state, 'f0'));
  assert.equal(state.formations[0].autoTaskHold, false);
});

check('save/load preserves enabled, hold and autoAssigned', () => {
  const restore = localStorageShim();
  try {
    const state = readyState({ formations: 2 });
    setAutoOperationsEnabled(state, true);
    runAutoOperationsPlanner(state);
    recallOperationalTask(state, 'f1');
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.autoOperations.enabled, true);
    assert.equal(loaded.state.formations.find((f) => f.id === 'f1').autoTaskHold, true);
    assert.equal(getOperationalTask(loaded.state, 'f0').autoAssigned, true);
  } finally { restore(); }
});

check('old save without autoOperations loads disabled', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const raw = JSON.parse(globalThis.window.localStorage.getItem(SAVE_KEY));
    delete raw.autoOperations;
    globalThis.window.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.state.autoOperations, { enabled: false });
    assert.equal(getOperationalTask(loaded.state, 'f0'), null);
  } finally { restore(); }
});

check('planner is deterministic for identical state', () => {
  const a = readyState({ formations: 3, unlockB: true });
  setAutoOperationsEnabled(a, true);
  setDoctrine(a, DOCTRINE_TYPE.CONTROL);
  a.theaterPressure = {
    [A]: { threat: 80, control: 40, recon: 20, security: 10 },
    [B]: { threat: 20, control: 5, recon: 70, security: 80 }
  };
  const b = clone(a);
  assert.deepEqual(runAutoOperationsPlanner(a), runAutoOperationsPlanner(b));
  assert.deepEqual(a.formations, b.formations);
});

check('online/offline assignment and final task/pressure state are equivalent', () => {
  const build = () => {
    const state = readyState({ formations: 2, unlockB: true });
    setDoctrine(state, DOCTRINE_TYPE.SECURITY);
    setAutoOperationsEnabled(state, true);
    return state;
  };
  const online = build();
  runAutoOperationsPlanner(online);
  for (let i = 0; i < 120; i += 1) {
    online.time.game += 5;
    tickOperationalTasks(online, 5);
    tickTheaterPressure(online, 5);
    runAutoOperationsPlanner(online);
  }
  const offline = build();
  settleOfflineProgress(offline, 600, { createReport: false });
  for (const theaterId of [A, B]) {
    const av = theaterPressureView(online, theaterId);
    const bv = theaterPressureView(offline, theaterId);
    for (const metric of ['threat', 'control', 'recon', 'security']) approx(av[metric], bv[metric]);
  }
  assert.deepEqual(
    online.formations.map((f) => f.tasking),
    offline.formations.map((f) => f.tasking)
  );
});

check('presentation builders are read-only and show AUTO/AUTO HOLD + adjusted upkeep', () => {
  const state = readyState({ formations: 2 });
  setDoctrine(state, DOCTRINE_TYPE.RECON);
  setAutoOperationsEnabled(state, true);
  runAutoOperationsPlanner(state);
  recallOperationalTask(state, 'f1');
  const before = JSON.stringify(state);
  buildOverviewCommandModels(state);
  buildDoctrineModels(state);
  const models = buildFormationCommandModels(state);
  assert.equal(JSON.stringify(state), before);
  const auto = models.find((m) => m.id === 'formation:f0');
  assert.ok(auto.badges.some((b) => b.label === 'AUTO'));
  assert.ok(auto.inspector.sections.flatMap((s) => s.rows || []).some((r) => r.label === '周期消耗' && /7\.5/.test(r.value)));
  const hold = models.find((m) => m.id === 'formation:f1');
  assert.ok(hold.badges.some((b) => b.label === 'AUTO HOLD'));
  assert.ok(hold.inspector.actions.some((a) => a.id === 'release-auto-hold'));
});

check('planner contains no random/wall-clock or formal battle dispatch path', () => {
  const source = fs.readFileSync(new URL('../js/auto-operations.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.random|Date\.now|dispatchFormation|dispatchOperation/);
  assert.match(source, /assignOperationalTask/);
  const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.equal((css.match(/\.command-doctrine-grid \{ grid-template-columns/g) || []).length, 1);
});

console.log(`\nStage 10-D Auto Operations: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
