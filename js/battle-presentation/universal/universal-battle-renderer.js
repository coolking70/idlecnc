import { buildUniversalBattleHud, drawUniversalBattleHud, validateUniversalHud } from './universal-hud-policy.js';
import { buildUniversalRenderState } from './universal-render-state.js';
import { clampUniversalCamera, UNIVERSAL_CAMERA_MODES } from './universal-render-camera.js';
import { applyPresentationWorldTransform, canvasPointFromEvent, measurePresentationViewport, screenDeltaToWorld } from '../presentation-viewport.js';
import { drawUniversalDebugOverlay, normalizeDebugOverlayOptions } from './universal-debug-overlay.js';
import { drawEnvironmentScene } from '../environment/environment-renderer.js';
import { createAssetRuntime } from '../environment/asset-runtime.js';
import { buildProductionDrawSpecs } from '../environment/production-visual-draw-spec.js';
import { normalizeVisualUnitClass, visualUnitClassFamily } from '../environment/visual-unit-class.js';

const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const TAU = Math.PI * 2;
const COLORS = Object.freeze({
  ink: '#0a1714', paper: '#dcebd0', friendly: '#78d3ad', friendlyDark: '#2e806e', enemy: '#e27b6e', enemyDark: '#8f454c', neutral: '#e6bd6b', repair: '#c5b77a', smoke: '#8a9587', road: '#555e57'
});

const TERRAIN_STYLE = Object.freeze({
  open: { base: '#294532', accent: '#63815a' },
  road: { base: '#3a443d', accent: '#8a8c78' },
  fortified: { base: '#463c32', accent: '#8e725d' },
  generic: { base: '#263b2d', accent: '#61705a' }
});

const RESULT_LABEL = Object.freeze({ victory: '目标完成', pyrrhic: '代价取胜', withdraw: '有序撤离', defeat: '战线失守', wiped: '部队覆灭' });

function terrainStyle(plan) { return TERRAIN_STYLE[plan.scene?.terrain?.id] || TERRAIN_STYLE.generic; }
function worldPoint(point, bounds) { return { x: (Number(point?.x) || 0) * VIEW_WIDTH / Math.max(1, Number(bounds?.width) || 1200), y: (Number(point?.y) || 0) * VIEW_HEIGHT / Math.max(1, Number(bounds?.height) || 700) }; }
function alphaFor(effect) { return Math.max(0, Math.min(1, Number(effect.life) / Math.max(.001, Number(effect.maxLife) || 1))); }
function roundedRect(context, x, y, width, height, radius = 4) { if (typeof context.roundRect === 'function') { context.beginPath(); context.roundRect(x, y, width, height, radius); } else context.rect(x, y, width, height); }
function path(context, points) { if (!points.length) return; context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); }
function hash(x, y = 0) { const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return value - Math.floor(value); }

function drawTerrain(context, plan, bounds) {
  const style = terrainStyle(plan);
  context.fillStyle = style.base; context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  context.globalAlpha = .55;
  context.fillStyle = style.accent;
  for (let y = 16; y < VIEW_HEIGHT; y += 34) for (let x = (y % 72) - 8; x < VIEW_WIDTH; x += 58) {
    context.beginPath(); context.arc(x + hash(x, y) * 12, y + hash(y, x) * 8, 1 + hash(x + 3, y) * 2, 0, TAU); context.fill();
  }
  context.globalAlpha = 1;
}

function drawProp(context, prop, bounds) {
  const point = worldPoint(prop.position, bounds); const width = Number(prop.geometry?.width) || 20; const height = Number(prop.geometry?.height) || 10;
  context.save(); context.translate(point.x, point.y);
  const heavy = prop.cover === 'heavy';
  // Soft-cover structures remain readable as terrain while preserving a
  // visible actor silhouette when a route passes behind the cover band.
  context.globalAlpha = heavy ? .48 : .68;
  context.fillStyle = prop.type === 'bunker' || prop.type === 'checkpoint' ? '#5e5446' : heavy ? '#625846' : '#766c58'; context.strokeStyle = heavy ? '#b89a69' : '#b69c70'; context.lineWidth = heavy ? 2.4 : 1.5;
  if (prop.type === 'crater' || prop.type === 'ditch') { context.beginPath(); context.ellipse(0, 0, width, height, -.15, 0, TAU); context.fill(); context.stroke(); }
  else if (prop.type === 'barbed_wire') { context.setLineDash([3, 4]); context.beginPath(); context.moveTo(-width, 0); context.lineTo(width, 0); context.stroke(); context.setLineDash([]); for (let x = -width; x <= width; x += 10) { context.beginPath(); context.moveTo(x, -5); context.lineTo(x + 5, 5); context.stroke(); } }
  else if (heavy) { context.beginPath(); context.moveTo(-width, height); context.quadraticCurveTo(0, -height * .7, width, height); context.closePath(); context.fill(); context.stroke(); context.fillStyle = '#8b7655'; for (let x = -width + 5; x < width; x += 11) { context.beginPath(); context.arc(x, height * .35, 4, 0, TAU); context.fill(); } }
  else { context.fillRect(-width, -height, width * 2, height * 2); context.strokeRect(-width, -height, width * 2, height * 2); if (prop.type === 'watchtower') { context.fillStyle = '#aa9d70'; context.fillRect(-3, -height - 12, 6, 12); } }
  context.restore();
}

