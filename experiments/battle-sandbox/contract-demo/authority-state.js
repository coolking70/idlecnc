function actorRows(contract) { return [...contract.normalizedBattle.actors.friendly, ...contract.normalizedBattle.actors.enemy]; }

export function createAuthorityState(contract) {
  const actors = Object.fromEntries(actorRows(contract).map((actor) => [actor.id, {
    sourceActorId: actor.id, side: actor.side, type: actor.type, initialHp: actor.initial.hp,
    maxHp: actor.initial.maxHp, hp: actor.initial.hp, alive: actor.initial.alive,
    suppressedUntil: 0, lastDamage: null, lastRepair: null, destroyedAt: null
  }]));
  return { actors, appliedAnchorIds: [], authorityLog: [], result: null, capture: false };
}

export function cloneAuthorityState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function applyAuthorityAnchor(state, anchor, presentationTime = anchor.presentationTime) {
  if (!anchor || state.appliedAnchorIds.includes(anchor.id)) return false;
  const target = anchor.targetId ? state.actors[anchor.targetId] : null;
  const actor = anchor.actorId ? state.actors[anchor.actorId] : null;
  if (anchor.type === 'damage' && target) {
    target.hp = Math.max(0, target.hp - anchor.value);
    target.lastDamage = { value: anchor.value, anchorId: anchor.id, at: presentationTime };
  } else if (anchor.type === 'repair' && target) {
    target.hp = Math.min(target.maxHp, target.hp + anchor.value);
    target.lastRepair = { value: anchor.value, anchorId: anchor.id, at: presentationTime };
  } else if (anchor.type === 'suppress' && target) {
    target.suppressedUntil = Math.max(target.suppressedUntil, anchor.suppressedUntil ?? presentationTime + 1.4);
  } else if (anchor.type === 'destroy' && target) {
    target.hp = 0; target.alive = false; target.destroyedAt = presentationTime;
  } else if (anchor.type === 'result') {
    state.result = 'victory'; state.capture = true;
  }
  state.appliedAnchorIds.push(anchor.id);
  state.authorityLog.push({ anchorId: anchor.id, sourceEventId: anchor.sourceEventId, type: anchor.type, reportTime: anchor.reportTime, presentationTime });
  return true;
}

export function applyAuthorityAnchorsThrough(state, anchors, time) {
  for (const anchor of anchors) if (anchor.presentationTime <= time + 1e-7) applyAuthorityAnchor(state, anchor, anchor.presentationTime);
  return state;
}

export function requiredAppliedCount(state, anchors) {
  const applied = new Set(state.appliedAnchorIds);
  return anchors.filter((anchor) => anchor.required && applied.has(anchor.id)).length;
}

export function compareAuthorityToContractFinal(state, contract) {
  const errors = [];
  for (const actor of actorRows(contract)) {
    const actual = state.actors[actor.id]; const expected = actor.final;
    if (!actual) { errors.push(`missing authority actor ${actor.id}`); continue; }
    for (const key of ['hp', 'maxHp', 'alive']) if (actual[key] !== expected[key]) errors.push(`${actor.id}.${key}: ${actual[key]} !== ${expected[key]}`);
  }
  return { ok: errors.length === 0, errors };
}
