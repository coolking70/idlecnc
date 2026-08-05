import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRequestPath } from '../../../scripts/serve.mjs';
import { COVER_GROUPS, DEBUG_DEFAULTS, ENEMY_UNITS, FIRE_PLAN, FRIENDLY_UNITS, PATHS, SANDBOX_SEED } from '../sandbox-config.js';
import { buildTimelineSignature, createSandboxState, interpolatePath, updateSandboxState } from '../sandbox-director.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const files = fs.readdirSync(root).filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const assertBetween = (value, min, max, message) => assert.ok(value >= min && value <= max, `${message}: ${value}`);

assert.equal(FRIENDLY_UNITS.length, 7, 'fixed config has 7 friendly logic units');
assert.equal(ENEMY_UNITS.length, 7, 'fixed config has 7 enemy logic units');
assert.equal(createSandboxState().units.find((unit) => unit.id === 'f_inf_1').members.length, 4, 'infantry squad has 4 visual soldiers');
assert.equal(createSandboxState().units.find((unit) => unit.id === 'f_at_1').members.length, 3, 'AT squad has 3 visual soldiers');
assert.equal(buildTimelineSignature(SANDBOX_SEED), buildTimelineSignature(SANDBOX_SEED), 'same seed gives same timeline');
assert.ok(!files.includes('Math.random'), 'sandbox does not use Math.random');
assert.ok(!files.includes('Date.now'), 'sandbox does not use Date.now');
assertBetween(PATHS.f_scout_1[0].t, .5, 3.2, 'scout starts in advance window');
assert.notDeepEqual(PATHS.f_inf_1, PATHS.f_inf_2, 'two infantry lanes differ');
assert.notDeepEqual(PATHS.f_tank_1, PATHS.f_tank_2, 'two tank lanes differ');
assert.ok(PATHS.f_repair_1.filter((point) => point.t <= 10).every((point) => point.x <= 320), 'repair vehicle remains in rear route during opening');
for (const time of [4, 6, 8, 10]) { const sample = createSandboxState(); updateSandboxState(sample, time); const repair = sample.units.find((unit) => unit.id === 'f_repair_1'); const leadTank = Math.max(sample.units.find((unit) => unit.id === 'f_tank_1').x, sample.units.find((unit) => unit.id === 'f_tank_2').x); assert.ok(leadTank - repair.x >= 180, `repair stays 180px behind at ${time}s`); }
assert.notDeepEqual(COVER_GROUPS.enemyNorth, COVER_GROUPS.enemySouth, 'enemy uses different covers');
assert.notDeepEqual(createSandboxState().units.find((unit) => unit.id === 'e_inf_2').x, 0, 'all configured enemy units have a visible position');
assert.ok(FIRE_PLAN.filter((plan) => plan.t >= 7.4 && plan.t <= 9).length >= 5, 'overlapping fire plans exist');
assert.ok(FIRE_PLAN.some((plan) => plan.t === 8.1 && plan.type === 'cannon_shell'), 'tank cannon event at 8.1s');
assert.ok(FIRE_PLAN.some((plan) => plan.t === 8.5 && plan.type === 'rocket'), 'enemy rocket event at 8.5s');
assert.ok(PATHS.f_scout_1.some((point) => point.t === 8.8 && point.x === 680), 'scout disengages 8.0-9.5s');
const tenSecondState = createSandboxState(); updateSandboxState(tenSecondState, 10); assert.equal(tenSecondState.ended, false, 'scene continues into stage 8.2B at 10s'); const twentySecondState = createSandboxState(); updateSandboxState(twentySecondState, 20); assert.equal(twentySecondState.ended, false, 'scene continues into stage 8.2C at 20s'); const thirtyFiveSecondState = createSandboxState(); updateSandboxState(thirtyFiveSecondState, 35); assert.equal(thirtyFiveSecondState.ended, true, 'scene stops at 35s');
assert.equal(DEBUG_DEFAULTS.routes, false, 'debug routes default off'); assert.equal(DEBUG_DEFAULTS.coverRadius, false, 'cover radius default off'); assert.equal(DEBUG_DEFAULTS.labels, false, 'permanent labels default off');
const paused = createSandboxState(); paused.paused = true; updateSandboxState(paused, 2); assert.equal(paused.time, 0, 'paused state does not advance');
const oneX = createSandboxState(); const twoX = createSandboxState(); updateSandboxState(oneX, 1); updateSandboxState(twoX, 2); assert.equal(oneX.time, 1); assert.equal(twoX.time, 2); assert.equal(oneX.seed, twoX.seed, 'speed does not alter seed/config');
const restarted = createSandboxState(); updateSandboxState(restarted, 4); const fresh = createSandboxState(); assert.equal(fresh.time, 0, 'restart state begins at zero');
const configRef = JSON.stringify({ units: FRIENDLY_UNITS, path: PATHS.f_tank_1, fire: FIRE_PLAN }); const directorState = createSandboxState(); updateSandboxState(directorState, 8); assert.equal(JSON.stringify({ units: FRIENDLY_UNITS, path: PATHS.f_tank_1, fire: FIRE_PLAN }), configRef, 'director does not mutate config');
const rendererSource = fs.readFileSync(path.join(root, 'sandbox-renderer.js'), 'utf8'); assert.ok(rendererSource.includes('export function renderSandbox'), 'renderer exports renderSandbox'); assert.ok(rendererSource.includes('state.time'), 'renderer reads timeline state');
assert.deepEqual(interpolatePath(PATHS.f_scout_1, 0), { x: 170, y: 420, angle: 0, moving: false }, 'path starts from fixed position');
for (const file of fs.readdirSync(root).filter((file) => file.endsWith('.js'))) { const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' }); assert.equal(result.status, 0, `syntax check passes for ${file}`); }
assert.equal(resolveRequestPath('/experiments/battle-sandbox/').ok, true, 'local server resolves sandbox entry');
console.log('sandbox-opening-test: 28 passed');
