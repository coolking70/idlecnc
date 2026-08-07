const COMMON = { bounds: { width: 1200, height: 700 }, friendlyEdge: 'west', enemyEdge: 'east' };
const zone = (id, kind, x, y, width, height, side = 'neutral', options = {}) => ({ id, kind, x, y, width, height, side, ...options });
const coverBands = (lanes, laneCenters, detour, friendlyX, enemyX) => lanes.flatMap((lane, index) => {
  const y = laneCenters[index] + (detour[lane] || 0);
  return [
    { type: 'berm', x: friendlyX, y, width: 74, height: 64, cover: 'heavy', coverRole: 'friendly', laneId: lane },
    { type: 'berm', x: enemyX, y, width: 74, height: 64, cover: 'heavy', coverRole: 'enemy', laneId: lane }
  ];
});

const SCRAP_MINE_LAYOUT = Object.freeze({
  version: 'scrap-mine-tactical-v2', laneIds: ['north', 'center', 'south'], laneCenters: [110, 350, 550],
  friendlyDeployX: 105, enemyDeployX: 1095, friendlyStagingX: 320, friendlyFireX: 590, friendlyApproachX: 790,
  enemyScreenX: 865, enemyFireX: 790, objectiveX: 930, detour: { north: -42, center: 54, south: 42 }
});

const ROAD_LAYOUT = Object.freeze({
  version: 'road-corridor-tactical-v2', laneIds: ['shoulder-north', 'road', 'shoulder-south'], laneCenters: [125, 350, 575],
  friendlyDeployX: 100, enemyDeployX: 1090, friendlyStagingX: 350, friendlyFireX: 650, friendlyApproachX: 835,
  enemyScreenX: 820, enemyFireX: 760, objectiveX: 990, detour: { 'shoulder-north': -34, road: 62, 'shoulder-south': -80 }
});

const FORTIFIED_LAYOUT = Object.freeze({
  version: 'fortified-breach-tactical-v2', laneIds: ['north-trench', 'central-breach', 'south-trench'], laneCenters: [120, 350, 580],
  friendlyDeployX: 100, enemyDeployX: 1070, friendlyStagingX: 300, friendlyFireX: 560, friendlyApproachX: 735,
  enemyScreenX: 760, enemyFireX: 700, objectiveX: 840, detour: { 'north-trench': -28, 'central-breach': 0, 'south-trench': 28 }
});

