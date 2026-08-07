import { profileForEnvironmentObject } from './environment-object-profiles.js';
import { deterministicUnit } from './environment-layout.js';

const TAU = Math.PI * 2;
const colorFor = (object) => profileForEnvironmentObject(object).style;
const worldPoint = (point, bounds, width = 1280, height = 720) => ({ x: (Number(point?.x) || 0) * width / Math.max(1, Number(bounds?.width) || 1200), y: (Number(point?.y) || 0) * height / Math.max(1, Number(bounds?.height) || 700) });

function drawGround(context, scene, bounds, width, height) {
  const base = scene?.layers?.base || '#344c38'; context.fillStyle = base; context.fillRect(0, 0, width, height);
  for (let index = 0; index < Number(scene?.layers?.largeVariation || 0); index += 1) { const x = deterministicUnit(scene.seed, `ground-large-x:${index}`) * width; const y = deterministicUnit(scene.seed, `ground-large-y:${index}`) * height; const radius = 30 + deterministicUnit(scene.seed, `ground-large-r:${index}`) * 100; context.fillStyle = index % 2 ? 'rgba(150,132,88,.055)' : 'rgba(12,27,19,.055)'; context.beginPath(); context.ellipse(x, y, radius * 1.7, radius, deterministicUnit(scene.seed, `ground-large-a:${index}`) * TAU, 0, TAU); context.fill(); }
  context.globalAlpha = .22; context.fillStyle = '#9c9c70';
  for (let index = 0; index < Number(scene?.layers?.smallVariation || 0); index += 1) { const x = deterministicUnit(scene.seed, `ground-small-x:${index}`) * width; const y = deterministicUnit(scene.seed, `ground-small-y:${index}`) * height; context.fillRect(x, y, 1 + (index % 2), 1 + (index % 2)); }
  context.globalAlpha = 1;
}

function drawZoneTint(context, scene, bounds, width, height) {
  for (const zone of scene?.zones || []) { const point = worldPoint(zone.center, bounds, width, height); const zoneWidth = Number(zone.width || 160) * width / bounds.width; const zoneHeight = Number(zone.height || 100) * height / bounds.height; context.fillStyle = zone.kind === 'industrial' ? 'rgba(181,144,87,.085)' : zone.kind === 'objective' ? 'rgba(202,182,100,.065)' : zone.kind === 'contact' ? 'rgba(38,70,50,.04)' : 'rgba(215,201,145,.018)'; context.fillRect(point.x - zoneWidth / 2, point.y - zoneHeight / 2, zoneWidth, zoneHeight); }
}

function drawRoadOrTrack(context, object, bounds, width, height) {
  const point = worldPoint(object.position, bounds, width, height); const geometry = object.geometry || {}; const style = colorFor(object); const w = Number(geometry.width || 100) * width / bounds.width; const h = Number(geometry.height || 12) * height / bounds.height; context.save(); context.translate(point.x, point.y); context.rotate((object.seed % 11) * .03);
  context.fillStyle = style.fill; context.globalAlpha = .42; context.fillRect(-w / 2, -h / 2, w, h); context.globalAlpha = .72; context.strokeStyle = style.stroke; context.lineWidth = 1.4;
  if (object.category === 'track') { for (let x = -w / 2; x < w / 2; x += 11) { context.beginPath(); context.moveTo(x, -h / 2 - 2); context.lineTo(x, h / 2 + 2); context.stroke(); } context.beginPath(); context.moveTo(-w / 2, -h / 2 + 3); context.lineTo(w / 2, -h / 2 + 3); context.moveTo(-w / 2, h / 2 - 3); context.lineTo(w / 2, h / 2 - 3); context.stroke(); } else { context.setLineDash([17, 9]); context.strokeRect(-w / 2, -h / 2, w, h); context.setLineDash([]); } context.restore();
}

