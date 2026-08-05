export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const ROAD_WIDTH = 105;
export const SANDBOX_SEED = 82021;

export const ROAD_POINTS = [
  { x: 0, y: 520 }, { x: 300, y: 500 }, { x: 650, y: 420 },
  { x: 980, y: 390 }, { x: 1280, y: 330 }
];

export const FRIENDLY_BUILDINGS = [
  { x: 100, y: 300, w: 150, h: 90, kind: 'warehouse' },
  { x: 160, y: 610, w: 125, h: 70, kind: 'workshop' }
];

export const ENEMY_BUILDINGS = [
  { x: 980, y: 170, w: 170, h: 100, kind: 'checkpoint' },
  { x: 1060, y: 520, w: 140, h: 85, kind: 'defense' }
];

export const COVER_GROUPS = {
  friendlyNorth: [{ x: 380, y: 255 }, { x: 430, y: 285 }],
  friendlyNorthSecondary: [{ x: 500, y: 220 }, { x: 525, y: 235 }],
  friendlySouth: [{ x: 390, y: 590 }, { x: 455, y: 560 }],
  enemyNorth: [{ x: 845, y: 245 }, { x: 890, y: 270 }],
  enemySouth: [{ x: 850, y: 530 }, { x: 910, y: 500 }]
};

export const COVER_SLOTS = Object.freeze({
  friendlyNorth: [
    { x: 402, y: 254, facing: 0.05, stance: 'crouch' }, { x: 419, y: 261, facing: 0.02, stance: 'crouch' },
    { x: 435, y: 271, facing: -0.03, stance: 'stand' }, { x: 447, y: 282, facing: -0.08, stance: 'crouch' }
  ],
  friendlySouth: [
    { x: 407, y: 582, facing: -0.08, stance: 'crouch' }, { x: 425, y: 574, facing: -0.04, stance: 'stand' },
    { x: 444, y: 563, facing: 0.02, stance: 'crouch' }, { x: 459, y: 551, facing: 0.06, stance: 'crouch' }
  ],
  friendlyNorthSecondary: [
    { x: 482, y: 216, facing: 0.05, stance: 'crouch' }, { x: 500, y: 222, facing: 0.02, stance: 'crouch' },
    { x: 519, y: 232, facing: -0.03, stance: 'stand' }, { x: 537, y: 240, facing: -0.07, stance: 'crouch' }
  ],
  enemyNorth: [
    { x: 842, y: 245, facing: 3.08, stance: 'crouch' }, { x: 860, y: 254, facing: 3.12, stance: 'stand' },
    { x: 879, y: 264, facing: 3.16, stance: 'crouch' }, { x: 895, y: 276, facing: 3.20, stance: 'crouch' }
  ],
  enemySouth: [
    { x: 846, y: 536, facing: 3.20, stance: 'crouch' }, { x: 865, y: 527, facing: 3.16, stance: 'stand' },
    { x: 884, y: 516, facing: 3.12, stance: 'crouch' }, { x: 901, y: 504, facing: 3.08, stance: 'crouch' }
  ]
});

export const OBJECTIVE_NORTH_SLOTS = Object.freeze([
  { x: 700, y: 330, facing: 0.02, stance: 'crouch' }, { x: 720, y: 340, facing: 0.00, stance: 'stand' },
  { x: 742, y: 350, facing: -0.03, stance: 'crouch' }, { x: 760, y: 360, facing: -0.05, stance: 'crouch' }
]);

export const OBJECTIVE_SOUTH_SLOTS = Object.freeze([
  { x: 690, y: 495, facing: -0.05, stance: 'crouch' }, { x: 712, y: 485, facing: -0.02, stance: 'stand' },
  { x: 735, y: 475, facing: 0.02, stance: 'crouch' }, { x: 755, y: 465, facing: 0.05, stance: 'crouch' }
]);

export const ENEMY_REVEAL_TIMES = Object.freeze({
  e_inf_1: { revealStart: 4.20, revealEnd: 4.80 },
  e_at_1: { revealStart: 4.45, revealEnd: 5.10 },
  e_armor_1: { revealStart: 4.90, revealEnd: 5.55 },
  e_inf_2: { revealStart: 5.10, revealEnd: 5.75 },
  e_armor_2: { revealStart: 5.35, revealEnd: 6.05 },
  e_inf_3: { revealStart: 5.55, revealEnd: 6.25 },
  e_at_2: { revealStart: 5.80, revealEnd: 6.50 }
});

