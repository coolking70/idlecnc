export const RETREAT_PATHS = Object.freeze({
  e_at_1: [{ t: 24.2, x: 845, y: 235 }, { t: 24.8, x: 895, y: 210 }, { t: 25.4, x: 950, y: 190 }, { t: 26, x: 1010, y: 175 }],
  e_at_2: [{ t: 25, x: 850, y: 555 }, { t: 25.7, x: 900, y: 575 }, { t: 26.4, x: 960, y: 590 }, { t: 27, x: 1015, y: 600 }],
  e_inf_1: [{ t: 27, x: 865, y: 250 }, { t: 27.8, x: 925, y: 225 }, { t: 28.5, x: 985, y: 205 }, { t: 29, x: 1035, y: 190 }],
  e_inf_2: [{ t: 26.8, x: 950, y: 310 }, { t: 27.7, x: 990, y: 285 }, { t: 28.7, x: 1035, y: 250 }, { t: 29.5, x: 1070, y: 220 }],
  e_inf_3: [{ t: 27.5, x: 875, y: 525 }, { t: 28.3, x: 925, y: 550 }, { t: 29.2, x: 985, y: 575 }, { t: 30, x: 1045, y: 595 }]
});

export function interpolateRetreatPath(path, time) {
  if (!path?.length || time <= path[0].t) return path?.[0] ? { ...path[0], moving: false } : null;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]; const next = path[index];
    if (time <= next.t) {
      const amount = Math.max(0, Math.min(1, (time - previous.t) / Math.max(0.001, next.t - previous.t)));
      return { x: previous.x + (next.x - previous.x) * amount, y: previous.y + (next.y - previous.y) * amount, angle: Math.atan2(next.y - previous.y, next.x - previous.x), moving: true };
    }
  }
  const last = path[path.length - 1]; const previous = path[path.length - 2] || last;
  return { ...last, angle: Math.atan2(last.y - previous.y, last.x - previous.x), moving: false };
}

export function getRetreatAlpha(id, time) {
  const path = RETREAT_PATHS[id]; if (!path || time < path[0].t) return 1;
  const fadeAt = path[path.length - 1].t;
  return time <= fadeAt ? 1 : Math.max(0, 1 - (time - fadeAt) / 1.2);
}
