import { buildReserveRoute, isReserveSlot, reserveIndexFromSlot } from './reserve-slot-policy.js';

const FIXED_ROUTES = Object.freeze({
  friendly_scout_flank: [[170, 420], [330, 385], [520, 330], [680, 300], [800, 255], [910, 290]],
  friendly_north_assault: [[230, 340], [350, 300], [450, 275], [570, 285], [720, 320], [770, 350]],
  friendly_south_infantry_assault: [[205, 570], [310, 560], [425, 525], [545, 490], [680, 475], [750, 465]],
  friendly_south_at_assault: [[150, 555], [300, 545], [430, 520], [550, 485], [680, 460], [770, 445]],
  friendly_lead_tank: [[170, 465], [330, 445], [500, 410], [610, 400], [610, 420], [610, 420]],
  friendly_support_tank: [[110, 560], [260, 520], [430, 470], [570, 440], [700, 415], [820, 370]],
  friendly_repair_rear: [[105, 635], [210, 610], [315, 575], [410, 530], [520, 485], [560, 460]],
  enemy_north_cover: [[1010, 235], [930, 245], [865, 255], [850, 265], [850, 265], [850, 265]],
  enemy_center_checkpoint: [[1040, 315], [980, 315], [920, 320], [860, 330], [845, 335], [845, 335]],
  enemy_south_cover: [[1030, 530], [960, 525], [900, 515], [860, 500], [850, 485], [850, 485]],
  enemy_rear_reserve: [[1080, 430], [1010, 425], [950, 420], [900, 410], [860, 395], [860, 395]],
  enemy_north_at_nest: [[960, 225], [900, 235], [855, 245], [830, 255], [825, 260], [825, 260]],
  enemy_south_at_nest: [[970, 555], [920, 545], [870, 535], [835, 520], [820, 500], [820, 500]]
});

function cloneRoute(points) { return points.map((point) => ({ x: point[0] ?? point.x, y: point[1] ?? point.y })); }
function fixedRoute(slotId) { return FIXED_ROUTES[slotId] ? cloneRoute(FIXED_ROUTES[slotId]) : null; }

export function buildRouteRegistry(slots = [], actors = []) {
  const actorById = Object.fromEntries(actors.map((actor) => [actor.id, actor]));
  const reserveCounters = { friendly: 0, enemy: 0 };
  const registry = {};
  const errors = [];
  for (const slot of slots) {
    const actor = actorById[slot.actorId];
    const fixed = fixedRoute(slot.slotId);
    let points = fixed;
    let source = 'fixed';
    if (!points && isReserveSlot(slot.slotId)) {
      const index = reserveIndexFromSlot(slot.slotId);
      points = buildReserveRoute({ side: slot.side, index, category: actor?.category || 'infantry' });
      source = 'dynamic';
    }
    if (!points) {
      errors.push(`unknown_template_slot:${slot.slotId}`);
      continue;
    }
    reserveCounters[slot.side] = Math.max(reserveCounters[slot.side], reserveIndexFromSlot(slot.slotId) || 0);
    const finalPosition = points.at(-1);
    registry[slot.slotId] = Object.freeze({
      slotId: slot.slotId, side: slot.side, category: actor?.category || null,
      points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
      finalPosition: Object.freeze({ ...finalPosition }), source
    });
  }
  return { registry, errors, reserveCounters };
}

export function getRoute(routeRegistry, slotId) {
  const route = routeRegistry?.[slotId];
  if (!route) throw new Error(`unknown_template_slot:${slotId}`);
  return route;
}

export { FIXED_ROUTES };
