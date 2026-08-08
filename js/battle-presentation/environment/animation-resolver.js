import { normalizeVisualUnitClass } from './visual-unit-class.js';
import { resolvePresentationVisualState } from './presentation-facing-policy.js';

export const DIRECTION_ORDER = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
const DIRECTION_ANGLES = Object.freeze([-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4]);
const DIRECTION_STEP = Math.PI / 4;
const HYSTERESIS = .035;

function wrapAngle(value) { let angle = Number(value) || 0; while (angle <= -Math.PI) angle += Math.PI * 2; while (angle > Math.PI) angle -= Math.PI * 2; return angle; }
function angleDistance(left, right) { return Math.abs(wrapAngle(left - right)); }
function stableHash(value) { let hash = 2166136261; for (const char of String(value ?? '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0) / 0xffffffff; }

export function nearestDirectionIndex(radians) {
  const angle = wrapAngle(radians); let best = 0; let distance = Infinity;
  for (let index = 0; index < DIRECTION_ANGLES.length; index += 1) { const current = angleDistance(angle, DIRECTION_ANGLES[index]); if (current < distance - 1e-12) { best = index; distance = current; } }
  return best;
}

/** Deterministic 8-way quantization. Previous direction only stabilizes a boundary; it never changes the battle facing. */
export function directionIndexFromRadians(radians, previousIndex = null) {
  const nearest = nearestDirectionIndex(radians); if (!Number.isInteger(previousIndex) || previousIndex < 0 || previousIndex >= DIRECTION_ORDER.length || nearest === previousIndex) return nearest;
  const previousAngle = DIRECTION_ANGLES[previousIndex]; const nearestAngle = DIRECTION_ANGLES[nearest]; const boundary = (previousAngle + nearestAngle) / 2;
  const distanceToBoundary = angleDistance(radians, boundary);
  return distanceToBoundary < HYSTERESIS ? previousIndex : nearest;
}

export function directionName(directionIndex) { return DIRECTION_ORDER[Number(directionIndex) % DIRECTION_ORDER.length] || DIRECTION_ORDER[0]; }
export function directionRadians(directionIndex) { return DIRECTION_ANGLES[Number(directionIndex) % DIRECTION_ANGLES.length] || DIRECTION_ANGLES[0]; }

function animationForState(actor, visualState) {
  const requested = String(visualState || actor?.visualState || actor?.presentationMode || 'idle').toLowerCase();
  const formalRepairSource = actor?.formalRepairSourceActive === true && actor?.formalRepairEventActive === true && actor?.repairSource === true;
  const state = resolvePresentationVisualState({ actor, visualClass: normalizeVisualUnitClass(actor), weaponTopology: actor?.weaponTopology, visualState: requested, action: actor?.currentAction, formalRepair: formalRepairSource }).visualState;
  if (['destroying', 'destroy'].includes(state)) return 'destroy';
  if (state === 'hit' || actor?.visualState === 'hit') return 'hit';
  if (state === 'repair' && formalRepairSource) return 'repair';
  if (state === 'fire' || (actor?.firing && state !== 'idle')) return 'fire';
  if (state === 'aim' || (actor?.aiming && state !== 'idle')) return 'aim';
  if (['move', 'deploy', 'turn', 'brake', 'retreat', 'cover_advance', 'retreat_route'].includes(state) || ['move', 'deploy', 'advance', 'screen', 'take_cover', 'disengage', 'repair_approach'].includes(actor?.currentAction)) return 'move';
  return 'idle';
}

export function resolveActorAnimationState(actor, visualState = actor?.visualState, seconds = 0, options = {}) {
  const animation = animationForState(actor, visualState); const directionIndex = directionIndexFromRadians(actor?.facing || 0, options.previousDirectionIndex); const entry = options.entry || null; const descriptor = entry?.animations?.[animation] || entry?.animations?.idle || null; const fallbackLevel = entry?.animations?.[animation] ? 'none' : descriptor ? 'animation' : 'asset'; const frameCount = Math.max(1, Number(descriptor?.frameCount) || 1); const frameDuration = Math.max(.001, Number(descriptor?.frameDuration) || .2); const phase = stableHash(`${options.seed ?? 0}:${actor?.id || actor?.actorId || ''}:${animation}`) * frameDuration; const elapsed = Math.max(0, Number(seconds) || 0) + phase; const frameOffset = descriptor?.loop === false ? Math.min(frameCount - 1, Math.floor(elapsed / frameDuration)) : Math.floor(elapsed / frameDuration) % frameCount;
  return { animation, directionIndex, direction: directionName(directionIndex), frameIndex: Number(descriptor?.startFrame || 0) + frameOffset, frameOffset, frameCount, frameDuration, loop: descriptor?.loop !== false, phaseOffset: Number(phase.toFixed(6)), fallbackLevel, visualClass: normalizeVisualUnitClass(actor), deterministicClock: 'presentation-seconds-plus-actor-seed' };
}

export function resolveSpriteFrame(entry, animationState) {
  const sheet = entry?.spritesheet; if (!sheet || !animationState) return { ok: false, fallbackLevel: 'asset', reason: 'spritesheet_metadata_missing' };
  const frameWidth = Number(sheet.frameWidth) || 0; const frameHeight = Number(sheet.frameHeight) || 0; const columns = Number(sheet.columns) || 0; const rows = Number(sheet.rows) || 0; const frameIndex = Number(animationState.frameIndex); const directionIndex = Number(animationState.directionIndex); if (!frameWidth || !frameHeight || frameIndex < 0 || frameIndex >= columns || directionIndex < 0 || directionIndex >= rows) return { ok: false, fallbackLevel: 'direction', reason: 'source_rect_out_of_bounds', frameIndex, directionIndex };
  return { ok: true, fallbackLevel: animationState.fallbackLevel, animation: animationState.animation, directionIndex, direction: animationState.direction, frameIndex, frameCount: animationState.frameCount, frameDuration: animationState.frameDuration, sourceRect: { x: frameIndex * frameWidth, y: directionIndex * frameHeight, width: frameWidth, height: frameHeight }, imageSize: { width: frameWidth * columns, height: frameHeight * rows } };
}

export function resolveMuzzleAnchor(actor, entry, directionIndex = directionIndexFromRadians(actor?.turretFacing ?? actor?.facing ?? 0)) {
  const anchor = entry?.weaponMuzzleAnchor; if (!anchor) return { ok: false, reason: 'manifest_anchor_missing' };
  const rawFacing = Number(anchor.uses === 'turretFacing' ? actor?.turretFacing : actor?.facing) || 0; const facing = Number(rawFacing.toFixed(6)); const forward = Number(anchor.forward) || 0; const lateral = Number(anchor.lateral) || 0; return { ok: true, directionIndex, direction: directionName(directionIndex), facing, space: anchor.space || 'normalized-destination', forward, lateral, source: 'manifest.weaponMuzzleAnchor' };
}
