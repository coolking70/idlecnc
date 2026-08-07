export function buildSceneGrammar(intent, terrain, mission, strategy) {
  const sceneObjects = mission.id === 'convoy_escort' ? [{ id: 'convoy_scene_object_1', kind: 'convoy_vehicle', authority: false, objectiveRole: 'escort_target', routeId: null, state: 'moving' }] : mission.id === 'salvage_run' ? [{ id: 'salvage_site_1', kind: 'salvage_site', authority: false, objectiveRole: 'salvage_target' }, { id: 'salvage_team_scene_object', kind: 'salvage_team', authority: false, objectiveRole: 'recovery_team' }] : mission.id === 'outpost_sweep' ? [{ id: 'outer_sector', kind: 'search_sector', authority: false }, { id: 'north_sector', kind: 'search_sector', authority: false }, { id: 'south_sector', kind: 'search_sector', authority: false }, { id: 'inner_sector', kind: 'search_sector', authority: false }] : [{ id: 'control_node_1', kind: 'control_node', authority: false, objectiveRole: 'capture_control' }];
  return {
    grammarVersion: 'universal-scene-1',
    terrain: { id: terrain.id, texture: terrain.texture || 'generic', cover: terrain.cover ?? 0.25, lanes: terrain.lanes || ['center'], zoneBlueprint: terrain.zoneBlueprint || [], obstacles: terrain.obstacles || [], tacticalLayout: terrain.tacticalLayout || null, obstacleLayout: terrain.obstacleLayout || [], coverLayout: terrain.coverLayout || [] },
    objective: { kind: mission.objectiveKind, label: mission.objectiveLabel, convoy: mission.convoy === true, anchor: intent.objective.anchor, state: 'contested' },
    doctrine: { id: strategy.id, advance: strategy.advance, spacing: strategy.spacing, reserve: strategy.reserve },
    beats: ['scout', 'deploy', 'contact', 'resolve'],
    props: (terrain.obstacles || []).map((type, index) => ({ id: `prop_${index + 1}`, type, semantic: 'non_authority_scene_prop', authority: false, solid: true, geometry: { shape: 'box' } })),
    sceneObjects,
    searchSequence: mission.id === 'outpost_sweep' ? ['outer_sector', 'north_sector', 'south_sector', 'inner_sector'] : []
  };
}
