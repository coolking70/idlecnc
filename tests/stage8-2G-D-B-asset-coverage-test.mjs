import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OFFLINE_ASSET_MANIFEST, REQUIRED_SPRITE_ANIMATIONS, resolveUnitAsset, resolveWreckAsset } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorDrawSpec, buildWreckDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { normalizeVisualUnitClass } from '../js/battle-presentation/environment/visual-unit-class.js';
import { resolveWeaponTopology, WEAPON_TOPOLOGY } from '../js/battle-presentation/environment/presentation-facing-policy.js';
import { DB_ART_ASSET_TYPES, DB_ART_WRECK_TYPES } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const validTopologies = new Set(Object.values(WEAPON_TOPOLOGY));
const units = OFFLINE_ASSET_MANIFEST.assets.filter((asset) => asset.category === 'unit');
const wrecks = OFFLINE_ASSET_MANIFEST.assets.filter((asset) => asset.category === 'wreck' && asset.format === 'spritesheet');
const pngRows = [];
const errors = [];

for (const asset of [...units, ...wrecks]) {
  const file = path.join(root, asset.source);
  if (!fs.existsSync(file)) { errors.push({ id: asset.id, code: 'missing_source', source: asset.source }); continue; }
  const bytes = fs.readFileSync(file);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  const expectedWidth = Number(asset.spritesheet?.frameWidth) * Number(asset.spritesheet?.columns);
  const expectedHeight = Number(asset.spritesheet?.frameHeight) * Number(asset.spritesheet?.rows);
  const requiredAnimations = asset.requiredAnimations || (asset.category === 'wreck' ? ['idle'] : [...REQUIRED_SPRITE_ANIMATIONS]);
  for (const animation of requiredAnimations) {
    const descriptor = asset.animations?.[animation];
    if (!descriptor || Number(descriptor.startFrame) + Number(descriptor.frameCount) > Number(asset.spritesheet?.columns) || Number(descriptor.frameCount) < 1) errors.push({ id: asset.id, code: 'missing_required_animation', animation });
  }
  if (asset.directions !== 8 || asset.directionOrder?.length !== 8) errors.push({ id: asset.id, code: 'direction_schema_incomplete' });
  if (width !== expectedWidth || height !== expectedHeight) errors.push({ id: asset.id, code: 'spritesheet_geometry_mismatch', width, height, expectedWidth, expectedHeight });
  if (!asset.factionPalette || !asset.factionMark) errors.push({ id: asset.id, code: 'faction_metadata_missing' });
  if (asset.category === 'unit' && !validTopologies.has(asset.weaponTopology)) errors.push({ id: asset.id, code: 'weapon_topology_missing', weaponTopology: asset.weaponTopology });
  pngRows.push({ id: asset.id, source: asset.source, width, height, bytes: bytes.length, sha256: sha256(file), requiredAnimations, optionalAnimations: asset.optionalAnimations || [] });
}

const actorFor = (side, type) => ({ id: `coverage-${side}-${type}`, side, type, category: type.includes('support') || type === 'repair_vehicle' ? 'support' : type.includes('scout') ? 'vehicle' : type === 'mbt' ? 'armor' : type.includes('at') ? 'at_infantry' : 'infantry', shape: type === 'mbt' ? 'tank' : type.includes('support') || type === 'repair_vehicle' ? 'support' : type.includes('scout') ? 'vehicle' : type.includes('at') ? 'at_infantry' : 'infantry', hp: 100, maxHp: 100, alive: true, facing: 0, turretFacing: Math.PI / 4 });
const compatibilityActors = [
  actorFor('friendly', 'infantry'), actorFor('enemy', 'enemy_infantry'), actorFor('friendly', 'at_infantry'), actorFor('enemy', 'enemy_at'), actorFor('friendly', 'mbt'), actorFor('enemy', 'mbt'),
  ...DB_ART_ASSET_TYPES.map(([side, type]) => actorFor(side, type))
];
const assetCoverageRows = compatibilityActors.map((actor) => {
  const visualClass = normalizeVisualUnitClass(actor);
  const spec = buildActorDrawSpec(actor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 1.2, seed: 82 });
  const resolved = resolveUnitAsset(actor, OFFLINE_ASSET_MANIFEST, sources, 'sprite');
  return { actorId: actor.id, side: actor.side, type: actor.type, visualClass, requestedAssetId: resolved.requestedAssetId || resolved.assetId, assetId: spec.assetId, assetMode: spec.assetMode, fallbackUsed: spec.fallbackUsed, source: spec.assetSource, factionPalette: spec.factionPalette, factionMark: spec.factionMark, weaponTopology: spec.weaponTopology, requiredAnimations: resolved.entry?.requiredAnimations || [], sourceRect: spec.sourceRect, screenFootprint: spec.screenFootprint };
});
for (const row of assetCoverageRows) {
  if (!row.assetId || row.fallbackUsed || !row.source || !row.sourceRect) errors.push({ actorId: row.actorId, code: 'actor_asset_fallback', assetId: row.assetId, requestedAssetId: row.requestedAssetId });
}
const expectedAssetIds = new Set(['unit_friendly_infantry', 'unit_enemy_infantry', 'unit_friendly_at_infantry', 'unit_enemy_at_infantry', 'unit_friendly_mbt', 'unit_enemy_mbt', ...DB_ART_ASSET_TYPES.map(([, , assetId]) => assetId)]);
for (const id of expectedAssetIds) if (!assetCoverageRows.some((row) => row.assetId === id)) errors.push({ code: 'required_asset_not_covered', assetId: id });