export const TERRAIN_PROFILES = Object.freeze({
  open: { ...COMMON, id: 'open', name: '废弃矿区', texture: 'dust', cover: 0.32, lanes: ['north', 'center', 'south'], obstacles: ['scrap_heap', 'crater', 'berm'], tacticalLayout: SCRAP_MINE_LAYOUT, coverLayout: coverBands(['north', 'center', 'south'], [110, 350, 550], SCRAP_MINE_LAYOUT.detour, 500, 860), obstacleLayout: [
    { type: 'scrap_heap', x: 260, y: 185, width: 42, height: 20, cover: 'light' }, { type: 'crater', x: 430, y: 470, width: 40, height: 22, cover: 'light' },
    { type: 'berm', x: 570, y: 520, width: 58, height: 18, cover: 'heavy' }, { type: 'scrap_heap', x: 690, y: 175, width: 48, height: 22, cover: 'light' },
    { type: 'crater', x: 790, y: 270, width: 42, height: 22, cover: 'light' }, { type: 'berm', x: 1000, y: 470, width: 54, height: 18, cover: 'heavy' },
    { type: 'barbed_wire', x: 720, y: 505, width: 52, height: 6, cover: 'denial' }
  ], objectiveAnchor: 'salvage_or_capture_objective', zoneBlueprint: [
    zone('friendly_deploy', 'deploy', 35, 110, 155, 480, 'friendly', { allowedTags: ['infantry', 'vehicle', 'armor', 'support'] }),
    zone('friendly_north_approach', 'approach', 210, 45, 260, 180), zone('friendly_center_approach', 'approach', 210, 260, 300, 180), zone('friendly_south_approach', 'approach', 210, 475, 260, 180),
    zone('open_contact_north', 'contact', 485, 40, 260, 190), zone('open_contact_center', 'contact', 500, 250, 290, 200), zone('open_contact_south', 'contact', 485, 470, 260, 190),
    zone('salvage_or_capture_objective', 'objective', 850, 235, 170, 230, 'neutral', { objectiveRole: 'primary' }), zone('enemy_screen', 'screen', 930, 60, 180, 170, 'enemy'), zone('enemy_depth', 'defense', 980, 280, 180, 350, 'enemy')
  ] },
  road: { ...COMMON, id: 'road', name: '公路', texture: 'asphalt', cover: 0.28, lanes: ['road', 'shoulder-north', 'shoulder-south'], obstacles: ['checkpoint', 'barrier', 'ditch'], tacticalLayout: ROAD_LAYOUT, coverLayout: coverBands(['road', 'shoulder-north', 'shoulder-south'], [125, 350, 575], ROAD_LAYOUT.detour, 565, 845), obstacleLayout: [
    { type: 'checkpoint', x: 520, y: 350, width: 42, height: 14, cover: 'heavy' }, { type: 'barrier', x: 690, y: 220, width: 48, height: 12, cover: 'light' },
    { type: 'barrier', x: 690, y: 550, width: 48, height: 12, cover: 'light' }, { type: 'ditch', x: 815, y: 240, width: 66, height: 14, cover: 'denial' }
  ], objectiveAnchor: 'road_objective', zoneBlueprint: [
    zone('friendly_deploy', 'deploy', 35, 160, 150, 380, 'friendly'), zone('north_shoulder', 'shoulder', 190, 65, 820, 130), zone('road_main', 'road_axis', 190, 275, 850, 150, 'neutral', { allowedTags: ['vehicle', 'armor', 'infantry'] }), zone('south_shoulder', 'shoulder', 190, 505, 820, 130),
    zone('road_checkpoint', 'contact', 580, 245, 190, 210), zone('road_objective', 'objective', 900, 260, 180, 180, 'neutral', { objectiveRole: 'primary' }), zone('enemy_screen', 'screen', 980, 75, 150, 160, 'enemy'), zone('enemy_depth', 'defense', 1040, 455, 120, 170, 'enemy')
  ] },
  fortified: { ...COMMON, id: 'fortified', name: '防御阵地', texture: 'earthworks', cover: 0.62, lanes: ['north_trench', 'central_breach', 'south_trench'], obstacles: ['bunker', 'sandbag', 'watchtower'], tacticalLayout: FORTIFIED_LAYOUT, coverLayout: coverBands(['north-trench', 'central-breach', 'south-trench'], [120, 350, 580], FORTIFIED_LAYOUT.detour, 470, 800), obstacleLayout: [
    { type: 'bunker', x: 430, y: 220, width: 48, height: 22, cover: 'heavy' }, { type: 'sandbag', x: 520, y: 225, width: 92, height: 12, cover: 'heavy' },
    { type: 'watchtower', x: 680, y: 230, width: 24, height: 24, cover: 'observation' }, { type: 'bunker', x: 700, y: 470, width: 48, height: 22, cover: 'heavy' },
    { type: 'sandbag', x: 780, y: 470, width: 52, height: 12, cover: 'heavy' }
  ], objectiveAnchor: 'inner_objective', zoneBlueprint: [
    zone('friendly_deploy', 'deploy', 30, 145, 160, 410, 'friendly'), zone('outer_contact_band', 'outer_contact', 205, 100, 220, 500), zone('north_fortification', 'strongpoint', 430, 30, 260, 170, 'enemy'), zone('central_breach', 'breach', 430, 250, 300, 200, 'neutral', { objectiveRole: 'breach' }), zone('south_fortification', 'strongpoint', 430, 500, 260, 170, 'enemy'),
    zone('inner_objective', 'objective', 750, 245, 180, 210, 'neutral', { objectiveRole: 'primary' }), zone('enemy_armor_redoubt', 'armor_redoubt', 870, 55, 260, 160, 'enemy', { allowedTags: ['armor', 'anti_armor'] }), zone('enemy_depth', 'defense', 930, 400, 230, 250, 'enemy')
  ] }
});

export function getTerrainProfile(id) { return TERRAIN_PROFILES[id] || null; }
