/**
 * RTS 战术战场渲染器（阶段8.1）。
 * Canvas 只读取视觉计划，绝不写入 activeBattle、report 或 state。
 */
import { RENDER, BATTLE_RESULT } from './config.js';
import { resultLabel } from './battle.js';
import { clamp, safeNumber } from './utils.js';
import { BATTLE_WORLD, createBattleVisualPlan, getVisualActorsAtTime, getVisualEffectsAtTime, getVisualPhaseAtTime } from './battle-visual-director.js';
import { CAMERA_MODES, createBattleCamera, getBattleCamera, setBattleCameraMode } from './battle-camera.js';

const FONT = "Consolas, 'Microsoft YaHei', monospace";
const TAU = Math.PI * 2;
const C = {
  sky: '#0c1715', ground: '#344631', ground2: '#293a2a', grid: 'rgba(168,210,174,.08)',
  friendly: '#83e0ad', friendlyDark: '#27684c', enemy: '#f07b68', enemyDark: '#74332d',
  accent: '#e8c15a', text: '#e0eade', dim: 'rgba(224,234,222,.60)', hp: '#87dfa6', repair: '#72cfee',
  dust: 'rgba(207,180,121,.45)', muzzle: '#ffd477', white: '#f6f2d7'
};

function rect(canvas) {
  const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 960, height: 540 };
  return { width: Math.max(320, Math.floor(r.width || 960)), height: Math.max(240, Math.floor(r.height || 540)) };
}

