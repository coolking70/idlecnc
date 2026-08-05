import { COVER_GROUPS, ENEMY_BUILDINGS, FRIENDLY_BUILDINGS, INFANTRY_OFFSETS, OBJECTIVE, ROAD_POINTS, ROAD_WIDTH } from './sandbox-config.js';
import { activeFirePlans, getUnitVisualCenter } from './sandbox-director.js';
import { cameraAt, worldToScreen } from './sandbox-camera.js';
import { drawBadge } from './sandbox-assets.js';
import { getFlagHeight, getObjectiveLightColor } from './sandbox-objective-director.js';
import { getWreckSmoke } from './sandbox-wrecks.js';

const TAU = Math.PI * 2;
const css = { bg: '#0d1716', grass: '#30463b', grass2: '#3b5742', road: '#62645b', roadEdge: '#a59a79', friendly: '#8ed3c0', friendlyDark: '#1b6868', enemy: '#e38c70', enemyDark: '#873b40', cream: '#e6d5a7', ink: '#10221e', smoke: '#c3c0a5' };

function hash(x, y = 0) { const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return value - Math.floor(value); }
function polyline(context, points) { context.beginPath(); context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); }
function roundRect(context, x, y, w, h, radius) { context.beginPath(); context.roundRect(x, y, w, h, radius); }
function roadPath(context) { polyline(context, ROAD_POINTS); context.lineCap = 'round'; }

function drawTerrain(context, debug) {
  context.fillStyle = css.grass; context.fillRect(0, 0, 1280, 720);
  context.save(); context.globalAlpha = .18; context.fillStyle = css.grass2;
  for (let y = 16; y < 720; y += 34) for (let x = (y % 68) - 20; x < 1280; x += 58) { context.beginPath(); context.arc(x + hash(x, y) * 12, y + hash(y, x) * 10, 1.5 + hash(x + 2, y) * 2, 0, TAU); context.fill(); }
  context.restore();
  context.save(); roadPath(context); context.strokeStyle = '#26332f'; context.lineWidth = ROAD_WIDTH + 18; context.stroke();
  roadPath(context); context.strokeStyle = css.roadEdge; context.lineWidth = ROAD_WIDTH + 6; context.stroke();
  roadPath(context); context.strokeStyle = css.road; context.lineWidth = ROAD_WIDTH; context.stroke();
  context.setLineDash([26, 24]); roadPath(context); context.strokeStyle = 'rgba(221, 205, 155, .62)'; context.lineWidth = 3; context.stroke(); context.setLineDash([]);
  context.strokeStyle = 'rgba(29, 36, 32, .42)'; context.lineWidth = 6; context.setLineDash([45, 30]); context.lineDashOffset = 9; context.translate(0, 8); roadPath(context); context.stroke(); context.restore();
  context.save(); context.fillStyle = 'rgba(45, 39, 30, .42)';
  for (const [x, y, w, h] of [[310, 488, 72, 6], [600, 428, 90, 6], [910, 382, 68, 5], [515, 512, 40, 5]]) context.fillRect(x, y, w, h);
  context.restore();
  if (debug.routes) { context.save(); context.strokeStyle = 'rgba(255,255,255,.35)'; context.setLineDash([5, 7]); context.lineWidth = 2; context.restore(); }
}

function drawBuilding(context, building, enemy) {
  context.save(); context.translate(building.x, building.y);
  context.fillStyle = 'rgba(8, 15, 15, .42)'; context.fillRect(8, 10, building.w, building.h);
  context.fillStyle = enemy ? '#5b4540' : '#46544a'; context.fillRect(0, 0, building.w, building.h);
  context.strokeStyle = enemy ? '#b97b67' : '#879477'; context.lineWidth = 2; context.strokeRect(1, 1, building.w - 2, building.h - 2);
  context.fillStyle = enemy ? '#7c5248' : '#687561'; context.fillRect(-5, -10, building.w + 10, 16);
  context.strokeStyle = 'rgba(20, 29, 27, .6)'; context.lineWidth = 3; for (let x = 15; x < building.w; x += 28) { context.beginPath(); context.moveTo(x, -9); context.lineTo(x + 12, 5); context.stroke(); }
  context.fillStyle = enemy ? '#d47f63' : '#b3bd8c'; context.fillRect(building.w * .38, building.h * .56, building.w * .24, building.h * .44);
  context.fillStyle = 'rgba(225, 203, 135, .72)'; context.fillRect(building.w * .12, building.h * .28, 20, 12); context.fillRect(building.w * .75, building.h * .28, 20, 12);
  context.fillStyle = enemy ? '#b5564e' : '#9cbd91'; context.beginPath(); context.arc(building.w * .8, -17, 7, 0, TAU); context.fill(); context.fillRect(building.w * .8 - 1, -28, 2, 11);
  context.restore();
}

