import { positionAtSlot } from './contract-movement-director.js';

function pointFor(routeRegistry, actor, time) {
  if (!actor) throw new Error('unknown_actor_position');
  return positionAtSlot(routeRegistry, actor.templateSlot, time);
}

export function resolveAnchorPositions(anchors, actorById, pairings = { pairs: [] }, routeRegistry = null) {
  const pairByFire = Object.fromEntries((pairings.pairs || []).map((pair) => [pair.fireAnchorId, pair]));
  const byId = Object.fromEntries(anchors.map((anchor) => [anchor.id, anchor]));
  return anchors.map((anchor) => {
    const sourceActor = actorById[anchor.actorId]; const targetActor = actorById[anchor.targetId];
    const sourcePosition = sourceActor ? pointFor(routeRegistry, sourceActor, anchor.presentationTime) : null;
    const targetPosition = targetActor ? pointFor(routeRegistry, targetActor, anchor.presentationTime) : null;
    const pair = pairByFire[anchor.id]; const pairedDamage = pair ? byId[pair.damageAnchorId] : null;
    const impactPosition = pairedDamage && targetActor ? pointFor(routeRegistry, targetActor, pairedDamage.presentationTime) : targetPosition;
    const controlPoint = anchor.type === 'fire' && anchor.weaponKind === 'rocket' && sourcePosition && impactPosition
      ? { x: (sourcePosition.x + impactPosition.x) / 2, y: Math.min(sourcePosition.y, impactPosition.y) - 55 }
      : null;
    return { ...anchor, sourcePosition, targetPosition, launchPosition: anchor.type === 'fire' ? sourcePosition : undefined, impactPosition: anchor.type === 'fire' ? impactPosition : targetPosition, controlPoint };
  });
}

export function projectilePoseAtAnchor(plan, anchorId) {
  const anchor = plan.anchors.find((item) => item.id === anchorId);
  return anchor ? { launchPosition: anchor.launchPosition, impactPosition: anchor.impactPosition, controlPoint: anchor.controlPoint } : null;
}