function drawConvoy(context, object, bounds) {
  const point = worldPoint(object.position, bounds); context.save(); context.translate(point.x, point.y); context.fillStyle = '#18251f'; roundedRect(context, -24, -12, 48, 24, 5); context.fill(); context.fillStyle = object.state === 'returned' || object.state === 'stopped' ? '#866a56' : '#c0ad73'; roundedRect(context, -17, -9, 30, 18, 3); context.fill(); context.fillStyle = '#6e806d'; context.fillRect(13, -7, 9, 14); context.fillStyle = '#111a17'; context.beginPath(); context.arc(-12, 12, 4, 0, TAU); context.arc(13, 12, 4, 0, TAU); context.fill(); context.restore();
}

function drawSceneObject(context, object, plan) {
  const kind = object.visualKind || object.kind; const point = worldPoint(object.position, plan.layout.bounds); const stateColor = object.state === 'secured' || object.state === 'recovered' || object.state === 'arrived' ? '#7fd7a6' : object.state === 'sweeping' ? '#e8ca7c' : '#d49d69';
  context.save();
  if (kind === 'convoy_vehicle' || kind === 'convoy') drawConvoy(context, object, plan.layout.bounds);
  else if (kind === 'salvage_site') { context.translate(point.x, point.y); context.fillStyle = 'rgba(228,191,104,.16)'; context.beginPath(); context.arc(0, 0, 34, 0, TAU); context.fill(); context.strokeStyle = stateColor; context.setLineDash([5, 4]); context.stroke(); context.setLineDash([]); context.fillStyle = '#ba9d69'; context.fillRect(-18, -8, 15, 14); context.fillRect(4, -7, 17, 13); context.fillStyle = '#e7d38d'; context.fillRect(-13, -5, 5, 5); }
  else if (kind === 'salvage_team') { context.translate(point.x, point.y); context.fillStyle = '#2d8e78'; context.beginPath(); context.arc(0, 0, 10, 0, TAU); context.fill(); context.strokeStyle = '#d6e3af'; context.beginPath(); context.moveTo(0, -7); context.lineTo(13, 0); context.stroke(); }
  else if (kind === 'search_sector') { context.translate(point.x, point.y); context.strokeStyle = stateColor; context.fillStyle = object.state === 'cleared' ? 'rgba(127,215,166,.12)' : 'rgba(231,198,113,.08)'; context.fillRect(-60, -32, 120, 64); context.setLineDash([7, 5]); context.strokeRect(-60, -32, 120, 64); context.setLineDash([]); context.fillStyle = stateColor; context.font = '700 11px sans-serif'; context.fillText(object.state === 'cleared' ? '已搜索' : object.state === 'sweeping' ? '搜索中' : '待搜索', -25, 4); }
  else { context.translate(point.x, point.y); context.fillStyle = object.state === 'secured' ? '#73d39d' : '#d8a55e'; context.strokeStyle = '#2c3b2d'; context.lineWidth = 2; context.fillRect(-15, -12, 30, 24); context.strokeRect(-15, -12, 30, 24); context.fillStyle = '#f0df9d'; context.fillRect(-3, -18, 6, 36); context.fillRect(-18, -3, 36, 6); }
  context.restore();
}

function drawInfantry(context, actor, bounds) {
  const positions = actor.memberPositions?.length ? actor.memberPositions : [{ ...actor.visualCenter, facing: actor.facing || 0 }]; const enemy = actor.side === 'enemy';
  for (const member of positions) {
    const point = worldPoint(member, bounds); context.save(); context.translate(point.x, point.y); context.rotate(member.facing || 0); context.fillStyle = 'rgba(7,16,13,.38)'; context.beginPath(); context.ellipse(2, 5, 7, 3, 0, 0, TAU); context.fill();
    context.strokeStyle = enemy ? '#b45e51' : '#79cda5'; context.lineWidth = 2.2; const stride = member.stance === 'stride' || member.stance === 'step' ? Math.sin(member.walkPhase || 0) * 3 : 0;
    context.beginPath(); context.moveTo(-2, 6); context.lineTo(-3 - stride, 13); context.moveTo(2, 6); context.lineTo(3 + stride, 13); context.stroke();
    context.fillStyle = enemy ? COLORS.enemyDark : COLORS.friendlyDark; context.beginPath(); context.ellipse(0, 1, 5.8, 9, 0, 0, TAU); context.fill(); context.fillStyle = enemy ? '#c66d5c' : '#d5bd80'; context.beginPath(); context.arc(0, -8, 3.6, 0, TAU); context.fill(); context.strokeStyle = '#152420'; context.lineWidth = member.role === 'rocket' ? 3.4 : 2.2; context.beginPath(); context.moveTo(2, -1); context.lineTo(member.role === 'rocket' ? 20 : 14, member.role === 'rocket' ? -7 : -2); context.stroke(); context.restore();
  }
}