function drawCoverBack(context, group, enemy, debug) {
  for (const cover of group) {
    context.save(); context.translate(cover.x, cover.y); context.rotate(-.18);
    context.fillStyle = 'rgba(10, 19, 17, .45)'; context.fillRect(-27, 7, 58, 12);
    context.fillStyle = enemy ? '#76504a' : '#807558'; context.fillRect(-26, -4, 52, 12); context.restore();
    if (debug.coverRadius) { context.save(); context.strokeStyle = 'rgba(255,255,255,.3)'; context.setLineDash([4, 5]); context.beginPath(); context.arc(cover.x, cover.y, 32, 0, TAU); context.stroke(); context.restore(); }
  }
}

function drawCoverFront(context, group, enemy) {
  for (const cover of group) {
    context.save(); context.translate(cover.x, cover.y); context.rotate(-.18);
    context.fillStyle = enemy ? '#9d6556' : '#ad9a71';
    for (let i = -20; i <= 20; i += 13) { context.beginPath(); context.arc(i, 7, 4.5, Math.PI, TAU); context.fill(); }
    context.fillStyle = enemy ? '#76504a' : '#807558'; context.fillRect(-26, 7, 52, 4);
    context.strokeStyle = 'rgba(227, 208, 153, .3)'; context.lineWidth = 1.5; context.strokeRect(-26, 6, 52, 5); context.restore();
  }
}

function drawObjective(context, time, objectiveState) {
  const progress = objectiveState?.progress || 0; const light = getObjectiveLightColor(time); const flagHeight = getFlagHeight(time);
  context.save(); context.translate(OBJECTIVE.x, OBJECTIVE.y); context.fillStyle = 'rgba(9, 18, 17, .48)'; context.fillRect(-7, 0, 12, 46); context.fillStyle = '#c8845d'; context.fillRect(-4, -34, 3, 78); context.fillStyle = progress >= 1 ? '#69c995' : '#d98567'; context.beginPath(); context.moveTo(0, -34 + (42 - flagHeight)); context.lineTo(26, -26 + (42 - flagHeight)); context.lineTo(0, -17 + (42 - flagHeight)); context.fill(); context.fillStyle = light; context.beginPath(); context.arc(15, 8, 5 + Math.sin(time * 5) * 1.5, 0, TAU); context.fill(); context.fillStyle = '#302d28'; context.fillRect(-18, 39, 34, 8);
  if (progress > 0 && progress < 1) { context.strokeStyle = 'rgba(233, 161, 92, .85)'; context.lineWidth = 3; context.beginPath(); context.arc(0, 4, 30, -Math.PI / 2, -Math.PI / 2 + TAU * progress); context.stroke(); }
  if (progress >= 1) { context.strokeStyle = 'rgba(114, 211, 154, .85)'; context.lineWidth = 2; context.beginPath(); context.arc(0, 4, 30, 0, TAU); context.stroke(); }
  context.fillStyle = '#1e2a26'; context.fillRect(-25, 31, 16, 8); context.fillStyle = light; context.fillRect(-22, 33, 10, 3); context.restore();
}

function drawShadow(context, x, y, rx, ry, alpha = .4) { context.save(); context.fillStyle = `rgba(8, 13, 13, ${alpha})`; context.beginPath(); context.ellipse(x + 5, y + 8, rx, ry, -.08, 0, TAU); context.fill(); context.restore(); }

