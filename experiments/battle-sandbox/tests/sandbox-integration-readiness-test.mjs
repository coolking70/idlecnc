import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATE_VISUAL_EVENTS, OBJECTIVE_NORTH_SLOTS, OBJECTIVE_SOUTH_SLOTS, SANDBOX_SEED } from '../sandbox-config.js';
import { TIME_EPSILON, getObjectiveStateAtTime } from '../sandbox-objective-director.js';
import { SANDBOX_DURATION, createSandboxState, getUnitVisualCenter, updateSandboxState } from '../sandbox-director.js';
import { boundsIntersect, getVisualBounds, seekSandboxState, validateCaptureState } from '../sandbox-capture-tools.js';
import { shouldDrawUnit } from '../sandbox-renderer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const projectRoot = path.resolve(root, '..', '..');
const unitAt = (state, id) => state.units.find((unit) => unit.id === id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const advanceWithStep = (state, target, step) => { while (state.time < target - TIME_EPSILON && !state.ended) updateSandboxState(state, Math.min(step, target - state.time)); return state; };
const stableState = (seconds, options) => JSON.stringify(seekSandboxState(seconds, options));

assert.equal(typeof seekSandboxState, 'function', 'seekSandboxState exists');
assert.equal(stableState(22.42), stableState(22.42), 'same absolute time is deterministic');
const oldState = seekSandboxState(8.8); const freshState = seekSandboxState(8.8); assert.equal(JSON.stringify(freshState), JSON.stringify(oldState), 'seek ignores prior state');
assert.equal(seekSandboxState(22.42, { step: 1 / 120 }).time, 22.42, '22.42 seek is exact');
assert.equal(seekSandboxState(35).time, 35, '35 seek is exact');
assert.equal(seekSandboxState(35).ended, true, '35 seek ends the sandbox');
assert.equal(seekSandboxState(17).paused, true, 'capture state is paused');
assert.equal(seekSandboxState(8.8).effects.length > 0, true, 'capture state contains time-appropriate effects');
assert.equal(seekSandboxState(22.82).wrecks.length, 1, 'seek creates one late wreck');
assert.equal(seekSandboxState(35).wrecks.length, 1, 'late seek does not duplicate wrecks');
assert.deepEqual(validateCaptureState(seekSandboxState(35), 35).ok, true, 'capture validator accepts exact final state');

const north = unitAt(seekSandboxState(31.6), 'f_inf_1'); const south = unitAt(seekSandboxState(31.6), 'f_inf_2');
assert.ok(north.visualCenter && south.visualCenter, 'infantry units expose visualCenter');
assert.deepEqual(unitAt(seekSandboxState(31.6), 'f_tank_2').visualCenter, { x: 815, y: 350 }, 'vehicle visual center equals anchor');
assert.ok(north.visualCenter.x >= 700 && north.visualCenter.x <= 760 && north.visualCenter.y >= 330 && north.visualCenter.y <= 360, 'north squad center is at objective north');
assert.ok(south.visualCenter.x >= 690 && south.visualCenter.x <= 755 && south.visualCenter.y >= 465 && south.visualCenter.y <= 495, 'south squad center is at objective south');
assert.ok(distance(north.visualCenter, { x: 435, y: 265 }) > 200, 'north squad center is not at the old cover');
assert.deepEqual(north.memberPositions.map(({ x, y }) => ({ x, y })), OBJECTIVE_NORTH_SLOTS.map(({ x, y }) => ({ x, y })), 'north members remain on objective slots');
assert.deepEqual(south.memberPositions.map(({ x, y }) => ({ x, y })), OBJECTIVE_SOUTH_SLOTS.map(({ x, y }) => ({ x, y })), 'south members remain on objective slots');
assert.notDeepEqual(seekSandboxState(24).units.find((unit) => unit.id === 'f_inf_1').visualCenter, north.visualCenter, 'center follows member movement');
assert.equal(seekSandboxState(31.6).units.find((unit) => unit.id === 'f_inf_1').x, north.x, 'anchor does not drift between repeated seeks');
const targetPulse = seekSandboxState(23.0).effects.find((effect) => effect.kind === 'tracer' && effect.source === 'f_inf_1');
assert.ok(targetPulse, 'infantry pulse exists at absolute time');
assert.ok(distance({ x: targetPulse.tx, y: targetPulse.ty }, getUnitVisualCenter(unitAt(seekSandboxState(23.0), 'e_inf_1'))) <= 8, 'infantry pulse uses visual target center');

const destroyed = seekSandboxState(22.82); const armor = unitAt(destroyed, 'e_armor_1');
assert.equal(destroyed.wrecks.filter((wreck) => wreck.sourceUnitId === 'e_armor_1').length, 1, 'wreck is created once');
assert.equal(shouldDrawUnit(armor, 22.82, destroyed.wrecks), true, 'destroyed unit remains during transition');
assert.equal(shouldDrawUnit(armor, 23.2, destroyed.wrecks), false, 'destroyed unit stops drawing after transition');
assert.equal(shouldDrawUnit(unitAt(seekSandboxState(35), 'e_armor_1'), 35, seekSandboxState(35).wrecks), false, 'final frame draws wreck only');
assert.equal(seekSandboxState(35).wrecks.length, 1, 'final frame has one wreck');
assert.equal(seekSandboxState(35).wrecks[0].id, 'wreck_e_armor_1', 'wreck id remains stable');
assert.equal(seekSandboxState(0).wrecks.length, 0, 'fresh seek clears wrecks');

const finalState = seekSandboxState(35); const tankTwo = unitAt(finalState, 'f_tank_2'); const wreck = finalState.wrecks[0]; const objective = { x: 760, y: 405 }; const northCenter = unitAt(finalState, 'f_inf_1').visualCenter;
assert.ok(distance(tankTwo, wreck) >= 60, 'tank two is at least 60px from wreck');
assert.equal(boundsIntersect(getVisualBounds(tankTwo), getVisualBounds(wreck)), false, 'tank two and wreck bounds do not intersect');
assert.ok(distance(tankTwo, objective) >= 50, 'tank two clears objective');
assert.ok(distance(tankTwo, northCenter) >= 50, 'tank two clears north infantry');
assert.ok(Math.cos(tankTwo.turretAngle) > 0, 'tank two turret remains oriented east');

assert.equal(getObjectiveStateAtTime(31.5).status, 'captured', '31.5 objective is captured');
assert.equal(getObjectiveStateAtTime(31.5).progress, 1, '31.5 progress is exactly one');
assert.equal(getObjectiveStateAtTime(31.5 - 0.5 * TIME_EPSILON).progress, 1, 'capture tolerance closes the boundary');
for (const step of [1 / 60, 1 / 120, 0.017]) { const state = advanceWithStep(createSandboxState(SANDBOX_SEED), 31.5, step); assert.equal(state.objective.status, 'captured', `capture at 31.5 with step ${step}`); assert.equal(state.objective.progress, 1, `capture progress at 31.5 with step ${step}`); }
for (const step of [1 / 60, 1 / 120, 0.017]) { const state = advanceWithStep(createSandboxState(SANDBOX_SEED), 35, step); assert.equal(state.time, 35, `end time with step ${step}`); assert.equal(state.ended, true, `end state with step ${step}`); }

const manifestPath = path.join(root, 'screenshots', 'capture-manifest.json'); assert.equal(fs.existsSync(manifestPath), true, 'capture manifest exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); assert.equal(manifest.frames.length, 12, 'manifest has twelve 21-32 captures');
const hashes = new Set();
for (const frame of manifest.frames) {
  const imagePath = path.join(root, 'screenshots', frame.file); assert.equal(fs.existsSync(imagePath), true, `capture exists: ${frame.file}`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'); hashes.add(hash); assert.equal(frame.sha256, hash, `manifest hash matches: ${frame.file}`); assert.ok(Math.abs(frame.actualTime - frame.requestedTime) <= 0.02, `capture time is exact: ${frame.file}`);
}
assert.equal(hashes.size, 12, '21-32 captures have unique hashes');
for (const [a, b] of [['14-tank-hit-11-5s.png', '15-infantry-suppressed-12s.png'], ['21-short-tracers-fixed.png', '24-tank-main-gun-22-4s.png'], ['26-infantry-bounding-advance-25s.png', '27-enemy-at-retreat-26s.png'], ['28-defense-collapse-29s.png', '29-objective-capturing-30s.png']]) assert.notEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'screenshots', a))).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'screenshots', b))).digest('hex'), `${a} and ${b} are different captures`);
const capture30 = manifest.frames.find((frame) => frame.file === '30-objective-captured-31-6s.png'); const capture32 = manifest.frames.find((frame) => frame.file === '32-final-regroup-35s.png'); assert.equal(capture30.keyState.objective, 'captured', 'capture 30 manifest state is captured'); assert.equal(capture32.keyState.ended, true, 'capture 32 manifest state is ended'); assert.equal(capture32.keyState.objective, 'captured', 'capture 32 manifest objective is captured'); assert.equal(capture32.keyState.wreckCount, 1, 'capture 32 manifest has one wreck');

const formalFiles = ['js', 'css', 'index.html', 'package.json', 'tests', 'scripts']; assert.ok(formalFiles.every((file) => fs.existsSync(path.join(projectRoot, file))), 'formal project boundary remains intact');
const source = fs.readdirSync(root).filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'); assert.ok(!source.includes('Math.random'), 'sandbox does not use Math.random'); assert.ok(!source.includes('Date.now'), 'sandbox does not use Date.now');
for (const file of fs.readdirSync(root).filter((file) => file.endsWith('.js'))) assert.equal((await import('node:child_process')).spawnSync(process.execPath, ['--check', path.join(root, file)]).status, 0, `syntax passes for ${file}`);

console.log('sandbox-integration-readiness-test: 53 passed');
