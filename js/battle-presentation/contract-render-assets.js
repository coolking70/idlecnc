export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const ROAD_WIDTH = 105;

export const ROAD_POINTS = Object.freeze([
  Object.freeze({ x: 0, y: 520 }), Object.freeze({ x: 300, y: 500 }),
  Object.freeze({ x: 650, y: 420 }), Object.freeze({ x: 980, y: 390 }),
  Object.freeze({ x: 1280, y: 330 })
]);

export const FRIENDLY_BUILDINGS = Object.freeze([
  Object.freeze({ x: 100, y: 300, w: 150, h: 90, kind: 'warehouse' }),
  Object.freeze({ x: 160, y: 610, w: 125, h: 70, kind: 'workshop' })
]);

export const ENEMY_BUILDINGS = Object.freeze([
  Object.freeze({ x: 980, y: 170, w: 170, h: 100, kind: 'checkpoint' }),
  Object.freeze({ x: 1060, y: 520, w: 140, h: 85, kind: 'defense' })
]);

export const COVER_GROUPS = Object.freeze({
  friendlyNorth: Object.freeze([{ x: 380, y: 255 }, { x: 430, y: 285 }]),
  friendlySouth: Object.freeze([{ x: 390, y: 590 }, { x: 455, y: 560 }]),
  enemyNorth: Object.freeze([{ x: 845, y: 245 }, { x: 890, y: 270 }]),
  enemySouth: Object.freeze([{ x: 850, y: 530 }, { x: 910, y: 500 }])
});

export const OBJECTIVE = Object.freeze({ x: 760, y: 405, radius: 28 });
export const OBJECTIVE_FLAG_BOUNDS = Object.freeze({ left: 756, right: 764, top: 368, bottom: 449 });
export const CONTRACT_TEMPLATE_ID = 'road_assault_v1_infantry_defense';
export const CONTRACT_RENDER_DEFAULTS = Object.freeze({ debug: false, showHud: true, viewMode: 'overview' });
