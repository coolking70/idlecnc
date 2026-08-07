/**
 * Presentation-only environment vocabulary for Stage 8.2G-C.
 * These objects never enter the spatial obstacle/authority graph.
 */
export const ENVIRONMENT_CATEGORIES = Object.freeze([
  'terrain_surface', 'road', 'track', 'embankment', 'cover', 'industrial_prop',
  'mission_structure', 'vegetation', 'rock', 'fence', 'barrier', 'ditch', 'debris_static'
]);

const profile = (category, variant, style, options = {}) => Object.freeze({ category, variant, style, ...options });

export const ENVIRONMENT_OBJECT_PROFILES = Object.freeze({
  bare_soil: profile('terrain_surface', 'bare_soil', { fill: '#3d513b', stroke: '#617455' }),
  compacted_road: profile('road', 'compacted_road', { fill: '#686451', stroke: '#aaa17a' }),
  rail_track: profile('track', 'rail_track', { fill: '#4c5147', stroke: '#938b6d' }),
  spoil_embankment: profile('embankment', 'spoil_embankment', { fill: '#655844', stroke: '#ad8f65' }),
  soft_sandbag: profile('cover', 'soft_sandbag', { fill: '#927957', stroke: '#c0a36d' }, { cover: true }),
  heavy_berm: profile('cover', 'heavy_berm', { fill: '#645442', stroke: '#b69563' }, { cover: true }),
  headframe: profile('industrial_prop', 'headframe', { fill: '#394a43', stroke: '#c0a66d' }),
  conveyor: profile('industrial_prop', 'conveyor', { fill: '#4b5b52', stroke: '#b79b65' }),
  ore_silo: profile('industrial_prop', 'ore_silo', { fill: '#55635a', stroke: '#c3aa72' }),
  machine_module: profile('industrial_prop', 'machine_module', { fill: '#47574d', stroke: '#a99168' }),
  objective_frame: profile('mission_structure', 'objective_frame', { fill: '#4f725f', stroke: '#d6bf7a' }),
  low_scrub: profile('vegetation', 'low_scrub', { fill: '#58744e', stroke: '#78915d' }),
  shale: profile('rock', 'shale', { fill: '#4c5148', stroke: '#827b63' }),
  fence_line: profile('fence', 'fence_line', { fill: '#5d6959', stroke: '#b9aa7c' }),
  concrete_barrier: profile('barrier', 'concrete_barrier', { fill: '#66645b', stroke: '#bdb18b' }),
  drainage_ditch: profile('ditch', 'drainage_ditch', { fill: '#2e3b32', stroke: '#7d7358' }),
  static_debris: profile('debris_static', 'static_debris', { fill: '#404a42', stroke: '#aa8d62' })
});

const TERRAIN_VOCABULARY = Object.freeze({
  open: ['headframe', 'conveyor', 'ore_silo', 'machine_module', 'rail_track', 'spoil_embankment', 'shale', 'low_scrub', 'fence_line', 'static_debris'],
  road: ['compacted_road', 'concrete_barrier', 'drainage_ditch', 'low_scrub', 'fence_line', 'machine_module', 'shale'],
  fortified: ['heavy_berm', 'soft_sandbag', 'objective_frame', 'low_scrub', 'shale', 'fence_line', 'static_debris']
});

export function profileForEnvironmentObject(object) {
  return ENVIRONMENT_OBJECT_PROFILES[object?.variant] || ENVIRONMENT_OBJECT_PROFILES.static_debris;
}

export function vocabularyForTerrain(terrainId) {
  return [...(TERRAIN_VOCABULARY[terrainId] || TERRAIN_VOCABULARY.open)];
}