function drawDamageSmoke(context, unit, time) {
  const level = unit.visualDamage?.smokeLevel || 0;
  if (!level) return;
  context.save(); context.globalAlpha = Math.min(.72, level * .72); context.fillStyle = '#777c73';
  const lift = Math.sin(time * 1.8 + unit.x) * 3;
  context.beginPath(); context.arc(unit.x - 5, unit.y - 19 + lift, 8 + level * 4, 0, TAU); context.arc(unit.x + 6, unit.y - 28 + lift, 10 + level * 5, 0, TAU); context.arc(unit.x + 15, unit.y - 20 + lift, 7 + level * 3, 0, TAU); context.fill(); context.restore();
}

function drawInfantry(context, unit, time, enemy, at = false) {
  const members = unit.members;
  const positions = unit.memberPositions?.length ? unit.memberPositions : members.map((member) => ({ x: unit.x + member.x, y: unit.y + member.y, facing: unit.angle, stance: 'moving' }));
  for (const [index, member] of members.entries()) {
    const sway = unit.status === 'moving' ? Math.sin(time * 10 + member.index) * 2 : Math.sin(time * 2 + member.index) * .5;
    const position = positions[index] || positions[0]; const x = position.x + (position.stance === 'moving' ? sway : 0); const y = position.y + (position.stance === 'moving' ? sway * .35 : 0); const crouched = position.stance === 'crouch';
    drawShadow(context, x, y, 7, 3, .5); context.save(); context.translate(x, y); context.rotate(position.facing ?? unit.angle);
    if (crouched) context.translate(0, 3);
    context.fillStyle = enemy ? css.enemyDark : css.friendlyDark; context.beginPath(); context.ellipse(0, 2, 5, crouched ? 6 : 8, 0, 0, TAU); context.fill();
    context.fillStyle = enemy ? '#cf765f' : '#d3b675'; context.beginPath(); context.arc(0, crouched ? -4 : -6, 3.2, 0, TAU); context.fill();
    context.strokeStyle = enemy ? '#3e2829' : '#172d2d'; context.lineWidth = 2.2; context.beginPath(); context.moveTo(2, -1); context.lineTo(11, at && member.role === 'rocket' ? -4 : -2); context.stroke();
    if (at && member.role === 'rocket') { context.lineWidth = 3; context.strokeStyle = enemy ? '#d18469' : '#c5c2a0'; context.beginPath(); context.moveTo(0, -1); context.lineTo(18, -5); context.stroke(); }
    context.restore();
  }
}