export class BattleRenderer {
  constructor(canvas) {
    if (!canvas || !canvas.getContext) throw new Error('[battle-renderer] 缺少可用的 canvas 元素');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0; this.height = 0; this.dpr = 1; this.tReal = 0;
    this._battleId = null; this._plan = null; this._camera = null; this._lastResult = null;
    this.cameraMode = CAMERA_MODES.overview;
    this.autoCamera = true;
    this._onResize = () => this.resize();
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const size = rect(this.canvas);
    this.width = size.width; this.height = size.height;
    this.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, RENDER.maxDpr || 2);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
  }

  reset() {
    this._battleId = null; this._plan = null; this._camera = null; this._lastResult = null;
  }

  destroy() {
    if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', this._onResize);
  }

  setCameraMode(mode, focusId = null) {
    this.cameraMode = mode;
    if (this._camera) setBattleCameraMode(this._camera, mode, focusId);
  }

  setAutoCamera(enabled) {
    this.autoCamera = enabled !== false;
    if (this._camera) this._camera.auto = this.autoCamera;
  }

  _ensurePlan(activeBattle) {
    if (!activeBattle || !activeBattle.report) return null;
    if (this._plan && this._battleId === activeBattle.id) return this._plan;
    this._battleId = activeBattle.id;
    this._plan = createBattleVisualPlan(activeBattle.report, { battleId: activeBattle.id });
    this._camera = createBattleCamera(this._plan, { mode: this.cameraMode, auto: this.autoCamera });
    this._lastResult = null;
    return this._plan;
  }

  _screenTransform(camera) {
    const fit = Math.min(this.width / BATTLE_WORLD.width, this.height / BATTLE_WORLD.height);
    const scale = fit * clamp(camera.zoom, 0.68, 1.3);
    return { scale, ox: this.width / 2 - camera.x * scale, oy: this.height / 2 - camera.y * scale };
  }

  _world(ctx, transform, x, y) {
    return { x: x * transform.scale + transform.ox, y: y * transform.scale + transform.oy };
  }

  render(activeBattle, dtReal = 0) {
    this.tReal += Math.max(0, safeNumber(dtReal, 0));
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    if (ctx.setTransform) ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!activeBattle || !activeBattle.report) {
      this._drawIdle(ctx);
      ctx.restore();
      return;
    }

    const plan = this._ensurePlan(activeBattle);
    const returning = activeBattle.presentationPhase === 'returning' || (activeBattle.settled && !activeBattle.playing);
    const elapsed = returning ? plan.duration : clamp(safeNumber(activeBattle.elapsed, 0), 0, plan.duration);
    const phase = getVisualPhaseAtTime(plan, elapsed);
    const actors = getVisualActorsAtTime(plan, elapsed, {
      presentationPhase: returning ? 'returning' : 'battle',
      returnElapsed: activeBattle.returnElapsed,
      returnDuration: activeBattle.returnDuration
    });
    const effects = getVisualEffectsAtTime(plan, elapsed);
    if (activeBattle.settled) this._camera.mode = CAMERA_MODES.result;
    else this._camera.mode = this.cameraMode;
    this._camera.auto = this.autoCamera;
    const camera = getBattleCamera(this._camera, plan, elapsed, { smoothing: 0.18, presentationPhase: returning ? 'returning' : 'battle', returnElapsed: activeBattle.returnElapsed, returnDuration: activeBattle.returnDuration });
    const transform = this._screenTransform(camera);
    this._drawSky(ctx);
    ctx.save();
    this._drawMap(ctx, plan, transform);
    this._drawRoutes(ctx, actors, transform);
    this._drawObjective(ctx, plan.objective, transform);
    this._drawEffects(ctx, effects, actors, transform);
    this._drawActors(ctx, actors, transform, camera);
    ctx.restore();
    this._drawHud(ctx, activeBattle, plan, phase, actors, camera, returning);
    if (activeBattle.settled) this._drawResultBanner(ctx, activeBattle.report, returning);
    ctx.restore();
  }

  _drawIdle(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, C.sky); g.addColorStop(1, C.ground2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = C.dim; ctx.font = `12px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('等待作战指令 · TACTICAL FIELD STANDBY', this.width / 2, this.height / 2);
    ctx.textAlign = 'left';
  }

  _drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, C.sky); g.addColorStop(0.48, '#17271f'); g.addColorStop(1, '#0d1511');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.width, this.height);
  }

  _drawMap(ctx, plan, tr) {
    const a = this._world(ctx, tr, 0, 110); const b = this._world(ctx, tr, BATTLE_WORLD.width, BATTLE_WORLD.height);
    ctx.fillStyle = C.ground; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let x = 0; x <= BATTLE_WORLD.width; x += 50) { const p = this._world(ctx, tr, x, 110); const q = this._world(ctx, tr, x, BATTLE_WORLD.height); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    for (let y = 110; y <= BATTLE_WORLD.height; y += 50) { const p = this._world(ctx, tr, 0, y); const q = this._world(ctx, tr, BATTLE_WORLD.width, y); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    if (plan.terrain === 'road') this._drawRoad(ctx, tr);
    if (plan.terrain === 'fortified') this._drawFortifiedLine(ctx, tr);
    plan.map.props.forEach((prop) => this._drawProp(ctx, prop, tr));
    plan.map.coverNodes.forEach((cover) => {
      const p = this._world(ctx, tr, cover.x, cover.y);
      ctx.strokeStyle = 'rgba(204,210,150,.22)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(p.x, p.y, cover.radius * tr.scale, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  _drawRoad(ctx, tr) {
    const a = this._world(ctx, tr, 0, 350); const b = this._world(ctx, tr, BATTLE_WORLD.width, 350);
    ctx.strokeStyle = '#55564b'; ctx.lineWidth = 86 * tr.scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(231,199,105,.65)'; ctx.lineWidth = 2; ctx.setLineDash([22, 18]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }

  _drawFortifiedLine(ctx, tr) {
    const a = this._world(ctx, tr, 590, 115); const b = this._world(ctx, tr, 590, 650);
    ctx.strokeStyle = 'rgba(106,88,61,.85)'; ctx.lineWidth = 22 * tr.scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(228,190,113,.6)'; ctx.lineWidth = 2; ctx.setLineDash([9, 7]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }

  _drawProp(ctx, prop, tr) {
    const p = this._world(ctx, tr, prop.x, prop.y); const s = tr.scale * prop.scale;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(prop.rotation || 0);
    if (prop.kind === 'bush') { ctx.fillStyle = '#49653c'; ctx.beginPath(); ctx.arc(0, 0, 13 * s, 0, TAU); ctx.arc(10 * s, 1 * s, 10 * s, 0, TAU); ctx.fill(); }
    else if (prop.kind === 'rock' || prop.kind === 'crater') { ctx.fillStyle = prop.kind === 'rock' ? '#69735d' : 'rgba(24,31,22,.65)'; ctx.beginPath(); ctx.ellipse(0, 0, 16 * s, 8 * s, 0, 0, TAU); ctx.fill(); }
    else if (prop.kind === 'bunker' || prop.kind === 'barrier' || prop.kind === 'sandbag') { ctx.fillStyle = prop.kind === 'bunker' ? '#5d614f' : '#88714e'; ctx.fillRect(-20 * s, -7 * s, 40 * s, 14 * s); if (prop.kind === 'sandbag') { ctx.fillStyle = '#af966a'; ctx.fillRect(-17 * s, -10 * s, 8 * s, 6 * s); ctx.fillRect(-5 * s, -10 * s, 8 * s, 6 * s); ctx.fillRect(7 * s, -10 * s, 8 * s, 6 * s); } }
    else { ctx.fillStyle = '#4f6248'; ctx.fillRect(-7 * s, -7 * s, 14 * s, 14 * s); ctx.strokeStyle = 'rgba(210,199,127,.35)'; ctx.strokeRect(-9 * s, -9 * s, 18 * s, 18 * s); }
    ctx.restore();
  }

  _drawRoutes(ctx, actors, tr) {
    actors.forEach((actor) => {
      ctx.strokeStyle = actor.side === 'friendly' ? 'rgba(131,224,173,.14)' : 'rgba(240,123,104,.14)'; ctx.lineWidth = 1; ctx.setLineDash([5, 8]); ctx.beginPath();
      actor.route.forEach((point, index) => { const p = this._world(ctx, tr, point.x, point.y); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  _drawObjective(ctx, objective, tr) {
    const p = this._world(ctx, tr, objective.x, objective.y);
    ctx.strokeStyle = 'rgba(232,193,90,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, objective.radius * tr.scale, 0, TAU); ctx.stroke();
    ctx.fillStyle = C.accent; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(objective.label, p.x, p.y - objective.radius * tr.scale - 7); ctx.textAlign = 'left';
  }

  _drawEffects(ctx, effects, actors, tr) {
    effects.forEach((effect) => {
      const target = actors.find((actor) => actor.id === effect.targetId) || actors.find((actor) => actor.id === effect.actorId);
      const origin = actors.find((actor) => actor.id === effect.actorId);
      if (effect.type === 'fire' && origin && target) {
        const a = this._world(ctx, tr, origin.x, origin.y); const b = this._world(ctx, tr, target.x, target.y);
        ctx.strokeStyle = origin.side === 'friendly' ? C.muzzle : C.enemy; ctx.lineWidth = 2; ctx.globalAlpha = 0.72; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = C.muzzle; ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, TAU); ctx.fill();
      } else if (effect.type === 'damage' || effect.type === 'destroy' || effect.type === 'cover_hit') {
        const p = target ? this._world(ctx, tr, target.x, target.y) : this._world(ctx, tr, effect.x || 600, effect.y || 350);
        ctx.strokeStyle = effect.type === 'destroy' ? C.enemy : C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, (effect.type === 'destroy' ? 17 : 10) * tr.scale, 0, TAU); ctx.stroke();
        if (effect.type === 'destroy') { ctx.fillStyle = 'rgba(30,24,18,.6)'; ctx.beginPath(); ctx.arc(p.x, p.y, 11 * tr.scale, 0, TAU); ctx.fill(); }
      } else if (effect.type === 'repair') {
        const a = origin && this._world(ctx, tr, origin.x, origin.y); const b = target && this._world(ctx, tr, target.x, target.y); if (a && b) { ctx.strokeStyle = C.repair; ctx.lineWidth = 2; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; }
      } else if (effect.type === 'dust') {
        const p = this._world(ctx, tr, effect.x, effect.y); ctx.fillStyle = C.dust; ctx.beginPath(); ctx.arc(p.x, p.y, 8 * tr.scale, 0, TAU); ctx.fill();
      }
    });
  }

  _drawActors(ctx, actors, tr, camera) {
    actors.forEach((actor) => {
      const p = this._world(ctx, tr, actor.x, actor.y); const color = actor.side === 'friendly' ? C.friendly : C.enemy; const dark = actor.side === 'friendly' ? C.friendlyDark : C.enemyDark; const s = tr.scale;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(actor.facing, 1); ctx.globalAlpha = actor.alive ? 1 : .52;
      if (actor.category === 'tank') { ctx.fillStyle = dark; ctx.fillRect(-22 * s, -11 * s, 44 * s, 22 * s); ctx.fillStyle = color; ctx.fillRect(-15 * s, -8 * s, 26 * s, 16 * s); ctx.strokeStyle = C.white; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(4 * s, 0); ctx.lineTo(31 * s, 0); ctx.stroke(); }
      else if (actor.category === 'scout_car') { ctx.fillStyle = dark; ctx.fillRect(-19 * s, -9 * s, 38 * s, 18 * s); ctx.fillStyle = color; ctx.fillRect(-11 * s, -7 * s, 17 * s, 8 * s); ctx.fillStyle = '#1b241c'; ctx.beginPath(); ctx.arc(-12 * s, 10 * s, 5 * s, 0, TAU); ctx.arc(12 * s, 10 * s, 5 * s, 0, TAU); ctx.fill(); }
      else if (actor.category === 'repair') { ctx.fillStyle = dark; ctx.fillRect(-18 * s, -10 * s, 36 * s, 20 * s); ctx.fillStyle = color; ctx.fillRect(-10 * s, -7 * s, 16 * s, 10 * s); ctx.strokeStyle = C.repair; ctx.beginPath(); ctx.moveTo(8 * s, -5 * s); ctx.lineTo(23 * s, -19 * s); ctx.stroke(); }
      else { actor.visualMembers.forEach((member) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(member.x - actor.x, member.y - actor.y, 5 * s, 0, TAU); ctx.fill(); ctx.strokeStyle = dark; ctx.stroke(); }); if (actor.category === 'at') { ctx.strokeStyle = C.white; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15 * s, -8 * s); ctx.stroke(); } }
      ctx.restore();
      const showHp = actor.hp < actor.maxHp || camera.mode === CAMERA_MODES.focus || actor.state === 'firing' || actor.state === 'destroyed';
      if (showHp) this._drawHp(ctx, actor, p, tr, color);
      ctx.fillStyle = actor.side === 'friendly' ? C.friendly : C.enemy; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(actor.callsign || actor.name, p.x, p.y - 18 * tr.scale); ctx.textAlign = 'left';
    });
  }

  _drawHp(ctx, actor, p, tr, color) {
    const w = 46 * tr.scale; const y = p.y + 22 * tr.scale; ctx.fillStyle = 'rgba(0,0,0,.64)'; ctx.fillRect(p.x - w / 2, y, w, 4 * tr.scale); ctx.fillStyle = color; ctx.fillRect(p.x - w / 2, y, w * clamp(actor.hp / actor.maxHp, 0, 1), 4 * tr.scale);
  }

  _drawHud(ctx, active, plan, phase, actors, camera, returning) {
    ctx.fillStyle = 'rgba(7,12,10,.78)'; ctx.fillRect(0, 0, this.width, 68);
    ctx.fillStyle = C.accent; ctx.font = `bold 14px ${FONT}`; ctx.fillText('战术战场 / TACTICAL BATTLE', 16, 22);
    ctx.fillStyle = C.dim; ctx.font = `11px ${FONT}`; ctx.fillText(`${active.theaterName || plan.theaterId || '未知战区'} · ${plan.terrain === 'fortified' ? '防御阵地' : plan.terrain === 'road' ? '公路' : '开阔地'}`, 16, 43);
    ctx.textAlign = 'right'; ctx.fillStyle = returning ? C.accent : C.text; ctx.fillText(returning ? '部队正在重新集结并返航' : `行动阶段：${phase ? phase.id : 'engage'} · ${this._cameraLabel(camera.mode)}`, this.width - 16, 22);
    const f = actors.filter((actor) => actor.side === 'friendly' && actor.alive).length; const e = actors.filter((actor) => actor.side === 'enemy' && actor.alive).length;
    ctx.fillStyle = C.friendly; ctx.fillText(`我方 ${f}`, this.width - 16, 43); ctx.fillStyle = C.enemy; ctx.fillText(`敌方 ${e}`, this.width - 72, 43); ctx.textAlign = 'left';
    const p = returning ? clamp(safeNumber(active.returnElapsed, 0) / Math.max(.1, safeNumber(active.returnDuration, 5)), 0, 1) : clamp(safeNumber(active.elapsed, 0) / Math.max(1, plan.duration), 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(16, 58, this.width - 32, 3); ctx.fillStyle = returning ? C.accent : C.friendly; ctx.fillRect(16, 58, (this.width - 32) * p, 3);
  }

  _cameraLabel(mode) { return mode === CAMERA_MODES.focus ? '聚焦镜头' : mode === CAMERA_MODES.impact ? '打击镜头' : mode === CAMERA_MODES.result ? '结果镜头' : '总览镜头'; }

  _drawResultBanner(ctx, report, returning) {
    const victory = report.result === BATTLE_RESULT.VICTORY || report.result === BATTLE_RESULT.PYRRHIC;
    const y = this.height * .38; ctx.fillStyle = 'rgba(8,12,10,.68)'; ctx.fillRect(0, y, this.width, 86);
    ctx.strokeStyle = victory ? 'rgba(131,224,173,.55)' : 'rgba(240,123,104,.55)'; ctx.strokeRect(0, y, this.width, 86);
    ctx.textAlign = 'center'; ctx.fillStyle = victory ? C.friendly : C.enemy; ctx.font = `bold 24px ${FONT}`; ctx.fillText(resultLabel(report.result), this.width / 2, y + 34);
    ctx.fillStyle = C.dim; ctx.font = `12px ${FONT}`; ctx.fillText(returning ? '作战结束，部队正在重新集结并返航' : '作战结束，正在准备返航', this.width / 2, y + 62); ctx.textAlign = 'left';
  }
}

