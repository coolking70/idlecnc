import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDING_STATUS, SAVE_VERSION, UNITS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { requestBuild, cancelConstruction } from '../js/construction.js';
import { queueEquipment, queueUnit, cancelCurrentProduction, cancelQueuedProduction } from '../js/production.js';
import {
  buildConstructionTileModels, buildEquipmentProductionTileModels,
  buildProductionQueueModels, buildUnitProductionTileModels
} from '../js/command-presentation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'evidence/stage10-P-A');
const clone = (value) => JSON.parse(JSON.stringify(value));

function normalize(state) {
  return {
    resources: { ...state.resources },
    buildings: (state.buildings || []).map((row) => ({ type: row.type, status: row.status, progress: row.progress })),
    construction: state.construction?.current ? { type: state.construction.current.type, elapsed: state.construction.current.elapsed, duration: state.construction.current.duration } : null,
    production: {
      current: state.production?.current ? { kind: state.production.current.kind || 'unit', type: state.production.current.type || null, equipmentId: state.production.current.equipmentId || null, duration: state.production.current.duration, costPaid: state.production.current.costPaid } : null,
      queue: (state.production?.queue || []).map((row) => ({ kind: row.kind || 'unit', type: row.type || null, equipmentId: row.equipmentId || null, duration: row.duration, costPaid: row.costPaid }))
    },
    units: (state.units || []).map((row) => row.type),
    equipmentInventory: (state.equipment?.inventory || []).map((row) => ({ equipmentId: row.equipmentId, quantity: row.quantity })),
    saveKeys: Object.keys(state).sort()
  };
}

function readyState() {
  const state = createInitialState();
  state.resources = { supply: 9000, alloy: 9000, intel: 900 };
  state.unlocks.units = Object.keys(UNITS);
  state.research.completed = ['modular_assembly', 'field_maintenance', 'composite_armor', 'expanded_storage'];
  state.buildings.push(
    { id: 'eq-barracks', type: 'barracks', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
    { id: 'eq-armor', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 }
  );
  recalcDerived(state);
  return state;
}

function performViaPresentation(state, model, cancel = false) {
  const payload = model.inspector?.actionPayload || {};
  if (cancel && model.inspector?.actionId === 'cancel-current-production') return cancelCurrentProduction(state);
  if (cancel && model.inspector?.actionId === 'cancel-queued-production') return cancelQueuedProduction(state, payload.jobId);
  if (model.actionId === 'build') return requestBuild(state, payload.typeId);
  if (model.actionId === 'produce-unit') return queueUnit(state, payload.unitType);
  if (model.actionId === 'produce-equipment') return queueEquipment(state, payload.equipmentId);
  return { ok: false, reason: 'no presentation action' };
}

const cases = [];

{
  const base = createInitialState(); const command = clone(base);
  recalcDerived(base); recalcDerived(command);
  assert.equal(requestBuild(base, 'supply_depot').ok, true);
  const model = buildConstructionTileModels(command).find((row) => row.id === 'construction:supply_depot');
  assert.equal(performViaPresentation(command, model).ok, true);
  assert.deepEqual(normalize(command), normalize(base));
  cancelConstruction(base); cancelConstruction(command);
  assert.deepEqual(normalize(command), normalize(base));
  cases.push({ domain: 'construction', equivalent: true, cancelEquivalent: true });
}

{
  const base = readyState(); const command = clone(base);
  ['infantry', 'infantry', 'mbt'].forEach((type) => assert.equal(queueUnit(base, type).ok, true));
  ['infantry', 'infantry', 'mbt'].forEach((type) => {
    const model = buildUnitProductionTileModels(command).find((row) => row.id === `unit:${type}`);
    assert.equal(performViaPresentation(command, model).ok, true);
  });
  assert.deepEqual(normalize(command), normalize(base));
  cases.push({ domain: 'unit_production', equivalent: true, rapidClicks: 3 });
}

{
  const base = readyState(); const command = clone(base);
  assert.equal(queueEquipment(base, 'anti_armor_sights').ok, true);
  assert.equal(queueEquipment(base, 'command_uplink').ok, true);
  for (const id of ['anti_armor_sights', 'command_uplink']) {
    const model = buildEquipmentProductionTileModels(command).find((row) => row.id === `equipment:${id}`);
    assert.equal(performViaPresentation(command, model).ok, true);
  }
  assert.deepEqual(normalize(command), normalize(base));
  const baseWaiting = base.production.queue[0].id;
  const commandWaitingModel = buildProductionQueueModels(command)[1];
  assert.equal(cancelQueuedProduction(base, baseWaiting).ok, true);
  assert.equal(performViaPresentation(command, commandWaitingModel, true).ok, true);
  assert.deepEqual(normalize(command), normalize(base));
  cases.push({ domain: 'equipment_production', equivalent: true, queuedCancelEquivalent: true });
}

{
  const state = readyState(); const before = clone(state);
  buildConstructionTileModels(state); buildUnitProductionTileModels(state);
  buildEquipmentProductionTileModels(state); buildProductionQueueModels(state);
  assert.deepEqual(state, before);
  cases.push({ domain: 'presentation_read_only', equivalent: true, canonicalFieldsAdded: [] });
}

const result = {
  stage: '10-P-A',
  saveVersion: SAVE_VERSION,
  comparison: 'legacy authority call vs presentation-model-resolved call',
  canonicalFieldsAdded: [],
  cases,
  passed: cases.every((row) => row.equivalent === true) && SAVE_VERSION === 10
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'stage10-P-A-state-equivalence.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ stage: result.stage, cases: cases.length, passed: result.passed }));
if (!result.passed) process.exitCode = 1;