function drawVehicle(context, unit, time, enemy) {
  const isTank = unit.type === 'mbt'; const isScout = unit.type === 'scout_car'; const isRepair = unit.type === 'repair_vehicle'; const isDisabled = unit.id === 'e_armor_2' && unit.status === 'disabled'; const isDestroyed = unit.status === 'destroyed'; const fire = !['f_tank_2', 'e_armor_2'].includes(unit.id) && !['disabled', 'destroyed', 'escaped'].includes(unit.status) && activeFirePlans(time).some((plan) => plan.source === unit.id) && (unit.visualDamage?.turretOperational ?? true);
  drawShadow(context, unit.x, unit.y, isTank ? 29 : 20, isTank ? 12 : 8, .55);
  context.save(); context.translate(unit.x, unit.y); context.rotate(unit.angle + (isDisabled ? unit.visualDamage?.disabledPose?.bodyTilt || 0.14 : 0));
  if (isTank) {
    context.fillStyle = '#161f1d'; roundRect(context, -29, -17, 58, 34, 7); context.fill(); context.fillStyle = isDisabled ? '#292e2d' : enemy ? css.enemyDark : '#2b6b61'; roundRect(context, -23, -13, 46, 26, 5); context.fill(); context.fillStyle = isDisabled ? '#3a403c' : enemy ? '#af604e' : '#75bda7'; roundRect(context, -12, -10, 26, 20, 5); context.fill();
    context.save(); context.rotate(unit.turretAngle - unit.angle + (isDisabled ? unit.visualDamage?.disabledPose?.turretAngleOffset || -0.45 : 0)); context.fillStyle = isDisabled ? '#333936' : enemy ? '#ae6250' : '#9bd5b5'; roundRect(context, -10, -9, 23, 18, 4); context.fill(); context.fillStyle = '#172522'; context.fillRect(8, -3, 38, 6); context.fillStyle = isDisabled ? '#3b413d' : '#f0cd83'; context.fillRect(42, -2, 9, 4); if (!isDisabled && (unit.status === 'aiming' || unit.status === 'recoiling' || fire)) { context.fillStyle = '#ffe8a2'; context.beginPath(); context.moveTo(52, 0); context.lineTo(68, -7); context.lineTo(61, 0); context.lineTo(68, 7); context.fill(); } context.restore();
    context.fillStyle = 'rgba(215, 202, 149, .65)'; context.fillRect(-18, -17, 7, 34); context.fillRect(11, -17, 7, 34);
    if (unit.visualDamage?.state === 'damaged' || unit.visualDamage?.state === 'being_repaired' || unit.visualDamage?.state === 'stabilized') { context.fillStyle = '#282c27'; context.fillRect(-18, 10, 7, 5); context.fillStyle = '#b8a46e'; context.fillRect(11, 10, 7, 3); }
    if (isDisabled) { context.fillStyle = '#181d1b'; context.fillRect(-18, 13, 7, 5); context.fillRect(11, 13, 7, 5); }
  } else {
    context.fillStyle = '#182421'; roundRect(context, -21, -10, 42, 20, 5); context.fill(); context.fillStyle = isDisabled ? '#292e2d' : isDestroyed ? '#353a35' : enemy ? '#9a4f49' : isRepair ? '#b4a875' : '#438b7e'; roundRect(context, -16, -8, 32, 16, 4); context.fill(); context.fillStyle = isDisabled ? '#3a403c' : isDestroyed ? '#252a27' : enemy ? '#de8568' : '#9cd0ad'; context.fillRect(-7, -5, 14, 10); context.fillStyle = '#1a2825'; context.fillRect(-18, -12, 7, 24); context.fillRect(11, -12, 7, 24); context.save(); context.rotate(-unit.angle * .3 + Math.sin(time * 1.8) * .15); if (!isDestroyed && !isDisabled) { context.strokeStyle = isScout ? '#bddb9d' : '#d7b777'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, 0); context.lineTo(0, -16); context.stroke(); context.beginPath(); context.arc(0, -18, 3, 0, TAU); context.fillStyle = '#ddc986'; context.fill(); } if (isDisabled) { context.fillStyle = '#111817'; context.fillRect(5, -3, 22, 6); context.fillStyle = '#4f4034'; context.fillRect(-8, -5, 9, 10); } if (isRepair) { const pose = unit.repairArmPose || { extension: 0, angle: -0.85 }; context.save(); context.rotate(pose.angle); context.lineWidth = 3; context.beginPath(); context.moveTo(5, -4); context.lineTo(20 + pose.extension * 16, -13 - pose.extension * 8); context.stroke(); if (pose.active) { context.fillStyle = '#d8f1ff'; context.beginPath(); context.arc(20 + pose.extension * 16, -13 - pose.extension * 8, 4, 0, TAU); context.fill(); } context.restore(); } context.restore();
  }
  context.restore();
  if (isTank || isDisabled) drawDamageSmoke(context, unit, time);
  if (fire && Math.sin(time * 24) > -.2) { context.save(); const muzzle = { x: unit.x + Math.cos(unit.turretAngle) * (isTank ? 50 : 20), y: unit.y + Math.sin(unit.turretAngle) * (isTank ? 50 : 20) }; context.fillStyle = '#ffe39a'; context.globalAlpha = .9; context.beginPath(); context.arc(muzzle.x, muzzle.y, isTank ? 13 : 7, 0, TAU); context.fill(); context.restore(); }
}

