import { resolveRolePresentationStatus, getFinalRoleStatus, isTemporaryPresentationStatus, TEMPORARY } from './role-presentation-policy.js';

export function resolvePresentationStatus(actor, authorityState, plan, time, choreography = null) {
  return resolveRolePresentationStatus(actor, authorityState.actors?.[actor.id] || authorityState, plan, time, choreography);
}

export { resolveRolePresentationStatus, getFinalRoleStatus, isTemporaryPresentationStatus, TEMPORARY };