export const OBJECTIVE = { x: 760, y: 405, radius: 28 };

export const INFANTRY_OFFSETS = [
  { x: -10, y: -7 }, { x: 10, y: -5 }, { x: -6, y: 9 }, { x: 12, y: 8 }
];

export const FRIENDLY_UNITS = [
  { id: 'f_scout_1', type: 'scout_car', name: '侦察车', start: { x: 170, y: 420 } },
  { id: 'f_inf_1', type: 'infantry', name: '步兵一班', start: { x: 190, y: 340 } },
  { id: 'f_inf_2', type: 'infantry', name: '步兵二班', start: { x: 210, y: 570 } },
  { id: 'f_at_1', type: 'at_infantry', name: '反装甲班', start: { x: 135, y: 510 } },
  { id: 'f_tank_1', type: 'mbt', name: '主战坦克一号', start: { x: 105, y: 455 } },
  { id: 'f_tank_2', type: 'mbt', name: '主战坦克二号', start: { x: 80, y: 565 } },
  { id: 'f_repair_1', type: 'repair_vehicle', name: '维修车', start: { x: 70, y: 650 } }
];

export const ENEMY_UNITS = [
  { id: 'e_inf_1', type: 'enemy_infantry', name: '敌步兵北组', start: { x: 1050, y: 250 }, ...ENEMY_REVEAL_TIMES.e_inf_1 },
  { id: 'e_inf_2', type: 'enemy_infantry', name: '敌步兵二组', start: { x: 980, y: 315 }, ...ENEMY_REVEAL_TIMES.e_inf_2 },
  { id: 'e_inf_3', type: 'enemy_infantry', name: '敌步兵南组', start: { x: 1010, y: 530 }, ...ENEMY_REVEAL_TIMES.e_inf_3 },
  { id: 'e_at_1', type: 'enemy_at', name: '敌反装甲北组', start: { x: 940, y: 230 }, ...ENEMY_REVEAL_TIMES.e_at_1 },
  { id: 'e_at_2', type: 'enemy_at', name: '敌反装甲南组', start: { x: 960, y: 560 }, ...ENEMY_REVEAL_TIMES.e_at_2 },
  { id: 'e_armor_1', type: 'enemy_light_armor', name: '敌轻装甲一号', start: { x: 1080, y: 420 }, ...ENEMY_REVEAL_TIMES.e_armor_1 },
  { id: 'e_armor_2', type: 'enemy_light_armor', name: '敌轻装甲二号', start: { x: 1120, y: 470 }, ...ENEMY_REVEAL_TIMES.e_armor_2 }
];