function drawUnit(context, unit, time) {
  context.save(); context.globalAlpha = unit.alpha;
  const enemy = unit.side === 'enemy';
  if (unit.type === 'infantry' || unit.type === 'enemy_infantry') drawInfantry(context, unit, time, enemy);
  else if (unit.type === 'at_infantry' || unit.type === 'enemy_at') drawInfantry(context, unit, time, enemy, true);
  else drawVehicle(context, unit, time, enemy);
  if (unit.status === 'taking_cover') { context.fillStyle = enemy ? 'rgba(224, 117, 90, .55)' : 'rgba(128, 217, 174, .55)'; context.fillRect(unit.x - 10, unit.y + 14, 20, 2); }
  context.restore();
}

export function shouldDrawUnit(unit, time, wrecks = []) {
  if (unit.status !== 'destroyed') return true;
  const hasWreck = wrecks.some((wreck) => wreck.sourceUnitId === unit.id);
  return !(hasWreck && time >= (unit.destroyedAt ?? time) + 0.38);
}

export function getTracerSegment(effect) {
  const progress = Math.max(0, Math.min(1, 1 - effect.life / effect.maxLife));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const head = { x: lerp(effect.sx, effect.tx, progress), y: lerp(effect.sy, effect.ty, progress) };
  const totalDistance = Math.hypot(effect.tx - effect.sx, effect.ty - effect.sy);
  const segmentLength = effect.fast ? 34 : 22;
  const tailProgress = Math.max(0, progress - segmentLength / Math.max(1, totalDistance));
  const tail = { x: lerp(effect.sx, effect.tx, tailProgress), y: lerp(effect.sy, effect.ty, tailProgress) };
  return { tail, head, length: Math.hypot(head.x - tail.x, head.y - tail.y) };
}