function drawObject(context, object, bounds, width, height, options = {}) {
  if (object.category === 'road' || object.category === 'track') return drawRoadOrTrack(context, object, bounds, width, height);
  const point = worldPoint(object.position, bounds, width, height); const geometry = object.geometry || {}; const style = colorFor(object); const w = Number(geometry.width || 20) * width / bounds.width; const h = Number(geometry.height || 12) * height / bounds.height; context.save(); context.translate(point.x, point.y); context.rotate((object.seed % 13 - 6) * .035); context.globalAlpha = object.category === 'cover' ? .6 : .9; context.fillStyle = style.fill; context.strokeStyle = style.stroke; context.lineWidth = object.category === 'industrial_prop' ? 1.8 : 1.2;
  const assetSpec = options.environmentSpecs?.get(object.id); const assetWidth = Number(assetSpec?.worldSize?.width || geometry.width || 20) * width / bounds.width; const assetHeight = Number(assetSpec?.worldSize?.height || geometry.height || 12) * height / bounds.height;
  if (assetSpec?.assetMode !== 'procedural' && assetSpec?.assetId && options.assetRuntime?.draw(context, assetSpec.assetId, 0, 0, assetWidth, assetHeight, 0)) { context.restore(); return; }
  if (geometry.shape === 'circle' || geometry.shape === 'rock' || geometry.shape === 'scrub') { context.beginPath(); context.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); context.fill(); context.stroke(); if (geometry.shape === 'scrub') { context.strokeStyle = style.stroke; for (let i = -1; i <= 1; i += 1) { context.beginPath(); context.moveTo(i * w * .2, h * .2); context.lineTo(i * w * .35, -h * .35); context.stroke(); } } }
  else if (geometry.shape === 'frame') { context.strokeRect(-w / 2, -h / 2, w, h); context.beginPath(); context.moveTo(-w / 2, h / 2); context.lineTo(0, -h / 2); context.lineTo(w / 2, h / 2); context.moveTo(-w / 4, h / 2); context.lineTo(w / 4, -h / 2); context.stroke(); }
  else if (geometry.shape === 'line' || geometry.shape === 'fence') { context.setLineDash(geometry.shape === 'fence' ? [6, 5] : []); context.beginPath(); context.moveTo(-w / 2, 0); context.lineTo(w / 2, 0); context.stroke(); context.setLineDash([]); for (let x = -w / 2; x <= w / 2; x += Math.max(8, w / 4)) { context.beginPath(); context.moveTo(x, -h / 2); context.lineTo(x, h / 2); context.stroke(); } }
  else if (geometry.shape === 'berm' || geometry.shape === 'sandbag') { context.beginPath(); context.moveTo(-w / 2, h / 2); context.quadraticCurveTo(0, -h / 2, w / 2, h / 2); context.closePath(); context.fill(); context.stroke(); if (geometry.shape === 'sandbag') for (let x = -w / 2 + 5; x < w / 2; x += 11) { context.beginPath(); context.arc(x, 1, 4, 0, TAU); context.fill(); } }
  else if (geometry.shape === 'ditch') { context.setLineDash([4, 5]); context.strokeRect(-w / 2, -h / 2, w, h); context.setLineDash([]); }
  else { context.fillRect(-w / 2, -h / 2, w, h); context.strokeRect(-w / 2, -h / 2, w, h); if (object.variant === 'ore_silo') { context.fillStyle = style.stroke; context.beginPath(); context.arc(0, -h / 2, Math.max(2, w * .15), 0, TAU); context.fill(); } }
  context.restore();
}

export function drawEnvironmentScene(context, scene, bounds, options = {}) {
  const width = Number(options.width) || 1280; const height = Number(options.height) || 720; const environmentSpecs = new Map((options.drawSpecs?.environmentSpecs || []).map((spec) => [spec.objectId, spec])); drawGround(context, scene, bounds, width, height); drawZoneTint(context, scene, bounds, width, height); for (const object of scene?.objects || []) drawObject(context, object, bounds, width, height, { ...options, environmentSpecs });
}
