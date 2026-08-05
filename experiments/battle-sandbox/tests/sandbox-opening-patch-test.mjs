import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_SLOTS, ENEMY_REVEAL_TIMES, SANDBOX_SEED } from '../sandbox-config.js';
import { buildPulseTimes, getActivePulses, PULSE_SCHEDULES } from '../sandbox-pulse-scheduler.js';
import { createSandboxState, formationToCoverTransition, getRepairVehicleState, updateSandboxState } from '../sandbox-director.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readdirSync(root).filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const advanceTo = (state, elapsed) => { while (state.time < elapsed) updateSandboxState(state, Math.min(1 / 60, elapsed - state.time)); return state; };
const unitAt = (state, id) => state.units.find((unit) => unit.id === id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const at88 = advanceTo(createSandboxState(SANDBOX_SEED), 8.8);
assert.equal(unitAt(at88, 'f_inf_2').status, 'suppressing', 'south infantry actively suppresses');
assert.notEqual(unitAt(at88, 'f_inf_2').status, 'suppressed', 'south infantry is not self-suppressed');
assert.ok(buildPulseTimes('f_inf_1').length >= 5, 'north rifle has at least five sub-pulses');
assert.ok(buildPulseTimes('e_inf_1').length >= 5, 'enemy north rifle has at least five sub-pulses');
assert.ok(buildPulseTimes('f_inf_2').length >= 9, 'south suppression has at least nine sub-pulses');
assert.ok(buildPulseTimes('f_tank_2').length >= 7, 'tank coax has at least seven sub-pulses');
for (const action of Object.keys(PULSE_SCHEDULES)) { const pulses = buildPulseTimes(action); assert.ok(pulses.every((pulse, index) => index === 0 || pulse.start >= pulses[index - 1].start), `${action} pulses are monotonic`); assert.deepEqual(pulses, buildPulseTimes(action, SANDBOX_SEED), `${action} pulses are seeded`); assert.ok(pulses.every((pulse) => pulse.lifetime < 0.25), `${action} tracer lifetime is short`); assert.equal(getActivePulses(action, 35.5, SANDBOX_SEED).length, 0, `${action} expired pulses are omitted`); }
assert.ok(!source.includes('Math.random'), 'patch sandbox does not use Math.random');
assert.ok(!source.includes('Date.now'), 'patch sandbox does not use Date.now');
assert.ok(ENEMY_REVEAL_TIMES.e_inf_1.revealStart < ENEMY_REVEAL_TIMES.e_at_1.revealStart, 'north reveals in sequence');
assert.ok(ENEMY_REVEAL_TIMES.e_inf_1.revealEnd < ENEMY_REVEAL_TIMES.e_inf_3.revealStart, 'north infantry reveals before south infantry');
assert.ok(new Set(Object.values(ENEMY_REVEAL_TIMES).map((item) => item.revealStart)).size === 7, 'enemy reveal starts are independent');
assert.ok(new Set(Object.values(ENEMY_REVEAL_TIMES).map((item) => item.revealEnd)).size === 7, 'enemy reveal ends are independent');
assert.equal(getRepairVehicleState(9.9), 'moving', 'repair moves at 9.9s');
assert.equal(getRepairVehicleState(10), 'holding', 'repair holds at 10s');
for (const [group, slots] of Object.entries(COVER_SLOTS)) { assert.equal(slots.length, 4, `${group} has four cover slots`); for (let i = 0; i < slots.length; i += 1) for (let j = i + 1; j < slots.length; j += 1) assert.ok(distance(slots[i], slots[j]) >= 12, `${group} slots do not overlap`); }
const beforeTransition = advanceTo(createSandboxState(), 5.49); const afterTransition = advanceTo(createSandboxState(), 5.51); const beforeSlots = unitAt(beforeTransition, 'f_inf_1').memberPositions; const afterSlots = unitAt(afterTransition, 'f_inf_1').memberPositions; assert.ok(Math.max(...beforeSlots.map((slot, index) => distance(slot, afterSlots[index]))) < 5, 'formation-to-cover transition has no jump');
assert.ok(['drawCoverBack', 'drawCoverFront'].every((name) => fs.readFileSync(path.join(root, 'sandbox-renderer.js'), 'utf8').includes(name)), 'renderer supports cover back/front layers');
const activeSources = new Set(at88.effects.filter((effect) => effect.pulse).map((effect) => effect.source)); assert.ok(activeSources.has('f_inf_1') && activeSources.has('f_inf_2') && activeSources.has('f_tank_2'), '8.8s has three parallel pulse groups');
assert.equal(unitAt(at88, 'f_scout_1').status, 'moving', 'scout is disengaging at 8.8s');
const repair = unitAt(at88, 'f_repair_1'); const tank = unitAt(at88, 'f_tank_2'); assert.equal(repair.status, 'moving', 'repair still moves at 8.8s'); assert.ok(tank.x - repair.x >= 180, 'repair remains behind the main force');
const originalConfig = fs.readFileSync(path.join(root, 'sandbox-config.js'), 'utf8'); const configState = createSandboxState(); advanceTo(configState, 10); assert.equal(fs.readFileSync(path.join(root, 'sandbox-config.js'), 'utf8'), originalConfig, 'director does not mutate config');
for (const file of fs.readdirSync(root).filter((file) => file.endsWith('.js'))) assert.equal(spawnSync(process.execPath, ['--check', path.join(root, file)]).status, 0, `syntax passes for ${file}`);
console.log('sandbox-opening-patch-test: 30 passed');