function drawEffect(context, effect) {
  const alpha = Math.max(0, Math.min(1, effect.life / effect.maxLife)); context.save(); context.globalAlpha = alpha;
  if (effect.kind === 'dust' || effect.kind === 'ground_dust' || effect.kind === 'damaged_track_dust' || effect.kind === 'retreat_dust' || effect.kind === 'rocket_smoke') { context.fillStyle = effect.kind === 'ground_dust' || effect.kind === 'damaged_track_dust' || effect.kind === 'retreat_dust' ? '#9a8d6d' : '#b9a982'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1.5 - alpha * .5), 0, TAU); context.fill(); }
  else if (effect.kind === 'tracer' || effect.kind === 'short_tracer') { const segment = getTracerSegment(effect); context.strokeStyle = '#f4df8a'; context.lineWidth = effect.fast ? 2.5 : 2; context.beginPath(); context.moveTo(segment.tail.x, segment.tail.y); context.lineTo(segment.head.x, segment.head.y); context.stroke(); }
  else if (effect.kind === 'rocket_curve') { context.strokeStyle = '#b9b6a2'; context.lineWidth = 3; context.beginPath(); context.moveTo(effect.start.x, effect.start.y); context.quadraticCurveTo(effect.control.x, effect.control.y, effect.x, effect.y); context.stroke(); context.fillStyle = '#f08e5e'; context.beginPath(); context.arc(effect.x, effect.y, 5, 0, TAU); context.fill(); context.fillStyle = 'rgba(189, 189, 174, .8)'; context.beginPath(); context.arc(effect.x - 7, effect.y - 4, 7, 0, TAU); context.arc(effect.x - 16, effect.y - 7, 5, 0, TAU); context.fill(); }
  else if (effect.kind === 'main_gun_shell' || effect.kind === 'rocket_curve_miss') { context.strokeStyle = effect.kind === 'main_gun_shell' ? '#f4d17f' : '#b9b6a2'; context.lineWidth = effect.kind === 'main_gun_shell' ? 4 : 3; context.beginPath(); context.moveTo(effect.start.x, effect.start.y); context.quadraticCurveTo(effect.control.x, effect.control.y, effect.x, effect.y); context.stroke(); context.fillStyle = effect.kind === 'main_gun_shell' ? '#fff1ac' : '#f08e5e'; context.beginPath(); context.arc(effect.x, effect.y, effect.kind === 'main_gun_shell' ? 6 : 5, 0, TAU); context.fill(); }
  else if (effect.kind === 'cannon_shell' || effect.kind === 'rocket') { context.strokeStyle = effect.kind === 'rocket' ? '#f08e5e' : '#eed182'; context.lineWidth = effect.kind === 'rocket' ? 3 : 4; context.beginPath(); context.moveTo(effect.sx, effect.sy); context.lineTo(effect.x, effect.y); context.stroke(); context.fillStyle = '#fff0ad'; context.beginPath(); context.arc(effect.x, effect.y, 4, 0, TAU); context.fill(); }
  else if (effect.kind === 'smoke') { context.fillStyle = '#a6a995'; context.beginPath(); context.arc(effect.x - 8, effect.y + 2, effect.size * .72, 0, TAU); context.arc(effect.x + 2, effect.y - 5, effect.size, 0, TAU); context.arc(effect.x + 12, effect.y + 1, effect.size * .68, 0, TAU); context.fill(); }
  else if (effect.kind === 'muzzle_flash') { context.fillStyle = '#ffe39a'; context.beginPath(); context.moveTo(effect.x - 4, effect.y); context.lineTo(effect.x + effect.size, effect.y - effect.size * .55); context.lineTo(effect.x + effect.size * .55, effect.y); context.lineTo(effect.x + effect.size, effect.y + effect.size * .55); context.fill(); }
  else if (effect.kind === 'impact_spark') { context.strokeStyle = '#f5db91'; context.lineWidth = 2; for (let index = 0; index < 5; index += 1) { const angle = index * 1.25; context.beginPath(); context.moveTo(effect.x, effect.y); context.lineTo(effect.x + Math.cos(angle) * effect.size, effect.y + Math.sin(angle) * effect.size); context.stroke(); } }
  else if (effect.kind === 'armor_hit') { context.fillStyle = '#f5b55e'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1 - alpha * .35), 0, TAU); context.fill(); context.fillStyle = '#f9e6a8'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * .42, 0, TAU); context.fill(); }
  else if (effect.kind === 'armor_destruction') { context.fillStyle = '#ec9a51'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1 - alpha * .25), 0, TAU); context.fill(); context.fillStyle = '#fff0a8'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * .42, 0, TAU); context.fill(); context.fillStyle = '#3b3027'; context.beginPath(); context.arc(effect.x - 9, effect.y - 12, effect.size * .35, 0, TAU); context.fill(); }
  else if (effect.kind === 'wreck_fire') { context.fillStyle = '#e87943'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (.55 + alpha * .45), 0, TAU); context.fill(); context.fillStyle = '#ffd37d'; context.beginPath(); context.arc(effect.x, effect.y - 3, effect.size * .3, 0, TAU); context.fill(); }
  else if (effect.kind === 'road_miss_explosion') { context.fillStyle = '#d28b54'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1 - alpha * .3), 0, TAU); context.fill(); context.fillStyle = '#a69a78'; context.beginPath(); context.arc(effect.x - 10, effect.y + 2, effect.size * .65, 0, TAU); context.arc(effect.x + 10, effect.y, effect.size * .45, 0, TAU); context.fill(); }
  else if (effect.kind === 'target_marker') { context.strokeStyle = '#e4ba72'; context.lineWidth = 2; context.beginPath(); context.arc(effect.x, effect.y, effect.size, 0, TAU); context.stroke(); context.beginPath(); context.moveTo(effect.x - effect.size - 4, effect.y); context.lineTo(effect.x + effect.size + 4, effect.y); context.moveTo(effect.x, effect.y - effect.size - 4); context.lineTo(effect.x, effect.y + effect.size + 4); context.stroke(); }
  else if (effect.kind === 'capture_pulse') { context.strokeStyle = '#76d19b'; context.lineWidth = 3; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1.2 - alpha), 0, TAU); context.stroke(); }
  else if (effect.kind === 'main_gun_muzzle') { context.fillStyle = '#fff0ad'; context.shadowColor = '#f39b54'; context.shadowBlur = 18; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (.45 + alpha * .6), 0, TAU); context.fill(); }
  else if (effect.kind === 'cover_debris') { context.fillStyle = '#a79871'; for (let index = 0; index < 6; index += 1) { context.fillRect(effect.x + Math.cos(index * 1.4) * effect.size * alpha, effect.y + Math.sin(index * 1.4) * effect.size * alpha, 3, 3); } }
  else if (effect.kind === 'welding_spark') { context.strokeStyle = '#d9f5ff'; context.lineWidth = 2; for (let index = 0; index < 6; index += 1) { const angle = index * 1.05; context.beginPath(); context.moveTo(effect.x, effect.y); context.lineTo(effect.x + Math.cos(angle) * effect.size * alpha, effect.y + Math.sin(angle) * effect.size * alpha); context.stroke(); } }
  else if (effect.kind === 'repair_work_light') { context.fillStyle = '#d9f5ff'; context.shadowColor = '#8bdcff'; context.shadowBlur = 12; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (.55 + alpha * .35), 0, TAU); context.fill(); }
  else if (effect.kind === 'reveal_marker') { context.strokeStyle = '#d5ca89'; context.lineWidth = 2; context.beginPath(); context.moveTo(effect.x, effect.y - effect.size); context.lineTo(effect.x + effect.size, effect.y); context.lineTo(effect.x, effect.y + effect.size); context.lineTo(effect.x - effect.size, effect.y); context.closePath(); context.stroke(); context.beginPath(); context.moveTo(effect.x - 11, effect.y + 12); context.lineTo(effect.x + 11, effect.y + 12); context.stroke(); }
  else if (effect.kind === 'large_explosion' || effect.kind === 'small_explosion') { context.fillStyle = '#f3b65c'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * (1 - alpha * .25), 0, TAU); context.fill(); context.fillStyle = '#f9e29d'; context.beginPath(); context.arc(effect.x, effect.y, effect.size * .45, 0, TAU); context.fill(); }
  context.restore();
}