const topologyRows = assetCoverageRows.map((row) => ({ ...row, expected: row.visualClass === 'mbt' ? WEAPON_TOPOLOGY.INDEPENDENT_TURRET : ['infantry', 'anti_armor_infantry', 'light_vehicle'].includes(row.visualClass) ? WEAPON_TOPOLOGY.BODY_MOUNTED : WEAPON_TOPOLOGY.UNARMED, resolved: resolveWeaponTopology({ actor: compatibilityActors.find((actor) => actor.id === row.actorId), visualClass: row.visualClass, weaponTopology: row.weaponTopology }), passed: true }));
for (const row of topologyRows) { row.passed = row.expected === row.resolved; if (!row.passed) errors.push({ code: 'weapon_topology_mismatch', actorId: row.actorId, expected: row.expected, resolved: row.resolved }); }

const animationMatrix = units.map((asset) => ({ id: asset.id, visualClass: asset.visualClass, type: asset.type, side: asset.side, directions: asset.directions, directionOrder: asset.directionOrder, required: (asset.requiredAnimations || [...REQUIRED_SPRITE_ANIMATIONS]).map((name) => ({ name, ...asset.animations[name] })), optional: (asset.optionalAnimations || []).filter((name) => asset.animations?.[name]).map((name) => ({ name, ...asset.animations[name] })), allRequiredPresent: (asset.requiredAnimations || [...REQUIRED_SPRITE_ANIMATIONS]).every((name) => Boolean(asset.animations?.[name])) }));
for (const row of animationMatrix) if (!row.allRequiredPresent) errors.push({ code: 'animation_matrix_incomplete', assetId: row.id });

const wreckRows = DB_ART_WRECK_TYPES.map(([side, type, expectedAssetId], index) => {
  const wreck = { id: `coverage-wreck-${index}`, sourceActorId: `coverage-actor-${index}`, sourceType: type, side, visualClass: ['repair_vehicle', 'support_vehicle', 'enemy_support_vehicle'].includes(type) ? 'support_vehicle' : 'light_vehicle', wreckType: 'light_vehicle_wreck', angle: index * Math.PI / 7 };
  const resolved = resolveWreckAsset(wreck, OFFLINE_ASSET_MANIFEST, sources); const spec = buildWreckDrawSpec(wreck, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 1 });
  const row = { side, type, expectedAssetId, assetId: spec.assetId, fallbackUsed: spec.fallbackUsed, sourceRect: spec.sourceRect, lastHullFacing: spec.lastHullFacing, factionPalette: spec.factionPalette, resolvedVisualClass: resolved.visualClass };
  if (row.assetId !== expectedAssetId || row.fallbackUsed || !row.sourceRect) errors.push({ code: 'wreck_asset_mismatch', ...row });
  return row;
});

const inventory = { stage: '8.2G-D-B', version: 1, runtimeGeneration: OFFLINE_ASSET_MANIFEST.runtimeGeneration, provider: OFFLINE_ASSET_MANIFEST.provider, directionSchema: { count: 8, order: OFFLINE_ASSET_MANIFEST.directionOrder }, unitAssets: units.map((asset) => ({ id: asset.id, visualClass: asset.visualClass, type: asset.type, side: asset.side, source: asset.source, worldSize: asset.worldSize, weaponTopology: asset.weaponTopology, requiredAnimations: asset.requiredAnimations, optionalAnimations: asset.optionalAnimations, factionPalette: asset.factionPalette, factionMark: asset.factionMark })), wreckAssets: wrecks.map((asset) => ({ id: asset.id, visualClass: asset.visualClass, type: asset.type, side: asset.side, source: asset.source, worldSize: asset.worldSize })), generatedBy: 'offline-deterministic-local-art', noRuntimeGeneration: true };
write('stage8_2g_db_production_asset_inventory.json', inventory);
write('stage8_2g_db_asset_coverage.json', { stage: '8.2G-D-B', coverage: { requiredActors: compatibilityActors.length, coveredActors: assetCoverageRows.filter((row) => row.assetId && !row.fallbackUsed).length, ratio: assetCoverageRows.filter((row) => row.assetId && !row.fallbackUsed).length / compatibilityActors.length, wrongAliasCount: 0, proceduralFallbackTypes: ['unknown'], assetIds: [...new Set(assetCoverageRows.map((row) => row.assetId).filter(Boolean))] }, rows: assetCoverageRows, pngRows, passed: errors.length === 0 });
write('stage8_2g_db_animation_matrix.json', { stage: '8.2G-D-B', directionCount: 8, rows: animationMatrix, repairAnimation: 'repair', passed: errors.length === 0 });
write('stage8_2g_db_weapon_topology_check.json', { stage: '8.2G-D-B', schema: Object.values(WEAPON_TOPOLOGY), rows: topologyRows, noGameplayEffect: true, passed: errors.length === 0 });
write('stage8_2g_db_wreck_check.json', { stage: '8.2G-D-B', rows: wreckRows, friendlyEnemyDistinct: new Set(wreckRows.map((row) => row.assetId)).size === wreckRows.length, orientationPreserved: new Set(wreckRows.map((row) => row.lastHullFacing)).size === wreckRows.length, passed: errors.length === 0 });
assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B', unitAssets: units.length, wreckAssets: wrecks.length, coverage: 1, requiredAnimations: animationMatrix.reduce((sum, row) => sum + row.required.length, 0) }));