function drawVehicle(context, actor, bounds) {
  const point = worldPoint(actor.visualCenter, bounds); const enemy = actor.side === 'enemy'; const tank = actor.type === 'mbt'; const scout = actor.type === 'scout_car' || actor.type === 'enemy_scout_car'; const repair = actor.type === 'repair_vehicle';
  context.save(); context.translate(point.x, point.y); if (actor.visualState === 'destroying') { context.globalAlpha = .62 + Math.abs(Math.sin((actor.stateProgress || 0) * 18)) * .28; context.translate(Math.sin((actor.stateProgress || 0) * 42) * 2, 0); }
  context.rotate(actor.facing || 0); context.fillStyle = 'rgba(7,16,13,.45)'; context.beginPath(); context.ellipse(4, 8, tank ? 30 : 22, 9, 0, 0, TAU); context.fill();
  context.fillStyle = '#17241f'; roundedRect(context, tank ? -30 : -22, tank ? -17 : -11, tank ? 60 : 44, tank ? 34 : 22, 6); context.fill(); context.fillStyle = enemy ? COLORS.enemyDark : repair ? COLORS.repair : COLORS.friendlyDark; roundedRect(context, tank ? -24 : -17, tank ? -13 : -8, tank ? 48 : 34, tank ? 26 : 16, 4); context.fill();
  if (tank) { context.fillStyle = enemy ? '#b45e51' : '#8bcdae'; roundedRect(context, -12, -10, 24, 20, 5); context.fill(); context.save(); context.translate(0, 0); context.rotate((actor.turretFacing || actor.facing || 0) - (actor.facing || 0)); context.fillStyle = '#1a2923'; context.fillRect(7 - (actor.recoil || 0), -3, 34, 6); context.restore(); context.fillStyle = '#d7c78e'; context.fillRect(-19, -17, 6, 34); context.fillRect(12, -17, 6, 34); }
  else { context.fillStyle = repair ? '#e0d39a' : enemy ? '#dc7963' : '#91cfae'; context.fillRect(-7, -5, 14, 10); if (scout) { context.strokeStyle = '#d9e6ad'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, 0); context.lineTo(0, -20); context.stroke(); } }
  if (actor.visualState === 'hit') { context.strokeStyle = '#fff0a8'; context.lineWidth = 3; context.beginPath(); context.arc(0, 0, tank ? 34 : 25, 0, TAU); context.stroke(); }
  context.restore();
}

function drawHybridTankOverlay(context, actor, point, bounds) {
  context.save(); context.translate(point.x, point.y); context.rotate(actor.turretFacing || actor.facing || 0); context.fillStyle = '#1a2923'; context.fillRect(-4, -2, 36, 4); context.fillStyle = actor.side === 'enemy' ? '#c66d5c' : '#b8e0a9'; context.beginPath(); context.arc(0, 0, 11, 0, TAU); context.fill(); context.restore();
}

function drawActor(context, actor, plan, options) {
  if (actor.visible === false) return;
  const point = worldPoint(actor.visualCenter, plan.layout.bounds);
  const spec = options.drawSpecByActor?.get(actor.id) || actor.drawSpec || {};
  const geometry = spec.finalDrawGeometry || spec;
  const visualClass = geometry.visualClass || spec.visualClass || normalizeVisualUnitClass(actor);
  const family = geometry.rendererFamily || visualUnitClassFamily(visualClass);
  const scale = Number(geometry.visualScaleBoost) || 1;
  const drawRect = geometry.drawRect || geometry.logicalRect || { width: 30, height: 22 };
  const assetDrawn = spec.assetMode !== 'procedural' && spec.assetId && options.assetRuntime?.draw(context, spec.assetId, point.x, point.y, drawRect.width, drawRect.height, actor.facing || 0);
  if (!assetDrawn) {
    context.save(); context.translate(point.x, point.y); context.scale(scale, scale); context.translate(-point.x, -point.y);
    if (family === 'infantry') drawInfantry(context, actor, plan.layout.bounds); else drawVehicle(context, actor, plan.layout.bounds);
    context.restore();
  } else if (spec.assetMode === 'hybrid' && visualClass === 'mbt') drawHybridTankOverlay(context, actor, point, plan.layout.bounds);
  const radius = Math.max(drawRect.width || 0, drawRect.height || 0) / 2;
  if (actor.alive && actor.cover?.inCover) { context.save(); context.strokeStyle = actor.side === 'enemy' ? 'rgba(231,177,116,.92)' : 'rgba(234,218,142,.92)'; context.fillStyle = actor.side === 'enemy' ? 'rgba(231,177,116,.12)' : 'rgba(234,218,142,.12)'; context.lineWidth = 2; context.beginPath(); context.arc(point.x, point.y, radius + 7, 0, Math.PI * 2); context.fill(); context.stroke(); context.restore(); }
  if (actor.alive && actor.visualStatus === 'repairing') { context.strokeStyle = '#e1c87b'; context.lineWidth = 2; context.setLineDash([4, 4]); context.beginPath(); context.arc(point.x, point.y, radius, 0, TAU); context.stroke(); context.setLineDash([]); }
  if (actor.alive && ['suppressed', 'take_cover'].includes(actor.visualState)) { context.save(); context.strokeStyle = '#e2b66d'; context.lineWidth = 2.5; context.setLineDash([3, 4]); context.beginPath(); context.arc(point.x, point.y, radius + 9, 0, TAU); context.stroke(); context.setLineDash([]); context.restore(); }
  if (actor.alive && actor.visualState === 'cover_fire') { context.save(); context.strokeStyle = '#f3c978'; context.lineWidth = 2; context.beginPath(); context.arc(point.x, point.y, radius + 7, -Math.PI * .7, Math.PI * .7); context.stroke(); context.restore(); }
  if (actor.alive && actor.visualState === 'retreat') { context.save(); context.strokeStyle = '#9ee2c1'; context.lineWidth = 2; context.setLineDash([7, 4]); context.beginPath(); context.arc(point.x, point.y, radius + 8, 0, TAU); context.stroke(); context.setLineDash([]); context.restore(); }
  if (actor.alive && actor.visualState === 'search_target') { context.save(); context.strokeStyle = '#b7c9da'; context.lineWidth = 1.5; context.beginPath(); context.arc(point.x, point.y, radius + 6, 0, TAU); context.stroke(); context.restore(); }
  const hpRatio = Math.max(0, Math.min(1, actor.hp / Math.max(1, actor.maxHp))); if (hpRatio < 1 && actor.alive) { context.fillStyle = 'rgba(5,10,8,.75)'; context.fillRect(point.x - 24, point.y - radius - 10, 48, 4); context.fillStyle = hpRatio < .35 ? '#df7d63' : '#d6c375'; context.fillRect(point.x - 24, point.y - radius - 10, 48 * hpRatio, 4); }
}