export const PATHS = Object.freeze({
  f_scout_1: [{ t: 0.5, x: 170, y: 420 }, { t: 1.3, x: 300, y: 400 }, { t: 2.1, x: 450, y: 350 }, { t: 2.8, x: 585, y: 325 }, { t: 3.2, x: 625, y: 315 }, { t: 8, x: 625, y: 315 }, { t: 8.8, x: 680, y: 255 }, { t: 9.5, x: 720, y: 235 }, { t: 20, x: 720, y: 235 }, { t: 20.8, x: 755, y: 205 }, { t: 21.6, x: 805, y: 195 }, { t: 22.5, x: 835, y: 215 }, { t: 23.2, x: 815, y: 245 }, { t: 24, x: 790, y: 260 }, { t: 29, x: 790, y: 260 }, { t: 30, x: 850, y: 250 }, { t: 31, x: 900, y: 265 }, { t: 32, x: 920, y: 290 }, { t: 35, x: 920, y: 290 }],
  f_inf_1: [{ t: 1, x: 190, y: 340 }, { t: 2.2, x: 285, y: 315 }, { t: 3.4, x: 360, y: 280 }, { t: 4.7, x: 420, y: 270 }, { t: 5.5, x: 435, y: 265 }],
  f_inf_2: [{ t: 1.4, x: 210, y: 570 }, { t: 2.8, x: 285, y: 600 }, { t: 4, x: 365, y: 585 }, { t: 5.2, x: 430, y: 565 }, { t: 6, x: 445, y: 555 }],
  f_at_1: [{ t: 3, x: 135, y: 510 }, { t: 4.2, x: 250, y: 470 }, { t: 5.5, x: 345, y: 420 }, { t: 6.6, x: 430, y: 390 }, { t: 7.5, x: 485, y: 370 }],
  f_tank_1: [{ t: 2, x: 105, y: 455 }, { t: 3, x: 235, y: 475 }, { t: 4.2, x: 360, y: 455 }, { t: 5.4, x: 485, y: 430 }, { t: 6.4, x: 575, y: 415 }, { t: 7, x: 620, y: 405 }, { t: 10, x: 620, y: 405 }, { t: 11.8, x: 620, y: 405 }, { t: 12.6, x: 590, y: 420 }, { t: 13.4, x: 555, y: 438 }, { t: 14.2, x: 530, y: 452 }, { t: 20, x: 530, y: 452 }, { t: 30, x: 530, y: 452 }, { t: 31, x: 555, y: 448 }, { t: 32, x: 580, y: 440 }, { t: 33, x: 605, y: 432 }, { t: 34, x: 625, y: 425 }, { t: 35, x: 625, y: 425 }],
  f_tank_2: [{ t: 2.7, x: 80, y: 565 }, { t: 3.8, x: 200, y: 540 }, { t: 5, x: 335, y: 510 }, { t: 6.2, x: 465, y: 475 }, { t: 7.2, x: 555, y: 455 }, { t: 7.8, x: 595, y: 450 }, { t: 20, x: 595, y: 450 }, { t: 21.2, x: 595, y: 450 }, { t: 21.7, x: 625, y: 440 }, { t: 22.3, x: 655, y: 430 }, { t: 23, x: 655, y: 430 }, { t: 24, x: 690, y: 420 }, { t: 25, x: 725, y: 410 }, { t: 26, x: 760, y: 400 }, { t: 27, x: 800, y: 390 }, { t: 28, x: 830, y: 382 }, { t: 30, x: 815, y: 350 }, { t: 35, x: 815, y: 350 }],
  f_repair_1: [{ t: 3.5, x: 70, y: 650 }, { t: 5, x: 145, y: 620 }, { t: 6.5, x: 230, y: 585 }, { t: 8, x: 300, y: 550 }, { t: 10, x: 320, y: 540 }, { t: 12, x: 320, y: 540 }, { t: 13, x: 365, y: 520 }, { t: 14, x: 415, y: 500 }, { t: 15, x: 465, y: 485 }, { t: 16.2, x: 500, y: 475 }, { t: 19.5, x: 500, y: 475 }, { t: 20, x: 480, y: 500 }, { t: 20.8, x: 480, y: 500 }, { t: 21.4, x: 455, y: 515 }, { t: 22, x: 438, y: 528 }, { t: 30.5, x: 438, y: 528 }, { t: 31.5, x: 470, y: 505 }, { t: 32.5, x: 505, y: 485 }, { t: 33.5, x: 535, y: 470 }, { t: 34.5, x: 555, y: 462 }, { t: 35, x: 555, y: 462 }],
  e_inf_1: [{ t: 0, x: 1050, y: 250 }, { t: 2.5, x: 930, y: 245 }, { t: 5.5, x: 865, y: 250 }],
  e_inf_2: [{ t: 0, x: 980, y: 315 }, { t: 4.5, x: 950, y: 310 }, { t: 10, x: 950, y: 310 }],
  e_at_1: [{ t: 0, x: 940, y: 230 }, { t: 2.5, x: 900, y: 245 }, { t: 5.5, x: 845, y: 235 }],
  e_inf_3: [{ t: 0, x: 1010, y: 530 }, { t: 3, x: 955, y: 535 }, { t: 6, x: 875, y: 525 }],
  e_at_2: [{ t: 0, x: 960, y: 560 }, { t: 3, x: 925, y: 540 }, { t: 6, x: 850, y: 555 }],
  e_armor_1: [{ t: 0, x: 1080, y: 420 }, { t: 4, x: 1000, y: 410 }, { t: 7, x: 875, y: 390 }],
  e_armor_2: [{ t: 0, x: 1120, y: 470 }, { t: 4, x: 1050, y: 465 }, { t: 7, x: 930, y: 455 }, { t: 17.55, x: 930, y: 455 }, { t: 18, x: 930, y: 455 }, { t: 18.6, x: 950, y: 468 }, { t: 19.2, x: 970, y: 480 }, { t: 19.5, x: 980, y: 486 }, { t: 20, x: 980, y: 486 }, { t: 35, x: 980, y: 486 }]
});