function drawWrecks(context, state) {
  for (const mark of state.scorchMarks || []) { context.save(); context.translate(mark.x, mark.y); context.rotate(-0.15); context.fillStyle = 'rgba(32, 28, 22, .7)'; context.beginPath(); context.ellipse(0, 0, mark.size, mark.size * .35, 0, 0, TAU); context.fill(); context.restore(); }
  for (const wreck of state.wrecks || []) {
    const smoke = getWreckSmoke(wreck, state.time); context.save(); context.translate(wreck.x, wreck.y); context.rotate(wreck.angle + .08); context.fillStyle = '#171e1c'; roundRect(context, -22, -10, 44, 20, 5); context.fill(); context.fillStyle = '#363b35'; roundRect(context, -16, -8, 32, 16, 4); context.fill(); context.fillStyle = '#111817'; context.fillRect(7, -3, 24, 6); context.fillStyle = '#5b4a3c'; context.fillRect(-8, -5, 11, 10); context.restore();
    context.save(); context.globalAlpha = Math.max(.34, Math.min(.78, smoke * .85)); context.fillStyle = '#545953'; context.beginPath(); context.arc(wreck.x - 7, wreck.y - 18, 9 + smoke * 4, 0, TAU); context.arc(wreck.x + 4, wreck.y - 27, 11 + smoke * 5, 0, TAU); context.arc(wreck.x + 14, wreck.y - 19, 8 + smoke * 3, 0, TAU); context.fill(); context.restore();
    context.save(); context.fillStyle = '#d87845'; context.fillRect(wreck.x - 4, wreck.y - 4, 8, 3); context.fillStyle = '#8a5c3e'; context.fillRect(wreck.x + 10, wreck.y + 5, 6, 3); context.restore();
  }
}