function drawWreck(context, wreck, bounds, options = {}) {
  const point = worldPoint(wreck, bounds); const infantry = wreck.wreckType === 'infantry_casualty_marker'; const tank = wreck.wreckType === 'tank_wreck'; const light = wreck.wreckType === 'light_vehicle_wreck'; const spec = wreck.drawSpec || {}; const entrySize = spec.worldSize || (tank ? { width: 60, height: 36 } : { width: 30, height: 18 }); const assetDrawn = spec.assetMode !== 'procedural' && spec.assetId && options.assetRuntime?.draw(context, spec.assetId, point.x, point.y, Number(entrySize.width) * VIEW_WIDTH / bounds.width, Number(entrySize.height) * VIEW_HEIGHT / bounds.height, wreck.angle || 0); if (assetDrawn) return; const width = infantry ? 9 : tank ? 30 : light ? 23 : 18; const height = infantry ? 5 : tank ? 14 : light ? 11 : 10; context.save(); context.translate(point.x, point.y); context.rotate(wreck.angle || 0); context.globalAlpha = .9;
  if (infantry) { context.fillStyle = '#6d6650'; context.beginPath(); context.ellipse(0, 0, width, height, 0, 0, TAU); context.fill(); context.strokeStyle = '#bca66f'; context.lineWidth = 1.5; context.beginPath(); context.moveTo(-6, -4); context.lineTo(6, 4); context.stroke(); }
  else { context.fillStyle = '#202925'; roundedRect(context, -width, -height, width * 2, height * 2, 5); context.fill(); context.fillStyle = tank ? '#4a5248' : '#5a6254'; roundedRect(context, -width * .7, -height * .7, width * 1.4, height * 1.4, 4); context.fill(); context.fillStyle = '#c97546'; context.fillRect(-width * .25, -height * .28, width * .35, height * .28); context.strokeStyle = '#c5c3a1'; context.lineWidth = 2; context.beginPath(); context.moveTo(-width * .65, -height * 1.1); context.lineTo(width * .65, height * 1.1); context.moveTo(width * .65, -height * 1.1); context.lineTo(-width * .65, height * 1.1); context.stroke(); }
  context.restore();
}

function drawDecals(context, decals, bounds) {
  for (const decal of decals || []) { const point = worldPoint(decal, bounds); const radius = Math.max(3, Number(decal.radius) || 8); const rotation = Number(decal.rotation) || 0; const scaleX = decal.kind === 'scorch' || decal.kind === 'burn_mark' ? 1.35 : decal.kind === 'crater' ? 1.15 : .9; const scaleY = decal.kind === 'crater' ? .62 : decal.kind === 'scorch' || decal.kind === 'burn_mark' ? .48 : .58; context.save(); context.translate(point.x, point.y); context.rotate(rotation); context.fillStyle = decal.kind === 'scorch' || decal.kind === 'burn_mark' ? 'rgba(24,28,23,.72)' : decal.kind === 'crater' ? 'rgba(25,31,26,.62)' : decal.kind === 'debris' ? 'rgba(75,61,43,.72)' : 'rgba(30,34,28,.54)'; context.beginPath(); context.ellipse(0, 0, radius * scaleX, radius * scaleY, 0, 0, TAU); context.fill(); if (decal.kind === 'crater') { context.strokeStyle = 'rgba(185,157,104,.4)'; context.lineWidth = Math.max(1, radius * .08); context.stroke(); } context.restore(); }
}

