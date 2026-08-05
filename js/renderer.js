/**
 * renderer.js —— 基地画面渲染（Canvas 2D，伪2.5D 斜视角）
 *
 * 职责边界（重要）：
 *  - 渲染层只读取状态并播放表现，绝不修改游戏数值；
 *  - 阶段5的战斗动画同样只能读取 battle.js 生成的事件序列；
 *  - 玩家不能拖动建筑，所有建筑位置由 config.BASE_LAYOUT / BUILDINGS.slot 决定。
 */

import {
  BASE_LAYOUT, BUILDINGS, BUILDING_STATUS, RENDER, CURRENT_STAGE, UNITS,
  RALLY, FORMATION_STATUS_LABEL
} from './config.js';
import { clamp, noise01, safeNumber, formatDuration } from './utils.js';
import { on } from './events.js';
import { getUnitRank, formatUnitDisplayName } from './units.js';

const TW = RENDER.tileW;   // 地块宽
const TH = RENDER.tileH;   // 地块高
const FONT = "Consolas, 'Microsoft YaHei', monospace";
const TAU = Math.PI * 2;

/** 地面色板（由确定性噪声选取，保证画面每帧一致） */
const GROUND_PALETTE = ['#35442f', '#31402c', '#2d3b29', '#374630', '#2a3726', '#33412d'];

