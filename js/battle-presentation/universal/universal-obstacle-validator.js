export function validateUniversalObstacles(plan) {
  const errors = []; const { width, height } = plan.layout.bounds;
  for (const node of plan.layout.nodes) if (node.x - node.radius < 0 || node.y - node.radius < 0 || node.x + node.radius > width || node.y + node.radius > height) errors.push({ code: 'actor_out_of_bounds', actorId: node.actorId });
  for (const route of plan.layout.sceneRoutes || []) if (route.points.some((point) => point.x < 0 || point.y < 0 || point.x > width || point.y > height)) errors.push({ code: 'scene_object_out_of_bounds', routeId: route.routeId });
  return { ok: errors.length === 0, errors, metrics: { checkedNodes: plan.layout.nodes.length, checkedSceneRoutes: plan.layout.sceneRoutes?.length || 0 } };
}