function drawProjectiles(context, projectiles, bounds) {
  for (const projectile of projectiles || []) { const start = worldPoint(projectile.start, bounds); const end = worldPoint(projectile, bounds); context.save(); context.strokeStyle = projectile.kind === 'cannon' ? '#fff0a8' : projectile.kind === 'rocket' ? '#f2b66e' : '#f5d27b'; context.globalAlpha = .72; context.lineWidth = Number(projectile.tracerWidth) || (projectile.kind === 'cannon' ? 4 : 2); context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke(); context.globalAlpha = 1; context.fillStyle = context.strokeStyle; context.beginPath(); context.arc(end.x, end.y, (Number(projectile.tracerWidth) || 2) * 1.1, 0, TAU); context.fill(); context.restore(); }
}

function drawSmoke(context, smoke, bounds) {
  for (const particle of smoke || []) { const point = worldPoint(particle, bounds); context.save(); context.globalAlpha = particle.alpha; context.fillStyle = '#879087'; context.beginPath(); context.arc(point.x, point.y, Number(particle.size) || 12, 0, TAU); context.fill(); context.restore(); }
}

function drawDebris(context, debris, bounds) {
  for (const item of debris || []) { const point = worldPoint(item, bounds); context.save(); context.translate(point.x, point.y); context.rotate(item.angle || 0); context.fillStyle = '#b18a5d'; context.globalAlpha = .72; context.fillRect(-(item.radius || 3), -1.5, (item.radius || 3) * 2, 3); context.restore(); }
}

function drawEffects(context, effects, bounds) {
  for (const effect of effects || []) {
    const alpha = alphaFor(effect); const target = worldPoint(effect, bounds); context.save(); context.globalAlpha = alpha;
    if (effect.start && effect.end) { const start = worldPoint(effect.start, bounds); const end = worldPoint(effect.end, bounds); context.strokeStyle = effect.kind === 'cannon' ? '#f5d27b' : effect.kind === 'welding' ? '#d6eff6' : '#ef9a67'; context.lineWidth = effect.kind === 'welding' ? 3 : 2; context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke(); }
    if (['impact', 'muzzle', 'hit_spark', 'muzzle_flash'].includes(effect.kind)) { context.strokeStyle = effect.kind.includes('muzzle') ? '#e9d889' : '#f7d489'; context.lineWidth = Number(effect.tracerWidth) || (effect.weaponKind === 'cannon' ? 4 : 2); context.beginPath(); context.arc(target.x, target.y, Number(effect.size) || 12, 0, TAU); context.stroke(); context.fillStyle = '#fff2ad'; context.beginPath(); context.arc(target.x, target.y, (Number(effect.impactScale) || 1) * (effect.weaponKind === 'cannon' ? 5 : 3), 0, TAU); context.fill(); }
    if (['destruction', 'explosion', 'heavy_impact'].includes(effect.kind)) { context.fillStyle = effect.kind === 'heavy_impact' ? '#efb65e' : '#ef9e50'; context.beginPath(); context.arc(target.x, target.y, Number(effect.size) * (.72 + alpha * .28), 0, TAU); context.fill(); context.fillStyle = '#fff0a8'; context.beginPath(); context.arc(target.x, target.y, Number(effect.size) * .32, 0, TAU); context.fill(); }
    if (effect.kind === 'muzzle_flash') { context.fillStyle = effect.weaponKind === 'cannon' ? '#fff0a8' : '#f7cf74'; const size = Number(effect.size || 12); context.beginPath(); if (effect.muzzleShape === 'small_flash' || effect.muzzleShape === 'rapid_flash') { context.arc(target.x, target.y, size * .55, 0, TAU); } else if (effect.muzzleShape === 'repair_spark') { context.arc(target.x, target.y, size * .35, 0, TAU); } else { context.moveTo(target.x, target.y); context.lineTo(target.x + size, target.y - size * .35); context.lineTo(target.x + size * .45, target.y); context.lineTo(target.x + size, target.y + size * .35); context.closePath(); } context.fill(); }
    if (effect.kind === 'welding') { context.strokeStyle = '#d9f5ff'; context.lineWidth = 2; for (let index = 0; index < 6; index += 1) { const angle = index * 1.05; context.beginPath(); context.moveTo(target.x, target.y); context.lineTo(target.x + Math.cos(angle) * Number(effect.size || 16) * alpha, target.y + Math.sin(angle) * Number(effect.size || 16) * alpha); context.stroke(); } }
    if (effect.kind === 'objective_ring') { context.strokeStyle = '#78d3ad'; context.lineWidth = 3; context.setLineDash([7, 5]); context.beginPath(); context.arc(target.x, target.y, Number(effect.size) * (1.1 - alpha * .25), 0, TAU); context.stroke(); context.setLineDash([]); }
    if (effect.kind === 'dust_cloud') { context.fillStyle = '#b09b70'; context.globalAlpha = alpha * .65; context.beginPath(); context.arc(target.x, target.y, Number(effect.size || 8) * (1.2 - alpha * .2), 0, TAU); context.fill(); }
    context.restore();
  }
}