function drawHud(context, state, showHud) {
  if (!showHud) return;
  context.save(); const elapsedSeconds = state.ended ? 35 : Math.min(35, Math.floor(state.time)); const elapsedLabel = `00:${String(elapsedSeconds).padStart(2, '0')} / 00:35`; context.fillStyle = 'rgba(5, 14, 15, .82)'; roundRect(context, 24, 22, 310, 74, 8); context.fill(); context.strokeStyle = 'rgba(147, 205, 172, .36)'; context.stroke(); context.fillStyle = '#f0d597'; context.font = '700 22px sans-serif'; context.fillText('边境公路遭遇战', 42, 52); context.fillStyle = '#8cc5a9'; context.font = '12px sans-serif'; context.fillText('突破、防线崩溃与重新集结', 43, 76); context.fillStyle = 'rgba(6, 14, 15, .85)'; roundRect(context, 1005, 22, 250, 55, 8); context.fill(); context.fillStyle = '#e7d7aa'; context.font = '700 18px monospace'; context.fillText(elapsedLabel, 1022, 47); context.fillStyle = '#8fc6a8'; context.font = '12px sans-serif'; context.fillText(state.ended ? '阶段8.2C演示结束' : state.time >= 31.5 ? '目标已控制，部队完成集结' : state.time >= 28 ? '检查站争夺中，步兵进入目标区' : state.time >= 22.72 ? '敌装甲被摧毁，防线开始瓦解' : state.time >= 20 ? '突破准备，侦察车正在标定目标' : state.time >= 10 ? '受损单位后撤，维修车前出' : state.time >= 7 ? '接敌，双方开始交火' : '侦察单位正在前出，主力编队展开中', 1022, 67); context.fillStyle = 'rgba(5, 14, 15, .78)'; roundRect(context, 24, 664, 520, 32, 6); context.fillStyle = '#b7c4a0'; context.font = '12px sans-serif'; context.fillText(state.ended ? '已完成突破、防线崩溃、目标占领与重新集结' : state.time >= 31.5 ? '检查站控制 · 东侧警戒 · 西侧重新集结' : state.time >= 28 ? '目标争夺 · 两路步兵建立警戒' : state.time >= 20 ? '装甲突破 · 敌军分批撤退 · 目标：检查站' : state.time >= 10 ? '受损坦克 · 北路换位 · 战地维修' : '公路轴线 · 北南两路展开 · 目标：检查站', 40, 685); context.restore();
}

export function renderSandbox(context, state, debug = {}) {
  const canvas = context.canvas; const camera = cameraAt(state.time); const viewW = canvas.width; const viewH = canvas.height; context.clearRect(0, 0, viewW, viewH); context.fillStyle = css.bg; context.fillRect(0, 0, viewW, viewH);
  context.save(); context.translate(viewW / 2, viewH / 2); context.scale(camera.zoom, camera.zoom); context.translate(-camera.x, -camera.y);
  drawTerrain(context, debug); for (const building of FRIENDLY_BUILDINGS) drawBuilding(context, building, false); for (const building of ENEMY_BUILDINGS) drawBuilding(context, building, true); drawObjective(context, state.time, state.objective);
  drawCoverBack(context, COVER_GROUPS.friendlyNorth, false, debug); drawCoverBack(context, COVER_GROUPS.friendlyNorthSecondary, false, debug); drawCoverBack(context, COVER_GROUPS.friendlySouth, false, debug); drawCoverBack(context, COVER_GROUPS.enemyNorth, true, debug); drawCoverBack(context, COVER_GROUPS.enemySouth, true, debug);
  for (const unit of state.units.filter((item) => item.side === 'enemy' && shouldDrawUnit(item, state.time, state.wrecks))) drawUnit(context, unit, state.time); for (const unit of state.units.filter((item) => item.side === 'friendly' && shouldDrawUnit(item, state.time, state.wrecks))) drawUnit(context, unit, state.time);
  drawCoverFront(context, COVER_GROUPS.friendlyNorth, false); drawCoverFront(context, COVER_GROUPS.friendlyNorthSecondary, false); drawCoverFront(context, COVER_GROUPS.friendlySouth, false); drawCoverFront(context, COVER_GROUPS.enemyNorth, true); drawCoverFront(context, COVER_GROUPS.enemySouth, true);
  for (const effect of state.effects) drawEffect(context, effect);
  drawWrecks(context, state);
  context.restore();
  if (debug.labels) for (const unit of state.units.filter((item) => shouldDrawUnit(item, state.time, state.wrecks))) { const screen = worldToScreen(getUnitVisualCenter(unit), camera, viewW, viewH); drawBadge(context, screen.x, screen.y - 22, unit.side === 'enemy' ? '#db8b70' : '#8ed3c0', unit.id.slice(2, 7)); }
  drawHud(context, state, debug.hud !== false);
}