export const CAMERA_KEYFRAMES = [
  { t: 0, x: 640, y: 400, zoom: 0.92 }, { t: 2.5, x: 600, y: 360, zoom: 1.02 },
  { t: 5, x: 650, y: 420, zoom: 1.05 }, { t: 7.5, x: 740, y: 365, zoom: 1.14 },
  { t: 9.4, x: 700, y: 400, zoom: 1.05 }, { t: 10, x: 700, y: 400, zoom: 1.05 },
  { t: 12, x: 690, y: 360, zoom: 1.14 }, { t: 15, x: 600, y: 355, zoom: 1.08 },
  { t: 18, x: 535, y: 440, zoom: 1.16 }, { t: 20, x: 670, y: 420, zoom: 1.06 },
  { t: 23, x: 760, y: 405, zoom: 1.13 }, { t: 27, x: 735, y: 390, zoom: 1.06 },
  { t: 31.5, x: 770, y: 405, zoom: 1.10 }, { t: 35, x: 720, y: 400, zoom: 0.96 }
];

export const LATE_VISUAL_EVENTS = Object.freeze([
  { t: 10.85, type: 'rocket_curve', source: 'e_at_1', target: 'f_tank_1', start: { x: 845, y: 235 }, control: { x: 750, y: 275 }, end: { x: 620, y: 405 }, impactTime: 11.45 },
  { t: 11.45, type: 'armor_hit', source: 'e_at_1', target: 'f_tank_1', x: 620, y: 405 },
  { t: 16.9, type: 'rocket_curve', source: 'f_at_1', target: 'e_armor_2', start: { x: 485, y: 370 }, control: { x: 670, y: 405 }, end: { x: 930, y: 455 }, impactTime: 17.55 },
  { t: 17.55, type: 'armor_hit', source: 'f_at_1', target: 'e_armor_2', x: 930, y: 455 }
  ,{ t: 22.0, type: 'target_mark', source: 'f_scout_1', target: 'e_at_1', x: 845, y: 235, life: 0.8 }
  ,{ t: 22.35, type: 'main_gun_curve', source: 'f_tank_2', target: 'e_armor_1', start: { x: 655, y: 430 }, control: { x: 755, y: 395 }, end: { x: 875, y: 390 }, impactTime: 22.72 }
  ,{ t: 22.72, type: 'armor_destroy', source: 'f_tank_2', target: 'e_armor_1', x: 875, y: 390 }
  ,{ t: 23.5, type: 'rocket_curve_miss', source: 'e_at_2', target: 'f_tank_2', start: { x: 850, y: 555 }, control: { x: 760, y: 505 }, end: { x: 690, y: 465 }, impactTime: 24.05 }
  ,{ t: 24.05, type: 'road_miss_explosion', source: 'e_at_2', x: 690, y: 465 }
  ,{ t: 31.5, type: 'capture_pulse', source: 'objective', x: 760, y: 405 }
]);

export const FIRE_PLAN = [
  { t: 7.2, type: 'aim', source: 'e_at_1', target: 'f_tank_1' },
  { t: 7.4, type: 'rifle_burst', source: 'f_inf_1', target: 'e_inf_1', duration: 1.0 },
  { t: 7.55, type: 'rifle_burst', source: 'e_inf_1', target: 'f_inf_1', duration: 1.0 },
  { t: 7.6, type: 'suppression', source: 'f_inf_2', target: 'e_inf_3', duration: 1.4 },
  { t: 7.8, type: 'turret_lock', source: 'f_tank_1', target: 'e_armor_1' },
  { t: 8.1, type: 'cannon_shell', source: 'f_tank_1', target: 'e_armor_1' },
  { t: 8.5, type: 'rocket', source: 'e_at_1', target: 'f_tank_1' },
  { t: 8.7, type: 'coax_burst', source: 'f_tank_2', target: 'e_inf_3', duration: 1.3 },
  { t: 9.0, type: 'enemy_armor_fire', source: 'e_armor_1', target: 'f_inf_1', duration: 1.0 }
];

export const DEBUG_DEFAULTS = Object.freeze({ routes: false, coverRadius: false, labels: false, hud: true });

export function clonePoint(point) { return { x: point.x, y: point.y }; }

export function fixedSeedSequence(seed = SANDBOX_SEED) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