function drawResultMark(context, plan, state) {
  const ratio = state.time / Math.max(1, Number(plan.timeline?.duration) || 30); if (ratio < .78 && !state.returning) return;
  const color = ['victory', 'pyrrhic'].includes(plan.source?.result) ? '#7fd7a6' : '#df8a78'; context.save(); context.fillStyle = 'rgba(7,16,13,.78)'; roundedRect(context, 470, 612, 340, 44, 7); context.fill(); context.strokeStyle = color; context.stroke(); context.fillStyle = color; context.font = '700 18px sans-serif'; context.textAlign = 'center'; context.fillText(RESULT_LABEL[plan.source?.result] || '行动结束', 640, 640); context.textAlign = 'start'; context.restore();
}

export function buildWorldRenderQueue(plan, state) {
  const items = [];
  for (const prop of plan.scene?.props || []) items.push({ kind: 'prop', value: prop, depth: Number(prop.position?.y) || 0, stableId: `prop:${prop.id || ''}` });
  for (const object of state.sceneObjects || []) items.push({ kind: 'sceneObject', value: object, depth: Number(object.position?.y) || 0, stableId: `scene:${object.id || ''}` });
  for (const actor of state.actors || []) items.push({ kind: 'actor', value: actor, depth: Number(actor.visualCenter?.y) || 0, stableId: `actor:${actor.id || ''}` });
  for (const wreck of state.wrecks || []) items.push({ kind: 'wreck', value: wreck, depth: Number(wreck.y) || 0, stableId: `wreck:${wreck.id || wreck.sourceActorId || ''}` });
  return items.sort((left, right) => left.depth - right.depth || left.stableId.localeCompare(right.stableId));
}

function drawWorldRenderQueue(context, plan, state, options) {
  for (const item of buildWorldRenderQueue(plan, state)) {
    if (item.kind === 'prop') drawProp(context, item.value, plan.layout.bounds);
    else if (item.kind === 'sceneObject') drawSceneObject(context, item.value, plan);
    else if (item.kind === 'actor') drawActor(context, item.value, plan, options);
    else if (item.kind === 'wreck') drawWreck(context, item.value, plan.layout.bounds, options);
  }
}

function drawScene(context, plan, state, options = {}) {
  const bounds = plan.layout?.bounds || { width: 1200, height: 700 }; const camera = state.camera || { x: 640, y: 360, zoom: .86 };
  context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT); context.fillStyle = '#0d1716'; context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  context.save(); context.translate(VIEW_WIDTH / 2, VIEW_HEIGHT / 2); context.scale(camera.zoom, camera.zoom); context.translate(-camera.x, -camera.y);
  drawEnvironmentScene(context, state.environment, bounds, { width: VIEW_WIDTH, height: VIEW_HEIGHT, drawSpecs: options.runtimeDrawSpecs || state.drawSpecs, assetRuntime: options.assetRuntime }); drawDecals(context, state.decals, bounds); drawDebris(context, state.debris, bounds); drawWorldRenderQueue(context, plan, state, { ...options, assetRuntime: options.assetRuntime });
  drawProjectiles(context, state.projectiles, bounds); drawEffects(context, state.effects, bounds); drawSmoke(context, state.smoke, bounds); drawUniversalDebugOverlay(context, plan, state, options); context.restore();
  // 战术状态、镜头和结果均由 screen-space HUD 绘制；地图层不再在角落叠加文字，
  // 避免自动镜头移动后把状态标签压到单位/目标上。
}

