import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const inventory = read('stage8_2g_dc_effect_inventory.json');
const muzzle = read('stage8_2g_dc_muzzle_effect_check.json');
const impact = read('stage8_2g_dc_impact_effect_check.json');
const damage = read('stage8_2g_dc_damage_visual_check.json');
const destruction = read('stage8_2g_dc_destruction_effect_check.json');
const wreck = read('stage8_2g_dc_wreck_effect_check.json');
assert.equal(inventory.passed, true); assert.equal(muzzle.passed, true); assert.equal(impact.passed, true); assert.equal(damage.passed, true); assert.equal(destruction.passed, true); assert.equal(wreck.passed, true);
assert.ok(inventory.effectKinds.includes('rocket_trail')); assert.ok(inventory.effectKinds.includes('damage_smoke')); assert.ok(inventory.effectKinds.includes('wreck_fire')); assert.ok(inventory.effectKinds.includes('repair_spark'));
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C', effectKinds: inventory.effectKinds.length, muzzleRows: muzzle.rows.length, impactRows: impact.rows.length, destructionRows: destruction.rows.length, wreckRows: wreck.rows.length }));