export class BaseRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement|null} tipEl 悬停提示元素
   */
  constructor(canvas, tipEl = null) {
    if (!canvas || !canvas.getContext) {
      throw new Error('[renderer] 缺少可用的 canvas 元素');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tipEl = tipEl || null;

    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;

    this.t = 0;         // 游戏时间累计（受速度影响，暂停即静止）
    this.tReal = 0;     // 真实时间累计（用于FPS等）
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this.particles = [];   // 烟雾/火花
    this.movers = [];      // 基地内移动的车辆
    this.rings = [];       // 建筑落成扩散环
    this._smokeAcc = 0;

    /* ---- 集结区（阶段4） ---- */
    /** 已编入编队的单位在集结区的表现体：unitId → sprite（只读状态派生，不含业务数据） */
    this.rallyUnits = new Map();
    /** 正在退场的表现体（单位已离队，画面上还需播完动画） */
    this.rallyLeaving = [];
    /** 维修车间表现体（阶段6）：status='repairing' 的单位在维修台附近展示 */
    this.repairUnits = new Map();
    /** 编队分组的布局缓存，供标签与选中高亮使用 */
    this.rallyGroups = [];
    /** 当前在编队页选中的编队 ID，由 main.js 单向同步进来 */
    this.selectedFormationId = null;
    /** 编队高亮脉冲（新建 / 变更时闪一下） */
    this._formationPulse = new Map();

    this.viewMode = 'base';   // base | battle（战斗视图阶段5接入）
    this.suspended = false;   // 战斗回放期间画布被战斗渲染器接管
    this.hover = null;
    this.pointer = { x: -1, y: -1, inside: false };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this._bindPointer();
    this._bindGameEvents();
    this.resize();
    this._initAmbientMovers();
  }

  /* ==========================================================
   * 坐标与尺寸
   * ======================================================== */

  /** 网格坐标 → 等距投影坐标 */
  iso(gx, gy) {
    return { x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 };
  }

  /** 屏幕(CSS px) → 网格坐标 */
  screenToGrid(cssX, cssY) {
    const isoX = (cssX - this.originX) / this.scale;
    const isoY = (cssY - this.originY) / this.scale;
    return { gx: isoY / TH + isoX / TW, gy: isoY / TH - isoX / TW };
  }

  /** 重新计算画布尺寸与投影参数 */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, RENDER.maxDpr);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);

    const cols = BASE_LAYOUT.cols;
    const rows = BASE_LAYOUT.rows;
    const isoW = (cols + rows) * TW / 2;
    const isoH = (cols + rows) * TH / 2;
    const availW = Math.max(120, w - RENDER.padding * 2);
    const availH = Math.max(120, h - RENDER.padding * 2 - RENDER.headroom);

    this.scale = clamp(Math.min(availW / isoW, availH / isoH), 0.32, 1.6);
    this.originX = w / 2 + ((rows - cols) * TW / 4) * this.scale;
    this.originY = (h - isoH * this.scale) / 2 + RENDER.headroom * 0.35;
  }

  /** 字体大小换算：保证屏幕上的视觉字号不受缩放影响 */
  font(px, bold = false) {
    return `${bold ? 'bold ' : ''}${(px / this.scale).toFixed(2)}px ${FONT}`;
  }

  /* ==========================================================
   * 输入与事件
   * ======================================================== */

  _bindPointer() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - rect.left;
      this.pointer.y = e.clientY - rect.top;
      this.pointer.inside = true;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.pointer.inside = false;
      this.hover = null;
      this._hideTip();
    });
  }

  _bindGameEvents() {
    // 建筑落成：播放扩散环
    on('construction:completed', ({ buildingId }) => {
      const def = this._findBuildingSlotById(buildingId);
      if (def) this.rings.push({ gx: def.gx + def.w / 2, gy: def.gy + def.h / 2, r: 0, life: 1 });
    });
    // 单位下线：从生产建筑驶出（阶段3表现）
    on('production:completed', ({ unitType, sourceBuildingType }) => {
      this.spawnUnitExit(unitType, sourceBuildingType);
    });

    /* ---- 编队事件（阶段4）：只播表现，不碰任何业务状态 ---- */
    on('formation:created', ({ formationId }) => {
      this._pulseFormation(formationId);
      this.rings.push({ gx: RALLY.center.gx, gy: RALLY.center.gy, r: 0, life: 0.9 });
    });
    on('formation:unitAdded', ({ formationId }) => this._pulseFormation(formationId));
    on('formation:unitRemoved', ({ formationId }) => this._pulseFormation(formationId));
    on('formation:renamed', ({ formationId }) => this._pulseFormation(formationId));
    on('formation:disbanded', () => {
      // 成员表现体会在下一帧同步时自动转入退场动画，这里只补一个扩散环
      this.rings.push({ gx: RALLY.center.gx, gy: RALLY.center.gy, r: 0, life: 0.7 });
    });
  }

  /** 编队高亮脉冲：0→1 的短暂强调，用于新建 / 成员变化时提示玩家 */
  _pulseFormation(formationId) {
    if (!formationId) return;
    this._formationPulse.set(formationId, 1);
  }

  /** 由 main.js 单向同步编队页的选中态（渲染层不认识 UI，只拿到一个 ID） */
  setSelectedFormation(formationId) {
    this.selectedFormationId = formationId || null;
  }

  /**
   * 战斗回放期间挂起基地画面（阶段5）。
   * 画布被战斗渲染器接管时调用，隐藏悬停提示避免两套视图的提示叠加。
   * 只影响表现，不改变任何游戏状态。
   */
  setSuspended(flag) {
    this.suspended = !!flag;
    if (this.suspended) {
      this.hover = null;
      this.pointer.inside = false;
      this._hideTip();
    }
  }

  _findBuildingSlotById(buildingId) {
    const state = this._lastState;
    if (!state) return null;
    const b = state.buildings.find((x) => x.id === buildingId);
    return b ? b.slot : null;
  }

  /** 当前是否有某类型建筑正在生产；是则返回正在生产的单位类型，否则 null（只读状态） */
  _producerBusy(type) {
    const s = this._lastState;
    if (!s || !s.production || !s.production.current) return null;
    const job = s.production.current;
    const def = UNITS[job.type];
    return def && def.from === type ? job.type : null;
  }

  /* ==========================================================
   * 移动物体（车辆）
   * ======================================================== */

  /** 基地内的巡逻车，让画面不至于死板 */
  _initAmbientMovers() {
    this.movers = [
      this._makeMover([{ gx: 6.5, gy: 0.4 }, { gx: 6.5, gy: 13.2 }], 1.15, 'jeep', true),
      this._makeMover([{ gx: 0.4, gy: 6.5 }, { gx: 13.2, gy: 6.5 }], 0.85, 'truck', true)
    ];
  }

  _makeMover(path, speed, kind, loop) {
    return { path, speed, kind, loop, idx: 0, t: 0, dir: 1, life: Infinity, gx: path[0].gx, gy: path[0].gy };
  }

  /**
   * 生产完成时，让单位从生产建筑驶向集结点（阶段3表现）。
   * 根据真实单位类型绘制不同外形（步兵/反装甲/侦察车/坦克/维修车）。
   * @param {string} unitType 单位类型 id
   * @param {string} sourceBuildingType 生产建筑类型 id
   */
  spawnUnitExit(unitType, sourceBuildingType) {
    const def = BUILDINGS[sourceBuildingType];
    if (!def || !def.slot) return;
    const s = def.slot;
    const start = { gx: s.gx + s.w / 2, gy: s.gy + s.h + 0.2 };
    const road = { gx: 6.5, gy: start.gy };
    const park = { gx: 6.5, gy: 10.5 };
    const uDef = UNITS[unitType];
    const kind = uDef ? uDef.shape : 'infantry';
    const mover = this._makeMover([start, road, park], 1.6, kind, false);
    mover.life = 26;
    mover.unitType = unitType || null;
    this.movers.push(mover);
  }

  _updateMovers(dt) {
    if (dt <= 0) return;
    this.movers.forEach((m) => {
      const from = m.path[m.idx];
      const to = m.path[m.idx + m.dir] || m.path[m.idx];
      const dx = to.gx - from.gx;
      const dy = to.gy - from.gy;
      const dist = Math.hypot(dx, dy) || 1;
      m.t += (m.speed * dt) / dist;
      if (m.t >= 1) {
        m.t = 0;
        m.idx += m.dir;
        if (m.idx >= m.path.length - 1) {
          if (m.loop) { m.dir = -1; m.idx = m.path.length - 1; } else { m.done = true; }
        } else if (m.idx <= 0) {
          m.dir = 1; m.idx = 0;
        }
      }
      const a = m.path[m.idx] || from;
      const b = m.path[m.idx + m.dir] || a;
      m.gx = a.gx + (b.gx - a.gx) * m.t;
      m.gy = a.gy + (b.gy - a.gy) * m.t;
      m.heading = Math.abs(b.gx - a.gx) > Math.abs(b.gy - a.gy) ? 'x' : 'y';
      if (Number.isFinite(m.life)) m.life -= dt;
    });
    this.movers = this.movers.filter((m) => !m.done && m.life > 0);
  }

  /* ==========================================================
   * 集结区（阶段4）
   *  - 只读 state.formations 与 state.units 推导站位；
   *  - 绝不修改单位归属、编队成员或任何数值；
   *  - 动画走真实时间，暂停时玩家调整编队也能看到反馈。
   * ======================================================== */

  /** 计算每支编队在集结区的基准点与成员站位（纯函数式，结果只用于画面） */
  _layoutRally(state) {
    const formations = Array.isArray(state.formations) ? state.formations : [];
    const units = Array.isArray(state.units) ? state.units : [];
    const byId = new Map();
    units.forEach((u) => { if (u && u.id) byId.set(u.id, u); });

    const n = formations.length;
    const groups = [];
    const slots = new Map();   // unitId → { gx, gy, kind, formationId }

    formations.forEach((f, i) => {
      if (!f || !f.id) return;
      const laneOffset = (i - (n - 1) / 2) * RALLY.formationGap;
      const baseGx = RALLY.center.gx + laneOffset;
      const baseGy = RALLY.center.gy + laneOffset * 0.35;   // 略微错开，避免完全重叠
      const ids = Array.isArray(f.unitIds) ? f.unitIds.filter((id) => byId.has(id)) : [];
      const count = ids.length;
      const cols = Math.max(1, Math.ceil(count / RALLY.perColumn));

      ids.forEach((unitId, k) => {
        const col = Math.floor(k / RALLY.perColumn);
        const row = k % RALLY.perColumn;
        const rowsHere = Math.min(RALLY.perColumn, count - col * RALLY.perColumn);
        const unit = byId.get(unitId);
        const def = unit ? UNITS[unit.type] : null;
        slots.set(unitId, {
          gx: baseGx + (col - (cols - 1) / 2) * RALLY.unitGapX,
          gy: baseGy + (row - (rowsHere - 1) / 2) * RALLY.unitGapY,
          kind: def ? def.shape : 'infantry',
          formationId: f.id,
          rankId: getUnitRank(unit).id,
          rankName: getUnitRank(unit).name,
          callsign: unit.callsign || null
        });
      });

      groups.push({
        id: f.id,
        name: f.name || '编队',
        gx: baseGx,
        gy: baseGy,
        count,
        radius: 12 + Math.max(0, cols - 1) * 10
      });
    });

    return { groups, slots };
  }

  /** 每帧同步集结区表现体：新成员入场、离队成员退场、其余向目标点插值 */
  _updateRally(state, dtReal) {
    const dt = Math.max(0, Math.min(dtReal || 0, 0.1));
    const { groups, slots } = this._layoutRally(state);
    this.rallyGroups = groups;

    // 1) 新加入的单位：从大门方向入场
    slots.forEach((slot, unitId) => {
      let sp = this.rallyUnits.get(unitId);
      if (!sp) {
        sp = {
          unitId,
          formationId: slot.formationId,
          kind: slot.kind,
          gx: RALLY.gate.gx,
          gy: RALLY.gate.gy,
          tx: slot.gx,
          ty: slot.gy,
          phase: 'joining',
          anim: 0,
          alpha: 0
        };
        this.rallyUnits.set(unitId, sp);
      }
      sp.formationId = slot.formationId;
      sp.kind = slot.kind;
      sp.rankId = slot.rankId;
      sp.rankName = slot.rankName;
      sp.callsign = slot.callsign;
      sp.tx = slot.gx;
      sp.ty = slot.gy;
    });

    // 2) 已不在任何编队的表现体：转入退场动画
    Array.from(this.rallyUnits.keys()).forEach((unitId) => {
      if (slots.has(unitId)) return;
      const sp = this.rallyUnits.get(unitId);
      this.rallyUnits.delete(unitId);
      sp.phase = 'leaving';
      sp.anim = 0;
      sp.tx = RALLY.gate.gx;
      sp.ty = RALLY.gate.gy;
      this.rallyLeaving.push(sp);
    });

    // 3) 位置插值与动画推进
    const step = (sp) => {
      const k = Math.min(1, RALLY.easing * dt);
      sp.gx += (sp.tx - sp.gx) * k;
      sp.gy += (sp.ty - sp.gy) * k;
    };

    this.rallyUnits.forEach((sp) => {
      step(sp);
      if (sp.phase === 'joining') {
        sp.anim += dt / RALLY.joinDuration;
        sp.alpha = clamp(sp.anim, 0, 1);
        if (sp.anim >= 1) { sp.phase = 'idle'; sp.alpha = 1; }
      } else {
        sp.alpha = 1;
      }
    });

    this.rallyLeaving.forEach((sp) => {
      step(sp);
      sp.anim += dt / RALLY.leaveDuration;
      sp.alpha = clamp(1 - sp.anim, 0, 1);
    });
    this.rallyLeaving = this.rallyLeaving.filter((sp) => sp.anim < 1);

    // 4) 编队脉冲衰减
    this._formationPulse.forEach((v, id) => {
      const next = v - dt / 0.9;
      if (next <= 0) this._formationPulse.delete(id);
      else this._formationPulse.set(id, next);
    });
  }

  /** 集结区地面标记（每支编队一块淡色站位区，选中的一块高亮） */
  _drawRallyPads(ctx) {
    if (!this.rallyGroups.length) return;
    ctx.save();
    this.rallyGroups.forEach((g) => {
      const c = this.iso(g.gx, g.gy);
      const selected = g.id === this.selectedFormationId;
      const pulse = this._formationPulse.get(g.id) || 0;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1, TH / TW);
      ctx.beginPath();
      ctx.arc(0, 0, g.radius + pulse * 6, 0, TAU);
      ctx.fillStyle = selected ? RALLY.colors.selectedFill : RALLY.colors.pad;
      ctx.fill();
      ctx.lineWidth = (selected ? 2 : 1) / this.scale;
      ctx.strokeStyle = selected ? RALLY.colors.selected : RALLY.colors.padEdge;
      ctx.globalAlpha = selected ? 0.9 : 0.55 + pulse * 0.4;
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  /** 单个集结单位（含影子、入场淡入、选中描边） */
  _drawRallyUnit(ctx, sp) {
    const p = this.iso(sp.gx, sp.gy);
    const selected = sp.formationId === this.selectedFormationId && sp.phase !== 'leaving';
    ctx.save();
    ctx.globalAlpha = clamp(sp.alpha, 0, 1);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 6, 2.6, 0, 0, TAU);
    ctx.fill();

    if (selected) {
      // 选中编队的成员脚下加一圈提示环
      ctx.strokeStyle = RALLY.colors.selected;
      ctx.lineWidth = 1.2 / this.scale;
      ctx.globalAlpha = clamp(sp.alpha, 0, 1) * (0.5 + 0.3 * Math.sin(this.tReal * 3));
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 8.5, 3.8, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = clamp(sp.alpha, 0, 1);
    }

    this._unitShape(ctx, p.x, p.y, sp.kind);
    this._drawVeteranMarker(ctx, p.x, p.y - 14, sp.rankId);
    ctx.restore();
  }

  _drawVeteranMarker(ctx, x, y, rankId) {
    if (!rankId || rankId === 'recruit') return;
    const color = rankId === 'elite' ? '#e8b45c' : rankId === 'veteran' ? '#74d8a3' : '#8fb9d8';
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.9)';
    ctx.lineWidth = 1 / this.scale;
    if (rankId === 'elite') {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 ? 3.1 : 6;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.7;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 2); ctx.lineTo(x, y + 3); ctx.lineTo(x + 5, y - 2);
      ctx.lineWidth = rankId === 'veteran' ? 2 / this.scale : 1.5 / this.scale;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 编队名标签（画在成员上方，选中的一支加亮加粗） */
  _drawRallyLabels(ctx) {
    if (!this.rallyGroups.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    this.rallyGroups.forEach((g) => {
      const c = this.iso(g.gx, g.gy);
      const selected = g.id === this.selectedFormationId;
      const label = g.count > 0 ? `${g.name}·${g.count}` : `${g.name}（空）`;
      const lift = 30 + RALLY.perColumn * 4;

      ctx.font = this.font(RALLY.labelSize, selected);
      const w = ctx.measureText(label).width;
      const padX = 4 / this.scale;
      const boxH = (RALLY.labelSize + 5) / this.scale;

      ctx.fillStyle = 'rgba(10, 18, 14, 0.62)';
      ctx.fillRect(c.x - w / 2 - padX, c.y - lift - boxH, w + padX * 2, boxH);
      if (selected) {
        ctx.strokeStyle = RALLY.colors.selected;
        ctx.lineWidth = 1 / this.scale;
        ctx.strokeRect(c.x - w / 2 - padX, c.y - lift - boxH, w + padX * 2, boxH);
      }
      ctx.fillStyle = selected ? RALLY.colors.labelSelected : RALLY.colors.label;
      ctx.fillText(label, c.x, c.y - lift - 2 / this.scale);
    });
    ctx.restore();
  }

  /* ==========================================================
   * 维修车间（阶段6）
   * ======================================================== */

  /** 维修台基准位（后勤区 repairpad 附近） */
  _repairBayOrigin() {
    return { gx: 11.6, gy: 11.4 };
  }

  /** 每帧同步维修中的单位到表现体，按工位网格排布 */
  _updateRepairBay(state, dtReal) {
    const dt = Math.max(0, Math.min(dtReal || 0, 0.1));
    const base = this._repairBayOrigin();
    const repairing = (state.units || []).filter((u) => u && u.status === 'repairing');

    const slots = new Map();
    repairing.forEach((u, k) => {
      const col = k % 2;
      const row = Math.floor(k / 2);
      const def = UNITS[u.type];
      slots.set(u.id, {
        gx: base.gx + col * 0.9 - 0.45,
        gy: base.gy + row * 0.8,
        kind: def ? def.shape : 'infantry'
      });
    });

    // 新进入维修台的单位：从集结区方向滑入
    slots.forEach((slot, unitId) => {
      let sp = this.repairUnits.get(unitId);
      if (!sp) {
        sp = {
          unitId,
          kind: slot.kind,
          gx: RALLY.gate.gx,
          gy: RALLY.gate.gy,
          tx: slot.gx,
          ty: slot.gy,
          alpha: 0
        };
        this.repairUnits.set(unitId, sp);
      }
      sp.kind = slot.kind;
      sp.tx = slot.gx;
      sp.ty = slot.gy;
    });

    // 已不在维修中的单位：直接移除（送回库存会由集结区或别处表现）
    Array.from(this.repairUnits.keys()).forEach((unitId) => {
      if (slots.has(unitId)) return;
      this.repairUnits.delete(unitId);
    });

    // 位置插值
    const k = Math.min(1, RALLY.easing * dt);
    this.repairUnits.forEach((sp) => {
      sp.gx += (sp.tx - sp.gx) * k;
      sp.gy += (sp.ty - sp.gy) * k;
      sp.alpha = Math.min(1, sp.alpha + dt / 0.4);
    });
  }

  /** 单个维修中单位（橙色工位环 + 单位外形 + 工具闪光） */
  _drawRepairUnit(ctx, sp) {
    const p = this.iso(sp.gx, sp.gy);
    ctx.save();
    ctx.globalAlpha = clamp(sp.alpha, 0, 1);

    // 工位提示环（橙色）
    ctx.strokeStyle = '#e8a13a';
    ctx.lineWidth = 1 / this.scale;
    ctx.globalAlpha = clamp(sp.alpha, 0, 1) * (0.5 + 0.3 * Math.sin(this.tReal * 2.5));
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 8.5, 3.8, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = clamp(sp.alpha, 0, 1);

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 6, 2.6, 0, 0, TAU);
    ctx.fill();

    this._unitShape(ctx, p.x, p.y, sp.kind);

    // 工具闪光（小亮点）
    this._light(ctx, p.x + 5, p.y - 6, '#e8d78a', 3, 1);
    ctx.restore();
  }

  /** 维修台标签 */
  _drawRepairBayLabel(ctx) {
    if (!this.repairUnits.size) return;
    const base = this._repairBayOrigin();
    const c = this.iso(base.gx, base.gy);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = `维修中·${this.repairUnits.size}`;
    ctx.font = this.font(RALLY.labelSize, false);
    const w = ctx.measureText(label).width;
    const padX = 4 / this.scale;
    const boxH = (RALLY.labelSize + 5) / this.scale;
    const lift = 26;
    ctx.fillStyle = 'rgba(10, 18, 14, 0.62)';
    ctx.fillRect(c.x - w / 2 - padX, c.y - lift - boxH, w + padX * 2, boxH);
    ctx.strokeStyle = '#e8a13a';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(c.x - w / 2 - padX, c.y - lift - boxH, w + padX * 2, boxH);
    ctx.fillStyle = '#e8d78a';
    ctx.fillText(label, c.x, c.y - lift - 2 / this.scale);
    ctx.restore();
  }

  /* ==========================================================
   * 粒子
   * ======================================================== */

  _spawnSmoke(gx, gy, lift, opts = {}) {
    this.particles.push({
      type: 'smoke',
      x: (gx - gy) * TW / 2 + (Math.random() - 0.5) * 4,
      y: (gx + gy) * TH / 2 - lift,
      vx: 3 + Math.random() * 5,
      vy: -(9 + Math.random() * 7),
      life: 0,
      maxLife: opts.maxLife || 2.6,
      size: opts.size || 4 + Math.random() * 3,
      alpha: opts.alpha || 0.32
    });
  }

  _spawnSpark(gx, gy, lift) {
    this.particles.push({
      type: 'spark',
      x: (gx - gy) * TW / 2,
      y: (gx + gy) * TH / 2 - lift,
      vx: (Math.random() - 0.5) * 26,
      vy: -(6 + Math.random() * 16),
      life: 0,
      maxLife: 0.5,
      size: 1.2,
      alpha: 0.9
    });
  }

  _updateParticles(dt) {
    if (dt <= 0) return;
    this.particles.forEach((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'smoke') {
        p.vy *= 0.985;
        p.size += 6 * dt;
      } else {
        p.vy += 42 * dt;
      }
    });
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  /* ==========================================================
   * 主渲染入口
   * ======================================================== */

  /**
   * @param {object} state  全局状态（只读）
   * @param {number} dtGame 本帧游戏时间（秒，已乘速度）
   * @param {number} dtReal 本帧真实时间（秒）
   */
  render(state, dtGame, dtReal) {
    if (!state) return;
    this._lastState = state;
    this.researchActive = Boolean(state.research && state.research.current);
    this.t += dtGame;
    this.tReal += dtReal;

    // FPS 统计
    this._fpsAcc += dtReal;
    this._fpsFrames += 1;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    // 若画布尺寸变化（布局变动），自动重算
    const rect = this.canvas.getBoundingClientRect();
    if (Math.abs(rect.width - this.width) > 1 || Math.abs(rect.height - this.height) > 1) {
      this.resize();
    }

    this._updateAnimations(state, dtGame);
    // 集结区走真实时间：暂停状态下调整编队，画面同样要有反馈
    this._updateRally(state, dtReal);
    // 维修车间（阶段6）：暂停状态下排队完成也要有画面反馈
    this._updateRepairBay(state, dtReal);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawBackdrop(ctx);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);

    this._pickHover(state);

    this._drawGround(ctx);
    this._drawRoads(ctx);
    this._drawZones(ctx);
    this._drawReservedSlots(ctx, state);
    this._drawRallyPads(ctx);
    this._drawFence(ctx);

    // 深度排序绘制（painter's algorithm）
    const objects = [];
    (state.buildings || []).forEach((b) => {
      const s = b.slot || (BUILDINGS[b.type] && BUILDINGS[b.type].slot);
      if (!s) return;
      objects.push({ kind: 'building', data: b, slot: s, depth: (s.gx + s.w / 2) + (s.gy + s.h / 2) });
    });
    (BASE_LAYOUT.props || []).forEach((p) => {
      objects.push({ kind: 'prop', data: p, depth: p.gx + p.gy + 0.5 });
    });
    this.movers.forEach((m) => {
      objects.push({ kind: 'mover', data: m, depth: m.gx + m.gy });
    });
    this.rallyUnits.forEach((sp) => {
      objects.push({ kind: 'rally', data: sp, depth: sp.gx + sp.gy });
    });
    this.rallyLeaving.forEach((sp) => {
      objects.push({ kind: 'rally', data: sp, depth: sp.gx + sp.gy });
    });
    this.repairUnits.forEach((sp) => {
      objects.push({ kind: 'repair', data: sp, depth: sp.gx + sp.gy });
    });
    objects.sort((a, b) => a.depth - b.depth);

    objects.forEach((obj) => {
      if (obj.kind === 'building') this._drawBuilding(ctx, obj.data, obj.slot);
      else if (obj.kind === 'prop') this._drawProp(ctx, obj.data);
      else if (obj.kind === 'rally') this._drawRallyUnit(ctx, obj.data);
      else if (obj.kind === 'repair') this._drawRepairUnit(ctx, obj.data);
      else this._drawMover(ctx, obj.data);
    });

    this._drawRallyLabels(ctx);
    this._drawRepairBayLabel(ctx);
    this._drawRings(ctx);
    this._drawParticles(ctx);
    this._drawHoverHighlight(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._updateTip(state);
  }

  /** 每帧的动画状态推进（雷达、烟雾、车辆） */
  _updateAnimations(state, dt) {
    this._updateParticles(dt);
    this._updateMovers(dt);

    this.rings.forEach((r) => { r.r += 90 * dt; r.life -= dt * 0.9; });
    this.rings = this.rings.filter((r) => r.life > 0);

    if (dt > 0) {
      this._smokeAcc += dt;
      if (this._smokeAcc >= RENDER.smokeSpawnInterval) {
        this._smokeAcc = 0;
        this._emitBuildingSmoke(state);
      }
    }
  }

  /** 按建筑类型产生烟雾 */
  _emitBuildingSmoke(state) {
    (state.buildings || []).forEach((b) => {
      if (b.status !== BUILDING_STATUS.OPERATIONAL) return;
      const def = BUILDINGS[b.type];
      const s = b.slot || (def && def.slot);
      if (!def || !s) return;
      if (def.shape === 'power') {
        this._spawnSmoke(s.gx + 0.45, s.gy + 0.45, s.height + 24, { alpha: 0.26, maxLife: 3.0 });
        this._spawnSmoke(s.gx + 1.35, s.gy + 1.35, s.height + 20, { alpha: 0.22, maxLife: 2.6 });
      } else if (def.shape === 'factory' || def.shape === 'factory_big') {
        this._spawnSmoke(s.gx + 0.4, s.gy + 0.4, s.height + 20, { alpha: 0.3, maxLife: 3.2 });
        // 正在生产车辆：烟雾强度增加 + 偶发焊接火花
        if (this._producerBusy(b.type)) {
          this._spawnSmoke(s.gx + 1.2, s.gy + 1.1, s.height + 14, { alpha: 0.22, maxLife: 2.6 });
          if (Math.random() < 0.5) this._spawnSpark(s.gx + s.w * 0.6, s.gy + s.h * 0.6, s.height + 6);
        }
      }
    });
    // 施工中的建筑产生焊接火花与工地扬尘
    (state.buildings || []).forEach((b) => {
      if (b.status !== BUILDING_STATUS.UNDER_CONSTRUCTION) return;
      const s = b.slot || (BUILDINGS[b.type] && BUILDINGS[b.type].slot);
      if (!s) return;
      const progress = clamp(safeNumber(b.progress, 0), 0, 1);
      this._spawnSpark(s.gx + s.w * 0.5, s.gy + s.h * 0.5, 8 + s.height * progress * 0.8 + Math.random() * 10);
      this._spawnSmoke(s.gx + s.w * 0.7, s.gy + s.h * 0.3, 6, { alpha: 0.14, maxLife: 1.8 });
    });
  }

  /* ==========================================================
   * 背景 / 地面 / 道路
   * ======================================================== */

  _drawBackdrop(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, RENDER.colors.skyTop);
    g.addColorStop(1, RENDER.colors.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _isRoad(gx, gy) {
    return BASE_LAYOUT.roads.cols.includes(gx) || BASE_LAYOUT.roads.rows.includes(gy);
  }

  _tilePath(ctx, gx, gy) {
    const a = this.iso(gx, gy);
    const b = this.iso(gx + 1, gy);
    const c = this.iso(gx + 1, gy + 1);
    const d = this.iso(gx, gy + 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  _drawGround(ctx) {
    const { cols, rows } = BASE_LAYOUT;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const road = this._isRoad(gx, gy);
        this._tilePath(ctx, gx, gy);
        if (road) {
          ctx.fillStyle = RENDER.colors.road;
        } else {
          const n = noise01(gx, gy);
          ctx.fillStyle = GROUND_PALETTE[Math.floor(n * GROUND_PALETTE.length) % GROUND_PALETTE.length];
        }
        ctx.fill();
        ctx.strokeStyle = road ? 'rgba(150,160,150,0.12)' : RENDER.colors.grid;
        ctx.lineWidth = 1 / this.scale;
        ctx.stroke();
      }
    }
  }

  _drawRoads(ctx) {
    // 道路中线虚线
    ctx.save();
    ctx.strokeStyle = RENDER.colors.roadLine;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.6 / this.scale;
    ctx.setLineDash([6 / this.scale, 7 / this.scale]);

    BASE_LAYOUT.roads.cols.forEach((c) => {
      const a = this.iso(c + 0.5, 0);
      const b = this.iso(c + 0.5, BASE_LAYOUT.rows);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    BASE_LAYOUT.roads.rows.forEach((r) => {
      const a = this.iso(0, r + 0.5);
      const b = this.iso(BASE_LAYOUT.cols, r + 0.5);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawZones(ctx) {
    (BASE_LAYOUT.zones || []).forEach((z) => {
      const a = this.iso(z.gx, z.gy);
      const b = this.iso(z.gx + z.w, z.gy);
      const c = this.iso(z.gx + z.w, z.gy + z.h);
      const d = this.iso(z.gx, z.gy + z.h);

      ctx.save();
      ctx.strokeStyle = z.color;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1.4 / this.scale;
      ctx.setLineDash([4 / this.scale, 5 / this.scale]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);

      // 分区标签
      const center = this.iso(z.gx + z.w / 2, z.gy + z.h / 2);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = z.color;
      ctx.font = this.font(11, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.name, center.x, center.y);
      ctx.restore();
    });
  }

  /** 未建造建筑的预留地块（虚线轮廓 + 名称），让玩家看到基地规划 */
  _drawReservedSlots(ctx, state) {
    const built = new Set((state.buildings || []).map((b) => b.type));
    Object.values(BUILDINGS).forEach((def) => {
      if (!def.buildable || built.has(def.id) || !def.slot) return;
      const s = def.slot;
      const a = this.iso(s.gx, s.gy);
      const b = this.iso(s.gx + s.w, s.gy);
      const c = this.iso(s.gx + s.w, s.gy + s.h);
      const d = this.iso(s.gx, s.gy + s.h);

      ctx.save();
      ctx.setLineDash([3 / this.scale, 4 / this.scale]);
      ctx.strokeStyle = RENDER.colors.slot;
      ctx.lineWidth = 1.2 / this.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(116, 216, 163, 0.05)';
      ctx.fill();
      ctx.setLineDash([]);

      const center = this.iso(s.gx + s.w / 2, s.gy + s.h / 2);
      ctx.fillStyle = 'rgba(160, 200, 175, 0.5)';
      ctx.font = this.font(9);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`预留 · ${def.name}`, center.x, center.y);
      ctx.restore();
    });
  }

  /** 基地围栏（出口处留缺口） */
  _drawFence(ctx) {
    const { cols, rows, exit } = BASE_LAYOUT;
    ctx.save();
    ctx.strokeStyle = '#4c5a4c';
    ctx.lineWidth = 1.2 / this.scale;
    ctx.globalAlpha = 0.85;

    const postH = 9;
    const drawPost = (gx, gy) => {
      const p = this.iso(gx, gy);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - postH);
      ctx.stroke();
    };

    for (let i = 0; i <= cols; i += 1) {
      if (!(i === exit.gx || i === exit.gx + 1)) drawPost(i, rows);
      drawPost(i, 0);
    }
    for (let j = 0; j <= rows; j += 1) {
      drawPost(0, j);
      drawPost(cols, j);
    }

    // 围栏横线
    ctx.globalAlpha = 0.45;
    const edges = [
      [this.iso(0, 0), this.iso(cols, 0)],
      [this.iso(0, 0), this.iso(0, rows)],
      [this.iso(cols, 0), this.iso(cols, rows)]
    ];
    edges.forEach(([p1, p2]) => {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y - postH * 0.7);
      ctx.lineTo(p2.x, p2.y - postH * 0.7);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* ==========================================================
   * 建筑绘制
   * ======================================================== */

  /** 绘制一个等距长方体，返回关键点位 */
  _box(ctx, gx, gy, w, h, height, colors) {
    const a = this.iso(gx, gy);
    const b = this.iso(gx + w, gy);
    const c = this.iso(gx + w, gy + h);
    const d = this.iso(gx, gy + h);
    const up = (p) => ({ x: p.x, y: p.y - height });

    // 阴影
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(a.x + height * 0.34, a.y + height * 0.17);
    ctx.lineTo(b.x + height * 0.34, b.y + height * 0.17);
    ctx.lineTo(c.x + height * 0.34, c.y + height * 0.17);
    ctx.lineTo(d.x + height * 0.34, d.y + height * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const poly = (pts, fill) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1 / this.scale;
      ctx.stroke();
    };

    poly([b, c, up(c), up(b)], colors.right);   // 右侧面
    poly([d, c, up(c), up(d)], colors.left);    // 左侧面
    poly([up(a), up(b), up(c), up(d)], colors.top); // 顶面

    return {
      a, b, c, d,
      top: { a: up(a), b: up(b), c: up(c), d: up(d) },
      center: this.iso(gx + w / 2, gy + h / 2),
      topCenter: { x: this.iso(gx + w / 2, gy + h / 2).x, y: this.iso(gx + w / 2, gy + h / 2).y - height }
    };
  }

  /** 闪烁灯 */
  _light(ctx, x, y, color, speed = 2, radius = 2.2, phase = 0) {
    const k = 0.35 + 0.65 * Math.abs(Math.sin(this.t * speed + phase));
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = k * 0.28;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawBuilding(ctx, building, slot) {
    const def = BUILDINGS[building.type];
    if (!def) return;
    const underConstruction = building.status === BUILDING_STATUS.UNDER_CONSTRUCTION;

    if (underConstruction) {
      this._drawConstructionSite(ctx, building, slot, def);
      return;
    }

    switch (def.shape) {
      case 'command': this._shapeCommand(ctx, slot); break;
      case 'power': this._shapePower(ctx, slot); break;
      case 'depot': this._shapeDepot(ctx, slot); break;
      case 'factory': this._shapeFactory(ctx, slot, false); break;
      case 'factory_big': this._shapeFactory(ctx, slot, true); break;
      case 'barracks': this._shapeBarracks(ctx, slot); break;
      case 'radar': this._shapeRadar(ctx, slot); break;
      case 'research': this._shapeResearch(ctx, slot, this.researchActive); break;
      default: this._box(ctx, slot.gx, slot.gy, slot.w, slot.h, slot.height,
        { top: '#4a5a50', left: '#33413a', right: '#26312b' });
    }

    // 生产活动表现：兵营 / 装甲工厂在生产时增强动画，空闲保留弱环境动画（只读状态）
    if (def.shape === 'barracks') {
      this._drawBarracksActivity(ctx, slot, this._producerBusy('barracks'));
    } else if (def.shape === 'factory' || def.shape === 'factory_big') {
      this._drawFactoryActivity(ctx, slot, this._producerBusy(def.id));
    } else if (def.shape === 'research') {
      this._drawResearchActivity(ctx, slot, this.researchActive);
    }

    // 建筑名称标签
    const label = this.iso(slot.gx + slot.w / 2, slot.gy + slot.h / 2);
    ctx.save();
    ctx.font = this.font(9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const textY = label.y + TH * 0.9;
    const textW = ctx.measureText(def.name).width;
    ctx.fillRect(label.x - textW / 2 - 3 / this.scale, textY - 6 / this.scale,
      textW + 6 / this.scale, 12 / this.scale);
    ctx.fillStyle = '#a9c6b4';
    ctx.fillText(def.name, label.x, textY);
    ctx.restore();
  }

  /** 施工中的建筑：地基 + 脚手架 + 吊车 + 进度条 */
  _drawConstructionSite(ctx, building, slot, def) {
    const g = this._box(ctx, slot.gx, slot.gy, slot.w, slot.h, 3,
      { top: '#3a3f33', left: '#2a2e25', right: '#22261f' });
    const progress = clamp(safeNumber(building.progress, 0), 0, 1);

    // 已完成的楼体（随进度长高）
    const h = Math.max(2, slot.height * progress);
    ctx.save();
    ctx.globalAlpha = 0.92;
    this._box(ctx, slot.gx + 0.12, slot.gy + 0.12, slot.w - 0.24, slot.h - 0.24, h,
      { top: '#55604f', left: '#3b453a', right: '#2c352c' });
    ctx.restore();

    // 脚手架立杆
    ctx.save();
    ctx.strokeStyle = '#c9a14a';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.1 / this.scale;
    const corners = [g.a, g.b, g.c, g.d];
    corners.forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - (slot.height + 6));
      ctx.stroke();
    });
    // 横杆
    [0.4, 0.75].forEach((k) => {
      const y = -(slot.height + 6) * k;
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y + y);
      ctx.lineTo(g.b.x, g.b.y + y);
      ctx.lineTo(g.c.x, g.c.y + y);
      ctx.lineTo(g.d.x, g.d.y + y);
      ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();

    // 吊车臂（缓慢摆动 + 吊钩上下）
    const swing = Math.sin(this.t * 0.8) * 16;
    const hook = 10 + Math.abs(Math.sin(this.t * 1.1)) * 10;
    ctx.save();
    ctx.strokeStyle = '#e0b45c';
    ctx.lineWidth = 1.6 / this.scale;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y - slot.height - 10);
    ctx.lineTo(g.a.x + swing, g.a.y - slot.height - 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.a.x + swing, g.a.y - slot.height - 26);
    ctx.lineTo(g.a.x + swing, g.a.y - slot.height - 26 + hook);
    ctx.stroke();
    ctx.restore();

    // 施工扫描线：沿建筑高度上下扫过，暗示“正在成型”
    ctx.save();
    const scanK = (Math.sin(this.t * 1.4) * 0.5 + 0.5);
    const scanY = -(slot.height + 4) * scanK;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#74d8a3';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y + scanY);
    ctx.lineTo(g.b.x, g.b.y + scanY);
    ctx.lineTo(g.c.x, g.c.y + scanY);
    ctx.lineTo(g.d.x, g.d.y + scanY);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 工程警示灯（四角交替闪烁）
    [g.a, g.b, g.c, g.d].forEach((p, i) => {
      this._light(ctx, p.x, p.y - slot.height - 6, i % 2 === 0 ? '#e8a13a' : '#d8563f', 3.2, 1.8, i * 1.1);
    });

    // 进度条与文字
    const c = g.center;
    const barW = 42;
    const barY = c.y - slot.height - 36;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(c.x - barW / 2, barY, barW, 5);
    ctx.fillStyle = '#e8a13a';
    ctx.fillRect(c.x - barW / 2 + 1, barY + 1, (barW - 2) * progress, 3);
    ctx.strokeStyle = 'rgba(232,161,58,0.7)';
    ctx.lineWidth = 0.8 / this.scale;
    ctx.strokeRect(c.x - barW / 2, barY, barW, 5);
    ctx.fillStyle = '#e8a13a';
    ctx.font = this.font(9, true);
    ctx.textAlign = 'center';
    ctx.fillText(`${def.name} 施工 ${Math.floor(progress * 100)}%`, c.x, barY - 4);
    ctx.restore();
  }

  /** 兵营生产活动：训练中指示灯 + 队列集合动作；空闲保留弱环境动画（只读状态） */
  _drawBarracksActivity(ctx, slot, unitType) {
    const c = this.iso(slot.gx + slot.w / 2, slot.gy + slot.h / 2);
    const fx = c.x - 8;
    const fy = c.y - slot.height * 0.35;
    if (unitType) {
      // 训练中：呼吸指示灯
      this._light(ctx, fx, fy, '#74d8a3', 3.4, 2.4, this.t * 3);
      // 队列集合动作：两个小兵在门前小幅踏步
      const step = Math.sin(this.t * 4) * 1.6;
      const bob = Math.abs(Math.sin(this.t * 4)) * 1.2;
      [-6, 4].forEach((dx, i) => {
        const px = c.x + dx + (i === 0 ? step : -step);
        const py = c.y - 2 - bob;
        ctx.save();
        ctx.fillStyle = '#8fae8a';
        ctx.fillRect(px - 1, py - 6, 2, 6);
        ctx.beginPath();
        ctx.arc(px, py - 7.4, 1.4, 0, TAU);
        ctx.fill();
        ctx.restore();
      });
      // 进度灯（小绿条）
      ctx.save();
      ctx.fillStyle = 'rgba(116,216,163,0.85)';
      ctx.fillRect(c.x - 9, c.y - slot.height - 4, 18, 1.6);
      ctx.restore();
    } else {
      // 空闲：弱环境灯
      this._light(ctx, fx, fy, '#4f7a5e', 2, 3, this.t);
    }
  }

  /** 装甲工厂生产活动：车库工作灯闪烁 + 进度灯；空闲保留弱环境动画（只读状态） */
  _drawFactoryActivity(ctx, slot, unitType) {
    const c = this.iso(slot.gx + slot.w / 2, slot.gy + slot.h / 2);
    const gx = c.x - slot.w * 6;
    const gy = c.y - slot.height * 0.4;
    if (unitType) {
      // 车库工作灯快速闪烁
      const flick = (Math.sin(this.t * 9) > 0) ? '#ffce6a' : '#e8a13a';
      this._light(ctx, gx, gy, flick, 3, 2, this.t * 5);
      // 进度灯（橙色小条）
      ctx.save();
      ctx.fillStyle = 'rgba(232,161,58,0.85)';
      ctx.fillRect(c.x - 10, c.y - slot.height - 4, 20, 1.6);
      ctx.restore();
    } else {
      this._light(ctx, gx, gy, '#7a6a4a', 1.8, 3, this.t);
    }
  }

  /** 指挥中心：主楼 + 旋转雷达 + 天线 + 地面扫描扇形 */
  _shapeCommand(ctx, s) {
    // 地面扫描扇形（先画在建筑下方）
    const base = this.iso(s.gx + s.w / 2, s.gy + s.h / 2);
    const R = 150;
    const ang = (this.t * 0.7) % TAU;
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.scale(1, TH / TW);
    const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, R);
    grad.addColorStop(0, 'rgba(116, 216, 163, 0.22)');
    grad.addColorStop(1, 'rgba(116, 216, 163, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, ang, ang + 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(116, 216, 163, 0.12)';
    ctx.lineWidth = 1 / this.scale;
    [0.45, 0.75, 1].forEach((k) => {
      ctx.beginPath();
      ctx.arc(0, 0, R * k, 0, TAU);
      ctx.stroke();
    });
    ctx.restore();

    // 主楼
    const g = this._box(ctx, s.gx, s.gy, s.w, s.h, s.height,
      { top: '#5b6a63', left: '#3c4a44', right: '#2c3833' });

    // 屋顶控制室
    const g2 = this._box(ctx, s.gx + 0.85, s.gy + 0.85, 1.3, 1.3, s.height + 16,
      { top: '#6b7c73', left: '#46554e', right: '#33403a' });

    // 窗户带
    ctx.save();
    ctx.fillStyle = 'rgba(126, 220, 255, 0.35)';
    for (let i = 0; i < 3; i += 1) {
      const p1 = this.iso(s.gx + 0.25 + i * 0.9, s.gy + s.h);
      ctx.fillRect(p1.x, p1.y - s.height + 8, 12, 5);
    }
    ctx.restore();

    // 旋转雷达
    const top = g2.topCenter;
    ctx.save();
    ctx.translate(top.x, top.y - 4);
    ctx.strokeStyle = '#8fa89a';
    ctx.lineWidth = 1.2 / this.scale;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10); ctx.stroke();
    ctx.translate(0, -10);
    ctx.scale(1, 0.45);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(190, 215, 200, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 3.4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 天线与警示灯
    ctx.save();
    ctx.strokeStyle = '#7d8f85';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.moveTo(g.top.b.x - 4, g.top.b.y);
    ctx.lineTo(g.top.b.x - 4, g.top.b.y - 22);
    ctx.stroke();
    ctx.restore();
    this._light(ctx, g.top.b.x - 4, g.top.b.y - 22, '#e2593f', 2.4, 1.8);
    this._light(ctx, g.top.d.x + 4, g.top.d.y - 2, '#74d8a3', 1.6, 1.6, 1.2);
  }

  /** 发电站：两座冷却塔 + 变压设备 + 闪烁指示灯 */
  _shapePower(ctx, s) {
    this._box(ctx, s.gx, s.gy, s.w, s.h, 12,
      { top: '#4d5347', left: '#363c33', right: '#282d26' });

    const tower = (cx, cy, r, height) => {
      const p = this.iso(cx, cy);
      ctx.save();
      // 塔身
      const grad = ctx.createLinearGradient(p.x - r, 0, p.x + r, 0);
      grad.addColorStop(0, '#6a7268');
      grad.addColorStop(0.5, '#565e54');
      grad.addColorStop(1, '#3c433a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y - 12);
      ctx.lineTo(p.x - r * 0.78, p.y - 12 - height);
      ctx.lineTo(p.x + r * 0.78, p.y - 12 - height);
      ctx.lineTo(p.x + r, p.y - 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1 / this.scale;
      ctx.stroke();
      // 顶口
      ctx.fillStyle = '#2b322a';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 12 - height, r * 0.78, r * 0.32, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      return { x: p.x, y: p.y - 12 - height };
    };

    const t1 = tower(s.gx + 0.5, s.gy + 0.5, 9, s.height);
    const t2 = tower(s.gx + 1.45, s.gy + 1.45, 7.5, s.height - 6);
    this._light(ctx, t1.x, t1.y - 2, '#e2593f', 2.2, 1.7);
    this._light(ctx, t2.x, t2.y - 2, '#e2593f', 2.2, 1.4, 1.6);

    // 变压器阵列 + 能量流动指示
    const box = this.iso(s.gx + 1.6, s.gy + 0.2);
    ctx.save();
    ctx.fillStyle = '#3f4a3e';
    ctx.fillRect(box.x - 5, box.y - 14, 10, 10);
    ctx.strokeStyle = '#616f5d';
    ctx.lineWidth = 0.8 / this.scale;
    ctx.strokeRect(box.x - 5, box.y - 14, 10, 10);
    ctx.restore();
    this._light(ctx, box.x, box.y - 16, '#d8d05c', 5.5, 1.4);

    // 电力流动光带
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#d8d05c';
    ctx.lineWidth = 1 / this.scale;
    ctx.setLineDash([3 / this.scale, 5 / this.scale]);
    ctx.lineDashOffset = -(this.t * 22) % 1000;
    const from = this.iso(s.gx + 1.6, s.gy + 0.2);
    const to = this.iso(s.gx + 2.6, s.gy + 2.4);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 10);
    ctx.lineTo(to.x, to.y - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** 补给仓库：低矮拱形库房 + 集装箱 */
  _shapeDepot(ctx, s) {
    const g = this._box(ctx, s.gx, s.gy, s.w, s.h, s.height,
      { top: '#5a5a46', left: '#3f4033', right: '#2f3026' });
    ctx.save();
    ctx.fillStyle = 'rgba(232, 180, 92, 0.5)';
    ctx.fillRect(g.center.x - 8, g.center.y - s.height - 2, 16, 3);
    ctx.restore();
    this._light(ctx, g.top.c.x, g.top.c.y, '#e8b45c', 1.2, 1.5);
  }

  /** 工厂：主厂房 + 烟囱 + 卷帘门 */
  _shapeFactory(ctx, s, big) {
    const g = this._box(ctx, s.gx, s.gy, s.w, s.h, s.height,
      { top: big ? '#5a5f52' : '#565b4d', left: '#3b4036', right: '#2b2f28' });

    // 锯齿屋顶
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1 / this.scale;
    for (let i = 1; i < 4; i += 1) {
      const p1 = this.iso(s.gx + (s.w * i) / 4, s.gy);
      const p2 = this.iso(s.gx + (s.w * i) / 4, s.gy + s.h);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y - s.height);
      ctx.lineTo(p2.x, p2.y - s.height);
      ctx.stroke();
    }
    ctx.restore();

    // 烟囱
    const ch = this.iso(s.gx + 0.4, s.gy + 0.4);
    ctx.save();
    ctx.fillStyle = '#4a4f44';
    ctx.fillRect(ch.x - 3.5, ch.y - s.height - 20, 7, 22);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(ch.x - 3.5, ch.y - s.height - 20, 7, 22);
    ctx.restore();

    // 卷帘门（车辆出口）
    const door = this.iso(s.gx + s.w * 0.5, s.gy + s.h);
    ctx.save();
    ctx.fillStyle = '#20261f';
    ctx.fillRect(door.x - 7, door.y - 13, 14, 12);
    ctx.fillStyle = 'rgba(232, 161, 58, 0.35)';
    ctx.fillRect(door.x - 7, door.y - 13, 14, 2);
    ctx.restore();
    this._light(ctx, g.top.a.x, g.top.a.y, '#e8a13a', 3.2, 1.5);
  }

  /** 兵营：营房 + 训练场 + 小人形单位 */
  _shapeBarracks(ctx, s) {
    this._box(ctx, s.gx, s.gy, s.w, s.h, s.height,
      { top: '#4f5c45', left: '#374132', right: '#293125' });

    // 训练场
    const yardX = s.gx;
    const yardY = s.gy + s.h + 0.1;
    ctx.save();
    ctx.fillStyle = 'rgba(120, 130, 100, 0.18)';
    this._tilePathRect(ctx, yardX, yardY, s.w, 1);
    ctx.fill();
    ctx.restore();

    // 训练中的人形单位（简化：来回走动的小竖条）
    for (let i = 0; i < 4; i += 1) {
      const phase = i * 0.8;
      const k = (Math.sin(this.t * 1.4 + phase) + 1) / 2;
      const p = this.iso(yardX + 0.3 + k * (s.w - 0.6), yardY + 0.5);
      ctx.save();
      ctx.fillStyle = '#8fa87e';
      ctx.fillRect(p.x - 1, p.y - 6, 2, 6);
      ctx.fillStyle = '#c3d2b4';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 7.5, 1.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 雷达站：塔架 + 旋转碟形天线 */
  _shapeRadar(ctx, s) {
    const g = this._box(ctx, s.gx, s.gy, s.w, s.h, 10,
      { top: '#4a5450', left: '#333c39', right: '#262d2b' });
    const c = g.center;
    ctx.save();
    ctx.strokeStyle = '#7a8a83';
    ctx.lineWidth = 1.3 / this.scale;
    [-6, 6].forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(c.x + dx, c.y - 10);
      ctx.lineTo(c.x, c.y - 10 - s.height);
      ctx.stroke();
    });
    ctx.restore();

    const ang = (this.t * 1.1) % TAU;
    ctx.save();
    ctx.translate(c.x, c.y - 10 - s.height);
    ctx.scale(1, 0.5);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(180, 210, 195, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    this._light(ctx, c.x, c.y - 14 - s.height, '#74d8a3', 3, 1.6);
  }

  /** 技术实验室：主体、传感天线、发光屏幕与研究扫描动画。 */
  _shapeResearch(ctx, s, active = false) {
    const g = this._box(ctx, s.gx, s.gy, s.w, s.h, s.height,
      { top: '#40576a', left: '#293c4a', right: '#202e3a' });
    const screen = this.iso(s.gx + s.w * 0.5, s.gy + s.h);
    ctx.save();
    ctx.fillStyle = active ? 'rgba(126,220,255,0.85)' : 'rgba(126,220,255,0.38)';
    ctx.fillRect(screen.x - 9, screen.y - s.height * 0.55, 18, 8);
    ctx.strokeStyle = 'rgba(205,245,255,0.72)';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(screen.x - 9, screen.y - s.height * 0.55, 18, 8);
    ctx.restore();
    const top = g.topCenter;
    ctx.save();
    ctx.strokeStyle = '#8bb7cc';
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(top.x - 7, top.y - 15); ctx.lineTo(top.x + 7, top.y - 15); ctx.stroke();
    ctx.restore();
    if (active) {
      const pulse = (Math.sin(this.t * 5) + 1) / 2;
      this._light(ctx, top.x, top.y - 24, '#9be8ff', 3 + pulse * 2, 1.8);
      ctx.save();
      ctx.strokeStyle = `rgba(150,230,255,${0.25 + pulse * 0.3})`;
      ctx.lineWidth = 1 / this.scale;
      ctx.beginPath(); ctx.arc(screen.x, screen.y - 12, 13 + pulse * 5, 0, TAU); ctx.stroke();
      ctx.restore();
    } else {
      this._light(ctx, top.x, top.y - 24, '#4e8da3', 2, 1.5);
    }
  }

  _drawResearchActivity(ctx, slot, active) {
    const c = this.iso(slot.gx + slot.w / 2, slot.gy + slot.h / 2);
    const pulse = active ? (Math.sin(this.t * 5) + 1) / 2 : 0.2;
    ctx.save();
    ctx.fillStyle = `rgba(132,220,255,${0.10 + pulse * 0.18})`;
    ctx.fillRect(c.x - 11, c.y - slot.height - 5, 22, 2);
    ctx.restore();
  }

  /** 在网格矩形区域构造路径（用于地面涂色） */
  _tilePathRect(ctx, gx, gy, w, h) {
    const a = this.iso(gx, gy);
    const b = this.iso(gx + w, gy);
    const c = this.iso(gx + w, gy + h);
    const d = this.iso(gx, gy + h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  /* ==========================================================
   * 景物
   * ======================================================== */

  _drawProp(ctx, prop) {
    switch (prop.type) {
      case 'gate': this._propGate(ctx, prop); break;
      case 'watchtower': this._propWatchtower(ctx, prop); break;
      case 'tanks': this._propTanks(ctx, prop); break;
      case 'crates': this._propCrates(ctx, prop); break;
      case 'helipad': this._propHelipad(ctx, prop); break;
      case 'repairpad': this._propRepairPad(ctx, prop); break;
      default: break;
    }
  }

  /** 基地出口：门柱 + 道闸 + 警示灯 + 标识 */
  _propGate(ctx, p) {
    const left = this.iso(p.gx, p.gy + 1);
    const right = this.iso(p.gx + 1, p.gy + 1);

    // 出口混凝土坪
    ctx.save();
    ctx.fillStyle = '#565c52';
    this._tilePathRect(ctx, p.gx - 0.2, p.gy + 0.6, 1.4, 0.8);
    ctx.fill();
    ctx.restore();

    const pillar = (pt) => {
      ctx.save();
      ctx.fillStyle = '#4b5247';
      ctx.fillRect(pt.x - 3, pt.y - 20, 6, 20);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1 / this.scale;
      ctx.strokeRect(pt.x - 3, pt.y - 20, 6, 20);
      ctx.fillStyle = '#c9a14a';
      ctx.fillRect(pt.x - 3, pt.y - 20, 6, 2.5);
      ctx.restore();
    };
    pillar(left);
    pillar(right);

    // 道闸横杆（缓慢起落）
    const lift = (Math.sin(this.t * 0.35) + 1) / 2;
    ctx.save();
    ctx.translate(left.x, left.y - 14);
    ctx.rotate(-lift * 0.5);
    ctx.fillStyle = '#d8563f';
    ctx.fillRect(0, -1.5, Math.hypot(right.x - left.x, right.y - left.y), 3);
    ctx.fillStyle = '#e8e0d0';
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(4 + i * 8, -1.5, 4, 3);
    }
    ctx.restore();

    this._light(ctx, left.x, left.y - 22, '#e2593f', 3.4, 1.7);
    this._light(ctx, right.x, right.y - 22, '#e2593f', 3.4, 1.7, 1.5);

    const mid = this.iso(p.gx + 0.5, p.gy + 1.6);
    ctx.save();
    ctx.font = this.font(9, true);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d8563f';
    ctx.fillText('基地出口', mid.x, mid.y + 6);
    ctx.restore();
  }

  _propWatchtower(ctx, p) {
    const c = this.iso(p.gx + 0.5, p.gy + 0.5);
    ctx.save();
    ctx.strokeStyle = '#5a6455';
    ctx.lineWidth = 1.2 / this.scale;
    [-4, 4].forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(c.x + dx, c.y);
      ctx.lineTo(c.x + dx * 0.4, c.y - 26);
      ctx.stroke();
    });
    ctx.fillStyle = '#4d5748';
    ctx.fillRect(c.x - 6, c.y - 34, 12, 8);
    ctx.fillStyle = '#2d342b';
    ctx.fillRect(c.x - 6, c.y - 32, 12, 3);
    ctx.restore();
    this._light(ctx, c.x, c.y - 36, '#74d8a3', 1.1, 1.3, p.gx + p.gy);
  }

  _propTanks(ctx, p) {
    for (let i = 0; i < 2; i += 1) {
      const c = this.iso(p.gx + 0.35 + i * 0.75, p.gy + 0.4 + i * 0.4);
      ctx.save();
      ctx.fillStyle = '#5d6357';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y - 12, 8, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4a5045';
      ctx.fillRect(c.x - 8, c.y - 12, 16, 12);
      ctx.fillStyle = '#3a4036';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 8, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1 / this.scale;
      ctx.strokeRect(c.x - 8, c.y - 12, 16, 12);
      ctx.restore();
    }
  }

  _propCrates(ctx, p) {
    const seeds = [[0.2, 0.2, 6], [0.62, 0.35, 5], [0.35, 0.68, 4.5]];
    seeds.forEach(([ox, oy, sz], i) => {
      const c = this.iso(p.gx + ox, p.gy + oy);
      ctx.save();
      ctx.fillStyle = i % 2 ? '#5b5136' : '#4d5540';
      ctx.fillRect(c.x - sz / 2, c.y - sz, sz, sz);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.9 / this.scale;
      ctx.strokeRect(c.x - sz / 2, c.y - sz, sz, sz);
      ctx.restore();
    });
  }

  _propHelipad(ctx, p) {
    const c = this.iso(p.gx + 0.5, p.gy + 0.5);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, TH / TW);
    ctx.strokeStyle = 'rgba(200, 220, 200, 0.28)';
    ctx.lineWidth = 1.6 / this.scale;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, TAU);
    ctx.stroke();
    ctx.font = this.font(11, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200, 220, 200, 0.3)';
    ctx.fillText('H', 0, 0);
    ctx.restore();
  }

  /** 维修区：混凝土坪 + 机械臂（阶段6接入实际维修流程） */
  _propRepairPad(ctx, p) {
    ctx.save();
    ctx.fillStyle = 'rgba(120, 128, 118, 0.22)';
    this._tilePathRect(ctx, p.gx, p.gy, 1.6, 1.6);
    ctx.fill();
    ctx.setLineDash([3 / this.scale, 3 / this.scale]);
    ctx.strokeStyle = 'rgba(232, 161, 58, 0.35)';
    ctx.lineWidth = 1 / this.scale;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const c = this.iso(p.gx + 0.8, p.gy + 0.8);
    const swing = Math.sin(this.t * 1.6) * 10;
    ctx.save();
    ctx.strokeStyle = '#7f8a78';
    ctx.lineWidth = 1.6 / this.scale;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x, c.y - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 14);
    ctx.lineTo(c.x + swing, c.y - 22);
    ctx.stroke();
    ctx.restore();
    this._light(ctx, c.x + swing, c.y - 22, '#8fd8ff', 6, 1.2);
  }

  /* ==========================================================
   * 车辆 / 粒子 / 特效
   * ======================================================== */

  _drawMover(ctx, m) {
    const p = this.iso(m.gx, m.gy);
    ctx.save();
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 7, 3, 0, 0, TAU);
    ctx.fill();
    this._unitShape(ctx, p.x, p.y, m.kind);
    ctx.restore();
    this._light(ctx, p.x + 6, p.y - 5, '#e8d78a', 4, 1);
  }

  /**
   * 单位外形（行进中的车辆与集结区的部队共用一套画法）。
   * @param {number} x 屏幕(投影)坐标
   * @param {number} y 屏幕(投影)坐标
   * @param {string} kind UNITS[type].shape：infantry / at_infantry / scout / tank / repair
   */
  _unitShape(ctx, x, y, kind) {
    const lineW = 1 / this.scale;

    // 步兵 / 反装甲班：人形
    if (kind === 'infantry' || kind === 'at_infantry') {
      const body = kind === 'at_infantry' ? '#9aa37a' : '#7f9070';
      ctx.fillStyle = body;
      ctx.fillRect(x - 1.2, y - 7, 2.4, 7);
      ctx.beginPath();
      ctx.arc(x, y - 8.6, 1.7, 0, TAU);
      ctx.fill();
      if (kind === 'at_infantry') {
        // 明显的反装甲武器轮廓（长管）
        ctx.strokeStyle = '#cfd6b5';
        ctx.lineWidth = 1.4 / this.scale;
        ctx.beginPath();
        ctx.moveTo(x + 1.2, y - 6);
        ctx.lineTo(x + 8, y - 9);
        ctx.stroke();
      }
      return;
    }

    // 车辆：侦察车 / 主战坦克 / 维修车（依据 kind 区分外形）
    const isTank = kind === 'tank';
    const isRepair = kind === 'repair';
    const w = isTank ? 8 : 7;
    const h = 7;
    ctx.fillStyle = isTank ? '#5c6a4e' : (isRepair ? '#5f6b62' : '#576250');
    ctx.fillRect(x - w, y - h, w * 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - w, y - h + 4, w * 2, 2.5);
    // 炮塔 / 驾驶舱
    ctx.fillStyle = isTank ? '#6b7a5b' : (isRepair ? '#6b756a' : '#66735a');
    const tw = isTank ? 4 : 5;
    ctx.fillRect(x - tw / 2, y - h - 5, tw, 5);
    if (isTank) {
      // 主炮
      ctx.fillStyle = '#59654b';
      ctx.fillRect(x + tw / 2, y - h - 4, 9, 1.6);
    } else if (isRepair) {
      // 机械臂 / 工具标识
      ctx.strokeStyle = '#e8d78a';
      ctx.lineWidth = 1.4 / this.scale;
      ctx.beginPath();
      ctx.moveTo(x + tw / 2, y - h - 5);
      ctx.lineTo(x + tw / 2 + 6, y - h - 9);
      ctx.stroke();
    } else {
      // 侦察车：小天线
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.moveTo(x, y - h - 5);
      ctx.lineTo(x, y - h - 9);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = lineW;
    ctx.strokeRect(x - w, y - h, w * 2, h);
  }

  _drawParticles(ctx) {
    ctx.save();
    this.particles.forEach((p) => {
      const k = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, p.alpha * k);
      if (p.type === 'smoke') {
        ctx.fillStyle = '#9aa79b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    });
    ctx.restore();
  }

  _drawRings(ctx) {
    ctx.save();
    this.rings.forEach((r) => {
      const c = this.iso(r.gx, r.gy);
      ctx.globalAlpha = Math.max(0, r.life) * 0.5;
      ctx.strokeStyle = '#74d8a3';
      ctx.lineWidth = 2 / this.scale;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1, TH / TW);
      ctx.beginPath();
      ctx.arc(0, 0, r.r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  /* ==========================================================
   * 悬停拾取与提示
   * ======================================================== */

  _pickHover(state) {
    if (!this.pointer.inside) { this.hover = null; return; }
    const { gx, gy } = this.screenToGrid(this.pointer.x, this.pointer.y);
    let found = null;

    (state.buildings || []).forEach((b) => {
      const s = b.slot || (BUILDINGS[b.type] && BUILDINGS[b.type].slot);
      if (!s) return;
      if (gx >= s.gx && gx <= s.gx + s.w && gy >= s.gy && gy <= s.gy + s.h) {
        found = { type: 'building', building: b, slot: s };
      }
    });

    if (!found) {
      Object.values(BUILDINGS).forEach((def) => {
        if (!def.buildable || !def.slot) return;
        if ((state.buildings || []).some((b) => b.type === def.id)) return;
        const s = def.slot;
        if (gx >= s.gx && gx <= s.gx + s.w && gy >= s.gy && gy <= s.gy + s.h) {
          found = { type: 'slot', def, slot: s };
        }
      });
    }

    // 集结区的编队优先于分区提示（阶段4）
    if (!found) {
      let best = null;
      this.rallyGroups.forEach((g) => {
        const d = Math.hypot(gx - g.gx, gy - g.gy);
        const reach = 0.55 + (g.radius - 12) / 24;
        if (d <= reach && (!best || d < best.d)) best = { d, group: g };
      });
      if (best) found = { type: 'formation', group: best.group };
    }

    if (!found) {
      const zone = (BASE_LAYOUT.zones || []).find(
        (z) => gx >= z.gx && gx <= z.gx + z.w && gy >= z.gy && gy <= z.gy + z.h
      );
      if (zone) found = { type: 'zone', zone };
    }

    this.hover = found;
  }

  _drawHoverHighlight(ctx) {
    if (!this.hover || !this.hover.slot) return;
    const s = this.hover.slot;
    ctx.save();
    ctx.strokeStyle = '#74d8a3';
    ctx.lineWidth = 1.6 / this.scale;
    ctx.globalAlpha = 0.85;
    this._tilePathRect(ctx, s.gx, s.gy, s.w, s.h);
    ctx.stroke();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#74d8a3';
    ctx.fill();
    ctx.restore();
  }

  /** 建筑效果摘要（只读 config，不显示内部字段名） */
  _effectLines(def) {
    const lines = [];
    const eff = def.effects || {};
    if (eff.supplyPerSec) lines.push(`补给产量：+${eff.supplyPerSec}/s`);
    if (eff.alloyPerSec) lines.push(`合金产量：+${eff.alloyPerSec}/s`);
    if (eff.intelPerSec) lines.push(`情报产量：+${eff.intelPerSec}/s`);
    if (eff.supplyCap) lines.push(`补给上限：+${eff.supplyCap}`);
    if (eff.alloyCap) lines.push(`合金上限：+${eff.alloyCap}`);
    if (eff.commandCapacity) lines.push(`指挥容量：+${eff.commandCapacity}`);
    if (eff.scouting) lines.push(`侦察能力：+${eff.scouting}`);
    if (eff.ambushResist) lines.push(`伏击抵抗：+${Math.round(eff.ambushResist * 100)}%`);
    if (eff.intelAccuracy) lines.push('战前情报准确度提升');
    const unlocks = (def.unlocks || []).map((id) => (UNITS[id] ? UNITS[id].name : null)).filter(Boolean);
    if (unlocks.length) lines.push(`已解锁：${unlocks.join('、')}`);
    return lines;
  }

  _updateTip(state) {
    if (!this.tipEl) return;
    if (!this.hover) { this._hideTip(); return; }

    let title = '';
    let lines = [];
    if (this.hover.type === 'building') {
      const def = BUILDINGS[this.hover.building.type];
      if (!def) { this._hideTip(); return; }
      const building = this.hover.building;
      title = def.name;

      if (building.status === BUILDING_STATUS.UNDER_CONSTRUCTION) {
        const progress = clamp(safeNumber(building.progress, 0), 0, 1);
        lines.push('状态：施工中');
        lines.push(`施工进度：${Math.floor(progress * 100)}%`);
        // 剩余时间取自当前施工任务（渲染器只读，不修改任何进度）
        const job = state && state.construction && state.construction.current;
        if (job && job.id === building.id) {
          const remain = Math.max(0, safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0));
          lines.push(`剩余时间：${remain > 0 ? formatDuration(Math.ceil(remain)) : '即将完成'}`);
        }
        lines.push(`建成后：${def.desc}`);
      } else {
        lines.push(building.status === BUILDING_STATUS.OFFLINE ? '状态：已停机' : '状态：运行中');
        const consume = safeNumber(def.power && def.power.consume, 0);
        const produce = safeNumber(def.power && def.power.produce, 0);
        if (produce > 0) lines.push(`电力输出：+${produce}`);
        else if (consume > 0) lines.push(`电力消耗：${consume}`);
        else lines.push('电力消耗：无');
        lines = lines.concat(this._effectLines(def));
        if (this._effectLines(def).length === 0 && def.desc) lines.push(def.desc);
      }
    } else if (this.hover.type === 'slot') {
      const def = this.hover.def;
      title = `预留位 · ${def.name}`;
      lines = [def.desc, `建造耗时：${safeNumber(def.buildTime, 0)} 秒`];
      const consume = safeNumber(def.power && def.power.consume, 0);
      if (consume > 0) lines.push(`电力需求：${consume}`);
      lines.push(CURRENT_STAGE >= (def.unlockStage || 2)
        ? '可在「建设」分页批准建设'
        : `开放阶段：阶段${def.unlockStage || 2}`);
    } else if (this.hover.type === 'formation') {
      // 编队悬停：只展示状态派生出来的只读信息
      const g = this.hover.group;
      const f = ((state && state.formations) || []).find((x) => x && x.id === g.id);
      title = g.name;
      lines = [`成员数量：${g.count}`];
      if (f) {
        const cost = (f.unitIds || []).reduce((sum, id) => {
          const u = (state.units || []).find((x) => x && x.id === id);
          const def = u ? UNITS[u.type] : null;
          return sum + (def ? safeNumber(def.command, 0) : 0);
        }, 0);
        lines.push(`指挥占用：${cost}`);
        lines.push(`当前状态：${FORMATION_STATUS_LABEL[f.status] || '待命'}`);
        const callsigns = (f.unitIds || []).map((id) => (state.units || []).find((u) => u && u.id === id)).filter(Boolean)
          .map((u) => formatUnitDisplayName(u)).filter((name) => !name.includes('未知单位'));
        if (callsigns.length) lines.push(`成员档案：${callsigns.join('、')}`);
      }
      lines.push(g.count > 0 ? '可在「编队」分页调整成员' : '尚未编入单位');
    } else if (this.hover.type === 'zone') {
      title = this.hover.zone.name;
      lines = ['基地功能分区'];
    }

    this.tipEl.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = title;
    this.tipEl.appendChild(b);
    lines.filter(Boolean).forEach((line) => {
      const span = document.createElement('span');
      span.textContent = line;
      this.tipEl.appendChild(span);
    });
    this.tipEl.hidden = false;

    const pad = 14;
    let left = this.pointer.x + pad;
    let top = this.pointer.y + pad;
    const tw = this.tipEl.offsetWidth || 180;
    const th = this.tipEl.offsetHeight || 60;
    if (left + tw > this.width - 8) left = this.pointer.x - tw - pad;
    if (top + th > this.height - 8) top = this.pointer.y - th - pad;
    this.tipEl.style.left = `${Math.max(4, left)}px`;
    this.tipEl.style.top = `${Math.max(4, top)}px`;
  }

  _hideTip() {
    if (this.tipEl && !this.tipEl.hidden) this.tipEl.hidden = true;
  }

  /* ==========================================================
   * 预留：战斗视图（阶段5）
   * ======================================================== */

  /** 切换视图；阶段1只有基地视图 */
  setViewMode(mode) {
    this.viewMode = mode === 'battle' && CURRENT_STAGE >= 5 ? 'battle' : 'base';
    return this.viewMode;
  }

  /**
   * 播放战斗（阶段5）：只读取 battle.js 生成的事件序列，
   * 严禁在此处修改任何战斗数值。
   */
  playBattle(report) {
    void report;
    console.info('[renderer] 战斗播放将在阶段5实现。');
  }

  /** 释放资源 */
  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.rallyUnits.clear();
    this.rallyLeaving = [];
    this.repairUnits.clear();
    this.rallyGroups = [];
    this._formationPulse.clear();
    this.particles = [];
    this.movers = [];
    this.rings = [];
  }
}