export class UniversalBattleRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.context = canvas?.getContext?.('2d'); this.options = normalizeDebugOverlayOptions({ showHud: true, ...options }); this.options.showHud = options.showHud !== false; this.assetRuntime = createAssetRuntime(); this.presentation = null; this.lastState = null; this.lastRuntimeDrawSpecs = null; this.lastScreenMetrics = null; this.lastTime = 0; this.activeBattle = null; this.cameraMode = 'overview'; this.autoCamera = true; this.cameraOverride = null; this.viewport = null; this.pointer = null;
    this._bindPointer();
    this.resizeObserver = typeof ResizeObserver === 'function' && canvas ? new ResizeObserver(() => this.resize()) : null; if (this.resizeObserver) this.resizeObserver.observe(canvas); this.resize();
  }
  resize() { if (!this.canvas) { this.viewport = { width: VIEW_WIDTH, height: VIEW_HEIGHT, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 }; return this.viewport; } this.viewport = measurePresentationViewport(this.canvas); const { width, height, dpr } = this.viewport; if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) { this.canvas.width = Math.floor(width * dpr); this.canvas.height = Math.floor(height * dpr); } return this.viewport; }
  _bindPointer() {
    if (!this.canvas?.addEventListener) return;
    this.canvas.style && (this.canvas.style.touchAction = 'none');
    this._onPointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
      event.preventDefault?.();
      const camera = this.lastState?.camera || { x: 640, y: 360, zoom: .86 };
      this.cameraOverride = clampUniversalCamera(camera);
      this.autoCamera = false;
      const point = canvasPointFromEvent(this.canvas, event);
      this.pointer = { id: event.pointerId, x: point.x, y: point.y, moved: false };
      this.canvas.setPointerCapture?.(event.pointerId);
      this.canvas.classList?.add('is-camera-dragging');
    };
    this._onPointerMove = (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const point = canvasPointFromEvent(this.canvas, event); const viewport = this.resize();
      const dx = screenDeltaToWorld(point.x - this.pointer.x, viewport, this.cameraOverride?.zoom); const dy = screenDeltaToWorld(point.y - this.pointer.y, viewport, this.cameraOverride?.zoom);
      if (Math.abs(dx) + Math.abs(dy) < .001) return;
      event.preventDefault?.(); this.pointer.x = point.x; this.pointer.y = point.y; this.pointer.moved = true;
      this.cameraOverride = clampUniversalCamera({ ...this.cameraOverride, x: this.cameraOverride.x - dx, y: this.cameraOverride.y - dy });
      if (this.activeBattle) this.render(this.activeBattle);
    };
    this._finishPointer = (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      this.canvas.releasePointerCapture?.(event.pointerId); this.canvas.classList?.remove('is-camera-dragging'); this.pointer = null;
    };
    this._onWheel = (event) => {
      if (!this.activeBattle) return;
      event.preventDefault?.(); const viewport = this.resize(); const current = this.lastState?.camera || { x: 640, y: 360, zoom: .86 }; const point = canvasPointFromEvent(this.canvas, event); const logicalX = (point.x - viewport.offsetX) / Math.max(.0001, viewport.scale); const logicalY = (point.y - viewport.offsetY) / Math.max(.0001, viewport.scale); const oldZoom = Number(current.zoom) || .86; const nextZoom = clampUniversalCamera({ ...current, zoom: oldZoom * (event.deltaY < 0 ? 1.1 : .9) }).zoom; const anchorX = current.x + (logicalX - 640) / oldZoom; const anchorY = current.y + (logicalY - 360) / oldZoom;
      this.autoCamera = false; this.cameraOverride = clampUniversalCamera({ x: anchorX - (logicalX - 640) / nextZoom, y: anchorY - (logicalY - 360) / nextZoom, zoom: nextZoom }); this.render(this.activeBattle);
    };
    this._onDoubleClick = (event) => { event.preventDefault?.(); this.resetCamera(); };
    this.canvas.addEventListener('pointerdown', this._onPointerDown); this.canvas.addEventListener('pointermove', this._onPointerMove); this.canvas.addEventListener('pointerup', this._finishPointer); this.canvas.addEventListener('pointercancel', this._finishPointer); this.canvas.addEventListener('wheel', this._onWheel, { passive: false }); this.canvas.addEventListener('dblclick', this._onDoubleClick);
  }
  setPresentation(presentation) { const changed = this.presentation?.plan !== presentation?.plan || this.presentation?.reportFingerprint !== presentation?.reportFingerprint; this.presentation = presentation || null; if (changed) { this.cameraOverride = null; this.autoCamera = true; } this.lastState = null; }
  reset() { this.presentation = null; this.activeBattle = null; this.lastState = null; this.lastRuntimeDrawSpecs = null; this.lastScreenMetrics = null; this.lastTime = 0; this.cameraOverride = null; this.autoCamera = true; this.pointer = null; this.canvas?.classList?.remove('is-camera-dragging'); }
  render(activeBattle, _dtReal = 0, exactSeconds = null) {
    if (!this.presentation?.ok) return false;
    this.activeBattle = activeBattle;
    const returning = activeBattle?.presentationPhase === 'returning'; const plan = this.presentation.plan; const duration = Math.max(.001, Number(activeBattle?.duration || plan.timeline.sourceDuration || 1)); const seconds = exactSeconds == null ? (returning ? plan.timeline.duration : Math.max(0, Number(activeBattle?.elapsed || 0) / duration * plan.timeline.duration)) : Math.max(0, Math.min(Number(plan.timeline.duration) || 1, Number(exactSeconds) || 0));
    const state = buildUniversalRenderState(plan, seconds, { presentationPhase: activeBattle?.presentationPhase, returnElapsed: activeBattle?.returnElapsed, returnDuration: activeBattle?.returnDuration, cameraMode: this.cameraMode, autoCamera: this.autoCamera, cameraOverride: this.cameraOverride }); this.assetRuntime.ensureAll(); const hud = buildUniversalBattleHud(activeBattle, this.presentation, state); const check = validateUniversalHud(hud); if (!check.ok) throw new Error(`invalid_universal_runtime_state:${check.errors.join(',')}`);
    this.lastState = state; this.lastTime = seconds; const viewport = this.resize(); const runtimeDrawSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: plan.layout?.bounds || { width: 1200, height: 700 }, viewport, manifest: undefined } }); this.lastRuntimeDrawSpecs = runtimeDrawSpecs; this.lastScreenMetrics = { metricSpace: 'final_css_pixels', geometrySource: 'production-final-draw-geometry', viewport: { ...viewport }, camera: { ...state.camera }, actors: runtimeDrawSpecs.actorSpecs.map((spec) => { const geometry = spec.finalDrawGeometry; const ready = spec.assetId ? this.assetRuntime.get(spec.assetId)?.status === 'ready' : false; return { ...geometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetStatus: spec.assetStatus, assetMode: spec.assetMode, factionVisualMode: spec.factionVisualMode, actualDrawPath: ready ? 'drawImage' : 'procedural-fallback', rendererGeometrySource: 'production-final-draw-geometry' }; }) }; if (!this.context) return true; const { width: cssWidth, height: cssHeight, dpr } = viewport; this.context.save(); this.context.setTransform(dpr, 0, 0, dpr, 0, 0); this.context.clearRect(0, 0, cssWidth, cssHeight); this.context.fillStyle = '#0d1716'; this.context.fillRect(0, 0, cssWidth, cssHeight); this.context.save(); applyPresentationWorldTransform(this.context, viewport); drawScene(this.context, plan, state, { ...this.options, assetRuntime: this.assetRuntime, runtimeDrawSpecs, drawSpecByActor: new Map(runtimeDrawSpecs.actorSpecs.map((spec) => [spec.actorId, spec])) }); this.context.restore(); this.context.restore(); drawUniversalBattleHud(this.context, hud, state, { showHud: this.options.showHud, screenSpace: true, screenWidth: cssWidth, screenHeight: cssHeight, screenDpr: dpr }); return true;
  }
  getTextState(options = {}) { if (!this.presentation?.ok) return null; const runtime = { ...(options.runtime || {}), cameraMode: options.cameraMode || this.cameraMode, autoCamera: options.autoCamera ?? this.autoCamera, cameraOverride: options.cameraOverride || this.cameraOverride }; return this.presentation.renderState.textAt(this.lastTime, { ...options, debugOverlay: this.options.debugOverlay, runtime }); }
  getAssetRuntimeState() { return { assets: this.assetRuntime.snapshot(), allReady: this.assetRuntime.allReady() }; }
  getActorScreenMetrics() { return this.lastScreenMetrics ? JSON.parse(JSON.stringify(this.lastScreenMetrics)) : null; }
  getActorRenderedBounds() { return this.lastScreenMetrics ? { ...this.getActorScreenMetrics(), rendererTime: this.lastTime } : null; }
  getActorScreenMetricsAt(seconds) {
    if (!this.lastScreenMetrics || !Number.isFinite(Number(seconds))) return null;
    if (Math.abs(this.lastTime - Number(seconds)) < .02) return this.getActorScreenMetrics();
    if (!this.presentation?.ok) return null;
    const state = this.presentation.renderState.atTime(Number(seconds)); const viewport = this.resize(); const specs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: this.presentation.plan.layout?.bounds || { width: 1200, height: 700 }, viewport } });
    return { metricSpace: 'final_css_pixels', geometrySource: 'production-final-draw-geometry', viewport: { ...viewport }, camera: { ...state.camera }, actors: specs.actorSpecs.map((spec) => ({ ...spec.finalDrawGeometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, assetStatus: spec.assetStatus, factionVisualMode: spec.factionVisualMode, actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : 'drawImage', rendererGeometrySource: 'production-final-draw-geometry' })) };
  }
  setAssetDisabled(assetId, value = true) { const result = this.assetRuntime.setDisabled(assetId, value); if (this.activeBattle) this.render(this.activeBattle); return { assets: result, allReady: this.assetRuntime.allReady() }; }
  setCameraMode(mode) { if (UNIVERSAL_CAMERA_MODES.includes(mode)) { this.cameraMode = mode; return true; } return false; }
  setAutoCamera(enabled) { this.autoCamera = enabled !== false; if (this.autoCamera) this.cameraOverride = null; return this.autoCamera; }
  setDebugOverlay(enabled, options = {}) { this.options = normalizeDebugOverlayOptions({ ...this.options, ...options, debugOverlay: enabled === true }); if (this.activeBattle) this.render(this.activeBattle); return this.options.debugOverlay; }
  getDebugOverlayState() { return { ...this.options }; }
  resetCamera() { this.cameraOverride = null; this.autoCamera = true; if (this.activeBattle) this.render(this.activeBattle); return true; }
  getInteractionState() { return { manual: Boolean(this.cameraOverride), dragging: Boolean(this.pointer), autoCamera: this.autoCamera, viewport: this.viewport ? { ...this.viewport } : null }; }
  destroy() { this.resizeObserver?.disconnect(); this.resizeObserver = null; if (this.canvas?.removeEventListener) { this.canvas.removeEventListener('pointerdown', this._onPointerDown); this.canvas.removeEventListener('pointermove', this._onPointerMove); this.canvas.removeEventListener('pointerup', this._finishPointer); this.canvas.removeEventListener('pointercancel', this._finishPointer); this.canvas.removeEventListener('wheel', this._onWheel); this.canvas.removeEventListener('dblclick', this._onDoubleClick); } this.reset(); }
}
