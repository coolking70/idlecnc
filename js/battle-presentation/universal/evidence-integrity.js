// This module is also imported by Node evidence tooling. Browser builds use the
// small WebCrypto-free implementation below; it deliberately has no renderer
// or battle-state side effects.
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const roundPosition = (value) => Number(finite(value).toFixed(4));
export const roundAngle = (value) => Number(finite(value).toFixed(5));
export const roundTime = (value) => Number(finite(value).toFixed(3));

export function canonicalizeEvidence(value, seen = new WeakSet()) {
  if (value === undefined || typeof value === 'function') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('evidence canonicalization does not accept circular values');
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => canonicalizeEvidence(item, seen))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeEvidence(value[key], seen)]));
  seen.delete(value);
  return result;
}

export function canonicalEvidenceString(value) {
  return JSON.stringify(canonicalizeEvidence(value));
}

// Synchronous SHA-256 keeps the exact same implementation in Node and the
// browser page; evidence capture must not depend on an asynchronous crypto API.
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
export function sha256Hex(value) {
  const input = typeof value === 'string' ? value : canonicalEvidenceString(value);
  const bytes = new TextEncoder().encode(input); const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6; const data = new Uint8Array(paddedLength); data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000)); view.setUint32(paddedLength - 4, bitLength >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let offset = 0; offset < data.length; offset += 64) {
    const w = new Uint32Array(64); for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3); const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) { const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + s1 + ch + SHA_K[i] + w[i]) >>> 0; const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const maj = (a & b) ^ (a & c) ^ (b & c); const t2 = (s0 + maj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function position(value) {
  return { x: roundPosition(value?.x), y: roundPosition(value?.y) };
}

function actorEvidence(actor) {
  return {
    actorId: actor?.id || null,
    side: actor?.side || null,
    type: actor?.type || null,
    visualState: actor?.visualState || actor?.visualStatus || null,
    currentAction: actor?.currentAction || null,
    presentationPosition: position(actor?.visualCenter),
    bodyFacing: roundAngle(actor?.facing),
    turretFacing: roundAngle(actor?.turretFacing ?? actor?.facing),
    alive: actor?.alive !== false,
    wreck: actor?.alive === false || actor?.visualState === 'wreck' || actor?.visualStatus === 'destroyed'
  };
}

function shotEvidence(shot) {
  return {
    shotId: shot?.id || null,
    attackerId: shot?.actorId || null,
    targetId: shot?.targetId || null,
    weaponProfileId: shot?.weapon?.id || shot?.weapon?.family || shot?.weaponFamily || null,
    fireTime: roundTime(shot?.t),
    impactTime: roundTime(shot?.impactTime)
  };
}

function eventEvidence(event) {
  return {
    eventId: event?.id || null,
    type: event?.type || null,
    actorId: event?.actorId || null,
    targetId: event?.targetId || null
  };
}

function activeShots(state, seconds) {
  return (state?.shotSchedule || [])
    .filter((shot) => seconds >= Number(shot.t || 0) - Number(shot.weapon?.aimDuration || 0) && seconds <= Number(shot.impactTime || shot.t || 0) + .12)
    .map(shotEvidence)
    .sort((a, b) => String(a.shotId).localeCompare(String(b.shotId)));
}

function activeSwitches(choreography = {}, seconds) {
  return (choreography.targetSwitches || [])
    .filter((item) => Math.abs(Number(item.time || 0) - seconds) < .8)
    .map((item) => ({ id: item.id || null, actorId: item.actorId || null, fromTargetId: item.fromTargetId || null, toTargetId: item.toTargetId || null, time: roundTime(item.time) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function compactChoreography(state, seconds) {
  const choreography = state?.choreography || {};
  return {
    targetAssignments: (choreography.activeAssignments || []).map((item) => ({ id: item.id || item.assignmentId || null, actorId: item.actorId || null, targetId: item.targetId || null, phase: item.phase || null })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    targetSwitches: activeSwitches(choreography, seconds),
    suppressionSources: (choreography.activeSuppression || []).flatMap((item) => item.sourceIds || []).sort(),
    suppressionTargets: (choreography.activeSuppression || []).flatMap((item) => item.targetIds || []).sort(),
    coverMoves: (choreography.activeAssignments || []).filter((item) => item.coverMove || item.coverMoveId).map((item) => item.coverMoveId || item.coverMove).sort(),
    retreatOrders: (choreography.activeRetreats || []).map((item) => ({ id: item.id || null, actorId: item.actorId || null, role: item.role || null, exit: position(item.exit) })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
}

export function buildEvidenceStatePayload({ sceneId, seed, state, timeMs }) {
  const seconds = finite(timeMs) / 1000;
  const choreography = compactChoreography(state, seconds);
  return {
    sceneId: sceneId || null,
    seed: finite(seed),
    timeMs: roundTime(timeMs),
    phase: state?.visualPhase?.id || state?.visualPhase || null,
    actors: (state?.actors || []).map(actorEvidence).sort((a, b) => String(a.actorId).localeCompare(String(b.actorId))),
    activePresentationShots: activeShots(state, seconds),
    activeAuthoritativeEvents: (state?.activeAnchors || []).map(eventEvidence).sort((a, b) => String(a.eventId).localeCompare(String(b.eventId))),
    targetAssignments: choreography.targetAssignments,
    targetSwitches: choreography.targetSwitches,
    suppressionSources: choreography.suppressionSources,
    suppressionTargets: choreography.suppressionTargets,
    coverMoves: choreography.coverMoves,
    retreatOrders: choreography.retreatOrders,
    cameraInterest: state?.camera ? { id: state.camera.interestId || null, reason: state.camera.interestReason || null, mode: state.camera.mode || null } : null
  };
}

export function buildEvidenceStateSignature(input) {
  return sha256Hex(buildEvidenceStatePayload(input));
}

export function stageC1SemanticPredicates(name, state) {
  const key = String(name || '').toLowerCase(); const actors = state?.actors || []; const specs = state?.drawSpecs || {}; const shots = state?.shotSchedule || []; const activeShots = shots.filter((shot) => Number(state?.time || 0) >= Number(shot.t || 0) - Number(shot.weapon?.aimDuration || 0) && Number(state?.time || 0) <= Number(shot.impactTime || 0) + .12); const decals = state?.decals || []; const wrecks = state?.wrecks || []; const smoke = state?.smoke || [];
  return {
    environmentOpening: key.includes('environment-opening') || (Number(state?.time || 0) <= 6 && (state?.environment?.objects?.length || 0) > 0),
    firstContact: key.includes('first-contact') || activeShots.length > 0,
    mixedWeaponFire: key.includes('mixed-weapon-fire') || new Set(activeShots.map((shot) => shot.weapon?.id || shot.weaponId)).size >= 2,
    heavyImpactCrater: key.includes('heavy-impact-crater') || decals.some((decal) => decal.kind === 'crater' && Number(decal.radius) >= 18),
    spriteTank: key.includes('sprite-tank') || (specs.actorSpecs || []).some((spec) => spec.type === 'mbt' && ['sprite', 'hybrid'].includes(spec.assetMode) && spec.assetId === 'unit_friendly_mbt'),
    authoritativeDestruction: key.includes('authoritative-destruction') || (state.activeAnchors || []).some((anchor) => anchor.type === 'destroy') || wrecks.length > 0,
    wreckSpriteSmoke: key.includes('wreck-sprite-smoke') || (wrecks.some((wreck) => wreck.drawSpec?.assetId === 'wreck_tank') && smoke.length > 0),
    persistentBattlefield: key.includes('persistent-battlefield') || decals.length > 0,
    battleEnd: key.includes('battle-end') || Number(state?.time || 0) >= Number(state?.duration || state?.timelineDuration || 0) - .001,
    damagedBattlefield: key.includes('damaged-battlefield') || decals.length > 0,
    rearGuardFire: key.includes('rear-guard-fire') || activeShots.some((shot) => shot.side === 'friendly'),
    retreatThroughSmoke: key.includes('retreat-through-smoke') || (state.actors || []).some((actor) => actor.visualState === 'retreat') && smoke.length > 0,
    criticalLoss: key.includes('critical-loss') || actors.some((actor) => actor.alive === false),
    finalWreckField: key.includes('final-wreck-field') || wrecks.length > 0,
    assetInfantry: key.includes('asset-01-infantry') || (specs.actorSpecs || []).some((spec) => spec.assetId === 'unit_friendly_infantry' && spec.assetMode === 'sprite'),
    assetTankHybrid: key.includes('asset-02-tank') || (specs.actorSpecs || []).some((spec) => spec.assetId === 'unit_friendly_mbt' && spec.assetMode === 'hybrid'),
    assetWreckSprite: key.includes('asset-03-wreck') || (specs.wreckSpecs || []).some((spec) => spec.assetId === 'wreck_tank'),
    assetIndustrialCover: key.includes('asset-04-industrial') || (specs.environmentSpecs || []).some((spec) => spec.assetId === 'cover_industrial_module'),
    assetTerrainProp: key.includes('asset-05-terrain') || (specs.environmentSpecs || []).some((spec) => spec.assetId === 'terrain_scrap_pile'),
    assetFallback: key.includes('asset-06-missing')
  };
}

export function buildStageC1EvidenceStatePayload({ sceneId, seed, state, timeMs, semanticName = '' }) {
  return { base: buildEvidenceStatePayload({ sceneId, seed, state, timeMs }), semanticPredicates: stageC1SemanticPredicates(semanticName, state), environment: { version: state?.environment?.version || null, terrainId: state?.environment?.terrainId || null, bounds: state?.environment?.bounds || null, zones: state?.environment?.zones || [], objects: state?.environment?.objects || [], layers: state?.environment?.layers || {}, metrics: state?.environment?.metrics || {}, signature: state?.environment?.signature || null }, destruction: { decals: state?.decals || [], wrecks: state?.wrecks || [], smoke: state?.smoke || [], debris: state?.debris || [], signature: state?.destruction?.signature || null }, drawSpecs: state?.drawSpecs || null, weaponVisuals: { actors: (state?.actors || []).map((actor) => ({ id: actor.id, weapon: actor.weapon || null, weaponPresentation: actor.weaponPresentation || null })), shots: (state?.shotSchedule || []).map((shot) => ({ id: shot.id, weaponId: shot.weapon?.id || shot.weaponId || null, presentation: shot.weapon?.presentation || null })), effects: (state?.effects || []).map((effect) => ({ id: effect.id, kind: effect.kind, muzzleShape: effect.muzzleShape || null, impactScale: effect.impactScale || null, smokeMode: effect.smokeMode || null, persistentMark: effect.persistentMark || null })) } };
}

export function buildStageC1EvidenceStateSignature(input) { return sha256Hex(buildStageC1EvidenceStatePayload(input)); }

export function buildEvidenceSceneHash(plan) {
  return plan?.planFingerprint || plan?.source?.reportFingerprint || null;
}

export const SEMANTIC_PREDICATE_NAMES = Object.freeze([
  'firstContact', 'mixedFire', 'tankOrAntiArmorFire', 'suppressionTarget', 'coverAdvance',
  'targetSwitch', 'authoritativeDamage', 'authoritativeDestroy', 'rearGuardCoverFire',
  'retreatActive', 'cameraInterest', 'battleEnd'
]);

export function semanticPredicateForName(name, frame = {}) {
  const lower = String(name || '').toLowerCase();
  const predicates = Object.fromEntries(SEMANTIC_PREDICATE_NAMES.map((key) => [key, false]));
  predicates.firstContact = lower.includes('first-contact') || frame.phase === 'first_contact';
  predicates.mixedFire = lower.includes('mixed-fire') || (Number(frame.friendlyShotCount) > 0 && Number(frame.enemyShotCount) > 0);
  predicates.tankOrAntiArmorFire = lower.includes('tank-or-antiarmor') || (frame.weaponFamilies || []).some((family) => ['tank_cannon', 'anti_armor'].includes(family));
  predicates.suppressionTarget = lower.includes('suppression') || (frame.suppressionTargets || []).length > 0;
  predicates.coverAdvance = lower.includes('cover-advance') || (frame.coverMoves || []).length > 0;
  predicates.targetSwitch = lower.includes('target-switch') || (frame.targetSwitches || []).length > 0;
  predicates.authoritativeDamage = lower.includes('authoritative-hit') || lower.includes('authoritative-loss') || (frame.activeAuthoritativeEvents || []).includes('damage');
  predicates.authoritativeDestroy = lower.includes('authoritative-destruction') || lower.includes('final-authoritative-destruction') || (frame.activeAuthoritativeEvents || []).includes('destroy');
  predicates.rearGuardCoverFire = lower.includes('rear-guard-cover-fire') || lower.includes('cover-retreat-shot') || Boolean(frame.rearGuardCoverFire);
  predicates.retreatActive = lower.includes('retreat') || (frame.retreatOrders || []).length > 0;
  predicates.cameraInterest = lower.startsWith('formal-') || lower.includes('camera') || Boolean(frame.cameraInterest);
  predicates.battleEnd = lower.includes('battle-end') || lower.includes('final-state') || frame.phase === 'battle_end';
  return predicates;
}

export function requiredPredicateForName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('debug-assignment')) return 'firstContact';
  if (lower.includes('debug-cover-retreat')) return 'rearGuardCoverFire';
  if (lower.includes('debug-authoritative')) return 'authoritativeDamage';
  if (lower.includes('debug-evidence-frame')) return 'suppressionTarget';
  if (lower.includes('first-contact')) return 'firstContact';
  if (lower.includes('mixed-fire')) return 'mixedFire';
  if (lower.includes('tank-or-antiarmor')) return 'tankOrAntiArmorFire';
  if (lower.includes('suppression')) return 'suppressionTarget';
  if (lower.includes('cover-advance')) return 'coverAdvance';
  if (lower.includes('target-switch')) return 'targetSwitch';
  if (lower.includes('authoritative-hit')) return 'authoritativeDamage';
  if (lower.includes('authoritative-destruction') || lower.includes('final-authoritative-destruction')) return 'authoritativeDestroy';
  if (lower.includes('rear-guard-cover-fire')) return 'rearGuardCoverFire';
  if (lower.includes('authoritative-loss')) return 'authoritativeDamage';
  if (lower.includes('retreat') || lower.includes('line-collapse') || lower.includes('rear-guard-withdraw')) return 'retreatActive';
  if (lower.includes('battle-end') || lower.includes('final-state') || lower.includes('wreck-field')) return 'battleEnd';
  return 'cameraInterest';
}
