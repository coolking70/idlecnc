/**
 * ui.js —— DOM 界面层（资源栏 / 分页面板 / 消息栏 / 提示条）
 *
 * 职责边界：只读取状态并渲染，玩家操作通过构造函数传入的回调交给 main.js 处理。
 * 所有 DOM 查询都做存在性检查，缺元素时静默降级，不抛异常。
 */

import {
  PANEL_TABS, STAGE_PLACEHOLDER, CURRENT_STAGE, CURRENT_STAGE_LABEL, BUILDINGS, BUILDING_STATUS,
  RESOURCE_DEFS, BASE_LAYOUT, TIME, UNITS, CONSTRUCTION, CONSTRUCTION_UI,
  PRODUCTION, PRODUCTION_UI, FORMATION, FORMATION_PRESETS, EQUIPMENT,
  BATTLE, BATTLE_RESULT, THEATERS, OPERATIONS, DAMAGE_STATES, REPAIR, RESEARCH, TECHNOLOGIES, UNIT_RANKS
} from './config.js';
import { canBuild, getConstructionProgress, buildableList } from './construction.js';
import { canQueueUnit, inventoryCount, getProductionProgress } from './production.js';
import {
  canQueueRepair, getActiveRepairs, getQueuedRepairs, getRepairProgress,
  getRepairRemaining, hasRepairShop, getRepairCost, getRepairTime
} from './repairs.js';
import { damageStateOfUnit } from './unit-status.js';
import {
  hasResearchCenter, listTechnologies, getResearchProgress, getResearchModifiers,
  getTechnologyState
} from './research.js';
import { getUnitRank, getRankProgress, formatUnitDisplayName, getUnitEffectiveStats, filterUnits, sortUnits } from './units.js';
import {
  canCreateFormation, canApplyPreset, canAddUnit, getAvailableUnits,
  getFormationStats, getFormationWarnings, getPresetCommandCost,
  isEditable, statusLabel
} from './formations.js';
import {
  listTheaters, listStrategies, getTheaterIntel, getMissionCost, formatMissionCost,
  canDispatch, canDispatchOperationMission, getOperation,
  getActiveBattle, getReports, hasRadar, buildDispatchSnapshot
} from './theater.js';
import { getOperationCost } from './operations.js';
import { EQUIPMENT_RULES } from './config.js';
import {
  canEquipEquipment, getEquipmentDefinition, getUnitEquipment,
  equipmentInventoryCounts
} from './equipment.js';
import { canQueueEquipment } from './production.js';
import { deriveSalvageOffer } from './battle-salvage.js';
import {
  missionKindLabel, dispatchEligibilityText, operationCooldownText, unitStatusLabel
} from './mission-command-presentation.js';
import { BATTLE_EVENT, resultLabel } from './battle.js';
import {
  qs, el, setText, toggleClass, formatInt, formatRate, formatClock,
  formatDuration, formatWallClock, clamp, safeNumber
} from './utils.js';
import { CategoryBar, CommandSurface } from './command-ui.js';
import {
  canAssignOperationalTask, OPERATIONAL_TASK
} from './tasking.js';
import {
  buildConstructionTileModels, buildCurrentConstructionModel,
  buildUnitProductionTileModels, buildEquipmentProductionTileModels,
  buildProductionQueueModels,
  buildUnitRosterModels, buildFormationCommandModels,
  buildTheaterCommandModels, buildStrategyModels,
  buildRepairCommandModels, buildResearchCommandModels,
  buildReportModels, buildOverviewCommandModels
} from './command-presentation.js';

/** 战斗结果 → 样式修饰类 */
const RESULT_TONE = {
  [BATTLE_RESULT.VICTORY]: 'ok',
  [BATTLE_RESULT.PYRRHIC]: 'warn',
  [BATTLE_RESULT.WITHDRAW]: 'warn',
  [BATTLE_RESULT.DEFEAT]: 'danger',
  [BATTLE_RESULT.WIPED]: 'danger'
};

export class UI {
  /**
   * @param {object} handlers 交互回调：
   *   { onSpeedChange, onSave, onLoad, onNewGame, onTabChange, onBuild, onCancelConstruction }
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.activeTab = 'overview';
    this.refs = {};
    this._logSignature = '';
    this._buildingSignature = '';
    this._toastTimer = null;
    /** 建造按钮的临时锁，防止一次点击被处理两次 */
    this._buildLocked = false;
    /** 生产按钮的临时锁，防止一次点击被处理两次 */
    this._produceLocked = false;
    /** 装备制造按钮的临时锁，防止同一实例被重复入队 */
    this._equipmentProduceLocked = false;
    /** 编队操作的临时锁 */
    this._formationLocked = false;
    /** 当前选中的编队 ID（阶段4） */
    this.selectedFormationId = null;
    /** 战区操作的临时锁（阶段5） */
    this._theaterLocked = false;
    /** 战区页选中的战区 / 派遣编队 / 作战策略（阶段5） */
    this.selectedTheaterId = null;
    this.dispatchFormationId = null;
    this.selectedStrategyId = 'cautious';
    this.selectedOperationId = null;
    /** 仅 UI 内存中的部署确认；刷新后安全回退，不写入 production save。 */
    this.dispatchReview = null;
    this._lastState = null;
    this.commandSurface = new CommandSurface((actionId, payload) => this._onInspectorCommand(actionId, payload));
    this.commandCategory = 'units';
    /** 战报页选中的战报 ID（阶段5） */
    this.selectedReportId = null;
    this.presentationState = { preference: 'auto', mode: 'legacy' };
    this._mount();
  }

  /* ==========================================================
   * 初始化
   * ======================================================== */

  _mount() {
    const r = this.refs;

    // 资源栏
    ['supply', 'alloy', 'intel', 'power', 'command'].forEach((key) => {
      r[`val_${key}`] = qs(`#val-${key}`);
      r[`cap_${key}`] = qs(`#cap-${key}`);
      r[`rate_${key}`] = qs(`#rate-${key}`);
      r[`box_${key}`] = qs(`.res[data-res="${key}"]`);
    });
    r.clock = qs('#game-clock');
    r.day = qs('#game-day');
    r.statChip = qs('#stat-chip');
    r.logList = qs('#log-list');
    r.logCount = qs('#log-count');
    r.tabs = qs('#panel-tabs');
    r.panelBody = qs('#panel-body');
    r.toast = qs('#toast');
    r.legend = qs('#zone-legend');
    r.viewChip = qs('#view-chip');
    r.presentationMode = qs('#battle-presentation-mode');
    r.presentationStatus = qs('#battle-presentation-status');
    if (r.presentationMode) r.presentationMode.addEventListener('click', () => {
      const order = ['auto', 'legacy', 'contract', 'universal'];
      const index = Math.max(0, order.indexOf(this.presentationState.preference));
      this.handlers.onPresentationModeChange?.(order[(index + 1) % order.length]);
    });
    r.battleOverlay = qs('#battle-overlay-controls');
    r.battleOverlayStatus = qs('#battle-overlay-status');
    r.battleViewReport = qs('#battle-view-report');
    r.battleSkipReturn = qs('#battle-skip-return');
    if (r.battleViewReport) r.battleViewReport.addEventListener('click', () => this._openActiveBattleReport());
    if (r.battleSkipReturn) r.battleSkipReturn.addEventListener('click', () => this._onTheaterAction('onSkipBattleReturn'));

    this._buildLegend();
    this._buildTabs();
    this._buildPages();
    this._bindTopbar();
  }

  /** 基地分区图例（数据来自 config，避免与画面不一致） */
  _buildLegend() {
    const box = this.refs.legend;
    if (!box) return;
    box.innerHTML = '';
    BASE_LAYOUT.zones.forEach((z) => {
      const span = el('span');
      const i = el('i');
      i.style.setProperty('--c', z.color);
      span.appendChild(i);
      span.appendChild(document.createTextNode(z.name));
      box.appendChild(span);
    });
    const exit = el('span');
    const ei = el('i');
    ei.style.setProperty('--c', '#d8563f');
    exit.appendChild(ei);
    exit.appendChild(document.createTextNode('基地出口'));
    box.appendChild(exit);
  }

  /** 分页标签 */
  _buildTabs() {
    const nav = this.refs.tabs;
    if (!nav) return;
    nav.innerHTML = '';
    PANEL_TABS.forEach((tab) => {
      const btn = el('button', 'tab', tab.label);
      btn.type = 'button';
      btn.dataset.tab = tab.id;
      btn.setAttribute('role', 'tab');
      if (tab.stage > CURRENT_STAGE) btn.classList.add('is-locked');
      if (tab.id === this.activeTab) btn.classList.add('is-active');
      btn.addEventListener('click', () => this.switchTab(tab.id));
      nav.appendChild(btn);
    });
  }

  /** 各分页内容容器 */
  _buildPages() {
    const body = this.refs.panelBody;
    if (!body) return;
    body.innerHTML = '';
    this.refs.pages = {};

    PANEL_TABS.forEach((tab) => {
      const page = el('section', 'tab-page');
      page.dataset.page = tab.id;
      page.hidden = tab.id !== this.activeTab;

      const title = el('h3', 'page-title');
      title.appendChild(el('span', '', tab.title));
      const COMMAND_PAGE_LABELS = {
        construction: 'BUILD', production: 'COMMAND PRODUCTION', units: 'ROSTER',
        formations: 'FORMATIONS', theater: 'OPERATIONS', repairs: 'REPAIR BAY',
        research: 'RESEARCH', reports: 'BATTLE LOG', overview: 'COMMAND OVERVIEW'
      };
      if (COMMAND_PAGE_LABELS[tab.id]) {
        title.classList.add('command-page-title');
        title.appendChild(el('small', '', COMMAND_PAGE_LABELS[tab.id]));
      } else {
        title.appendChild(el('small', '', tab.stage > CURRENT_STAGE ? `阶段${tab.stage}` : `阶段${tab.stage} · 已开放`));
      }
      page.appendChild(title);

      if (tab.id === 'overview') {
        this._buildOverview(page);
      } else if (tab.id === 'construction') {
        this._buildConstructionPage(page);
      } else if (tab.id === 'production') {
        this._buildProductionPage(page);
      } else if (tab.id === 'units') {
        this._buildUnitsPage(page);
      } else if (tab.id === 'formations') {
        this._buildFormationPage(page);
      } else if (tab.id === 'theater') {
        this._buildTheaterPage(page);
      } else if (tab.id === 'repairs') {
        this._buildRepairsPage(page);
      } else if (tab.id === 'research') {
        this._buildResearchPage(page);
      } else if (tab.id === 'reports') {
        this._buildReportsPage(page);
      } else {
        page.appendChild(this._buildLockedBlock(tab));
      }

      body.appendChild(page);
      this.refs.pages[tab.id] = page;
    });
  }

  /** 未开放分页占位 */
  _buildLockedBlock(tab) {
    const box = el('div', 'locked');
    box.appendChild(el('div', 'lock-icon', '⛨'));
    box.appendChild(el('div', 'lock-title', '后续阶段开放'));
    box.appendChild(el('div', 'lock-text', STAGE_PLACEHOLDER[tab.stage] || '后续阶段开放'));

    const detail = {
      production: '将提供：步兵班、反装甲班、侦察车、主战坦克、维修车的训练队列与库存。',
      formations: '将提供：编队创建、单位增减、指挥容量校验与三套预设模板。',
      research: '将提供：简化科技树（侦察、后勤、装甲维护等方向）。'
    }[tab.id];
    if (detail) box.appendChild(el('div', 'lock-text', detail));
    return box;
  }

  /* ==========================================================
   * 建设页（阶段2）
   * ======================================================== */

  _onInspectorCommand(actionId, payload = {}) {
    if (actionId === 'cancel-construction') this.handlers.onCancelConstruction?.();
    else if (actionId === 'cancel-current-production') this.handlers.onCancelCurrentProduction?.();
    else if (actionId === 'cancel-queued-production') this.handlers.onCancelQueuedProduction?.(payload.jobId);
    else if (actionId === 'build') this._onBuildClick(payload.typeId);
    else if (actionId === 'produce-unit') this._onProduceClick(payload.unitType);
    else if (actionId === 'produce-equipment') this._onEquipmentProduceClick(payload.equipmentId);
    /* Stage 10-P-B：迁移页面共用同一 Inspector 通道，操作仍走原 authority API */
    else if (actionId === 'rename-unit') this.handlers.onRenameUnit?.(payload.unitId, payload.value);
    else if (actionId === 'equip-equipment') this.handlers.onEquipEquipment?.(payload.unitId, payload.equipmentInstanceId);
    else if (actionId === 'unequip-equipment') this.handlers.onUnequipEquipment?.(payload.unitId, payload.equipmentInstanceId);
    else if (actionId === 'repair-unit') this.handlers.onRepair?.(payload.unitId);
    else if (actionId === 'cancel-repair') this.handlers.onCancelRepair?.(payload.jobId);
    else if (actionId === 'research') this.handlers.onResearch?.(payload.techId);
    else if (actionId === 'cancel-current-research') this.handlers.onCancelCurrentResearch?.(payload);
    else if (actionId === 'cancel-queued-research') this.handlers.onCancelQueuedResearch?.(payload.taskId, payload);
    else if (actionId === 'create-formation') this._onFormationAction('onCreateFormation');
    else if (actionId === 'apply-preset') this._onFormationAction('onApplyPreset', payload.presetId);
    else if (actionId === 'disband-formation') this._onFormationAction('onDisbandFormation', payload.formationId);
    else if (actionId === 'remove-unit') this._onFormationAction('onRemoveUnit', payload.formationId, payload.unitId);
    else if (actionId === 'add-unit') this._onFormationAction('onAddUnit', payload.formationId, payload.unitId);
    else if (actionId === 'replay-report') this._onTheaterAction('onReplayReport', payload.reportId);
    else if (actionId === 'claim-battle-salvage') this._onTheaterAction('onClaimBattleSalvage', payload.battleSessionId);
    else if (actionId === 'select-theater') this._selectTheaterTarget(payload.theaterId, payload.operationId);
    else if (actionId === 'select-strategy') this._selectStrategy(payload.strategyId);
    /* Stage 10-A：作战任务（选择任务 → 选择战区 → 下达 / 召回） */
    else if (actionId === 'choose-task') this._chooseOperationalTaskTheater(payload);
    else if (actionId === 'assign-task') this._onFormationAction('onAssignOperationalTask', payload.formationId, payload.taskType, payload.theaterId);
    else if (actionId === 'recall-task') this._onFormationAction('onRecallOperationalTask', payload.formationId);
  }

  /** Stage 10-A：任务类型选定后，Inspector 内选择目标战区再下达（纯 UI 选择态） */
  _chooseOperationalTaskTheater(payload = {}) {
    const state = this._lastState;
    if (!state || !payload.formationId || !payload.taskType) return;
    const formation = (state.formations || []).find((f) => f && f.id === payload.formationId);
    if (!formation) return;
    const theaters = listTheaters(state).filter((row) => row.unlocked);
    this.commandSurface.inspector.open({
      title: `${OPERATIONAL_TASK.labels[payload.taskType] || payload.taskType}`,
      eyebrow: 'OPERATIONAL TASK · 选择目标战区',
      description: OPERATIONAL_TASK.descs[payload.taskType] || '',
      rows: [
        { label: '出击编队', value: formation.name },
        { label: '周期消耗', value: `${Object.entries(OPERATIONAL_TASK.upkeepPerInterval[payload.taskType] || {}).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'} / ${OPERATIONAL_TASK.costIntervalSec}s` },
        { label: '说明', value: '任务是持续性派遣：随游戏时间推进，暂停时不推进；召回后编队恢复待命。' }
      ],
      actions: theaters.map((row) => {
        const check = canAssignOperationalTask(state, payload.formationId, payload.taskType, row.id);
        return {
          id: 'assign-task',
          label: `前往 ${row.name}`,
          payload: { formationId: payload.formationId, taskType: payload.taskType, theaterId: row.id },
          disabled: !check.ok
        };
      })
    });
  }

  _onCommandPrimary(model) {
    const payload = model?.actionPayload || model?.inspector?.actionPayload || {};
    const actionId = model?.actionId || model?.inspector?.actionId;
    if (actionId === 'build') this._onBuildClick(payload.typeId);
    else if (actionId === 'produce-unit') this._onProduceClick(payload.unitType);
    else if (actionId === 'produce-equipment') this._onEquipmentProduceClick(payload.equipmentId);
    else if (actionId === 'repair-unit') this.handlers.onRepair?.(payload.unitId);
    else if (actionId === 'research') this.handlers.onResearch?.(payload.techId);
    else if (actionId === 'select-theater') this._selectTheaterTarget(payload.theaterId, payload.operationId);
    else if (actionId === 'select-strategy') this._selectStrategy(payload.strategyId);
  }

  /** 战区目标选择（Stage 10-P-B：Tile 主操作） */
  _selectTheaterTarget(theaterId, operationId = null) {
    if (!theaterId) return;
    this.dispatchReview = null;
    this.selectedTheaterId = theaterId;
    this.selectedOperationId = operationId;
    if (this.refs.th) this.refs.th.sig.cost = '';
    const fn = this.handlers.onSelectTheater;
    if (typeof fn === 'function') fn(theaterId);
    if (this._lastState) this._updateTheater(this._lastState);
  }

  /** 作战策略选择（Stage 10-P-B：Tile 主操作） */
  _selectStrategy(strategyId) {
    if (!strategyId) return;
    this.selectedStrategyId = strategyId;
    this.dispatchReview = null;
    if (this.refs.th) this.refs.th.sig.cost = '';
    if (this._lastState) this._updateTheater(this._lastState);
  }

  _setCommandCategory(categoryId) {
    const p = this.refs.prod;
    if (!p || !['units', 'equipment'].includes(categoryId)) return;
    this.commandCategory = categoryId;
    p.categoryBar?.select(categoryId);
    if (p.unitsSection) p.unitsSection.hidden = categoryId !== 'units';
    if (p.equipmentSection) p.equipmentSection.hidden = categoryId !== 'equipment';
  }

  /** 构建建设分页：工程状态区 + 建筑项目列表 */
  _buildConstructionPage(page) {
    const r = this.refs;
    r.build = {};

    const currentHead = el('div', 'command-section-head');
    currentHead.appendChild(el('span', '', 'CURRENT'));
    currentHead.appendChild(el('small', '', '施工队列'));
    page.appendChild(currentHead);
    r.build.currentEmpty = el('div', 'command-empty', '施工队列空闲');
    page.appendChild(r.build.currentEmpty);
    r.build.currentRoot = el('div', 'command-current command-queue');
    page.appendChild(r.build.currentRoot);
    r.build.currentGrid = this.commandSurface.createQueue(r.build.currentRoot, (model) => this._onCommandPrimary(model));

    const buildHead = el('div', 'command-section-head');
    buildHead.appendChild(el('span', '', 'BUILD'));
    buildHead.appendChild(el('small', '', '点击建造'));
    page.appendChild(buildHead);
    r.build.gridRoot = el('div', 'command-grid command-build-grid');
    r.build.gridRoot.dataset.commandScope = 'construction';
    page.appendChild(r.build.gridRoot);
    r.build.commandGrid = this.commandSurface.createGrid(r.build.gridRoot, (model) => this._onCommandPrimary(model));
    page.appendChild(el('div', 'command-gesture-hint', '点击执行 · 悬浮快览 · 长按详情'));
    return;

    // —— 工程状态区 ——
    const status = el('div', 'card build-status');
    const head = el('div', 'card-head');
    head.appendChild(el('span', '', '工程队状态'));
    r.build.statusTag = el('span', 'tag', '空闲');
    head.appendChild(r.build.statusTag);
    status.appendChild(head);

    // 空闲态
    r.build.idleBox = el('div', 'cs-idle');
    r.build.idleBox.appendChild(el('div', 'cs-idle-title', CONSTRUCTION_UI.idleTitle));
    r.build.idleBox.appendChild(el('div', 'cs-idle-hint', CONSTRUCTION_UI.idleHint));
    status.appendChild(r.build.idleBox);

    // 施工态
    const active = el('div', 'cs-active');
    active.hidden = true;
    r.build.activeBox = active;

    r.build.jobName = el('div', 'cs-name', '——');
    active.appendChild(r.build.jobName);

    const mkRow = (label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '——');
      row.appendChild(v);
      active.appendChild(row);
      return v;
    };
    r.build.jobStatus = mkRow('状态');
    r.build.jobElapsed = mkRow('已用时间');
    r.build.jobRemaining = mkRow('剩余时间');

    const barWrap = el('div', 'cs-bar-wrap');
    const bar = el('div', 'bar build');
    r.build.jobBar = el('i');
    bar.appendChild(r.build.jobBar);
    barWrap.appendChild(bar);
    r.build.jobPercent = el('span', 'cs-pct', '0%');
    barWrap.appendChild(r.build.jobPercent);
    active.appendChild(barWrap);

    r.build.pausedHint = el('div', 'cs-paused', CONSTRUCTION_UI.pausedHint);
    r.build.pausedHint.hidden = true;
    active.appendChild(r.build.pausedHint);

    r.build.cancelBtn = el('button', 'btn danger cs-cancel', '取消工程');
    r.build.cancelBtn.type = 'button';
    r.build.cancelBtn.addEventListener('click', () => {
      const fn = this.handlers.onCancelConstruction;
      if (typeof fn === 'function') fn();
    });
    active.appendChild(r.build.cancelBtn);

    status.appendChild(active);
    page.appendChild(status);

    // —— 建筑项目列表 ——
    const listHead = el('div', 'section-head');
    listHead.appendChild(el('span', '', '可建设项目'));
    listHead.appendChild(el('span', 'tag', `同时施工上限 ${CONSTRUCTION.maxConcurrent}`));
    page.appendChild(listHead);

    const list = el('div', 'build-list');
    buildableList().forEach((def) => {
      const card = this._renderBuildCard(def);
      list.appendChild(card.root);
      r.build.cards[def.id] = card;
    });
    page.appendChild(list);

    const note = el('div', 'hint');
    note.innerHTML = `<b>说明：</b>每种建筑最多建造一座，同时只能进行 ${CONSTRUCTION.maxConcurrent} 项工程。`
      + `取消施工只返还 ${Math.round(CONSTRUCTION.refundRatio * 100)}% 的建设资源，`
      + '暂停状态下施工进度不会推进。';
    page.appendChild(note);
  }

  /** 单张建筑卡片（只建结构，文字由 _updateConstruction 刷新） */
  _renderBuildCard(def) {
    const root = el('article', 'build-card');
    root.dataset.type = def.id;

    const head = el('div', 'bc-head');
    head.appendChild(el('span', 'bc-name', def.name));
    const statusTag = el('span', 'bc-status tag', CONSTRUCTION_UI.statusLabel.available);
    head.appendChild(statusTag);
    root.appendChild(head);

    root.appendChild(el('p', 'bc-desc', def.desc || ''));

    // 区域 / 时间 / 电力 / 前置
    const grid = el('div', 'bc-grid');
    const mkCell = (label, value) => {
      const cell = el('div', 'bc-cell');
      cell.appendChild(el('b', '', label));
      cell.appendChild(el('span', '', value));
      grid.appendChild(cell);
    };
    const zone = (BASE_LAYOUT.zones || []).find((z) => z.id === def.zone);
    mkCell('所在区域', zone ? zone.name : '基地');
    mkCell('建造时间', `${formatInt(def.buildTime)} 秒`);
    const consume = safeNumber(def.power && def.power.consume, 0);
    const produce = safeNumber(def.power && def.power.produce, 0);
    mkCell('电力需求', produce > 0 ? `产出 ${formatInt(produce)}` : (consume > 0 ? `占用 ${formatInt(consume)}` : '无'));
    const reqNames = (def.requires || [])
      .map((id) => (BUILDINGS[id] ? BUILDINGS[id].name : id));
    mkCell('前置条件', reqNames.length ? reqNames.join('、') : '无');
    root.appendChild(grid);

    // 建设成本（缺料时高亮）
    const costBox = el('div', 'bc-cost');
    costBox.appendChild(el('b', '', '建设成本'));
    const chips = {};
    Object.keys(def.cost || {}).forEach((key) => {
      const amount = safeNumber(def.cost[key], 0);
      if (amount <= 0) return;
      const resDef = RESOURCE_DEFS[key];
      const chip = el('span', 'cost-chip', `${resDef ? resDef.name : key} ${formatInt(amount)}`);
      chip.dataset.res = key;
      costBox.appendChild(chip);
      chips[key] = chip;
    });
    if (!Object.keys(chips).length) costBox.appendChild(el('span', 'cost-chip', '免费'));
    root.appendChild(costBox);

    // 建成效果
    const effect = el('div', 'bc-effect');
    effect.appendChild(el('b', '', '建成效果'));
    effect.appendChild(el('span', '', this._effectSummary(def)));
    root.appendChild(effect);

    // 操作
    const btn = el('button', 'btn primary build-btn', CONSTRUCTION_UI.buttonLabel.ready);
    btn.type = 'button';
    btn.dataset.type = def.id;
    btn.dataset.action = 'build';
    btn.dataset.buildingType = def.id;
    btn.addEventListener('click', () => this._onBuildClick(def.id));
    root.appendChild(btn);

    const reason = el('div', 'bc-reason');
    reason.hidden = true;
    root.appendChild(reason);

    return { root, statusTag, btn, reason, chips, def };
  }

  /** 建造按钮点击：临时锁按钮，避免连点重复扣费 */
  _onBuildClick(typeId) {
    if (this._buildLocked) return;
    this._buildLocked = true;
    this._setBuildButtonsDisabled(true);
    try {
      const fn = this.handlers.onBuild;
      if (typeof fn === 'function') fn(typeId);
    } finally {
      this._buildLocked = false;
      // 真实可用状态会在下一次 _updateConstruction 中按 canBuild 重算
    }
  }

  _setBuildButtonsDisabled(disabled) {
    const cards = this.refs.build && this.refs.build.cards;
    if (!cards) return;
    Object.keys(cards).forEach((id) => { cards[id].btn.disabled = Boolean(disabled); });
  }

  /** 建筑效果的可读摘要（数据全部来自 config） */
  _effectSummary(def) {
    const parts = [];
    const eff = def.effects || {};
    if (eff.supplyPerSec) parts.push(`补给产量 +${eff.supplyPerSec}/s`);
    if (eff.alloyPerSec) parts.push(`合金产量 +${eff.alloyPerSec}/s`);
    if (eff.intelPerSec) parts.push(`情报产量 +${eff.intelPerSec}/s`);
    if (eff.supplyCap) parts.push(`补给上限 +${formatInt(eff.supplyCap)}`);
    if (eff.alloyCap) parts.push(`合金上限 +${formatInt(eff.alloyCap)}`);
    if (eff.intelCap) parts.push(`情报上限 +${formatInt(eff.intelCap)}`);
    if (eff.commandCapacity) parts.push(`指挥容量 +${eff.commandCapacity}`);
    if (eff.powerCapacity) parts.push(`电力输出 +${eff.powerCapacity}`);
    if (eff.scouting) parts.push(`侦察 +${eff.scouting}`);
    if (eff.ambushResist) parts.push(`伏击抵抗 +${Math.round(eff.ambushResist * 100)}%`);
    if (eff.intelAccuracy) parts.push('情报准确度提升');
    const unlocks = (def.unlocks || []).map((id) => (UNITS[id] ? UNITS[id].name : id));
    if (unlocks.length) parts.push(`解锁 ${unlocks.join('、')}（可生产）`);
    return parts.length ? parts.join('；') : '暂无直接数值加成';
  }

  /** 刷新建设页：工程进度 + 每张卡片的按钮状态与禁用原因 */
  _updateConstruction(state) {
    const b = this.refs.build;
    if (!b || !b.commandGrid) return;

    this._lastState = state;
    const current = buildCurrentConstructionModel(state);
    b.currentGrid.update(current ? [current] : []);
    b.currentEmpty.hidden = Boolean(current);
    b.currentRoot.hidden = !current;
    b.commandGrid.update(buildConstructionTileModels(state));
    return;

    const job = getConstructionProgress(state);
    const paused = safeNumber(state.time.speed, 1) === 0;

    // —— 工程状态区 ——
    if (job) {
      b.idleBox.hidden = true;
      b.activeBox.hidden = false;
      b.statusTag.textContent = paused ? '已暂停' : '施工中';
      b.statusTag.className = `tag ${paused ? 'warn' : 'ok'}`;
      setText(b.jobName, job.name);
      setText(b.jobStatus, paused ? '施工中（推演已暂停）' : '施工中');
      setText(b.jobElapsed, `${job.elapsedText} / 共 ${formatDuration(Math.ceil(job.duration))}`);
      setText(b.jobRemaining, job.remaining > 0 ? job.remainingText : '即将完成');
      b.jobBar.style.width = `${clamp(job.percent, 0, 100)}%`;
      setText(b.jobPercent, `${job.percent}%`);
      b.pausedHint.hidden = !paused;
      b.cancelBtn.disabled = false;
    } else {
      b.idleBox.hidden = false;
      b.activeBox.hidden = true;
      b.statusTag.textContent = '空闲';
      b.statusTag.className = 'tag';
      b.cancelBtn.disabled = true;
    }

    // —— 每张卡片 ——
    Object.keys(b.cards).forEach((typeId) => {
      const card = b.cards[typeId];
      const def = card.def;
      const inst = state.buildings.find((x) => x.type === typeId);
      const isBuilding = Boolean(inst && inst.status === BUILDING_STATUS.UNDER_CONSTRUCTION);
      const isBuilt = Boolean(inst && inst.status === BUILDING_STATUS.OPERATIONAL);
      const check = canBuild(state, typeId);

      // 状态徽标
      let statusText = CONSTRUCTION_UI.statusLabel.available;
      let statusClass = 'tag';
      if (isBuilt) { statusText = CONSTRUCTION_UI.statusLabel.built; statusClass = 'tag ok'; }
      else if (isBuilding) { statusText = CONSTRUCTION_UI.statusLabel.building; statusClass = 'tag warn'; }
      else if (!check.ok) { statusText = CONSTRUCTION_UI.statusLabel.locked; statusClass = 'tag'; }
      card.statusTag.textContent = statusText;
      card.statusTag.className = `bc-status ${statusClass}`;
      toggleClass(card.root, 'is-built', isBuilt);
      toggleClass(card.root, 'is-building', isBuilding);

      // 按钮文字与可用性
      let label = CONSTRUCTION_UI.buttonLabel.ready;
      if (isBuilt) label = CONSTRUCTION_UI.buttonLabel.built;
      else if (isBuilding) label = CONSTRUCTION_UI.buttonLabel.building;
      else if (check.code === 'busy') label = CONSTRUCTION_UI.buttonLabel.busy;
      else if (!check.ok) label = CONSTRUCTION_UI.buttonLabel.blocked;
      setText(card.btn, label);
      card.btn.disabled = !check.ok;

      // 禁用原因（已建成不算“原因”，不再刷屏）
      if (check.ok || isBuilt) {
        card.reason.hidden = true;
        setText(card.reason, '');
      } else {
        card.reason.hidden = false;
        setText(card.reason, check.reasons.join('；'));
      }

      // 成本缺料高亮
      Object.keys(card.chips).forEach((key) => {
        const need = safeNumber(def.cost[key], 0);
        const have = safeNumber(state.resources[key], 0);
        toggleClass(card.chips[key], 'lack', !isBuilt && !isBuilding && have < need);
      });
    });
  }

  /* ==========================================================
   * 生产页（阶段3）
   * ======================================================== */

  /** 单位类别 → 中文标签 */
  _categoryLabel(category) {
    return { infantry: '步兵', vehicle: '车辆', armor: '装甲', support: '支援' }[category] || category || '单位';
  }

  /** 构建生产分页：当前生产线 + 等待队列 + 单位卡片 + 单位库存 */
  _buildProductionPage(page) {
    const r = this.refs;
    r.prod = {};

    const queueHead = el('div', 'command-section-head');
    queueHead.appendChild(el('span', '', 'QUEUE'));
    queueHead.appendChild(el('small', '', `0 / ${PRODUCTION.maxQueueSize}`));
    r.prod.queueCount = queueHead.lastChild;
    page.appendChild(queueHead);
    r.prod.queueEmpty = el('div', 'command-empty', '生产队列空闲');
    page.appendChild(r.prod.queueEmpty);
    r.prod.queueRoot = el('div', 'command-grid command-queue');
    r.prod.queueRoot.dataset.commandScope = 'production-queue';
    page.appendChild(r.prod.queueRoot);
    r.prod.queueGrid = this.commandSurface.createQueue(r.prod.queueRoot, (model) => this._onCommandPrimary(model));

    r.prod.categoryRoot = el('div', 'command-category');
    page.appendChild(r.prod.categoryRoot);
    r.prod.categoryBar = new CategoryBar(r.prod.categoryRoot, [
      { id: 'units', label: 'UNITS' },
      { id: 'equipment', label: 'EQUIPMENT' }
    ], (id) => this._setCommandCategory(id));

    r.prod.unitsSection = el('section', 'command-category-panel');
    r.prod.unitsSection.dataset.commandCategoryPanel = 'units';
    const unitHead = el('div', 'command-section-head');
    unitHead.appendChild(el('span', '', 'UNITS'));
    unitHead.appendChild(el('small', '', '点击入队'));
    r.prod.unitsSection.appendChild(unitHead);
    r.prod.unitsRoot = el('div', 'command-grid');
    r.prod.unitsRoot.dataset.commandScope = 'unit-production';
    r.prod.unitsSection.appendChild(r.prod.unitsRoot);
    r.prod.unitGrid = this.commandSurface.createGrid(r.prod.unitsRoot, (model) => this._onCommandPrimary(model));
    page.appendChild(r.prod.unitsSection);

    r.prod.equipmentSection = el('section', 'command-category-panel');
    r.prod.equipmentSection.dataset.commandCategoryPanel = 'equipment';
    const commandEquipmentHead = el('div', 'command-section-head');
    commandEquipmentHead.appendChild(el('span', '', 'EQUIPMENT'));
    commandEquipmentHead.appendChild(el('small', '', '点击入队'));
    r.prod.equipmentSection.appendChild(commandEquipmentHead);
    r.prod.equipmentRoot = el('div', 'command-grid');
    r.prod.equipmentRoot.dataset.commandScope = 'equipment-production';
    r.prod.equipmentSection.appendChild(r.prod.equipmentRoot);
    r.prod.equipmentGrid = this.commandSurface.createGrid(r.prod.equipmentRoot, (model) => this._onCommandPrimary(model));
    page.appendChild(r.prod.equipmentSection);
    page.appendChild(el('div', 'command-gesture-hint', '点击生产 · 悬浮快览 · 长按详情'));
    this._setCommandCategory(this.commandCategory);
    return;

    // —— 当前生产线 ——
    const line = el('div', 'card prod-line');
    const lineHead = el('div', 'card-head');
    lineHead.appendChild(el('span', '', '当前生产线'));
    r.prod.statusTag = el('span', 'tag', '空闲');
    lineHead.appendChild(r.prod.statusTag);
    line.appendChild(lineHead);

    // 空闲态
    r.prod.idleBox = el('div', 'cs-idle');
    r.prod.idleBox.appendChild(el('div', 'cs-idle-title', PRODUCTION_UI.idleTitle));
    r.prod.idleBox.appendChild(el('div', 'cs-idle-hint', PRODUCTION_UI.idleHint));
    line.appendChild(r.prod.idleBox);

    // 生产中态
    const active = el('div', 'cs-active');
    active.hidden = true;
    r.prod.activeBox = active;
    r.prod.lineName = el('div', 'cs-name', '——');
    active.appendChild(r.prod.lineName);

    const mkRow = (label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '——');
      row.appendChild(v);
      active.appendChild(row);
      return v;
    };
    r.prod.lineSource = mkRow('生产设施');
    r.prod.lineStatus = mkRow('状态');
    r.prod.lineElapsed = mkRow('已用时间');
    r.prod.lineTotal = mkRow('总生产时间');
    r.prod.lineRemaining = mkRow('预计剩余');

    const barWrap = el('div', 'cs-bar-wrap');
    const bar = el('div', 'bar build');
    r.prod.lineBar = el('i');
    bar.appendChild(r.prod.lineBar);
    barWrap.appendChild(bar);
    r.prod.linePercent = el('span', 'cs-pct', '0%');
    barWrap.appendChild(r.prod.linePercent);
    active.appendChild(barWrap);

    r.prod.pausedHint = el('div', 'cs-paused', PRODUCTION_UI.pausedHint);
    r.prod.pausedHint.hidden = true;
    active.appendChild(r.prod.pausedHint);

    r.prod.cancelBtn = el('button', 'btn danger cs-cancel', '取消当前项目');
    r.prod.cancelBtn.type = 'button';
    r.prod.cancelBtn.dataset.action = 'cancel-production-current';
    r.prod.cancelBtn.addEventListener('click', () => {
      const fn = this.handlers.onCancelCurrentProduction;
      if (typeof fn === 'function') fn();
    });
    active.appendChild(r.prod.cancelBtn);

    line.appendChild(active);
    page.appendChild(line);

    // —— 等待队列 ——
    const qHead = el('div', 'section-head');
    qHead.appendChild(el('span', '', PRODUCTION_UI.queueHead));
    qHead.appendChild(el('span', 'tag', `最多 ${PRODUCTION.maxQueueSize} 项（含当前）`));
    page.appendChild(qHead);
    r.prod.queueList = el('div', 'queue-list');
    page.appendChild(r.prod.queueList);
    r.prod.queueEmpty = el('div', 'hint', '队列为空，可同时排队多项生产。');
    page.appendChild(r.prod.queueEmpty);

    // —— 单位卡片 ——
    const uHead = el('div', 'section-head');
    uHead.appendChild(el('span', '', '可生产单位'));
    page.appendChild(uHead);
    const grid = el('div', 'unit-grid');
    Object.values(UNITS).forEach((def) => {
      const card = this._renderUnitCard(def);
      grid.appendChild(card.root);
      r.prod.cards[def.id] = card;
    });
    page.appendChild(grid);

    // —— 装备制造卡片：仍然使用共享生产队列，UI 只读取权威资格结果 ——
    const equipmentHead = el('div', 'section-head');
    equipmentHead.appendChild(el('span', '', '装备制造'));
    equipmentHead.appendChild(el('span', 'tag', '装甲工厂生产'));
    page.appendChild(equipmentHead);
    const equipmentGrid = el('div', 'unit-grid equipment-production-grid');
    Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production').forEach((def) => {
      const card = this._renderEquipmentProductionCard(def);
      equipmentGrid.appendChild(card.root);
      r.prod.equipmentCards[def.id] = card;
    });
    page.appendChild(equipmentGrid);

    // —— 单位库存 ——
    const iHead = el('div', 'section-head');
    iHead.appendChild(el('span', '', PRODUCTION_UI.inventoryHead));
    page.appendChild(iHead);
    const inv = el('div', 'card inv-card');
    const mkInv = (label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '0');
      row.appendChild(v);
      inv.appendChild(row);
      return v;
    };
    r.prod.invTotal = mkInv('库存总单位');
    r.prod.invIdle = mkInv('空闲单位');
    r.prod.invAssigned = mkInv('已编入编队');
    r.prod.invRepairing = mkInv('维修中');
    const invList = el('div', 'inv-list');
    r.prod.invList = invList;
    inv.appendChild(invList);
    page.appendChild(inv);

    const note = el('div', 'hint');
    note.innerHTML = `<b>说明：</b>同时只生产 1 个单位，当前生产 + 等待队列最多 ${PRODUCTION.maxQueueSize} 项。`
      + `取消正在生产的单位返还 ${Math.round(PRODUCTION.activeCancelRefundRatio * 100)}% 成本，`
      + '取消等待任务返还 100% 成本。库存单位不占用指挥容量，只有编入作战编队后才会占用。';
    page.appendChild(note);
  }

  /** 单张单位卡片（只建结构，文字由 _updateProduction 刷新） */
  _renderUnitCard(def) {
    const root = el('article', 'unit-card');
    root.dataset.type = def.id;

    const head = el('div', 'bc-head');
    head.appendChild(el('span', 'bc-name', def.name));
    const catTag = el('span', 'bc-status tag', this._categoryLabel(def.category));
    head.appendChild(catTag);
    root.appendChild(head);

    root.appendChild(el('p', 'bc-desc', def.desc || ''));

    const grid = el('div', 'bc-grid');
    const mkCell = (label, value) => {
      const cell = el('div', 'bc-cell');
      cell.appendChild(el('b', '', label));
      cell.appendChild(el('span', '', String(value)));
      grid.appendChild(cell);
    };
    const producer = BUILDINGS[def.from] ? BUILDINGS[def.from].name : def.from;
    mkCell('来源建筑', producer);
    mkCell('生产时间', `${formatInt(def.buildTime)} 秒`);
    const st = def.stats || {};
    const dash = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : '—';
    mkCell('攻击', dash(st.attack));
    mkCell('反装甲', dash(st.antiArmor));
    mkCell('防御', dash(st.defense));
    mkCell('侦察', dash(st.scouting));
    mkCell('机动', dash(st.mobility));
    mkCell('维修', dash(st.repair));
    mkCell('生命值', dash(st.hp));
    mkCell('任务补给消耗', dash(def.upkeep));
    mkCell('指挥占用', dash(def.command));
    root.appendChild(grid);

    // 生产成本（缺料时高亮）
    const costBox = el('div', 'bc-cost');
    costBox.appendChild(el('b', '', '生产成本'));
    const chips = {};
    Object.keys(def.cost || {}).forEach((key) => {
      const amount = safeNumber(def.cost[key], 0);
      if (amount <= 0) return;
      const resDef = RESOURCE_DEFS[key];
      const chip = el('span', 'cost-chip', `${resDef ? resDef.name : key} ${formatInt(amount)}`);
      chip.dataset.res = key;
      costBox.appendChild(chip);
      chips[key] = chip;
    });
    if (!Object.keys(chips).length) costBox.appendChild(el('span', 'cost-chip', '免费'));
    root.appendChild(costBox);

    // 当前库存数量
    const inv = el('div', 'uc-inv');
    inv.appendChild(el('b', '', '当前库存'));
    const invCount = el('span', 'uc-inv-count', '0');
    inv.appendChild(invCount);
    root.appendChild(inv);

    // 操作
    const verb = def.category === 'infantry' ? PRODUCTION_UI.buttonLabel.train : PRODUCTION_UI.buttonLabel.manufacture;
    const btn = el('button', 'btn primary unit-btn', verb);
    btn.type = 'button';
    btn.dataset.type = def.id;
    btn.dataset.action = 'produce';
    btn.dataset.unitType = def.id;
    btn.addEventListener('click', () => this._onProduceClick(def.id));
    root.appendChild(btn);

    const reason = el('div', 'bc-reason');
    reason.hidden = true;
    root.appendChild(reason);

    return { root, btn, reason, chips, invCount, def };
  }

  _renderEquipmentProductionCard(def) {
    const root = el('article', 'unit-card equipment-card');
    root.dataset.equipmentId = def.id;
    const head = el('div', 'bc-head');
    head.appendChild(el('span', 'bc-name', def.name));
    const tag = el('span', 'bc-status tag', def.slot || '装备');
    head.appendChild(tag); root.appendChild(head);
    root.appendChild(el('p', 'bc-desc', def.desc || ''));
    const grid = el('div', 'bc-grid');
    const applicable = Array.isArray(def.applicableTypes) ? def.applicableTypes.map((id) => UNITS[id]?.name || id).join('、') : '—';
    [['适用单位', applicable], ['制造时间', `${formatInt(def.acquisition?.buildTime || 0)} 秒`], ['科研前置', def.requiresTech ? (TECHNOLOGIES[def.requiresTech]?.name || def.requiresTech) : '无']]
      .forEach(([label, value]) => { const cell = el('div', 'bc-cell'); cell.appendChild(el('b', '', label)); cell.appendChild(el('span', '', value)); grid.appendChild(cell); });
    root.appendChild(grid);
    const costBox = el('div', 'bc-cost'); costBox.appendChild(el('b', '', '制造成本'));
    const chips = {};
    Object.keys(def.acquisition?.cost || {}).forEach((key) => {
      const chip = el('span', 'cost-chip', `${RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key} ${formatInt(def.acquisition.cost[key])}`);
      chip.dataset.res = key; chips[key] = chip; costBox.appendChild(chip);
    });
    root.appendChild(costBox);
    const inv = el('div', 'uc-inv'); inv.appendChild(el('b', '', '库存实例')); const invCount = el('span', 'uc-inv-count', '0'); inv.appendChild(invCount); root.appendChild(inv);
    const btn = el('button', 'btn primary equipment-btn', '加入制造队列');
    btn.type = 'button'; btn.dataset.action = 'produce-equipment'; btn.dataset.equipmentId = def.id;
    btn.addEventListener('click', () => this._onEquipmentProduceClick(def.id));
    root.appendChild(btn);
    const reason = el('div', 'bc-reason'); reason.hidden = true; root.appendChild(reason);
    return { root, btn, reason, chips, invCount, def };
  }

  /** 生产按钮点击：临时锁按钮，避免连点重复扣费 */
  _onProduceClick(typeId) {
    if (this._produceLocked) return;
    this._produceLocked = true;
    try {
      const fn = this.handlers.onProduce;
      if (typeof fn === 'function') fn(typeId);
    } finally {
      this._produceLocked = false;
    }
  }

  _onEquipmentProduceClick(equipmentId) {
    if (this._equipmentProduceLocked) return;
    this._equipmentProduceLocked = true;
    try {
      if (this.handlers.onProduceEquipment) this.handlers.onProduceEquipment(equipmentId);
    } finally {
      this._equipmentProduceLocked = false;
    }
  }

  /** 渲染等待队列中的一项 */
  _renderQueueItem(job, index, state) {
    const def = job.kind === 'equipment' ? getEquipmentDefinition(job.equipmentId) : UNITS[job.type];
    const item = el('div', 'queue-item');
    item.dataset.jobId = job.id;

    const title = el('div', 'qi-title');
    title.appendChild(el('span', 'qi-idx', `${index}.`));
    title.appendChild(el('span', 'qi-name', def ? def.name : '未知项目'));
    item.appendChild(title);

    const meta = el('div', 'qi-meta');
    const producer = (state.buildings || []).find((b) => b.id === job.sourceBuildingId);
    const pname = producer ? (BUILDINGS[producer.type] ? BUILDINGS[producer.type].name : '生产设施') : '生产设施';
    meta.appendChild(el('span', '', `来源：${pname}`));
    const duration = job.kind === 'equipment' ? def?.acquisition?.buildTime : def?.buildTime;
    meta.appendChild(el('span', '', `时间：${formatInt(duration || 0)}秒`));
    const paid = Object.keys(job.costPaid || {})
      .filter((k) => safeNumber(job.costPaid[k], 0) > 0)
      .map((k) => `${RESOURCE_DEFS[k] ? RESOURCE_DEFS[k].name : k}${formatInt(job.costPaid[k])}`)
      .join(' · ');
    meta.appendChild(el('span', '', `已支付：${paid || '无'}`));
    item.appendChild(meta);

    const cancel = el('button', 'btn tiny danger qi-cancel', '移除');
    cancel.type = 'button';
    cancel.dataset.jobId = job.id;
    cancel.dataset.action = 'cancel-production-queue';
    if (job.kind === 'equipment') cancel.dataset.equipmentId = job.equipmentId;
    cancel.addEventListener('click', () => {
      const fn = this.handlers.onCancelQueuedProduction;
      if (typeof fn === 'function') fn(job.id);
    });
    item.appendChild(cancel);
    return item;
  }

  /** 刷新生产页：当前生产线 + 等待队列 + 单位卡片 + 库存统计 */
  _updateProduction(state) {
    const p = this.refs.prod;
    if (!p || !p.unitGrid) return;

    this._lastState = state;
    const queueModels = buildProductionQueueModels(state);
    p.queueGrid.update(queueModels);
    p.queueEmpty.hidden = queueModels.length > 0;
    p.queueRoot.hidden = queueModels.length === 0;
    setText(p.queueCount, `${queueModels.length} / ${PRODUCTION.maxQueueSize}`);
    p.unitGrid.update(buildUnitProductionTileModels(state));
    p.equipmentGrid.update(buildEquipmentProductionTileModels(state));
    this._setCommandCategory(this.commandCategory);
    return;

    const progress = getProductionProgress(state);
    const paused = safeNumber(state.time.speed, 1) === 0;

    // —— 当前生产线 ——
    if (progress) {
      p.idleBox.hidden = true;
      p.activeBox.hidden = false;
      p.statusTag.textContent = paused ? '已暂停' : '生产中';
      p.statusTag.className = `tag ${paused ? 'warn' : 'ok'}`;
      setText(p.lineName, `当前项目：${progress.name}`);
      setText(p.lineSource, progress.sourceBuildingName);
      setText(p.lineStatus, paused ? '生产中（推演已暂停）' : '生产中');
      setText(p.lineElapsed, progress.elapsedText);
      setText(p.lineTotal, formatDuration(Math.ceil(progress.duration)));
      setText(p.lineRemaining, progress.remaining > 0 ? progress.remainingText : '即将完成');
      p.lineBar.style.width = `${clamp(progress.percent, 0, 100)}%`;
      setText(p.linePercent, `${progress.percent}%`);
      p.pausedHint.hidden = !paused;
      p.cancelBtn.disabled = false;
    } else {
      p.idleBox.hidden = false;
      p.activeBox.hidden = true;
      p.statusTag.textContent = '空闲';
      p.statusTag.className = 'tag';
      p.cancelBtn.disabled = true;
    }

    // —— 等待队列（最多显示 4 项）——
    const queue = (state.production && state.production.queue) || [];
    const sig = queue.map((j) => j.id).join('|');
    if (sig !== p.queueSig) {
      p.queueSig = sig;
      p.queueList.innerHTML = '';
      const shown = queue.slice(0, 4);
      shown.forEach((job, i) => {
        p.queueList.appendChild(this._renderQueueItem(job, i + 1, state));
      });
    }
    p.queueEmpty.hidden = queue.length > 0;

    // —— 单位卡片：按钮状态、禁用原因、库存数量、缺料高亮 ——
    const counts = inventoryCount(state);
    Object.keys(p.cards).forEach((typeId) => {
      const card = p.cards[typeId];
      const def = card.def;
      const check = canQueueUnit(state, typeId);
      const inv = safeNumber(counts[typeId], 0);
      setText(card.invCount, String(inv));

      let label = def.category === 'infantry' ? PRODUCTION_UI.buttonLabel.train : PRODUCTION_UI.buttonLabel.manufacture;
      if (state.production && state.production.current && state.production.current.type === typeId) {
        label = PRODUCTION_UI.buttonLabel.producing;
      }
      setText(card.btn, label);
      card.btn.disabled = !check.ok;

      if (check.ok) {
        card.reason.hidden = true;
        setText(card.reason, '');
      } else {
        card.reason.hidden = false;
        setText(card.reason, check.reasons.join('；'));
      }

      Object.keys(card.chips).forEach((key) => {
        const need = safeNumber(def.cost[key], 0);
        const have = safeNumber(state.resources[key], 0);
        toggleClass(card.chips[key], 'lack', have < need);
      });
    });

    // —— 装备制造卡片：库存只按已完成实例统计，生产中任务不会提前进入库存 ——
    const equipmentCounts = equipmentInventoryCounts(state.equipment);
    Object.keys(p.equipmentCards || {}).forEach((equipmentId) => {
      const card = p.equipmentCards[equipmentId];
      const def = card.def;
      const check = canQueueEquipment(state, equipmentId);
      setText(card.invCount, String(safeNumber(equipmentCounts[equipmentId], 0)));
      const current = state.production?.current;
      setText(card.btn, current?.kind === 'equipment' && current.equipmentId === equipmentId ? '制造中' : '加入制造队列');
      card.btn.disabled = !check.ok;
      card.reason.hidden = check.ok;
      setText(card.reason, check.ok ? '' : (check.reasons || [check.reason]).join('；'));
      Object.keys(card.chips).forEach((key) => {
        toggleClass(card.chips[key], 'lack', safeNumber(state.resources?.[key], 0) < safeNumber(def.acquisition.cost[key], 0));
      });
    });

    // —— 库存统计 ——
    const units = state.units || [];
    setText(p.invTotal, String(units.length));
    const idle = units.filter((u) => !u.formationId && u.status === 'ready').length;
    const assigned = units.filter((u) => u.formationId).length;
    const repairing = units.filter((u) => u.status === 'repairing').length;
    setText(p.invIdle, String(idle));
    setText(p.invAssigned, String(assigned));
    setText(p.invRepairing, String(repairing));

    const listSig = `${units.map((u) => `${u.type}:${counts[u.type]}`).join('|')}|equipment:${JSON.stringify(state.equipment || {})}`;
    if (listSig !== p._invListSig) {
      p._invListSig = listSig;
      p.invList.innerHTML = '';
      Object.keys(UNITS).forEach((typeId) => {
        const def = UNITS[typeId];
        const n = safeNumber(counts[typeId], 0);
        const row = el('div', 'inv-row');
        row.appendChild(el('span', 'inv-name', def ? def.name : typeId));
        row.appendChild(el('span', 'inv-num', `× ${n}`));
        p.invList.appendChild(row);
      });
    }
  }

  /** 生产状态变化后由 main.js 立即调用一次，避免等待下一次节流刷新 */
  refreshProduction(state) {
    this._updateProduction(state);
    this._updateUnits(state);
    this._updateResources(state);
    this._updateOverview(state);
  }

  /* ==========================================================
   * 部队档案页（阶段8）
   * ======================================================== */

  _buildUnitsPage(page) {
    const r = this.refs;
    r.units = { selectedId: null, filter: 'all', status: 'all', rank: 'all', sort: 'createdAt', equipmentSignature: '', detailUnitId: null };

    /* Stage 10-P-B：portrait roster grid + 按需展开的 Inspector */
    const controls = el('div', 'units-controls command-filter-row');
    const mkSelect = (label, options, key) => {
      const wrap = el('label', 'units-filter');
      wrap.appendChild(el('span', '', label));
      const select = el('select');
      options.forEach(([value, text]) => { const opt = el('option', '', text); opt.value = value; select.appendChild(opt); });
      select.addEventListener('change', () => { r.units[key] = select.value; this._updateUnits(this._lastState); });
      wrap.appendChild(select);
      return select;
    };
    r.units.categorySelect = mkSelect('类型', [['all', '全部类型'], ['infantry', '步兵'], ['vehicle', '车辆'], ['armor', '装甲'], ['support', '支援']], 'filter');
    r.units.statusSelect = mkSelect('状态', [['all', '全部状态'], ['ready', '空闲'], ['assigned', '已编队'], ['repairing', '维修中'], ['damaged', '受损']], 'status');
    r.units.rankSelect = mkSelect('等级', [['all', '全部等级'], ...Object.values(UNIT_RANKS).map((rank) => [rank.id, rank.name])], 'rank');
    r.units.sortSelect = mkSelect('排序', [['createdAt', '创建时间'], ['experience', '经验'], ['battles', '战斗次数'], ['hpRatio', '生命比例'], ['type', '单位类型']], 'sort');
    controls.append(r.units.categorySelect.parentNode, r.units.statusSelect.parentNode, r.units.rankSelect.parentNode, r.units.sortSelect.parentNode);
    page.appendChild(controls);

    const head = el('div', 'command-section-head');
    head.appendChild(el('span', '', 'ROSTER'));
    r.units.headTag = el('small', '', '0 个单位');
    head.appendChild(r.units.headTag);
    page.appendChild(head);
    r.units.empty = el('div', 'command-empty', '尚无单位，前往「生产」分页训练或制造');
    page.appendChild(r.units.empty);
    r.units.gridRoot = el('div', 'command-grid command-roster-grid');
    r.units.gridRoot.dataset.commandScope = 'units';
    page.appendChild(r.units.gridRoot);
    r.units.grid = this.commandSurface.createGrid(r.units.gridRoot, () => {});
    page.appendChild(el('div', 'command-gesture-hint', '点击查看档案 · 悬浮快览 · 长按详情'));
    return;
    {
    const summary = el('div', 'card units-summary');
    r.units.summary = el('div', 'units-summary-grid');
    summary.appendChild(r.units.summary);
    page.appendChild(summary);

    const controls = el('div', 'card units-controls');
    const mkSelect = (label, options, key) => {
      const wrap = el('label', 'units-filter');
      wrap.appendChild(el('span', '', label));
      const select = el('select');
      options.forEach(([value, text]) => { const opt = el('option', '', text); opt.value = value; select.appendChild(opt); });
      select.addEventListener('change', () => { r.units[key] = select.value; r.units.sig = ''; this._updateUnits(this._lastState); });
      wrap.appendChild(select);
      return select;
    };
    r.units.categorySelect = mkSelect('类型', [['all', '全部类型'], ['infantry', '步兵'], ['vehicle', '车辆'], ['armor', '装甲'], ['support', '支援']], 'filter');
    r.units.statusSelect = mkSelect('状态', [['all', '全部状态'], ['ready', '空闲'], ['assigned', '已编队'], ['repairing', '维修中'], ['damaged', '受损']], 'status');
    r.units.rankSelect = mkSelect('等级', [['all', '全部等级'], ...Object.values(UNIT_RANKS).map((rank) => [rank.id, rank.name])], 'rank');
    r.units.sortSelect = mkSelect('排序', [['createdAt', '创建时间'], ['experience', '经验'], ['battles', '战斗次数'], ['hpRatio', '生命比例'], ['type', '单位类型']], 'sort');
    controls.appendChild(r.units.categorySelect.parentNode);
    controls.appendChild(r.units.statusSelect.parentNode);
    controls.appendChild(r.units.rankSelect.parentNode);
    controls.appendChild(r.units.sortSelect.parentNode);
    page.appendChild(controls);

    const columns = el('div', 'units-layout');
    r.units.list = el('div', 'card units-list');
    r.units.detail = el('div', 'card units-detail');
    columns.appendChild(r.units.list);
    columns.appendChild(r.units.detail);
    page.appendChild(columns);
    }
  }

  _renderUnitSummary(state) {
    const units = Array.isArray(state.units) ? state.units : [];
    const counts = { total: units.length, ready: 0, assigned: 0, repairing: 0, light: 0, heavy: 0, recruit: 0, trained: 0, veteran: 0, elite: 0 };
    units.forEach((unit) => { if (counts[unit.status] !== undefined) counts[unit.status] += 1; const damage = damageStateOfUnit(unit); if (counts[damage] !== undefined) counts[damage] += 1; const rank = getUnitRank(unit).id; if (counts[rank] !== undefined) counts[rank] += 1; });
    return counts;
  }

  _updateUnits(state) {
    this._lastState = state;
    const r = this.refs.units;
    if (!r) return;
    if (r.grid) {
      /* Presentation adapter：只把过滤排序后的单位视图交给只读 builder（浅克隆，不改 canonical state） */
      r.categorySelect.value = r.filter; r.statusSelect.value = r.status; r.rankSelect.value = r.rank; r.sortSelect.value = r.sort;
      const list = sortUnits(filterUnits(state, { category: r.filter, status: r.status, rankId: r.rank }), r.sort);
      const models = buildUnitRosterModels({ ...state, units: list });
      r.grid.update(models);
      r.empty.hidden = models.length > 0;
      r.headTag.textContent = `${models.length} 个单位`;
      return;
    }
    if (!r.list) return;
    const counts = this._renderUnitSummary(state);
    r.summary.innerHTML = '';
    [['单位总数', counts.total], ['空闲单位', counts.ready], ['已编队单位', counts.assigned], ['维修中单位', counts.repairing], ['轻度受损', counts.light], ['重度受损', counts.heavy], ['新兵', counts.recruit], ['训练有素', counts.trained], ['老兵', counts.veteran], ['精锐', counts.elite]].forEach(([label, value]) => {
      const cell = el('div', 'units-summary-cell'); cell.appendChild(el('b', '', String(value))); cell.appendChild(el('span', '', label)); r.summary.appendChild(cell);
    });
    r.categorySelect.value = r.filter; r.statusSelect.value = r.status; r.rankSelect.value = r.rank; r.sortSelect.value = r.sort;
    const list = sortUnits(filterUnits(state, { category: r.filter, status: r.status, rankId: r.rank }), r.sort);
    r.list.innerHTML = '';
    const head = el('div', 'card-head'); head.appendChild(el('span', '', '单位列表')); head.appendChild(el('span', 'tag', `${list.length} 个`)); r.list.appendChild(head);
    if (!list.length) r.list.appendChild(el('div', 'hint', '没有符合筛选条件的单位。'));
    list.forEach((unit) => {
      const row = el('button', 'unit-row'); row.type = 'button'; row.dataset.unitId = unit.id;
      const rank = getUnitRank(unit); const damage = damageStateOfUnit(unit); const def = UNITS[unit.type];
      row.appendChild(el('span', 'unit-row-name', formatUnitDisplayName(unit)));
      row.appendChild(el('span', 'tag', `${rank.name} · ${def ? def.name : unit.type}`));
      row.appendChild(el('span', 'unit-row-meta', `经验 ${formatInt(unit.experience)} · 战斗 ${unit.battles} · HP ${Math.round(unit.hp)}/${Math.round(unit.maxHp)} · ${damage}`));
      row.classList.toggle('is-active', unit.id === r.selectedId);
      row.addEventListener('click', () => { r.selectedId = unit.id; this._updateUnits(state); });
      r.list.appendChild(row);
    });
    const selected = list.find((unit) => unit.id === r.selectedId) || list[0] || null;
    r.selectedId = selected ? selected.id : null;
    const equipmentSignature = JSON.stringify({
      equipment: state.equipment || null,
      battle: state.activeBattle ? {
        id: state.activeBattle.id || null,
        replayReadOnly: state.activeBattle.replayReadOnly === true,
        settled: state.activeBattle.settled === true
      } : null
    });
    if (r.equipmentSignature !== equipmentSignature || r.detailUnitId !== (selected && selected.id)) {
      r.equipmentSignature = equipmentSignature;
      this._renderUnitDetail(state, selected);
    }
  }

  _renderUnitDetail(state, unit) {
    const box = this.refs.units && this.refs.units.detail;
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'card-head', '单位详情'));
    if (!unit) { box.appendChild(el('div', 'hint', '选择一个单位查看详情。')); return; }
    const def = UNITS[unit.type]; const rank = getUnitRank(unit); const progress = getRankProgress(unit); const stats = getUnitEffectiveStats(unit, state.equipment);
    const name = el('div', 'unit-detail-title'); name.appendChild(el('b', '', formatUnitDisplayName(unit))); name.appendChild(el('span', 'tag ok', rank.name)); box.appendChild(name);
    const callsign = el('input', 'unit-callsign'); callsign.type = 'text'; callsign.maxLength = 12; callsign.value = unit.callsign || ''; callsign.placeholder = '输入呼号（最多12字）';
    const rename = el('button', 'btn primary small', '保存呼号'); rename.type = 'button'; rename.addEventListener('click', () => this.handlers.onRenameUnit && this.handlers.onRenameUnit(unit.id, callsign.value));
    const callRow = el('div', 'unit-call-row'); callRow.appendChild(callsign); callRow.appendChild(rename); box.appendChild(callRow);
    [['单位类型', def ? def.name : unit.type], ['创建时间', formatWallClock(unit.createdAt)], ['来源建筑', def && def.from && BUILDINGS[def.from] ? BUILDINGS[def.from].name : '未知'], ['经验', formatInt(unit.experience)], ['战斗次数', String(unit.battles)], ['生命', `${Math.round(unit.hp)} / ${Math.round(unit.maxHp)}`], ['损伤', damageStateOfUnit(unit)], ['等级进度', progress.nextRankName ? `距${progress.nextRankName}还需 ${progress.remaining}` : '已达最高等级']].forEach(([label, value]) => { const row = el('div', 'kv'); row.appendChild(el('span', '', label)); row.appendChild(el('span', '', value)); box.appendChild(row); });
    const bar = el('div', 'bar unit-rank'); const fill = el('i'); fill.style.width = `${progress.percent}%`; bar.appendChild(fill); box.appendChild(bar);
    const statHead = el('div', 'section-head sub'); statHead.appendChild(el('span', '', '战斗中实际属性')); box.appendChild(statHead);
    ['attack', 'antiArmor', 'defense', 'scouting', 'mobility', 'repair'].forEach((key) => { const row = el('div', 'kv'); row.appendChild(el('span', '', key)); row.appendChild(el('span', '', `${stats[key]}（基础 ${def.stats[key]}）`)); box.appendChild(row); });

    const equipmentHead = el('div', 'section-head sub');
    equipmentHead.appendChild(el('span', '', `装备槽位（${(stats.equipment || []).length}/${EQUIPMENT_RULES.maxSlotsPerUnit}）`));
    box.appendChild(equipmentHead);
    const equipped = getUnitEquipment(state.equipment, unit.id);
    if (!equipped.length) box.appendChild(el('div', 'hint', '当前没有挂载装备。'));
    equipped.forEach((item) => {
      const row = el('div', 'kv equipment-row');
      row.appendChild(el('span', '', `${item.name} · 槽位${item.slotIndex + 1}`));
      const remove = el('button', 'btn small', '卸载');
      remove.type = 'button'; remove.dataset.action = 'unequip-equipment'; remove.dataset.unitId = unit.id; remove.dataset.equipmentInstanceId = item.instanceId;
      remove.addEventListener('click', () => this.handlers.onUnequipEquipment && this.handlers.onUnequipEquipment(unit.id, item.instanceId));
      row.appendChild(remove); box.appendChild(row);
    });

    const available = Array.isArray(state.equipment?.inventory) ? state.equipment.inventory : [];
    const mountedIds = new Set(equipped.map((item) => item.instanceId));
    available.filter((instance) => !mountedIds.has(instance.id)).forEach((instance) => {
      const equipmentDef = getEquipmentDefinition(instance.equipmentId);
      if (!equipmentDef) return;
      const check = canEquipEquipment(state, unit.id, instance.id);
      const provenance = instance.provenance?.kind === 'battle_salvage'
        ? `战场回收${instance.provenance.theaterId ? ` · ${THEATERS[instance.provenance.theaterId]?.name || instance.provenance.theaterId}` : ''}`
        : instance.provenance?.kind === 'production' ? '装甲工厂生产' : '初始配发';
      const row = el('div', 'kv equipment-row');
      row.appendChild(el('span', '', `${equipmentDef.name} · ${provenance} · ${instance.id}`));
      const mount = el('button', 'btn primary small', '挂载');
      mount.type = 'button'; mount.dataset.action = 'equip-equipment'; mount.dataset.unitId = unit.id; mount.dataset.equipmentInstanceId = instance.id; mount.disabled = !check.ok;
      mount.title = check.ok ? equipmentDef.desc : check.reason;
      mount.addEventListener('click', () => this.handlers.onEquipEquipment && this.handlers.onEquipEquipment(unit.id, instance.id));
      row.appendChild(mount); box.appendChild(row);
    });
    this.refs.units.detailUnitId = unit.id;
  }

  /* ==========================================================
   * 编队页（阶段4）
   * ======================================================== */

  /**
   * 构建编队分页：
   *   指挥容量概览 → 快速组建（空编队 + 3 套预设） → 编队列表
   *   → 编队详情（重命名 / 解散 / 汇总属性 / 评估提示 / 成员 / 可加入单位）
   * 只搭结构，所有文字与禁用状态由 _updateFormations 刷新。
   */
  _buildFormationPage(page) {
    const r = this.refs;
    r.fm = { presetCards: {}, sig: {} };

    /* Stage 10-P-B：紧凑编队 Tile + Inspector 管理操作 */
    const cap = el('div', 'command-section-head fm-cap-head');
    cap.appendChild(el('span', '', 'FORMATIONS'));
    r.fm.capTag = el('small', '', '—');
    cap.appendChild(r.fm.capTag);
    page.appendChild(cap);

    r.fm.listEmpty = el('div', 'command-empty', '尚无编队');
    r.fm.listEmpty.hidden = true;
    page.appendChild(r.fm.listEmpty);
    r.fm.gridRoot = el('div', 'command-grid command-formation-grid');
    r.fm.gridRoot.dataset.commandScope = 'formations';
    page.appendChild(r.fm.gridRoot);
    r.fm.grid = this.commandSurface.createGrid(r.fm.gridRoot, () => {});
    page.appendChild(el('div', 'command-gesture-hint', '点击查看编队与管理操作 · 悬浮快览 · 长按详情'));
    return;
    {
    // —— 指挥容量概览 ——
    const cap = el('div', 'card fm-capacity');
    const capHead = el('div', 'card-head');
    capHead.appendChild(el('span', '', '指挥容量'));
    r.fm.capTag = el('span', 'tag ok', '充足');
    capHead.appendChild(r.fm.capTag);
    cap.appendChild(capHead);

    const mkKv = (parent, label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '—');
      row.appendChild(v);
      parent.appendChild(row);
      return v;
    };
    r.fm.capUsed = mkKv(cap, '已占用 / 总容量');
    r.fm.capFree = mkKv(cap, '剩余可编入');
    r.fm.capCount = mkKv(cap, '编队数量');
    const capBar = el('div', 'bar command');
    r.fm.capBar = el('i');
    capBar.appendChild(r.fm.capBar);
    cap.appendChild(capBar);
    cap.appendChild(el('div', 'fm-cap-note', '库存单位不占用指挥容量；单位一旦编入编队即占用，移出或解散后立即释放。'));
    page.appendChild(cap);

    // —— 快速组建 ——
    const quickHead = el('div', 'section-head');
    quickHead.appendChild(el('span', '', '快速组建'));
    quickHead.appendChild(el('span', 'tag', `最多 ${FORMATION.maxFormations} 支编队`));
    page.appendChild(quickHead);

    const quick = el('div', 'fm-quick');

    // 空编队卡片
    const emptyCard = el('article', 'fm-preset');
    const ecHead = el('div', 'bc-head');
    ecHead.appendChild(el('span', 'bc-name', '空编队'));
    ecHead.appendChild(el('span', 'bc-status tag', '自定义'));
    emptyCard.appendChild(ecHead);
    emptyCard.appendChild(el('p', 'bc-desc', '先建立一支空编队，再手动挑选库存单位编入。'));
    r.fm.createBtn = el('button', 'btn primary', '新建空编队');
    r.fm.createBtn.type = 'button';
    r.fm.createBtn.dataset.action = 'create-formation';
    r.fm.createBtn.addEventListener('click', () => this._onFormationAction('onCreateFormation'));
    emptyCard.appendChild(r.fm.createBtn);
    r.fm.createReason = el('div', 'bc-reason');
    r.fm.createReason.hidden = true;
    emptyCard.appendChild(r.fm.createReason);
    quick.appendChild(emptyCard);

    // 预设模板卡片
    FORMATION_PRESETS.forEach((preset) => {
      const card = el('article', 'fm-preset');
      card.dataset.preset = preset.id;
      const head = el('div', 'bc-head');
      head.appendChild(el('span', 'bc-name', preset.name));
      head.appendChild(el('span', 'bc-status tag', `指挥 ${getPresetCommandCost(preset.id)}`));
      card.appendChild(head);

      const comp = Object.keys(preset.units)
        .map((t) => `${UNITS[t] ? UNITS[t].name : t}×${preset.units[t]}`)
        .join('、');
      card.appendChild(el('p', 'bc-desc', comp));

      const btn = el('button', 'btn primary', '一键组建');
      btn.type = 'button';
      btn.dataset.preset = preset.id;
      btn.addEventListener('click', () => this._onFormationAction('onApplyPreset', preset.id));
      card.appendChild(btn);

      const reason = el('div', 'bc-reason');
      reason.hidden = true;
      card.appendChild(reason);

      quick.appendChild(card);
      r.fm.presetCards[preset.id] = { root: card, btn, reason, preset };
    });
    page.appendChild(quick);

    // —— 编队列表 ——
    const listHead = el('div', 'section-head');
    listHead.appendChild(el('span', '', '我的编队'));
    r.fm.listTag = el('span', 'tag', '0 支');
    listHead.appendChild(r.fm.listTag);
    page.appendChild(listHead);

    r.fm.list = el('div', 'fm-list');
    page.appendChild(r.fm.list);
    r.fm.listEmpty = el('div', 'hint', '尚未建立任何编队。可以直接新建空编队，或使用上方预设模板一键组建。');
    page.appendChild(r.fm.listEmpty);

    // —— 编队详情 ——
    const detail = el('div', 'card fm-detail');
    r.fm.detail = detail;
    const dHead = el('div', 'card-head');
    r.fm.detailTitle = el('span', '', '编队详情');
    dHead.appendChild(r.fm.detailTitle);
    r.fm.detailTag = el('span', 'tag', '待命');
    dHead.appendChild(r.fm.detailTag);
    detail.appendChild(dHead);

    // 重命名 / 解散（结构常驻，避免刷新时输入框失焦）
    const nameRow = el('div', 'fm-name-row');
    r.fm.nameInput = el('input', 'fm-name-input');
    r.fm.nameInput.type = 'text';
    r.fm.nameInput.maxLength = FORMATION.maxNameLength;
    r.fm.nameInput.placeholder = '编队名称';
    r.fm.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitRename();
    });
    nameRow.appendChild(r.fm.nameInput);
    r.fm.renameBtn = el('button', 'btn', '重命名');
    r.fm.renameBtn.type = 'button';
    r.fm.renameBtn.addEventListener('click', () => this._submitRename());
    nameRow.appendChild(r.fm.renameBtn);
    r.fm.disbandBtn = el('button', 'btn danger', '解散编队');
    r.fm.disbandBtn.type = 'button';
    r.fm.disbandBtn.addEventListener('click', () => {
      if (this.selectedFormationId) this._onFormationAction('onDisbandFormation', this.selectedFormationId);
    });
    nameRow.appendChild(r.fm.disbandBtn);
    detail.appendChild(nameRow);

    r.fm.stats = el('div', 'fm-stats');
    detail.appendChild(r.fm.stats);

    r.fm.warnings = el('div', 'fm-warnings');
    detail.appendChild(r.fm.warnings);

    const mHead = el('div', 'section-head sub');
    mHead.appendChild(el('span', '', '当前成员'));
    r.fm.memberTag = el('span', 'tag', '0 个');
    mHead.appendChild(r.fm.memberTag);
    detail.appendChild(mHead);
    r.fm.members = el('div', 'fm-members');
    detail.appendChild(r.fm.members);

    const aHead = el('div', 'section-head sub');
    aHead.appendChild(el('span', '', '可加入单位'));
    r.fm.availTag = el('span', 'tag', '0 个空闲');
    aHead.appendChild(r.fm.availTag);
    detail.appendChild(aHead);
    r.fm.available = el('div', 'fm-available');
    detail.appendChild(r.fm.available);

    detail.hidden = true;
    page.appendChild(detail);

    const note = el('div', 'hint');
    note.innerHTML = `<b>说明：</b>最多同时保有 ${FORMATION.maxFormations} 支编队，编队名称不超过 ${FORMATION.maxNameLength} 个字符。`
      + '只有「待命」状态的编队可以调整成员、重命名与解散；'
      + '单位加入编队后占用指挥容量，移出或解散后立即返回库存。'
      + '编队组建完成后，切到「战区」分页即可选择目标与作战策略并派遣出击。';
    page.appendChild(note);
    }
  }

  /** 编队操作统一入口：加锁 → 转交 main.js */
  _onFormationAction(handlerName, ...args) {
    if (this._formationLocked) return;
    this._formationLocked = true;
    try {
      const fn = this.handlers[handlerName];
      if (typeof fn === 'function') fn(...args);
    } finally {
      this._formationLocked = false;
    }
  }

  /** 提交重命名 */
  _submitRename() {
    const input = this.refs.fm && this.refs.fm.nameInput;
    if (!input || !this.selectedFormationId) return;
    this._onFormationAction('onRenameFormation', this.selectedFormationId, input.value);
  }

  /** 选中某支编队（供列表点击与 main.js 调用） */
  selectFormation(formationId) {
    this.selectedFormationId = formationId || null;
    if (this.refs.fm) this.refs.fm.sig = {};   // 强制下次刷新重建详情
  }

  /** 刷新编队页 */
  _updateFormations(state) {
    const f = this.refs.fm;
    if (!f) return;

    if (f.grid) {
      /* Stage 10-P-B path：Tile 网格 + Inspector 管理 */
      const formations = Array.isArray(state.formations) ? state.formations : [];
      const cUsed = safeNumber(state.command.used, 0);
      const cCap = safeNumber(state.command.capacity, 0);
      f.capTag.textContent = `编队 ${formations.length}/${FORMATION.maxFormations} · 指挥 ${formatInt(cUsed)}/${formatInt(cCap)}`;
      if (this.selectedFormationId && !formations.some((x) => x.id === this.selectedFormationId)) this.selectedFormationId = null;
      const models = buildFormationCommandModels(state);
      models.forEach((model) => {
        if (model.id === `formation:${this.selectedFormationId}`) model.selected = true;
      });
      f.grid.update(models);
      f.listEmpty.hidden = formations.length > 0;
      return;
    }

    if (!f.list) return;

    const formations = Array.isArray(state.formations) ? state.formations : [];
    const cUsed = safeNumber(state.command.used, 0);
    const cCap = safeNumber(state.command.capacity, 0);
    const free = cCap - cUsed;

    // —— 指挥容量概览 ——
    setText(f.capUsed, `${formatInt(cUsed)} / ${formatInt(cCap)}`);
    setText(f.capFree, `${formatInt(free)} 点`);
    setText(f.capCount, `${formations.length} / ${FORMATION.maxFormations} 支`);
    f.capBar.style.width = `${cCap > 0 ? clamp((cUsed / cCap) * 100, 0, 100) : 0}%`;
    if (free <= 0) {
      f.capTag.textContent = cCap > 0 && cUsed > cCap ? '超出容量' : '已满';
      f.capTag.className = `tag ${cUsed > cCap ? 'danger' : 'warn'}`;
    } else {
      f.capTag.textContent = '充足';
      f.capTag.className = 'tag ok';
    }

    // —— 快速组建区 ——
    const canCreate = canCreateFormation(state);
    f.createBtn.disabled = !canCreate.ok;
    f.createReason.hidden = canCreate.ok;
    setText(f.createReason, canCreate.ok ? '' : canCreate.reason);

    Object.keys(f.presetCards).forEach((pid) => {
      const card = f.presetCards[pid];
      const check = canApplyPreset(state, pid);
      card.btn.disabled = !check.ok;
      card.reason.hidden = check.ok;
      setText(card.reason, check.ok ? '' : check.reason);
      toggleClass(card.root, 'is-blocked', !check.ok);
    });

    // —— 选中校正：选中的编队被解散时自动回落 ——
    if (this.selectedFormationId && !formations.some((x) => x.id === this.selectedFormationId)) {
      this.selectedFormationId = null;
      f.sig = {};
    }
    if (!this.selectedFormationId && formations.length > 0) {
      this.selectedFormationId = formations[0].id;
      f.sig = {};
    }

    // —— 编队列表（签名变化才重建） ——
    setText(f.listTag, `${formations.length} 支`);
    f.listEmpty.hidden = formations.length > 0;
    const listSig = formations
      .map((x) => `${x.id}:${x.name}:${x.status}:${x.unitIds.length}`)
      .join('|') + `#${this.selectedFormationId || ''}`;
    if (listSig !== f.sig.list) {
      f.sig.list = listSig;
      f.list.innerHTML = '';
      formations.forEach((formation) => {
        f.list.appendChild(this._renderFormationRow(state, formation));
      });
    }

    // —— 详情 ——
    const current = formations.find((x) => x.id === this.selectedFormationId) || null;
    f.detail.hidden = !current;
    if (!current) return;
    this._updateFormationDetail(state, current);
  }

  /** 编队列表中的一行 */
  _renderFormationRow(state, formation) {
    const stats = getFormationStats(state, formation);
    const row = el('div', 'fm-row');
    row.dataset.formationId = formation.id;
    if (formation.id === this.selectedFormationId) row.classList.add('is-active');

    const head = el('div', 'fm-row-head');
    head.appendChild(el('span', 'fm-row-name', formation.name));
    head.appendChild(el('span', 'tag', statusLabel(formation.status)));
    row.appendChild(head);

    const meta = el('div', 'fm-row-meta');
    meta.appendChild(el('span', '', `成员 ${stats.count}`));
    meta.appendChild(el('span', '', `指挥 ${stats.command}`));
    meta.appendChild(el('span', '', `攻击 ${formatInt(stats.attack)}`));
    meta.appendChild(el('span', '', `防御 ${formatInt(stats.defense)}`));
    meta.appendChild(el('span', '', `侦察 ${formatInt(stats.scouting)}`));
    row.appendChild(meta);

    row.addEventListener('click', () => {
      this.selectFormation(formation.id);
      const fn = this.handlers.onSelectFormation;
      if (typeof fn === 'function') fn(formation.id);
      this._updateFormations(state);
    });
    return row;
  }

  /** 刷新编队详情：属性、提示、成员、可加入单位 */
  _updateFormationDetail(state, formation) {
    const f = this.refs.fm;
    const editable = isEditable(formation);
    const stats = getFormationStats(state, formation);

    setText(f.detailTitle, `编队详情 · ${formation.name}`);
    f.detailTag.textContent = statusLabel(formation.status);
    f.detailTag.className = `tag ${editable ? 'ok' : 'warn'}`;

    // 名称输入框：正在输入时不覆盖玩家内容
    const active = (typeof document !== 'undefined' && document.activeElement) || null;
    if (f.nameInput !== active && f.nameInput.value !== formation.name) {
      f.nameInput.value = formation.name;
    }
    f.nameInput.disabled = !editable;
    f.renameBtn.disabled = !editable;
    f.disbandBtn.disabled = !editable;

    // 汇总属性
    const statSig = `${formation.id}|${formation.unitIds.join(',')}|${stats.hp}`;
    if (statSig !== f.sig.stats) {
      f.sig.stats = statSig;
      f.stats.innerHTML = '';
      const mkStat = (label, value) => {
        const cell = el('div', 'fm-stat');
        cell.appendChild(el('b', '', label));
        cell.appendChild(el('span', '', String(value)));
        f.stats.appendChild(cell);
      };
      mkStat('单位数量', stats.count);
      mkStat('指挥占用', stats.command);
      mkStat('总生命值', `${formatInt(stats.hp)} / ${formatInt(stats.maxHp)}`);
      mkStat('完好度', `${Math.round(stats.avgHp * 100)}%`);
      mkStat('总攻击', formatInt(stats.attack));
      mkStat('总反装甲', formatInt(stats.antiArmor));
      mkStat('总防御', formatInt(stats.defense));
      mkStat('总侦察', formatInt(stats.scouting));
      mkStat('总维修', formatInt(stats.repair));
      mkStat('平均机动', stats.avgMobility.toFixed(1));
      mkStat('任务补给消耗', `${formatInt(stats.upkeep)}/次`);
      const comp = Object.keys(stats.byType)
        .map((t) => `${UNITS[t] ? UNITS[t].name : t}×${stats.byType[t]}`)
        .join('、');
      mkStat('编成', comp || '空');
    }

    // 评估提示
    const warnings = getFormationWarnings(state, formation);
    const warnSig = warnings.join('|');
    if (warnSig !== f.sig.warn) {
      f.sig.warn = warnSig;
      f.warnings.innerHTML = '';
      if (warnings.length === 0) {
        f.warnings.appendChild(el('div', 'fm-warn ok', '编成均衡，暂无明显短板。'));
      } else {
        warnings.forEach((text) => f.warnings.appendChild(el('div', 'fm-warn', text)));
      }
    }

    // 当前成员
    const memberSig = `${formation.id}|${formation.unitIds.join(',')}|${editable}`;
    setText(f.memberTag, `${formation.unitIds.length} 个`);
    if (memberSig !== f.sig.members) {
      f.sig.members = memberSig;
      f.members.innerHTML = '';
      if (formation.unitIds.length === 0) {
        f.members.appendChild(el('div', 'hint', '编队为空，请从下方「可加入单位」中挑选。'));
      }
      formation.unitIds.forEach((unitId) => {
        const unit = (state.units || []).find((u) => u.id === unitId);
        const def = unit && UNITS[unit.type];
        if (!def) return;
        const item = el('div', 'fm-member');
        item.dataset.unitId = unitId;
        const info = el('div', 'fm-member-info');
        info.appendChild(el('span', 'fm-member-name', def.name));
        info.appendChild(el('span', 'fm-member-meta',
          `生命 ${formatInt(unit.hp)}/${formatInt(unit.maxHp)} · 指挥 ${def.command} · 战斗 ${safeNumber(unit.battles, 0)} 次`));
        item.appendChild(info);
        const btn = el('button', 'btn tiny danger', '移出');
        btn.type = 'button';
        btn.disabled = !editable;
        btn.addEventListener('click', () => this._onFormationAction('onRemoveUnit', formation.id, unitId));
        item.appendChild(btn);
        f.members.appendChild(item);
      });
    }

    // 可加入单位（按类型分组）
    const pool = getAvailableUnits(state);
    setText(f.availTag, `${pool.length} 个空闲`);
    const availSig = `${formation.id}|${pool.map((u) => u.id).join(',')}|${editable}|${safeNumber(state.command.used, 0)}`;
    if (availSig !== f.sig.avail) {
      f.sig.avail = availSig;
      f.available.innerHTML = '';
      if (pool.length === 0) {
        f.available.appendChild(el('div', 'hint', '没有空闲单位，请先到「生产」分页训练或制造。'));
      }
      Object.keys(UNITS).forEach((typeId) => {
        const group = pool.filter((u) => u.type === typeId);
        if (group.length === 0) return;
        const def = UNITS[typeId];
        const first = group[0];
        const check = canAddUnit(state, formation.id, first.id);

        const item = el('div', 'fm-avail');
        item.dataset.type = typeId;
        const info = el('div', 'fm-member-info');
        info.appendChild(el('span', 'fm-member-name', `${def.name} × ${group.length}`));
        info.appendChild(el('span', 'fm-member-meta',
          `指挥 ${def.command} · 攻击 ${def.stats.attack} · 防御 ${def.stats.defense} · 侦察 ${def.stats.scouting}`));
        item.appendChild(info);

        const btn = el('button', 'btn tiny primary', '加入');
        btn.type = 'button';
        btn.dataset.unitId = first.id;
        btn.dataset.action = 'add-unit';
        btn.disabled = !check.ok;
        btn.addEventListener('click', () => this._onFormationAction('onAddUnit', formation.id, first.id));
        item.appendChild(btn);

        if (!check.ok) {
          const reason = el('div', 'bc-reason', check.reason);
          item.appendChild(reason);
        }
        f.available.appendChild(item);
      });
    }
  }

  /** 编队变化后由 main.js 立即调用一次 */
  refreshFormations(state) {
    this._updateFormations(state);
    this._updateProduction(state);
    this._updateResources(state);
    this._updateOverview(state);
  }

  /* ==========================================================
   * 战区页（阶段5）
   * ======================================================== */

  /** 战区 / 战斗操作统一入口：加锁 → 转交 main.js */
  _onTheaterAction(handlerName, ...args) {
    if (this._theaterLocked) return;
    this._theaterLocked = true;
    try {
      const fn = this.handlers[handlerName];
      if (typeof fn === 'function') return fn(...args);
    } finally {
      this._theaterLocked = false;
    }
  }

  /**
   * 构建战区分页：
   *   当前作战面板（进行中进度 / 结束后战报要点 + 返回基地）
   *   → 战区目标列表（解锁条件、敌情、奖励）
   *   → 派遣控制台（编队下拉 + 策略卡 + 成本 + 禁用原因 + 派遣按钮）
   * 只搭结构，文字与禁用状态由 _updateTheater 刷新。
   */
  _buildTheaterPage(page) {
    const r = this.refs;
    r.th = { strategyCards: {}, sig: {} };

    // —— 当前作战面板 ——
    const battle = el('div', 'card th-battle');
    battle.hidden = true;
    r.th.battleBox = battle;

    const bHead = el('div', 'card-head');
    bHead.appendChild(el('span', '', '当前作战'));
    r.th.battleTag = el('span', 'tag warn', '进行中');
    bHead.appendChild(r.th.battleTag);
    battle.appendChild(bHead);

    r.th.battleTitle = el('div', 'th-battle-title', '——');
    battle.appendChild(r.th.battleTitle);
    r.th.battleMeta = el('div', 'th-battle-meta', '');
    battle.appendChild(r.th.battleMeta);

    const bar = el('div', 'bar battle');
    r.th.battleBar = el('i');
    bar.appendChild(r.th.battleBar);
    battle.appendChild(bar);

    r.th.battlePhase = el('div', 'th-battle-phase', '');
    battle.appendChild(r.th.battlePhase);
    r.th.battleTicker = el('div', 'th-battle-ticker', '');
    battle.appendChild(r.th.battleTicker);

    r.th.result = el('div', 'th-result');
    r.th.result.hidden = true;
    battle.appendChild(r.th.result);

    const actions = el('div', 'th-battle-actions');
    r.th.skipReturnBtn = el('button', 'btn primary', '跳过返航动画');
    r.th.skipReturnBtn.type = 'button';
    r.th.skipReturnBtn.dataset.action = 'return-from-battle';
    r.th.skipReturnBtn.addEventListener('click', () => this._onTheaterAction('onSkipBattleReturn'));
    actions.appendChild(r.th.skipReturnBtn);
    r.th.viewReportBtn = el('button', 'btn', '查看完整战报');
    r.th.viewReportBtn.type = 'button';
    r.th.viewReportBtn.dataset.action = 'view-report';
    r.th.viewReportBtn.addEventListener('click', () => this._openActiveBattleReport());
    actions.appendChild(r.th.viewReportBtn);
    r.th.battleActions = actions;
    actions.hidden = true;
    battle.appendChild(actions);

    page.appendChild(battle);

    // —— 战区目标列表（Stage 10-P-B：紧凑战区 Tile，详情进 Inspector） ——
    const listHead = el('div', 'command-section-head');
    listHead.appendChild(el('span', '', 'THEATERS'));
    r.th.listTag = el('small', '', '0 / 0 已占领');
    listHead.appendChild(r.th.listTag);
    page.appendChild(listHead);

    r.th.list = el('div');
    r.th.gridRoot = el('div', 'command-grid command-theater-grid');
    r.th.gridRoot.dataset.commandScope = 'theater';
    r.th.list.appendChild(r.th.gridRoot);
    page.appendChild(r.th.list);
    r.th.grid = this.commandSurface.createGrid(r.th.gridRoot, (model) => this._onCommandPrimary(model));

    // —— 派遣控制台 ——
    const ds = el('div', 'card th-dispatch');
    r.th.dispatchBox = ds;
    const dsHead = el('div', 'card-head');
    dsHead.appendChild(el('span', '', '派遣控制台'));
    r.th.dsTag = el('span', 'tag', '未选择目标');
    dsHead.appendChild(r.th.dsTag);
    ds.appendChild(dsHead);

    r.th.dsTarget = el('div', 'th-ds-target', '请先在上方选择一个作战目标。');
    ds.appendChild(r.th.dsTarget);
    r.th.dsMission = el('div', 'th-ds-mission', '任务类型：未选择');
    ds.appendChild(r.th.dsMission);

    // 编队下拉
    const fRow = el('div', 'th-ds-row');
    fRow.appendChild(el('label', 'th-ds-label', '出击编队'));
    r.th.dsSelect = el('select', 'th-select');
    r.th.dsSelect.addEventListener('change', () => {
      this.dispatchFormationId = r.th.dsSelect.value || null;
      this.dispatchReview = null;
      if (this.refs.th) this.refs.th.sig.cost = '';
    });
    fRow.appendChild(r.th.dsSelect);
    ds.appendChild(fRow);
    r.th.dsFormMeta = el('div', 'th-ds-meta', '');
    ds.appendChild(r.th.dsFormMeta);

    // 策略选择
    const sHead = el('div', 'section-head sub');
    sHead.appendChild(el('span', '', '作战策略'));
    r.th.dsStrategyTag = el('span', 'tag', '谨慎推进');
    sHead.appendChild(r.th.dsStrategyTag);
    ds.appendChild(sHead);

    const sWrap = el('div', 'th-strategies');
    r.th.strategyGridRoot = el('div', 'command-grid command-strategy-grid');
    sWrap.appendChild(r.th.strategyGridRoot);
    ds.appendChild(sWrap);
    r.th.strategyGrid = this.commandSurface.createGrid(r.th.strategyGridRoot, (model) => this._onCommandPrimary(model));

    // 成本与派遣
    const cHead = el('div', 'section-head sub');
    cHead.appendChild(el('span', '', '任务成本'));
    r.th.dsCostTag = el('span', 'tag', '—');
    cHead.appendChild(r.th.dsCostTag);
    ds.appendChild(cHead);

    r.th.dsCost = el('div', 'th-cost');
    ds.appendChild(r.th.dsCost);

    r.th.dsBtn = el('button', 'btn primary th-dispatch-btn', '派遣出击');
    r.th.dsBtn.type = 'button';
    r.th.dsBtn.dataset.action = 'launch-battle';
    r.th.dsBtn.addEventListener('click', () => this._openDispatchReview(this._lastState));
    ds.appendChild(r.th.dsBtn);
    r.th.dsReason = el('div', 'bc-reason');
    r.th.dsReason.hidden = true;
    ds.appendChild(r.th.dsReason);

    page.appendChild(ds);

    // —— 部署编成确认 ——
    r.th.review = el('div', 'card th-deployment-review');
    r.th.review.hidden = true;
    page.appendChild(r.th.review);

    const note = el('div', 'hint');
    note.innerHTML = '<b>说明：</b>同一时间只能进行一场作战。战斗结果在派遣时即由求解器一次性算出，'
      + '画面只是按事件时间轴回放，暂停或加速不会改变胜负。'
      + `每场战斗最多 ${BATTLE.maxRounds} 轮交火；建成雷达站可获得精确敌情，否则只能得到估算区间。`;
    page.appendChild(note);
  }

  /** 刷新战区页 */
  _updateTheater(state) {
    const t = this.refs.th;
    if (!t || !t.list) return;

    this._lastState = state;

    const active = getActiveBattle(state);
    if (active && this.dispatchReview) this.dispatchReview = null;
    this._updateBattlePanel(state, active);

    // —— 战区列表（Stage 10-P-B：Tile 网格，主操作=选择目标） ——
    const theaters = listTheaters(state);
    const captured = theaters.filter((x) => x.captured).length;
    setText(t.listTag, `${captured} / ${theaters.length} 已占领`);

    if (this.selectedTheaterId && !theaters.some((x) => x.id === this.selectedTheaterId)) {
      this.selectedTheaterId = null;
    }
    if (!this.selectedTheaterId) {
      const first = theaters.find((x) => x.unlocked && !x.captured) || theaters[0] || null;
      this.selectedTheaterId = first ? first.id : null;
    }

    if (t.grid) {
      const models = buildTheaterCommandModels(state);
      models.forEach((model) => {
        const [kind, rawId] = model.id.split(':');
        model.selected = kind === 'theater' && rawId === this.selectedTheaterId && !this.selectedOperationId;
        if (kind === 'theater') {
          model.inspectOnClick = false;
          model.actionId = 'select-theater';
          model.actionPayload = { theaterId: rawId, operationId: null };
          model.disabled = model.state === 'locked';
        } else if (kind === 'operation') {
          model.selected = this.selectedOperationId === rawId;
          model.inspectOnClick = false;
          model.actionId = 'select-theater';
          model.actionPayload = { theaterId: this.selectedTheaterId, operationId: rawId };
        }
      });
      t.grid.update(models);
      t.sig.cost = t.sig.cost || '';
      this._updateDispatchConsole(state, active);
      return;
    }

    const radar = hasRadar(state);
    const listSig = theaters
      .map((x) => `${x.id}:${x.unlocked ? 1 : 0}:${x.captured ? 1 : 0}:${x.engaged ? 1 : 0}:${x.attempts}:${x.lastResult || '-'}`)
      .join('|') + `#${this.selectedTheaterId || ''}#${radar ? 1 : 0}#${Math.floor(safeNumber(state.time && state.time.game, 0))}`;
    if (listSig !== t.sig.list) {
      t.sig.list = listSig;
      t.list.innerHTML = '';
      theaters.forEach((view) => {
        t.list.appendChild(this._renderTheaterCard(state, view));
      });
      t.sig.cost = '';
    }

    this._updateDispatchConsole(state, active);
  }

  /** 单个战区卡片 */
  _renderTheaterCard(state, view) {
    const card = el('article', 'th-card');
    card.dataset.theater = view.id;
    card.dataset.action = 'select-theater';
    if (view.id === this.selectedTheaterId) card.classList.add('is-active');
    if (!view.unlocked) card.classList.add('is-locked');
    if (view.captured) card.classList.add('is-captured');

    const head = el('div', 'bc-head');
    head.appendChild(el('span', 'bc-name', view.name));
    const statusText = view.engaged ? '交战中'
      : view.captured ? '已占领'
        : view.unlocked ? '可进攻' : '未解锁';
    const tone = view.captured ? 'ok' : view.engaged ? 'warn' : view.unlocked ? '' : 'danger';
    head.appendChild(el('span', `bc-status tag ${tone}`.trim(), statusText));
    card.appendChild(head);

    const stars = '★'.repeat(clamp(view.difficulty, 1, 5)) + '☆'.repeat(Math.max(0, 5 - view.difficulty));
    const meta = el('div', 'th-card-meta');
    meta.appendChild(el('span', '', `难度 ${stars}`));
    meta.appendChild(el('span', '', `地形 ${view.terrainName}`));
    meta.appendChild(el('span', '', `隐蔽 ${view.concealment}`));
    card.appendChild(meta);

    card.appendChild(el('p', 'bc-desc', view.desc));

    // 敌情
    const intel = getTheaterIntel(state, view.id);
    if (intel) {
      const box = el('div', 'th-intel');
      const ih = el('div', 'th-intel-head');
      ih.appendChild(el('span', '', `敌情（${intel.accurate ? '雷达确认' : '侦察估算'}）`));
      ih.appendChild(el('span', 'tag', `兵力 ${intel.totalText}`));
      box.appendChild(ih);
      intel.units.forEach((u) => {
        const row = el('div', `th-intel-row${u.threat ? ' threat' : ''}`);
        row.appendChild(el('span', '', u.label));
        box.appendChild(row);
      });
      const extra = [];
      if (intel.terrainEffects.length) extra.push(intel.terrainEffects.join(' · '));
      extra.push(`伏击风险 ${intel.ambushText}`);
      box.appendChild(el('div', 'th-intel-note', extra.join('　|　')));
      card.appendChild(box);
    }

    // 奖励与战绩
    const rw = [];
    if (Object.keys(view.firstReward).length) rw.push(`首占奖励 ${formatMissionCost(view.firstReward)}`);
    const inc = Object.keys(view.captureIncome)
      .map((k) => `${RESOURCE_DEFS[k.replace('PerSec', '')] ? RESOURCE_DEFS[k.replace('PerSec', '')].name : k}+${view.captureIncome[k]}/s`);
    if (inc.length) rw.push(`占领收益 ${inc.join(' ')}`);
    if (rw.length) card.appendChild(el('div', 'th-reward', rw.join('　|　')));

    if (view.captured) {
      Object.values(OPERATIONS).filter((operation) => operation.theaterId === view.id).forEach((operation) => {
        const op = getOperation(state, operation.id);
        const box = el('div', 'operation-card');
        box.appendChild(el('div', 'bc-name', `${operation.name} · 重复任务`));
        box.appendChild(el('div', 'th-card-meta', `${operation.desc} · 经验倍率 ×${operation.experienceMultiplier}`));
        box.appendChild(el('div', 'th-reward', `成本系数 ×${operation.supplyMultiplier} · 奖励范围 ${Object.keys(operation.rewards || {}).map((key) => `${key} ${operation.rewards[key].min}-${operation.rewards[key].max}`).join(' / ')}`));
        box.appendChild(el('div', 'bc-reason', op.cooldownText));
        const btn = el('button', 'btn primary small', '选择任务'); btn.type = 'button'; btn.disabled = op.cooldownRemaining > 0;
        btn.dataset.action = 'select-operation';
        btn.dataset.operationId = operation.id;
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          this.dispatchReview = null;
          this.selectedTheaterId = view.id;
          this.selectedOperationId = operation.id;
          this.refs.th.sig.list = '';
          this.refs.th.sig.cost = '';
        });
        box.appendChild(btn); card.appendChild(box);
      });
    }

    const rec = el('div', 'th-card-rec');
    rec.appendChild(el('span', '', `尝试 ${view.attempts} 次`));
    rec.appendChild(el('span', '', `胜利 ${view.victories} 次`));
    rec.appendChild(el('span', '', view.lastResult ? `上次 ${resultLabel(view.lastResult)}` : '尚未交战'));
    card.appendChild(rec);

    if (!view.unlocked) {
      card.appendChild(el('div', 'bc-reason', view.lockReason));
    }

    card.addEventListener('click', () => {
      this.dispatchReview = null;
      this.selectedTheaterId = view.id;
      this.selectedOperationId = null;
      if (this.refs.th) { this.refs.th.sig.list = ''; this.refs.th.sig.cost = ''; }
      const fn = this.handlers.onSelectTheater;
      if (typeof fn === 'function') fn(view.id);
    });
    return card;
  }

  /** 刷新派遣控制台 */
  _updateDispatchConsole(state, active) {
    const t = this.refs.th;
    const target = this.selectedTheaterId ? THEATERS[this.selectedTheaterId] : null;
    const selectedOperation = this.selectedOperationId && OPERATIONS[this.selectedOperationId]
      && OPERATIONS[this.selectedOperationId].theaterId === this.selectedTheaterId ? OPERATIONS[this.selectedOperationId] : null;

    setText(t.dsTag, selectedOperation ? `${selectedOperation.name} · 重复任务` : (target ? target.name : '未选择目标'));
    setText(t.dsTarget, target
      ? `${selectedOperation ? `任务：${selectedOperation.name}` : `目标：${target.name}`} · ${target.terrainName} · 补给系数 ×${selectedOperation ? selectedOperation.supplyMultiplier : target.supplyMultiplier}`
      : '请先在上方选择一个作战目标。');
    const selectedOperationState = selectedOperation ? getOperation(state, selectedOperation.id) : null;
    setText(t.dsMission, target
      ? `任务类型：${missionKindLabel(selectedOperation ? 'operation' : 'campaign')} · ${selectedOperation ? operationCooldownText(selectedOperationState) : '战区首次占领任务，无重复任务冷却'}`
      : '任务类型：未选择');

    // 编队下拉（结构变化才重建，避免刷新时丢失选择）
    const formations = Array.isArray(state.formations) ? state.formations : [];
    const optSig = formations
      .map((f) => `${f.id}:${f.name}:${f.status}:${(f.unitIds || []).length}`)
      .join('|');
    if (optSig !== t.sig.options) {
      t.sig.options = optSig;
      t.dsSelect.innerHTML = '';
      if (formations.length === 0) {
        const opt = el('option', '', '暂无编队，请先在「编队」分页组建');
        opt.value = '';
        t.dsSelect.appendChild(opt);
      } else {
        formations.forEach((f) => {
          const stats = getFormationStats(state, f);
          const opt = el('option', '',
            `${f.name}（${statusLabel(f.status)} · ${stats.count}单位 · 指挥${stats.command}）`);
          opt.value = f.id;
          t.dsSelect.appendChild(opt);
        });
      }
      t.sig.cost = '';
    }

    // 选中校正
    if (this.dispatchFormationId && !formations.some((f) => f.id === this.dispatchFormationId)) {
      this.dispatchFormationId = null;
    }
    if (!this.dispatchFormationId && formations.length > 0) {
      const idle = formations.find((f) => f.status === 'idle' && (f.unitIds || []).length > 0);
      this.dispatchFormationId = (idle || formations[0]).id;
    }
    if (t.dsSelect.value !== (this.dispatchFormationId || '')) {
      t.dsSelect.value = this.dispatchFormationId || '';
    }

    const formation = formations.find((f) => f.id === this.dispatchFormationId) || null;
    if (formation) {
      const stats = getFormationStats(state, formation);
      setText(t.dsFormMeta,
        `攻击 ${formatInt(stats.attack)} · 防御 ${formatInt(stats.defense)} · `
        + `侦察 ${formatInt(stats.scouting)} · 耐久 ${formatInt(stats.hp)} · 维持 ${formatInt(stats.upkeep)}`);
    } else {
      setText(t.dsFormMeta, '尚未选择编队。');
    }

    // 策略高亮（Stage 10-P-B：Tile 网格）
    if (!this.selectedStrategyId) this.selectedStrategyId = listStrategies()[0]?.id || null;
    if (t.strategyGrid) {
      t.strategyGrid.update(buildStrategyModels(state, this.selectedStrategyId));
    } else {
      if (!this.selectedStrategyId || !t.strategyCards[this.selectedStrategyId]) {
        this.selectedStrategyId = Object.keys(t.strategyCards)[0] || null;
      }
      Object.keys(t.strategyCards).forEach((sid) => {
        toggleClass(t.strategyCards[sid], 'is-active', sid === this.selectedStrategyId);
      });
    }
    const curStrategy = listStrategies().find((s) => s.id === this.selectedStrategyId) || null;
    setText(t.dsStrategyTag, curStrategy ? curStrategy.name : '未选择');

    // 成本与派遣资格
    const mission = selectedOperation
      ? getOperationCost(state, this.dispatchFormationId, selectedOperation.id, this.selectedStrategyId)
      : getMissionCost(state, this.dispatchFormationId, this.selectedTheaterId, this.selectedStrategyId);
    const check = selectedOperation
      ? canDispatchOperationMission(state, this.dispatchFormationId, selectedOperation.id, this.selectedStrategyId)
      : canDispatch(state, this.dispatchFormationId, this.selectedTheaterId, this.selectedStrategyId);

    const costSig = `${formatMissionCost(mission.cost)}#${mission.affordable ? 1 : 0}`
      + `#${mission.breakdown.unitCount || ''}:${mission.breakdown.upkeepSum || mission.breakdown.upkeep || ''}:${mission.breakdown.supplyMultiplier || ''}:${mission.breakdown.upkeepMod || ''}`
      + `#${check.ok ? 1 : 0}:${check.code}`;
    if (costSig !== t.sig.cost) {
      t.sig.cost = costSig;
      t.dsCostTag.textContent = mission.affordable ? '资源充足' : '资源不足';
      t.dsCostTag.className = `tag ${mission.affordable ? 'ok' : 'danger'}`;

      t.dsCost.innerHTML = '';
      const mk = (label, value) => {
        const row = el('div', 'kv');
        row.appendChild(el('span', '', label));
        row.appendChild(el('span', '', value));
        t.dsCost.appendChild(row);
      };
      mk('出击消耗', formatMissionCost(mission.cost));
      mk('计算方式', `维持 ${mission.breakdown.upkeepSum || mission.breakdown.upkeep || 0} × 系数 ${mission.breakdown.supplyMultiplier || 0}`
        + (mission.breakdown.upkeepMod ? ` × 策略 ${mission.breakdown.upkeepMod}` : ''));
      if (Object.keys(mission.breakdown.strategyCost).length) {
        mk('策略附加', formatMissionCost(mission.breakdown.strategyCost));
      }
      mk('参战单位', `${mission.breakdown.unitCount} 个`);
      if (!mission.affordable && mission.missing.length) {
        const warn = el('div', 'bc-reason', `缺少：${mission.missing.join('，')}`);
        t.dsCost.appendChild(warn);
      }
    }

    const blocked = !check.ok || !!active;
    t.dsBtn.textContent = active ? '作战进行中' : (this.dispatchReview ? '等待确认' : '查看部署确认');
    const reason = active ? '已有一场作战正在进行，请先返回基地。' : (check.ok ? '' : dispatchEligibilityText(check));
    t.dsReason.hidden = !reason;
    setText(t.dsReason, reason);
    t.dsBtn.disabled = blocked || Boolean(this.dispatchReview);
    this._updateDispatchReview(state);
  }

  /*
   * 打开部署确认。确认面板只保存 UI 内存态；真正派遣时仍由
   * theater.js 重新执行资格校验、成本扣除、快照构建与生产会话建立。
   */
  _openDispatchReview(state) {
    if (!state || state.activeBattle) {
      this.toast('已有一场作战正在进行，无法重复派遣', 'warn');
      return { ok: false, code: 'battle_active', reason: '已有一场作战正在进行' };
    }
    const selectedOperation = this.selectedOperationId && OPERATIONS[this.selectedOperationId]
      && OPERATIONS[this.selectedOperationId].theaterId === this.selectedTheaterId
      ? OPERATIONS[this.selectedOperationId] : null;
    const missionKind = selectedOperation ? 'operation' : 'campaign';
    const missionId = selectedOperation ? selectedOperation.id : this.selectedTheaterId;
    const check = selectedOperation
      ? canDispatchOperationMission(state, this.dispatchFormationId, missionId, this.selectedStrategyId)
      : canDispatch(state, this.dispatchFormationId, this.selectedTheaterId, this.selectedStrategyId);
    if (!check.ok) {
      this.toast(dispatchEligibilityText(check), 'warn');
      this._updateDispatchConsole(state, getActiveBattle(state));
      return check;
    }
    const formation = (state.formations || []).find((row) => row && row.id === this.dispatchFormationId);
    if (!formation) {
      const result = { ok: false, code: 'formation_not_found', reason: '未找到出击编队' };
      this.toast(result.reason, 'warn');
      return result;
    }
    const cost = selectedOperation
      ? getOperationCost(state, formation.id, missionId, this.selectedStrategyId)
      : getMissionCost(state, formation.id, this.selectedTheaterId, this.selectedStrategyId);
    const snapshot = buildDispatchSnapshot(
      state, formation, this.selectedTheaterId, this.selectedStrategyId, missionKind, missionId
    );
    this.dispatchReview = {
      formationId: formation.id,
      theaterId: this.selectedTheaterId,
      strategyId: this.selectedStrategyId,
      operationId: selectedOperation?.id || null,
      missionKind,
      missionId,
      cost: { ...(cost.cost || {}) },
      snapshot,
      openedAtGameTime: safeNumber(state.time?.game, 0)
    };
    this._updateDispatchReview(state);
    if (this.refs.th?.review && typeof this.refs.th.review.scrollIntoView === 'function') {
      this.refs.th.review.scrollIntoView({ block: 'nearest' });
    }
    return { ok: true, review: this.dispatchReview };
  }

  /** 部署确认面板：展示 buildDispatchSnapshot 的同一份快照数据。 */
  _updateDispatchReview(state) {
    const t = this.refs.th;
    if (!t?.review) return;
    const review = this.dispatchReview;
    if (!review) {
      t.review.hidden = true;
      t.review.innerHTML = '';
      t.sig.review = '';
      return;
    }
    const snapshot = review.snapshot || {};
    const operation = review.operationId ? OPERATIONS[review.operationId] : null;
    const sourceUnits = new Map((state.units || []).map((unit) => [unit.id, unit]));
    const sourceUnitSignature = (snapshot.units || []).map((unit) => {
      const source = sourceUnits.get(unit.id);
      return [unit.id, unit.hp, unit.maxHp, source?.status || '', source?.damage || ''].join(':');
    }).join('|');
    const operationState = operation ? getOperation(state, operation.id) : null;
    const reviewSignature = [
      review.formationId, review.theaterId, review.strategyId, review.missionKind, review.missionId,
      formatMissionCost(review.cost), Math.floor(review.openedAtGameTime), sourceUnitSignature,
      operationState?.cooldownRemaining || 0, operationState?.cooldownUntil || 0, operationState?.cooldownText || ''
    ].join('#');
    t.review.hidden = false;
    if (t.sig.review === reviewSignature) return;
    t.sig.review = reviewSignature;
    t.review.dataset.action = 'deployment-review';
    t.review.dataset.formationId = review.formationId;
    t.review.dataset.theaterId = review.theaterId || '';
    t.review.dataset.strategyId = review.strategyId || '';
    t.review.dataset.snapshotUnitIds = (snapshot.units || []).map((unit) => unit.id).join(',');
    t.review.innerHTML = '';

    const head = el('div', 'card-head');
    head.appendChild(el('span', '', '部署确认 / DEPLOYMENT REVIEW'));
    head.appendChild(el('span', 'tag warn', '待确认'));
    t.review.appendChild(head);

    const targetName = THEATERS[review.theaterId]?.name || review.theaterId;
    t.review.appendChild(el('div', 'th-review-title', (snapshot.formation?.name || '编队') + ' → ' + targetName));
    const strategy = listStrategies().find((row) => row.id === review.strategyId);
    t.review.appendChild(el('div', 'th-review-meta',
      missionKindLabel(review.missionKind) + ' · 策略 ' + (strategy?.name || review.strategyId)
      + (operation ? ' · ' + operation.name : '')));

    const facts = el('div', 'th-review-facts');
    const addFact = (label, value) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      row.appendChild(el('span', '', value));
      facts.appendChild(row);
    };
    addFact('目标战区', targetName || '未选择');
    addFact('预计消耗', formatMissionCost(review.cost));
    addFact('冷却安排', operationCooldownText(operationState));
    addFact('确认时游戏时间', Math.floor(review.openedAtGameTime) + ' 秒');
    t.review.appendChild(facts);

    const unitHead = el('div', 'section-head sub');
    unitHead.appendChild(el('span', '', '实际派遣快照 · 参战单位'));
    unitHead.appendChild(el('span', 'tag', (snapshot.units || []).length + ' 个'));
    t.review.appendChild(unitHead);
    const list = el('div', 'th-review-units');
    (snapshot.units || []).forEach((unit) => {
      const source = sourceUnits.get(unit.id);
      const row = el('div', 'th-review-unit');
      row.dataset.unitId = unit.id;
      row.appendChild(el('span', 'th-review-unit-name', unit.callsign || UNITS[unit.type]?.name || unit.type));
      row.appendChild(el('span', 'th-review-unit-meta',
        'HP ' + formatInt(unit.hp) + '/' + formatInt(unit.maxHp)
        + ' · 状态 ' + unitStatusLabel(source?.status) + ' · ' + (unit.rankName || '普通')
        + (source?.damage ? ' · ' + source.damage : '')));
      list.appendChild(row);
    });
    t.review.appendChild(list);

    const note = el('div', 'hint th-review-source');
    note.textContent = '以上清单来自本次派遣将写入的 dispatchSnapshot；确认时核心层会再次校验资格与资源。';
    t.review.appendChild(note);

    const actions = el('div', 'th-review-actions');
    const cancel = el('button', 'btn', '取消派遣');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-deployment-review';
    cancel.addEventListener('click', () => {
      this.dispatchReview = null;
      this._updateDispatchReview(state);
      this._updateDispatchConsole(state, getActiveBattle(state));
    });
    actions.appendChild(cancel);
    const confirm = el('button', 'btn primary', '确认派遣');
    confirm.type = 'button';
    confirm.dataset.action = 'confirm-dispatch';
    confirm.addEventListener('click', () => {
      const current = this.dispatchReview;
      if (!current) return;
      this.dispatchReview = null;
      this._updateDispatchReview(state);
      return this._onTheaterAction(
        'onConfirmDispatch', current.formationId, current.theaterId,
        current.strategyId, current.operationId
      );
    });
    confirm.disabled = Boolean(state.activeBattle);
    actions.appendChild(confirm);
    t.review.appendChild(actions);
  }

  /** 刷新「当前作战」面板 */
  _updateBattlePanel(state, active) {
    const t = this.refs.th;
    if (!t || !t.battleBox) return;

    t.lastActive = active || null;
    if (!active) {
      t.battleBox.hidden = true;
      t.sig.battle = '';
      return;
    }
    t.battleBox.hidden = false;

    const report = active.report || {};
    const duration = Math.max(1, safeNumber(active.duration, 1));
    const elapsed = clamp(safeNumber(active.elapsed, 0), 0, duration);
    const pct = clamp((elapsed / duration) * 100, 0, 100);

    setText(t.battleTitle, `${active.formationName} → ${active.theaterName}`);
    const strategyName = (listStrategies().find((s) => s.id === active.strategyId) || {}).name || '未知策略';
    const tacticalName = report.tactics?.name || (report.tactics?.combinedArms ? '步坦协同楔形' : '常规展开');
    setText(t.battleMeta,
      `策略 ${strategyName} · 队形 ${tacticalName} · 种子 ${active.seed} · 进度 ${Math.floor(pct)}%（${elapsed.toFixed(0)} / ${duration} 秒）`);
    t.battleBar.style.width = `${pct}%`;

    if (active.settled) {
      t.battleTag.textContent = '已结束';
      t.battleTag.className = `tag ${RESULT_TONE[report.result] || ''}`.trim();
      setText(t.battlePhase, `结果：${resultLabel(report.result)}`);
      setText(t.battleTicker, report.summary || '');
    } else {
      t.battleTag.textContent = '进行中';
      t.battleTag.className = 'tag warn';
      setText(t.battlePhase, this._currentPhaseText(report, elapsed));
      setText(t.battleTicker, this._lastEventText(report, elapsed));
    }

    t.battleActions.hidden = !active.settled;
    if (t.skipReturnBtn) t.skipReturnBtn.hidden = !active.settled;

    const salvage = active.battleSessionId ? deriveSalvageOffer(state, active.battleSessionId) : null;
    const salvageSig = salvage?.ok
      ? `${salvage.salvageId}:${salvage.offerHash}:${salvage.state}:${salvage.claim?.instanceId || ''}`
      : `${salvage?.code || 'none'}:${salvage?.reason || ''}`;
    const sig = `${active.id}:${active.settled ? 1 : 0}:${active.replayReadOnly ? 1 : 0}:${salvageSig}`;
    if (sig === t.sig.battle) return;
    t.sig.battle = sig;

    t.result.hidden = !active.settled;
    t.result.innerHTML = '';
    if (!active.settled) return;

    const banner = el('div', `th-result-banner ${RESULT_TONE[report.result] || ''}`.trim());
    banner.appendChild(el('b', '', resultLabel(report.result)));
    banner.appendChild(el('span', '', report.capture ? '目标已占领' : '未能占领目标'));
    t.result.appendChild(banner);

    const mk = (label, value) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      row.appendChild(el('span', '', value));
      t.result.appendChild(row);
    };
    const lost = (report.losses && report.losses.friendly) || [];
    const permanent = lost.filter((l) => !l.recovered);
    const recovered = lost.filter((l) => l.recovered);
    mk('我方永久损失', permanent.length ? permanent.map((l) => l.name).join('、') : '无');
    if (recovered.length) mk('战地抢救回收', recovered.map((l) => l.name).join('、'));
    mk('敌方损失', `${((report.losses && report.losses.enemy) || []).length} 个单位`);
    const granted = active.granted || {};
    mk('本次获得', Object.keys(granted).length ? formatMissionCost(granted) : '无（奖励已领取或未占领）');

    this._renderBattleSalvage(t.result, state, active, salvage);

    const reasons = report.reasons || { advantages: [], problems: [] };
    if (reasons.advantages.length || reasons.problems.length) {
      const ul = el('ul', 'th-reasons');
      reasons.advantages.forEach((x) => ul.appendChild(el('li', 'good', x)));
      reasons.problems.forEach((x) => ul.appendChild(el('li', 'risk', x)));
      t.result.appendChild(ul);
    }
  }

  /** 战后打捞只消费 salvage 模块的重算结果，不在 UI 层推导概率或装备池。 */
  _renderBattleSalvage(box, state, active, offer = null) {
    const section = el('div', 'battle-salvage');
    const head = el('div', 'section-head sub');
    head.appendChild(el('span', '', '战场打捞'));
    head.appendChild(el('span', 'tag', '结算后获取'));
    section.appendChild(head);

    if (!offer || !offer.ok) {
      section.appendChild(el('div', 'hint', offer?.reason || '本次作战不适用战场打捞。'));
      box.appendChild(section);
      return;
    }
    if (offer.outcome !== 'equipment') {
      section.appendChild(el('div', 'hint', '未发现可回收装备。'));
      box.appendChild(section);
      return;
    }
    const def = getEquipmentDefinition(offer.equipmentId);
    const title = offer.claimed ? `已回收：${def?.name || offer.equipmentId}` : `发现：${def?.name || offer.equipmentId}`;
    section.appendChild(el('div', offer.claimed ? 'hint good' : 'hint', title));
    if (offer.claimed) {
      section.appendChild(el('div', 'hint', '装备实例已写入库存，可在单位档案中挂载。'));
    } else if (active.replayReadOnly !== true && active.settlementAllowed !== false && active.settled === true) {
      const claim = el('button', 'btn primary', '回收装备');
      claim.type = 'button';
      claim.dataset.action = 'claim-battle-salvage';
      claim.dataset.battleSessionId = active.battleSessionId || '';
      claim.addEventListener('click', () => this._onTheaterAction('onClaimBattleSalvage', active.battleSessionId));
      section.appendChild(claim);
    } else {
      section.appendChild(el('div', 'hint', '只读回放中不能领取战利品。'));
    }
    box.appendChild(section);
  }

  /** 按播放进度推断当前阶段文本 */
  _currentPhaseText(report, elapsed) {
    const events = (report && report.events) || [];
    let text = '部队开进中…';
    for (let i = 0; i < events.length; i += 1) {
      if (safeNumber(events[i].t, 0) > elapsed) break;
      if (events[i].type === BATTLE_EVENT.PHASE) text = events[i].text;
    }
    return text;
  }

  /** 按播放进度取最近一条事件文本 */
  _lastEventText(report, elapsed) {
    const events = (report && report.events) || [];
    let text = '等待战场回传…';
    for (let i = 0; i < events.length; i += 1) {
      if (safeNumber(events[i].t, 0) > elapsed) break;
      if (events[i].text) text = events[i].text;
    }
    return text;
  }

  /** 战区状态变化后由 main.js 立即调用一次 */
  refreshTheater(state) {
    this._updateTheater(state);
    this._updateBattlePresentation(state);
    this._updateBattleOverlay(state);
    this._updateReports(state);
    this._updateFormations(state);
    this._updateResources(state);
    this._updateOverview(state);
  }

  /** 战斗播放期间的轻量刷新（只更新作战面板） */
  refreshBattle(state) {
    if (!this.refs.th || !this.refs.th.battleBox) return;
    this._updateBattlePanel(state, getActiveBattle(state));
    this._updateBattlePresentation(state);
    this._updateBattleOverlay(state);
  }

  _openActiveBattleReport() {
    const active = this.refs.th && this.refs.th.lastActive;
    if (active && active.report) this.selectedReportId = active.report.id;
    this.switchTab('reports');
  }

  /** 结果控件挂在战场层之上，和右侧当前分页解耦。 */
  _updateBattleOverlay(state) {
    const active = getActiveBattle(state);
    const visible = !!(active && active.settled);
    if (this.refs.battleOverlay) this.refs.battleOverlay.hidden = !visible;
    if (!visible) return;
    const elapsed = clamp(safeNumber(active.returnElapsed, 0), 0, Math.max(.1, safeNumber(active.returnDuration, 5)));
    const duration = Math.max(.1, safeNumber(active.returnDuration, 5));
    setText(this.refs.battleOverlayStatus, `作战结束，部队正在重新集结并返航 · ${Math.ceil(Math.max(0, duration - elapsed))} 秒`);
  }

  /** 战术战场期间隐藏基地图例，并替换视图 chip。 */
  _updateBattlePresentation(state) {
    const active = getActiveBattle(state);
    const battle = !!active;
    const stage = qs('#stage');
    if (stage) {
      stage.classList.toggle('is-battle-active', battle);
      stage.classList.toggle('is-battle-settled', Boolean(active?.settled));
    }
    if (this.refs.legend) this.refs.legend.hidden = battle;
    const renderedMode = this.presentationState.renderedMode || this.presentationState.mode || 'legacy';
    const contract = battle && renderedMode === 'contract_road_victory';
    const universal = battle && renderedMode === 'universal_battle';
    if (this.refs.viewChip) setText(this.refs.viewChip, battle ? (contract ? '视图：契约RTS战场 / CONTRACT RTS' : universal ? '视图：通用RTS战场 / UNIVERSAL RTS' : '视图：战术战场 / TACTICAL BATTLE') : '视图：基地全景 / BASE VIEW');
    if (this.refs.presentationMode) {
      const labels = { auto: '演出：自动', legacy: '演出：兼容', contract: '演出：契约RTS', universal: '演出：通用RTS' };
      setText(this.refs.presentationMode, labels[this.presentationState.preference] || labels.auto);
      this.refs.presentationMode.hidden = !battle;
      this.refs.presentationMode.title = '切换自动、兼容、契约RTS与通用RTS演出';
    }
    if (this.refs.presentationStatus) {
      const status = contract ? '正面突破 · 道路RTS' : universal ? '通用规划 · 正式旁路' : (battle && this.presentationState.preference === 'contract' ? '当前战报不满足正式演出条件，已回退' : battle && this.presentationState.preference === 'universal' ? '当前战报不满足通用演出条件，已回退' : '');
      setText(this.refs.presentationStatus, status);
      this.refs.presentationStatus.hidden = !status;
    }
    const tip = qs('#canvas-tip');
    if (tip && battle) tip.hidden = true;
  }

  setPresentationState(state = {}) {
    this.presentationState = { ...this.presentationState, ...state };
    this._updateBattlePresentation(this._lastState || {});
  }

  /* ==========================================================
   * 科研页（阶段7）
   * ======================================================== */

  _buildResearchPage(page) {
    const r = this.refs;
    r.research = { cards: {}, branchList: {}, branchGrids: {} };

    /* Stage 10-P-B：紧凑科技 Tile；效果 / 成本 / 前置进 Inspector */
    const labHead = el('div', 'command-section-head');
    labHead.appendChild(el('span', '', 'RESEARCH'));
    r.research.labTag = el('small', '', '未建成');
    labHead.appendChild(r.research.labTag);
    page.appendChild(labHead);
    r.research.labHint = el('div', 'command-gesture-hint', '技术实验室尚未建成');
    page.appendChild(r.research.labHint);

    const currentHead = el('div', 'command-section-head');
    currentHead.appendChild(el('span', '', 'CURRENT'));
    r.research.currentTag = el('small', '', '空闲');
    currentHead.appendChild(r.research.currentTag);
    page.appendChild(currentHead);
    r.research.currentEmpty = el('div', 'command-empty', '实验室空闲，可从下方科技树选择研究');
    page.appendChild(r.research.currentEmpty);
    r.research.currentRoot = el('div', 'command-grid command-research-current');
    page.appendChild(r.research.currentRoot);
    r.research.currentGrid = this.commandSurface.createQueue(r.research.currentRoot, () => {});
    r.research.queueRoot = el('div', 'command-grid command-repair-grid');
    page.appendChild(r.research.queueRoot);
    r.research.queueGrid = this.commandSurface.createQueue(r.research.queueRoot, () => {});

    const tree = el('div', 'research-tree research-tree-compact');
    ['industry', 'military', 'command'].forEach((branch) => {
      const col = el('div', 'research-branch');
      col.dataset.branch = branch;
      col.appendChild(el('h4', '', { industry: '工业', military: '军备', command: '指挥' }[branch]));
      r.research.branchList[branch] = el('div', 'research-branch-list');
      r.research.branchGrids[branch] = this.commandSurface.createGrid(r.research.branchList[branch], (model) => this._onCommandPrimary(model));
      col.appendChild(r.research.branchList[branch]);
      tree.appendChild(col);
    });
    page.appendChild(tree);
    page.appendChild(el('div', 'command-gesture-hint', '点击开始研究 · 悬浮成本与时长 · 长按详情'));
    return;
    {
    const lab = el('div', 'card research-lab');
    const head = el('div', 'card-head');
    head.appendChild(el('span', '', '实验室状态'));
    r.research.labTag = el('span', 'tag', '未建成');
    head.appendChild(r.research.labTag);
    lab.appendChild(head);
    r.research.labHint = el('div', 'hint', '技术实验室尚未建成');
    lab.appendChild(r.research.labHint);
    page.appendChild(lab);

    const current = el('div', 'card research-current');
    const ch = el('div', 'card-head');
    ch.appendChild(el('span', '', '当前研究'));
    r.research.currentTag = el('span', 'tag', '空闲');
    ch.appendChild(r.research.currentTag);
    current.appendChild(ch);
    r.research.currentBox = el('div', 'research-current-box');
    current.appendChild(r.research.currentBox);
    page.appendChild(current);

    const queue = el('div', 'card research-queue');
    const qh = el('div', 'card-head');
    qh.appendChild(el('span', '', '等待队列'));
    r.research.queueTag = el('span', 'tag', '0 / 3');
    qh.appendChild(r.research.queueTag);
    queue.appendChild(qh);
    r.research.queueList = el('div', 'research-queue-list');
    queue.appendChild(r.research.queueList);
    page.appendChild(queue);

    const treeHead = el('div', 'section-head');
    treeHead.appendChild(el('span', '', '科技树'));
    r.research.completedTag = el('span', 'tag', '已完成 0 / 9');
    treeHead.appendChild(r.research.completedTag);
    page.appendChild(treeHead);
    const tree = el('div', 'research-tree');
    ['industry', 'military', 'command'].forEach((branch) => {
      const col = el('div', 'research-branch');
      col.dataset.branch = branch;
      col.appendChild(el('h4', '', { industry: '工业', military: '军备', command: '指挥' }[branch]));
      r.research.branchLists[branch] = el('div', 'research-branch-list');
      col.appendChild(r.research.branchLists[branch]);
      tree.appendChild(col);
    });
    Object.values(TECHNOLOGIES).forEach((tech) => {
      const card = el('article', 'research-card');
      card.dataset.tech = tech.id;
      card.appendChild(el('div', 'research-card-head', `${tech.name} · ${tech.tier}级`));
      const status = el('span', 'tag', '未解锁');
      card.appendChild(status);
      card.appendChild(el('p', 'research-desc', tech.desc));
      card.appendChild(el('div', 'research-meta', `成本：${this._costText(tech.cost)} · 时间：${tech.researchTime}秒`));
      const reason = el('div', 'bc-reason');
      reason.hidden = true;
      card.appendChild(reason);
      const btn = el('button', 'btn primary research-btn', '开始研究');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (this.handlers.onResearch) this.handlers.onResearch(tech.id);
      });
      card.appendChild(btn);
      r.research.cards[tech.id] = { root: card, status, reason, btn, tech };
      r.research.branchLists[tech.branch].appendChild(card);
    });
    page.appendChild(tree);
    page.appendChild(el('div', 'hint', '研究只影响新创建的生产与维修任务；战斗修正按当前科技动态生效。暂停时科研不会推进。'));
    }
  }

  _costText(cost) {
    return Object.keys(cost || {}).map((key) => `${RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key} ${formatInt(cost[key])}`).join(' / ') || '免费';
  }

  _updateResearch(state) {
    const r = this.refs.research;
    if (!r) return;
    const built = hasResearchCenter(state);

    /* Stage 10-P-B path：科技 Tile 网格 */
    if (r.branchGrids && r.branchGrids.industry) {
      const models = buildResearchCommandModels(state);
      r.labTag.textContent = built ? '运行中' : '未建成';
      r.labHint.textContent = built
        ? `队列 ${models.current.length + models.queue.length} / ${RESEARCH.maxQueueSize} · 已完成 ${((state.research && state.research.completed) || []).length} / 9`
        : '技术实验室尚未建成。需要先完成雷达站，然后在建设页面批准技术实验室工程。';
      r.currentTag.textContent = models.current.length ? '研究中' : '空闲';
      const currentModels = [...models.current, ...models.queue];
      r.currentGrid.update(currentModels);
      r.currentEmpty.hidden = currentModels.length > 0;
      /* Stage 10-P-B.1: CommandGrid.update(models) replaces the whole grid,
       * so each branch grid must be updated exactly once with ALL of its
       * tech tiles. Updating per tech dropped every earlier tile of the
       * branch and left only the last tech per branch rendered. */
      const branchTechIds = {};
      Object.values(TECHNOLOGIES).forEach((tech) => {
        (branchTechIds[tech.branch] = branchTechIds[tech.branch] || []).push(`research:${tech.id}`);
      });
      Object.keys(r.branchGrids).forEach((branch) => {
        r.branchGrids[branch]?.update(models.tech.filter((model) => (branchTechIds[branch] || []).includes(model.id)));
      });
      return;
    }

    r.labTag.textContent = built ? '运行中' : '未建成';
    r.labTag.className = `tag ${built ? 'ok' : 'warn'}`;
    const mods = getResearchModifiers(state);
    setText(r.labHint, built
      ? `技术实验室：运行中 · 电力消耗 5 · 队列 ${(state.research && state.research.current ? 1 : 0) + ((state.research && state.research.queue) || []).length} / ${RESEARCH.maxQueueSize}`
        + ` · 已完成科技 ${((state.research && state.research.completed) || []).length} / 9`
      : '技术实验室尚未建成。需要先完成雷达站，然后在建设页面批准技术实验室工程。');
    const progress = getResearchProgress(state);
    r.currentBox.innerHTML = '';
    r.currentTag.textContent = progress ? '研究中' : '空闲';
    r.currentTag.className = `tag ${progress ? 'warn' : ''}`.trim();
    if (progress) {
      r.currentBox.appendChild(el('div', 'cs-name', progress.name));
      r.currentBox.appendChild(el('div', 'kv', `已用 ${formatDuration(Math.floor(progress.elapsed))} · 剩余 ${formatDuration(Math.ceil(progress.remaining))}`));
      const bar = el('div', 'bar research');
      const fill = el('i');
      fill.style.width = `${progress.percent}%`;
      bar.appendChild(fill);
      r.currentBox.appendChild(bar);
      const cancel = el('button', 'btn danger', '取消当前研究');
      cancel.type = 'button';
      cancel.addEventListener('click', () => this.handlers.onCancelCurrentResearch && this.handlers.onCancelCurrentResearch({ confirm: true }));
      r.currentBox.appendChild(cancel);
    } else r.currentBox.appendChild(el('div', 'hint', built ? '实验室空闲，可从科技树选择研究。' : '实验室建成后可开始研究。'));
    const queue = (state.research && state.research.queue) || [];
    r.queueTag.textContent = `${queue.length + (state.research && state.research.current ? 1 : 0)} / ${RESEARCH.maxQueueSize}`;
    r.queueList.innerHTML = '';
    queue.forEach((task, index) => {
      const row = el('div', 'research-queue-row');
      row.appendChild(el('span', '', `${index + 2}. ${(TECHNOLOGIES[task.techId] || {}).name || task.techId}`));
      row.appendChild(el('span', 'dim', `${task.duration}秒 · ${this._costText(task.costPaid)}`));
      const cancel = el('button', 'btn small danger', '取消');
      cancel.type = 'button';
      cancel.addEventListener('click', () => this.handlers.onCancelQueuedResearch && this.handlers.onCancelQueuedResearch(task.id, { confirm: true }));
      row.appendChild(cancel);
      r.queueList.appendChild(row);
    });
    Object.keys(r.cards).forEach((id) => {
      const card = r.cards[id];
      const view = getTechnologyState(state, id);
      const labels = { completed: '已完成', researching: '研究中', queued: '队列中', available: '可研究', locked: '未解锁', unknown: '未知' };
      card.status.textContent = labels[view.status] || view.status;
      card.status.className = `tag ${view.status === 'completed' ? 'ok' : view.status === 'available' ? 'warn' : ''}`.trim();
      card.btn.disabled = !built || view.status !== 'available';
      card.reason.hidden = view.status === 'available' || view.status === 'completed';
      setText(card.reason, view.reason || '');
    });
  }

  refreshResearch(state) {
    this._updateResearch(state);
    this._updateResources(state);
    this._updateOverview(state);
  }

  /* ==========================================================
   * 战报页（阶段5）
   * ======================================================== */

  /** 构建战报分页：统计 → 历史列表 → 详细战报 */
  _buildReportsPage(page) {
    const r = this.refs;
    r.rp = { sig: {} };

    /* Stage 10-P-B：紧凑战报 Tile，完整战报进 Inspector */
    const statHead = el('div', 'command-section-head');
    statHead.appendChild(el('span', '', 'BATTLE LOG'));
    r.rp.statTag = el('small', '', '0 份');
    statHead.appendChild(r.rp.statTag);
    page.appendChild(statHead);
    r.rp.empty = el('div', 'command-empty', '尚无战报。前往「战区」分页派遣编队出击后，战斗结束即可在此查看完整复盘。');
    page.appendChild(r.rp.empty);
    r.rp.gridRoot = el('div', 'command-grid command-report-grid');
    r.rp.gridRoot.dataset.commandScope = 'reports';
    page.appendChild(r.rp.gridRoot);
    r.rp.grid = this.commandSurface.createGrid(r.rp.gridRoot, () => {});
    page.appendChild(el('div', 'command-gesture-hint', '点击查看完整战报 · 悬浮要点 · 长按详情'));
    return;

    const stat = el('div', 'card');
    const sHead = el('div', 'card-head');
    sHead.appendChild(el('span', '', '战斗统计'));
    r.rp.statTag = el('span', 'tag', '0 场');
    sHead.appendChild(r.rp.statTag);
    stat.appendChild(sHead);
    const mkKv = (label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '—');
      row.appendChild(v);
      stat.appendChild(row);
      return v;
    };
    r.rp.statFought = mkKv('累计交战');
    r.rp.statWin = mkKv('占领成功');
    r.rp.statTheater = mkKv('已占领战区');
    page.appendChild(stat);

    const listHead = el('div', 'section-head');
    listHead.appendChild(el('span', '', '历史战报'));
    r.rp.listTag = el('span', 'tag', `最多保留 ${BATTLE.maxReports} 份`);
    listHead.appendChild(r.rp.listTag);
    page.appendChild(listHead);

    r.rp.list = el('div', 'rp-list');
    page.appendChild(r.rp.list);
    r.rp.empty = el('div', 'hint', '尚无战报。前往「战区」分页派遣编队出击后，战斗结束即可在此查看完整复盘。');
    page.appendChild(r.rp.empty);

    r.rp.detail = el('div', 'card rp-detail');
    r.rp.detail.hidden = true;
    page.appendChild(r.rp.detail);

    const note = el('div', 'hint');
    note.innerHTML = '<b>说明：</b>战报中的随机种子决定了整场战斗的全部判定；'
      + '相同种子、相同编队与相同策略必然得到完全相同的结果，可用于复盘与验证。';
    page.appendChild(note);
  }

  /** 刷新战报页 */
  _updateReports(state) {
    const p = this.refs.rp;
    if (!p) return;

    /* Stage 10-P-B path：紧凑历史记录，完整战报进 Inspector */
    if (p.grid) {
      const reports = getReports(state);
      const stats = state.stats || {};
      const capturedCount = Object.keys(THEATERS)
        .filter((id) => state.theaters && state.theaters[id] && state.theaters[id].captured).length;
      p.statTag.textContent = `${reports.length} 份 · 交战 ${formatInt(safeNumber(stats.battlesFought, 0))} · 占领 ${formatInt(safeNumber(stats.victories, 0))} · 战区 ${capturedCount}/${Object.keys(THEATERS).length}`;
      const models = buildReportModels(state);
      const active = getActiveBattle(state);
      models.forEach((model) => {
        const reportId = model.id.slice('report:'.length);
        const session = Object.values(state?.battleSessions || {})
          .find((row) => row && row.formalReportId === reportId);
        const applied = Boolean(session?.settlementId && state?.battleSettlementLedger?.[session.settlementId]);
        model.inspector.actions = [
          { id: 'replay-report', label: '只读回放', payload: { reportId }, disabled: !applied || Boolean(active) },
          ...(session && !active
            ? [{ id: 'claim-battle-salvage', label: '回收装备', payload: { battleSessionId: session.battleSessionId } }]
            : [])
        ];
      });
      p.grid.update(models);
      p.empty.hidden = models.length > 0;
      return;
    }

    if (!p.list) return;

    const reports = getReports(state);
    const stats = state.stats || {};
    const capturedCount = Object.keys(THEATERS)
      .filter((id) => state.theaters && state.theaters[id] && state.theaters[id].captured).length;

    setText(p.statTag, `${reports.length} 份`);
    setText(p.statFought, `${formatInt(safeNumber(stats.battlesFought, 0))} 场`);
    setText(p.statWin, `${formatInt(safeNumber(stats.victories, 0))} 次`);
    setText(p.statTheater, `${capturedCount} / ${Object.keys(THEATERS).length}`);

    p.empty.hidden = reports.length > 0;

    if (this.selectedReportId && !reports.some((x) => x && x.id === this.selectedReportId)) {
      this.selectedReportId = null;
    }
    if (!this.selectedReportId && reports.length > 0) this.selectedReportId = reports[0].id;

    const listSig = reports.map((x) => x.id).join('|') + `#${this.selectedReportId || ''}`;
    if (listSig !== p.sig.list) {
      p.sig.list = listSig;
      p.list.innerHTML = '';
      reports.forEach((rep) => p.list.appendChild(this._renderReportRow(rep)));
    }

    const current = reports.find((x) => x.id === this.selectedReportId) || null;
    p.detail.hidden = !current;
    if (!current) { p.sig.detail = ''; return; }
    // The replay control depends on settlement having been applied and on
    // there being no active battle. A report id alone is therefore not a
    // sufficient render signature: after returning from the result panel,
    // the same report must be rebuilt so its read-only replay button becomes
    // enabled without requiring a manual page reload.
    const active = getActiveBattle(state);
    const session = Object.values(state?.battleSessions || {})
      .find((row) => row && row.formalReportId === current.id);
    const settlementApplied = Boolean(session?.settlementId && state?.battleSettlementLedger?.[session.settlementId]);
    const detailSig = `${current.id}#${active?.battleSessionId || ''}#${settlementApplied ? 1 : 0}`;
    if (p.sig.detail === detailSig) return;
    p.sig.detail = detailSig;
    this._renderReportDetail(p.detail, current, state);
  }

  /** 战报列表中的一行 */
  _renderReportRow(report) {
    const row = el('div', 'rp-row');
    row.dataset.reportId = report.id;
    row.dataset.action = 'select-report';
    if (report.id === this.selectedReportId) row.classList.add('is-active');

    const head = el('div', 'rp-row-head');
    head.appendChild(el('span', 'rp-row-name', `${report.missionKind === 'operation' ? `重复任务 · ${report.missionId}` : report.theaterName} · ${report.formationName}`));
    head.appendChild(el('span', `tag ${RESULT_TONE[report.result] || ''}`.trim(), resultLabel(report.result)));
    row.appendChild(head);

    const meta = el('div', 'rp-row-meta');
    meta.appendChild(el('span', '', report.strategyName));
    if (report.missionKind === 'operation') meta.appendChild(el('span', 'operation-report-tag', `经验 ×${report.experienceMultiplier || 1}`));
    meta.appendChild(el('span', '', `${(report.rounds || []).length} 轮`));
    const lostN = ((report.losses && report.losses.friendly) || []).filter((l) => !l.recovered).length;
    meta.appendChild(el('span', '', `损失 ${lostN}`));
    meta.appendChild(el('span', '', `种子 ${report.seed}`));
    row.appendChild(meta);

    row.addEventListener('click', () => {
      this.selectedReportId = report.id;
      if (this.refs.rp) { this.refs.rp.sig.list = ''; this.refs.rp.sig.detail = ''; }
      const fn = this.handlers.onSelectReport;
      if (typeof fn === 'function') fn(report.id);
    });
    return row;
  }

  /** 渲染详细战报 */
  _renderReportDetail(box, report, state = null) {
    box.innerHTML = '';

    const head = el('div', 'card-head');
    head.appendChild(el('span', '', '战报详情'));
    head.appendChild(el('span', `tag ${RESULT_TONE[report.result] || ''}`.trim(), resultLabel(report.result)));
    box.appendChild(head);

    box.appendChild(el('div', 'rp-title', `${report.missionKind === 'operation' ? `重复任务 · ${report.missionId}` : report.theaterName} · ${report.formationName}`));
    box.appendChild(el('p', 'rp-summary', report.summary || ''));

    const session = Object.values(state?.battleSessions || {})
      .find((row) => row && row.formalReportId === report.id);
    if (session) {
      const sessionBox = el('div', 'hint');
      const applied = Boolean(session.settlementId && state?.battleSettlementLedger?.[session.settlementId]);
      sessionBox.appendChild(el('span', '', `正式会话 ${session.battleSessionId} · ${applied ? '结算已应用' : '结算未完成'}`));
      const replay = el('button', 'btn', '只读回放');
      replay.type = 'button';
      replay.dataset.action = 'replay-report';
      replay.dataset.reportId = report.id;
      replay.disabled = !applied || !!getActiveBattle(state);
      replay.addEventListener('click', () => this._onTheaterAction('onReplayReport', report.id));
      sessionBox.appendChild(replay);
      box.appendChild(sessionBox);

      // 历史战报只读取同一正式会话的确定性打捞结果；不在 UI 层复制
      // 掉落概率、装备池或资格判断。
      const salvage = deriveSalvageOffer(state, session.battleSessionId);
      const salvageBox = el('div', 'battle-salvage');
      const salvageHead = el('div', 'section-head sub');
      salvageHead.appendChild(el('span', '', '战场打捞历史'));
      salvageHead.appendChild(el('span', 'tag', '正式结算后'));
      salvageBox.appendChild(salvageHead);
      if (!salvage.ok || salvage.outcome !== 'equipment') {
        salvageBox.appendChild(el('div', 'hint', salvage.ok ? '本次未发现可回收装备。' : (salvage.reason || '本次作战不适用战场打捞。')));
      } else {
        const def = getEquipmentDefinition(salvage.equipmentId);
        salvageBox.appendChild(el('div', salvage.claimed ? 'hint good' : 'hint', `${salvage.claimed ? '已回收' : '发现'}：${def?.name || salvage.equipmentId}`));
        if (salvage.claimed) {
          salvageBox.appendChild(el('div', 'hint', `历史实例 ${salvage.claim?.instanceId || salvage.instanceId}`));
        } else if (!getActiveBattle(state)) {
          const claim = el('button', 'btn primary', '回收装备');
          claim.type = 'button'; claim.dataset.action = 'claim-battle-salvage'; claim.dataset.battleSessionId = session.battleSessionId;
          claim.addEventListener('click', () => this._onTheaterAction('onClaimBattleSalvage', session.battleSessionId));
          salvageBox.appendChild(claim);
        } else {
          salvageBox.appendChild(el('div', 'hint', '请在结算面板领取；只读回放中不能领取。'));
        }
      }
      box.appendChild(salvageBox);
    }

    const mk = (label, value) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      row.appendChild(el('span', '', value));
      box.appendChild(row);
    };
    mk('随机种子', String(report.seed));
    mk('作战策略', report.strategyName);
    if (report.tactics) {
      mk('战术编组', `${report.tactics.name || '常规展开'}${report.tactics.combinedArms ? '（坦克前置、步兵护翼、反装甲后置警戒）' : ''}`);
      const metrics = report.tactics.metrics || {};
      if (Number.isFinite(Number(metrics.coordination)) && metrics.coordination > 0) {
        mk('协同强度', `${Math.round(Number(metrics.coordination) * 100)}%`);
      }
    }
    if (report.missionKind === 'operation') {
      const op = OPERATIONS[report.missionId];
      mk('任务类型', op ? `${op.name}（${op.cooldown}s 冷却）` : report.missionId);
      mk('经验倍率', `×${report.experienceMultiplier || 1}`);
    }
    mk('战场地形', (THEATERS[report.theaterId] || {}).terrainName || report.terrain);
    mk('战斗时长', `${formatInt(report.duration)} 秒`);
    mk('我方参战', `${((report.initial && report.initial.friendly) || []).length} 个单位`);
    mk('敌方兵力', `${((report.initial && report.initial.enemy) || []).length} 个单位`);
    const scout = report.scout || {};
    mk('侦察结果', `侦察值 ${formatInt(scout.friendlyScouting)} · 伏击概率 ${Math.round(safeNumber(scout.ambushChance, 0) * 100)}%`
      + ` · 先手 ${scout.firstStrike === 'friendly' ? '我方' : '敌方'}`);

    // 四阶段
    const ph = el('div', 'section-head sub');
    ph.appendChild(el('span', '', '作战经过'));
    ph.appendChild(el('span', 'tag', `${(report.phases || []).length} 个阶段`));
    box.appendChild(ph);
    (report.phases || []).forEach((phase) => {
      const item = el('div', 'rp-phase');
      item.appendChild(el('div', 'rp-phase-title', phase.title));
      item.appendChild(el('div', 'rp-phase-sum', phase.summary || ''));
      if (Array.isArray(phase.details) && phase.details.length) {
        const ul = el('ul', 'rp-phase-list');
        phase.details.forEach((d) => ul.appendChild(el('li', '', d)));
        item.appendChild(ul);
      }
      box.appendChild(item);
    });

    // 损失与奖励
    const lh = el('div', 'section-head sub');
    lh.appendChild(el('span', '', '战损与收获'));
    box.appendChild(lh);
    const lost = (report.losses && report.losses.friendly) || [];
    const permanent = lost.filter((l) => !l.recovered);
    const recovered = lost.filter((l) => l.recovered);
    mk('我方永久损失', permanent.length ? permanent.map((l) => l.name).join('、') : '无');
    mk('战地抢救回收', recovered.length ? recovered.map((l) => l.name).join('、') : '无');
    mk('敌方损失', `${((report.losses && report.losses.enemy) || []).length} 个单位`);
    mk('是否占领', report.capture ? '是' : '否');
    mk('首占奖励', Object.keys(report.rewards || {}).length ? formatMissionCost(report.rewards) : '无');

    // 原因分析
    const reasons = report.reasons || { advantages: [], problems: [] };
    if (reasons.advantages.length || reasons.problems.length) {
      const rh = el('div', 'section-head sub');
      rh.appendChild(el('span', '', '胜负原因'));
      box.appendChild(rh);
      const ul = el('ul', 'th-reasons');
      reasons.advantages.forEach((x) => ul.appendChild(el('li', 'good', x)));
      reasons.problems.forEach((x) => ul.appendChild(el('li', 'risk', x)));
      box.appendChild(ul);
    }

    // 事件时间轴
    const eh = el('div', 'section-head sub');
    eh.appendChild(el('span', '', '事件时间轴'));
    eh.appendChild(el('span', 'tag', `${(report.events || []).length} 条`));
    box.appendChild(eh);
    const timeline = el('div', 'rp-timeline');
    (report.events || []).forEach((ev) => {
      const li = el('div', `rp-ev ${ev.type || ''}`.trim());
      li.appendChild(el('span', 't', `${safeNumber(ev.t, 0).toFixed(1)}s`));
      li.appendChild(el('span', 'm', ev.text || ''));
      timeline.appendChild(li);
    });
    box.appendChild(timeline);
  }

  /* ==========================================================
   * 维修与补员页（阶段6）
   * ======================================================== */

  /** 损伤等级 → 中文名 */
  _damageLabel(state) {
    return {
      [DAMAGE_STATES.INTACT]: '完好',
      [DAMAGE_STATES.LIGHT]: '轻伤',
      [DAMAGE_STATES.HEAVY]: '重伤',
      [DAMAGE_STATES.DESTROYED]: '已损毁'
    };
  }

  _buildRepairsPage(page) {
    const r = this.refs;
    r.repairs = {};

    /* Stage 10-P-B：portrait Tile + 进度覆盖 + 紧凑队列 */
    const shopHead = el('div', 'command-section-head');
    shopHead.appendChild(el('span', '', 'REPAIR BAY'));
    r.repairs.shopTag = el('small', '', '——');
    shopHead.appendChild(r.repairs.shopTag);
    page.appendChild(shopHead);
    r.repairs.shopHint = el('div', 'command-gesture-hint', '');
    page.appendChild(r.repairs.shopHint);

    r.repairs.activeEmpty = el('div', 'command-empty', '当前没有进行中的维修');
    page.appendChild(r.repairs.activeEmpty);
    r.repairs.activeGridRoot = el('div', 'command-grid command-repair-grid');
    page.appendChild(r.repairs.activeGridRoot);
    r.repairs.activeGrid = this.commandSurface.createQueue(r.repairs.activeGridRoot, () => {});

    const queueHead = el('div', 'command-section-head');
    queueHead.appendChild(el('span', '', 'QUEUE'));
    r.repairs.queueTag = el('small', '', '0');
    queueHead.appendChild(r.repairs.queueTag);
    page.appendChild(queueHead);
    r.repairs.queueEmpty = el('div', 'command-empty', '等待队列为空');
    page.appendChild(r.repairs.queueEmpty);
    r.repairs.queueGridRoot = el('div', 'command-grid command-repair-grid');
    page.appendChild(r.repairs.queueGridRoot);
    r.repairs.queueGrid = this.commandSurface.createQueue(r.repairs.queueGridRoot, () => {});

    const candHead = el('div', 'command-section-head');
    candHead.appendChild(el('span', '', 'DAMAGED'));
    r.repairs.candTag = el('small', '', '0');
    candHead.appendChild(r.repairs.candTag);
    page.appendChild(candHead);
    r.repairs.candEmpty = el('div', 'command-empty', '所有单位状态完好，无需维修');
    page.appendChild(r.repairs.candEmpty);
    r.repairs.candGridRoot = el('div', 'command-grid command-roster-grid');
    r.repairs.candGridRoot.dataset.commandScope = 'repairs';
    page.appendChild(r.repairs.candGridRoot);
    r.repairs.candGrid = this.commandSurface.createGrid(r.repairs.candGridRoot, (model) => this._onCommandPrimary(model));
    page.appendChild(el('div', 'command-gesture-hint', '点击送修 · 悬浮费用与时长 · 长按详情'));
    return;
    {
    // —— 维修车间状态 ——
    const shop = el('div', 'card repair-shop');
    const shopHead = el('div', 'card-head');
    shopHead.appendChild(el('span', '', '维修车间'));
    r.repairs.shopTag = el('span', 'tag', '——');
    shopHead.appendChild(r.repairs.shopTag);
    shop.appendChild(shopHead);
    r.repairs.shopHint = el('div', 'kv dim', '');
    shop.appendChild(r.repairs.shopHint);
    page.appendChild(shop);

    // —— 工位占用 ——
    const slots = el('div', 'card repair-slots');
    const slotsHead = el('div', 'card-head');
    slotsHead.appendChild(el('span', '', '维修工位'));
    r.repairs.slotsTag = el('span', 'tag', '0 / 2');
    slotsHead.appendChild(r.repairs.slotsTag);
    slots.appendChild(slotsHead);
    r.repairs.activeList = el('div', 'repair-active-list');
    slots.appendChild(r.repairs.activeList);
    page.appendChild(slots);

    // —— 等待队列 ——
    const queue = el('div', 'card repair-queue');
    const queueHead = el('div', 'card-head');
    queueHead.appendChild(el('span', '', '等待队列'));
    r.repairs.queueTag = el('span', 'tag', '0');
    queueHead.appendChild(r.repairs.queueTag);
    queue.appendChild(queueHead);
    r.repairs.queueList = el('div', 'repair-queue-list');
    queue.appendChild(r.repairs.queueList);
    page.appendChild(queue);

    // —— 可维修单位 ——
    const candidates = el('div', 'card repair-candidates');
    const cHead = el('div', 'card-head');
    cHead.appendChild(el('span', '', '受损单位'));
    r.repairs.candTag = el('span', 'tag', '0');
    cHead.appendChild(r.repairs.candTag);
    candidates.appendChild(cHead);
    r.repairs.candHint = el('div', 'kv dim', '战斗中受损的单位会在此列出，点击「送去维修」即可排队修复。');
    candidates.appendChild(r.repairs.candHint);
    r.repairs.candList = el('div', 'repair-cand-list');
    candidates.appendChild(r.repairs.candList);
    page.appendChild(candidates);
    }
  }

  /** 维修页内容刷新（结构变化时重建列表，进度变化只更新数字） */
  _updateRepairs(state) {
    const r = this.refs;
    if (!r.repairs) return;
    const labels = this._damageLabel(state);

    /* Stage 10-P-B path：Tile 网格，CommandGrid 自身按 id 增量刷新 */
    if (r.repairs.candGrid) {
      const models = buildRepairCommandModels(state);
      const hasShop = hasRepairShop(state);
      r.repairs.shopTag.textContent = hasShop
        ? `已运行 · 工位 ${models.active.length}/${REPAIR.maxConcurrent}`
        : '未建成（可先排队）';
      r.repairs.shopHint.textContent = hasShop
        ? `同时进行 ${REPAIR.maxConcurrent} 项维修，队列最多 ${REPAIR.maxQueueSize} 项`
        : '建造「装甲工厂」后开启维修车间';
      r.repairs.activeGrid.update(models.active);
      r.repairs.activeEmpty.hidden = models.active.length > 0;
      r.repairs.queueGrid.update(models.queued);
      r.repairs.queueTag.textContent = `${models.queued.length}`;
      r.repairs.queueEmpty.hidden = models.queued.length > 0;
      r.repairs.candGrid.update(models.candidates);
      r.repairs.candTag.textContent = `${models.candidates.length}`;
      r.repairs.candEmpty.hidden = models.candidates.length > 0;
      return;
    }


    // 车间状态
    const hasShop = hasRepairShop(state);
    if (r.repairs.shopTag) {
      r.repairs.shopTag.textContent = hasShop ? '已运行' : '未建成';
      r.repairs.shopTag.className = `tag ${hasShop ? 'ok' : 'warn'}`;
    }
    if (r.repairs.shopHint) {
      r.repairs.shopHint.textContent = hasShop
        ? `同时进行 ${REPAIR.maxConcurrent} 项维修，队列最多 ${REPAIR.maxQueueSize} 项。`
        : '建造「装甲工厂」后开启维修车间（受损单位仍可排队，车间建成即生效）。';
    }

    // 工位占用
    const active = getActiveRepairs(state);
    const queued = getQueuedRepairs(state);
    if (r.repairs.slotsTag) {
      r.repairs.slotsTag.textContent = `${active.length} / ${REPAIR.maxConcurrent}`;
    }

    // 活跃维修列表（签名变化才重建）
    const activeSig = active.map((j) => `${j.id}:${Math.floor(getRepairProgress(j) * 50)}`).join('|');
    if (activeSig !== this._repairActiveSig && r.repairs.activeList) {
      this._repairActiveSig = activeSig;
      r.repairs.activeList.innerHTML = '';
      if (active.length === 0) {
        r.repairs.activeList.appendChild(el('div', 'kv dim', '当前没有进行中的维修。'));
      } else {
        active.forEach((job) => {
          r.repairs.activeList.appendChild(this._renderActiveRepair(state, job, labels));
        });
      }
    } else {
      // 仅更新进度数字
      active.forEach((job) => {
        const node = r.repairs.activeList && r.repairs.activeList.querySelector(`[data-job="${job.id}"]`);
        if (!node) return;
        const pct = Math.floor(getRepairProgress(job) * 100);
        const bar = node.querySelector('.bar i');
        if (bar) bar.style.width = `${pct}%`;
        const rem = node.querySelector('[data-rem]');
        if (rem) rem.textContent = `剩余 ${formatDuration(getRepairRemaining(job))}`;
      });
    }

    // 等待队列（签名变化才重建）
    const queueSig = queued.map((j) => j.id).join('|');
    if (queueSig !== this._repairQueueSig && r.repairs.queueList) {
      this._repairQueueSig = queueSig;
      r.repairs.queueList.innerHTML = '';
      if (r.repairs.queueTag) r.repairs.queueTag.textContent = `${queued.length}`;
      if (queued.length === 0) {
        r.repairs.queueList.appendChild(el('div', 'kv dim', '等待队列为空。'));
      } else {
        queued.forEach((job) => {
          r.repairs.queueList.appendChild(this._renderQueuedRepair(state, job, labels));
        });
      }
    }

    // 可维修单位（签名变化才重建）
    const damaged = (state.units || []).filter((u) => {
      if (!u || u.status === 'repairing' || u.status === 'deployed') return false;
      const ds = damageStateOfUnit(u);
      return ds === DAMAGE_STATES.LIGHT || ds === DAMAGE_STATES.HEAVY;
    });
    const candSig = damaged.map((u) => `${u.id}:${damageStateOfUnit(u)}:${Math.floor(safeNumber(u.hp, 0))}`).join('|');
    if (candSig !== this._repairCandSig && r.repairs.candList) {
      this._repairCandSig = candSig;
      r.repairs.candList.innerHTML = '';
      if (r.repairs.candTag) r.repairs.candTag.textContent = `${damaged.length}`;
      if (damaged.length === 0) {
        r.repairs.candList.appendChild(el('div', 'kv dim', '所有单位状态完好，无需维修。'));
      } else {
        damaged.forEach((unit) => {
          r.repairs.candList.appendChild(this._renderCandidate(state, unit, labels));
        });
      }
    }
  }

  /** 单个进行中维修卡片 */
  _renderActiveRepair(state, job, labels) {
    const row = el('div', 'repair-item active');
    row.dataset.job = job.id;
    row.appendChild(el('span', 'ri-name', job.unitName));
    row.appendChild(el('span', 'tag warn', labels[job.severity] || job.severity));
    const barWrap = el('div', 'cs-bar-wrap');
    const bar = el('div', 'bar build');
    const inner = el('i');
    inner.style.width = `${Math.floor(getRepairProgress(job) * 100)}%`;
    bar.appendChild(inner);
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    const rem = el('span', 'kv dim');
    rem.dataset.rem = '1';
    rem.textContent = `剩余 ${formatDuration(getRepairRemaining(job))}`;
    row.appendChild(rem);
    const cancelBtn = el('button', 'btn mini warn', '取消');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      if (this.handlers.onCancelRepair) this.handlers.onCancelRepair(job.id);
    });
    row.appendChild(cancelBtn);
    return row;
  }

  /** 单个排队中维修卡片 */
  _renderQueuedRepair(state, job, labels) {
    const row = el('div', 'repair-item queued');
    row.dataset.job = job.id;
    row.appendChild(el('span', 'ri-name', job.unitName));
    row.appendChild(el('span', 'tag warn', labels[job.severity] || job.severity));
    row.appendChild(el('span', 'kv dim', `预计 ${formatDuration(job.duration)}`));
    const cancelBtn = el('button', 'btn mini warn', '取消');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      if (this.handlers.onCancelRepair) this.handlers.onCancelRepair(job.id);
    });
    row.appendChild(cancelBtn);
    return row;
  }

  /** 可维修单位卡片 */
  _renderCandidate(state, unit, labels) {
    const def = UNITS[unit.type] || {};
    const ds = damageStateOfUnit(unit);
    const check = canQueueRepair(state, unit.id);
    const row = el('div', 'repair-item candidate');
    row.appendChild(el('span', 'ri-name', def.name || '单位'));
    row.appendChild(el('span', 'tag danger', labels[ds] || ds));
    const hpRow = el('span', 'kv dim');
    hpRow.textContent = `耐久 ${formatInt(safeNumber(unit.hp, 0))} / ${formatInt(safeNumber(unit.maxHp, 0))}`;
    row.appendChild(hpRow);
    const cost = getRepairCost(ds);
    const costText = Object.keys(cost)
      .map((k) => `${RESOURCE_DEFS[k] ? RESOURCE_DEFS[k].name : k} ${formatInt(cost[k])}`)
      .join(' / ');
    row.appendChild(el('span', 'kv dim', `费用 ${costText || '——'}`));
    const repairBtn = el('button', 'btn mini', '送去维修');
    repairBtn.type = 'button';
    repairBtn.disabled = !check.ok;
    if (!check.ok) repairBtn.title = check.reason || '当前无法维修';
    repairBtn.addEventListener('click', () => {
      if (this.handlers.onRepair) this.handlers.onRepair(unit.id);
    });
    row.appendChild(repairBtn);
    return row;
  }

  /** 离线报告渲染（Stage 10-P-B：与新 Overview 共用） */
  _updateOfflineBox(state, offlineBox) {
    if (!offlineBox) return;
    const o = state.offline;
    if (o && o.shown !== true) {
      offlineBox.hidden = false;
      offlineBox.innerHTML = '';
      const head = el('div', 'card-head');
      head.appendChild(el('span', '', '离线报告'));
      head.appendChild(el('span', `tag ${o.settled ? 'ok' : 'warn'}`, o.settled ? '已结算' : '未结算'));
      offlineBox.appendChild(head);
      const viewBtn = el('button', 'btn offline-view-btn', '查看报告');
      viewBtn.type = 'button';
      viewBtn.dataset.action = 'view-offline-report';
      viewBtn.addEventListener('click', () => {
        offlineBox.dataset.viewed = 'true';
        viewBtn.hidden = true;
      });
      offlineBox.appendChild(viewBtn);
      const durRow = el('div', 'kv');
      durRow.appendChild(el('span', '', '离线时长'));
      let durText = o.text || '';
      if (o.capped && o.rawSeconds > o.seconds) durText += `（原 ${formatDuration(o.rawSeconds)}，已按上限截断）`;
      durRow.appendChild(el('span', '', durText));
      offlineBox.appendChild(durRow);
      (o.lines || []).forEach((line) => offlineBox.appendChild(el('div', 'kv dim', line)));
      const btnRow = el('div', 'offline-actions');
      const btn = el('button', 'btn', '知道了');
      btn.type = 'button';
      btn.dataset.action = 'dismiss-offline-report';
      btn.addEventListener('click', () => this.handlers.onDismissOfflineReport?.());
      btnRow.appendChild(btn);
      offlineBox.appendChild(btnRow);
    } else if (!o) {
      offlineBox.hidden = true;
    }
  }

  /** 基地概览页 */
  _buildOverview(page) {
    const r = this.refs;

    /* Stage 10-P-B：Commander Overview —— 只保留需要立即关注的信息 */
    const head = el('div', 'command-section-head ov-command-head');
    head.appendChild(el('span', '', 'COMMAND OVERVIEW'));
    r.briefTag = el('small', '', '战备就绪');
    head.appendChild(r.briefTag);
    page.appendChild(head);

    r.ovStatus = el('div', 'ov-status-line', '—');
    page.appendChild(r.ovStatus);

    const opsHead = el('div', 'command-section-head');
    opsHead.appendChild(el('span', '', 'ACTIVE OPERATIONS'));
    opsHead.appendChild(el('small', '', '当前施工 / 生产 / 科研 / 维修 / 作战'));
    page.appendChild(opsHead);
    r.ovEmpty = el('div', 'command-empty', '基地待命，没有进行中的任务');
    page.appendChild(r.ovEmpty);
    r.ovGridRoot = el('div', 'command-grid command-overview-grid');
    r.ovGridRoot.dataset.commandScope = 'overview';
    page.appendChild(r.ovGridRoot);
    r.ovGrid = this.commandSurface.createGrid(r.ovGridRoot, () => {});

    r.ovWarnBox = el('div', 'ov-warnings');
    page.appendChild(r.ovWarnBox);

    // —— 离线提示（读档时显示） ——
    r.offlineBox = el('div', 'card');
    r.offlineBox.id = 'offline-report';
    r.offlineBox.dataset.action = 'offline-report-view';
    r.offlineBox.hidden = true;
    page.appendChild(r.offlineBox);
    return;

    // —— 指挥官简报 ——
    const brief = el('div', 'card');
    const briefHead = el('div', 'card-head');
    briefHead.appendChild(el('span', '', '指挥官简报'));
    // Production UI must not expose internal stage identifiers.  The debug
    // renderer/text channel still carries CURRENT_STAGE_LABEL for diagnostics.
    r.briefTag = el('span', 'tag ok', '战备就绪');
    briefHead.appendChild(r.briefTag);
    brief.appendChild(briefHead);

    const mkKv = (label) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', label));
      const v = el('span', '', '—');
      row.appendChild(v);
      return { row, v };
    };
    const kvPlayed = mkKv('已运行时长');
    const kvBuildings = mkKv('运行中建筑');
    const kvSave = mkKv('上次保存');
    const kvSpeed = mkKv('推演速度');
    r.kvPlayed = kvPlayed.v;
    r.kvBuildings = kvBuildings.v;
    r.kvSave = kvSave.v;
    r.kvSpeed = kvSpeed.v;
    [kvPlayed, kvBuildings, kvSave, kvSpeed].forEach((k) => brief.appendChild(k.row));
    page.appendChild(brief);

    // —— 电力与指挥容量 ——
    const cap = el('div', 'card');
    const capHead = el('div', 'card-head');
    capHead.appendChild(el('span', '', '基地负载'));
    r.capTag = el('span', 'tag ok', '正常');
    capHead.appendChild(r.capTag);
    cap.appendChild(capHead);

    const powerRow = el('div', 'kv');
    powerRow.appendChild(el('span', '', '电力'));
    r.ovPower = el('span', '', '0 / 0');
    powerRow.appendChild(r.ovPower);
    cap.appendChild(powerRow);
    const powerBar = el('div', 'bar power');
    r.ovPowerBar = el('i');
    powerBar.appendChild(r.ovPowerBar);
    cap.appendChild(powerBar);

    const cmdRow = el('div', 'kv');
    cmdRow.appendChild(el('span', '', '指挥容量'));
    r.ovCommand = el('span', '', '0 / 0');
    cmdRow.appendChild(r.ovCommand);
    cap.appendChild(cmdRow);
    const cmdBar = el('div', 'bar command');
    r.ovCommandBar = el('i');
    cmdBar.appendChild(r.ovCommandBar);
    cap.appendChild(cmdBar);
    page.appendChild(cap);

    // —— 资源产出 ——
    const prod = el('div', 'card');
    const prodHead = el('div', 'card-head');
    prodHead.appendChild(el('span', '', '资源产出'));
    prodHead.appendChild(el('span', 'tag', '每秒'));
    prod.appendChild(prodHead);
    r.ovRates = {};
    Object.keys(RESOURCE_DEFS).forEach((key) => {
      const row = el('div', 'kv');
      row.appendChild(el('span', '', RESOURCE_DEFS[key].name));
      const v = el('span', '', '+0/s');
      row.appendChild(v);
      prod.appendChild(row);
      r.ovRates[key] = v;
    });
    page.appendChild(prod);

    // —— 建筑清单 ——
    const blds = el('div', 'card');
    const bldsHead = el('div', 'card-head');
    bldsHead.appendChild(el('span', '', '基地设施'));
    r.bldTag = el('span', 'tag', '0 座');
    bldsHead.appendChild(r.bldTag);
    blds.appendChild(bldsHead);
    r.ovBuildingList = el('ul', 'blist');
    blds.appendChild(r.ovBuildingList);
    page.appendChild(blds);

    // —— 阶段交付核对表 ——
    const stage = el('div', 'card');
    const stageHead = el('div', 'card-head');
    stageHead.appendChild(el('span', '', '战区作战'));
    stageHead.appendChild(el('span', 'tag ok', '战区作战'));
    stage.appendChild(stageHead);
    const list = el('ul', 'check-list');
    [
      '顶部资源栏与自动增长',
      'Canvas 伪2.5D 基地画面',
      '雷达旋转、烟雾、施工火花',
      '暂停 / 1× / 2× / 4× 速度（暂停前档位可恢复）',
      '五种建筑的完整建设流程与进度',
      `取消工程并返还 ${Math.round(CONSTRUCTION.refundRatio * 100)}% 资源`,
      '建成后效果立即生效（产量 / 上限 / 电力 / 解锁）',
      `每${TIME.autoSaveInterval}秒自动保存，施工与生产要素可续`,
      '兵营 / 装甲工厂训练与制造五种单位',
      `生产队列（最多 ${PRODUCTION.maxQueueSize} 项）与 50%/100% 取消返还`,
      '单位实例入库与实时库存统计',
      '生产 / 施工动画与出厂表现',
      `作战编队创建、重命名、解散（最多 ${FORMATION.maxFormations} 支）`,
      '单位编入 / 移出与指挥容量实时校验',
      `${FORMATION_PRESETS.length} 套预设模板一键组建（原子操作）`,
      '编队汇总属性与编成评估提示',
      'Canvas 基地集结区编队单位表现',
      `${Object.keys(THEATERS).length} 个战区目标、解锁链与占领收益`,
      '雷达站决定敌情精度（精确编成 / 模糊估算）',
      '三套作战策略（谨慎推进 / 正面突破 / 火力侦察）',
      '任务补给成本预览与派遣资格校验',
      '确定性战斗求解器（同种子必得同结果）',
      `四阶段自动战斗（侦察→接敌→交火≤${BATTLE.maxRounds}轮→结算）`,
      'Canvas 战斗回放（只播放事件，不决定胜负）',
      '战地抢救、压制与维修车修复判定',
      '可解释战报：胜负原因、损失、事件时间轴',
      `历史战报存档（最多 ${BATTLE.maxReports} 份）与存档版本4迁移`,
      '单位档案、呼号、动态老兵等级与战斗属性修正',
      '重复任务：固定成本、冷却、战报与离线就绪提示',
      '战斗派遣快照、确定性重建与结算完整性校验'
    ].forEach((text) => {
      const li = el('li', 'done', text);
      list.appendChild(li);
    });
    stage.appendChild(list);
    page.appendChild(stage);

    // —— 操作提示 ——
    const hint = el('div', 'hint');
    hint.innerHTML = '<b>操作提示：</b>鼠标悬停基地内的建筑或虚线预留位可查看详情；'
      + '空格键暂停/继续，数字键 1 / 2 / 3 切换 1× / 2× / 4× 速度。'
      + '切到「建设」分页可批准新工程，「生产」分页可训练/制造单位，'
      + '「编队」分页可把库存单位编成作战编队，「战区」分页选择目标与策略后派遣出击，'
      + '「部队」分页可管理呼号与老兵档案；占领战区后可选择重复任务，'
      + '战斗结束后可在「战报」分页复盘全过程，冷却会随游戏时间推进。';
    page.appendChild(hint);

    // —— 离线提示（读档时显示） ——
    r.offlineBox = el('div', 'card');
    r.offlineBox.id = 'offline-report';
    r.offlineBox.dataset.action = 'offline-report-view';
    r.offlineBox.hidden = true;
    page.appendChild(r.offlineBox);
  }

  /** 顶部按钮绑定 */
  _bindTopbar() {
    const speedBox = qs('#speed-controls');
    if (speedBox) {
      speedBox.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-speed]');
        if (!btn) return;
        const speed = Number(btn.dataset.speed);
        if (typeof this.handlers.onSpeedChange === 'function') this.handlers.onSpeedChange(speed);
      });
    }

    const bind = (selector, handlerName) => {
      const btn = qs(selector);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const fn = this.handlers[handlerName];
        if (typeof fn === 'function') fn();
      });
    };
    bind('#btn-save', 'onSave');
    bind('#btn-load', 'onLoad');
    bind('#btn-new', 'onNewGame');
  }

  /* ==========================================================
   * 交互
   * ======================================================== */

  /** 切换分页 */
  switchTab(tabId) {
    if (!this.refs.pages || !this.refs.pages[tabId]) return;
    this.activeTab = tabId;
    Object.keys(this.refs.pages).forEach((id) => {
      this.refs.pages[id].hidden = id !== tabId;
    });
    const nav = this.refs.tabs;
    if (nav) {
      Array.from(nav.children).forEach((btn) => {
        toggleClass(btn, 'is-active', btn.dataset.tab === tabId);
      });
    }
    if (typeof this.handlers.onTabChange === 'function') this.handlers.onTabChange(tabId);
  }

  /** 同步速度按钮高亮 */
  setSpeed(speed) {
    const box = qs('#speed-controls');
    if (!box) return;
    Array.from(box.children).forEach((btn) => {
      toggleClass(btn, 'is-active', Number(btn.dataset.speed) === Number(speed));
    });
  }

  /** 短暂提示条 */
  toast(message, level = 'info') {
    const box = this.refs.toast;
    if (!box) return;
    box.textContent = message;
    box.className = `toast ${level === 'info' ? '' : level}`.trim();
    box.hidden = false;
    if (this._toastTimer) window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => { box.hidden = true; }, 2200);
  }

  /* ==========================================================
   * 每帧（节流后）刷新
   * ======================================================== */

  update(state, extra = {}) {
    if (!state) return;
    this._updateResources(state);
    this._updateClock(state);
    this._updateStatChip(state, extra);
    this._updateOverview(state);
    this._updateConstruction(state);
    this._updateProduction(state);
    this._updateUnits(state);
    this._updateFormations(state);
    this._updateTheater(state);
    this._updateReports(state);
    this._updateRepairs(state);
    this._updateResearch(state);
    this._updateLog(state);
    this._updateBattlePresentation(state);
    this._updateBattleOverlay(state);
  }

  /** 资源、施工状态变化后由 main.js 立即调用一次，避免等待下一次节流刷新 */
  refreshConstruction(state) {
    this._updateConstruction(state);
    this._updateResources(state);
    this._updateOverview(state);
  }

  /** 维修队列变化后由 main.js 立即调用一次（阶段6） */
  refreshRepairs(state) {
    this._updateRepairs(state);
    this._updateOverview(state);
  }

  refreshUnits(state) {
    this._updateUnits(state);
  }

  /** 概览页（离线报告）变化后由 main.js 立即调用一次（阶段6） */
  refreshOverview(state) {
    this._updateOverview(state);
  }

  _updateResources(state) {
    const r = this.refs;
    const res = state.resources;
    const caps = state.caps;
    const rates = state.rates;

    setText(r.val_supply, formatInt(res.supply));
    setText(r.cap_supply, `/ ${formatInt(caps.supply)}`);
    setText(r.rate_supply, formatRate(rates.supply));

    setText(r.val_alloy, formatInt(res.alloy));
    setText(r.cap_alloy, `/ ${formatInt(caps.alloy)}`);
    setText(r.rate_alloy, formatRate(rates.alloy));

    setText(r.val_intel, formatInt(res.intel));
    setText(r.cap_intel, `/ ${formatInt(caps.intel)}`);
    setText(r.rate_intel, formatRate(rates.intel));

    const used = safeNumber(state.power.used, 0);
    const produced = safeNumber(state.power.produced, 0);
    setText(r.val_power, formatInt(used));
    setText(r.cap_power, `/ ${formatInt(produced)}`);
    const overload = used > produced;
    setText(r.rate_power, overload ? '超载' : (used === 0 ? '空载' : '正常'));
    toggleClass(r.box_power, 'is-alert', overload);

    const cUsed = safeNumber(state.command.used, 0);
    const cCap = safeNumber(state.command.capacity, 0);
    setText(r.val_command, formatInt(cUsed));
    setText(r.cap_command, `/ ${formatInt(cCap)}`);
    setText(r.rate_command, cUsed >= cCap && cCap > 0 ? '已满' : '空闲');
    toggleClass(r.box_command, 'is-alert', cCap > 0 && cUsed > cCap);

    // 资源接近上限时提示
    toggleClass(r.box_supply, 'is-alert', res.supply >= caps.supply - 0.5);
    toggleClass(r.box_alloy, 'is-alert', res.alloy >= caps.alloy - 0.5);
  }

  _updateClock(state) {
    const clock = formatClock(state.time.game);
    setText(this.refs.clock, clock.text);
    setText(this.refs.day, `第${clock.day + 1}天`);
  }

  _updateStatChip(state, extra) {
    if (!this.refs.statChip) return;
    const fps = safeNumber(extra.fps, 0);
    const speed = safeNumber(state.time.speed, 1);
    const speedText = speed === 0 ? '暂停' : `${speed}×`;
    setText(this.refs.statChip, `FPS ${fps} · ${speedText}`);
  }

  _updateOverview(state) {
    const r = this.refs;
    if (!r.kvPlayed && !r.ovGrid) return;

    /* Stage 10-P-B path：Commander Overview */
    if (r.ovGrid) {
      const used = safeNumber(state.power.used, 0);
      const produced = safeNumber(state.power.produced, 0);
      const speed = safeNumber(state.time.speed, 1);
      r.briefTag.textContent = used > produced ? '电力超载' : '战备就绪';
      setText(r.ovStatus,
        `运行 ${formatDuration(state.time.played)} · ${speed === 0 ? '已暂停' : `${speed}× 速度`}`
        + ` · 电力 ${formatInt(used)}/${formatInt(produced)}`
        + ` · 指挥 ${formatInt(safeNumber(state.command.used, 0))}/${formatInt(safeNumber(state.command.capacity, 0))}`
        + ` · 上次保存 ${state.savedAt ? formatWallClock(state.savedAt) : '尚未保存'}`);
      const models = buildOverviewCommandModels(state);
      r.ovGrid.update(models);
      r.ovEmpty.hidden = models.length > 1;
      const warns = [];
      if (used > produced) warns.push('电力超载：部分设施效率下降，请增建发电设施。');
      if (!hasRepairShop(state) && (state.units || []).some((u) => u.status === 'repairing')) warns.push('维修车间未建成，维修队列不会推进。');
      if ((getQueuedRepairs(state) || []).length >= REPAIR.maxQueueSize) warns.push('维修等待队列已满。');
      const warnSig = warns.join('|');
      if (this._ovWarnSig !== warnSig) {
        this._ovWarnSig = warnSig;
        r.ovWarnBox.innerHTML = '';
        warns.forEach((text) => r.ovWarnBox.appendChild(el('div', 'bc-reason', text)));
      }
      this._updateOfflineBox(state, r.offlineBox);
      return;
    }

    setText(r.kvPlayed, formatDuration(state.time.played));
    const operational = state.buildings.filter((b) => b.status === BUILDING_STATUS.OPERATIONAL).length;
    setText(r.kvBuildings, `${operational} 座`);
    setText(r.kvSave, state.savedAt ? formatWallClock(state.savedAt) : '尚未保存');
    const speed = safeNumber(state.time.speed, 1);
    setText(r.kvSpeed, speed === 0 ? '已暂停' : `${speed} 倍速`);

    const used = safeNumber(state.power.used, 0);
    const produced = safeNumber(state.power.produced, 0);
    setText(r.ovPower, `${formatInt(used)} / ${formatInt(produced)}`);
    if (r.ovPowerBar) {
      r.ovPowerBar.style.width = `${produced > 0 ? clamp((used / produced) * 100, 0, 100) : 0}%`;
    }
    const cUsed = safeNumber(state.command.used, 0);
    const cCap = safeNumber(state.command.capacity, 0);
    setText(r.ovCommand, `${formatInt(cUsed)} / ${formatInt(cCap)}`);
    if (r.ovCommandBar) {
      r.ovCommandBar.style.width = `${cCap > 0 ? clamp((cUsed / cCap) * 100, 0, 100) : 0}%`;
    }
    if (r.capTag) {
      const overload = used > produced;
      r.capTag.textContent = overload ? '电力超载' : '正常';
      r.capTag.className = `tag ${overload ? 'danger' : 'ok'}`;
    }

    Object.keys(RESOURCE_DEFS).forEach((key) => {
      if (r.ovRates[key]) setText(r.ovRates[key], formatRate(state.rates[key]));
    });

    // 建筑清单（结构变化时才重建）
    const signature = state.buildings
      .map((b) => `${b.type}:${b.status}:${Math.floor(safeNumber(b.progress, 0) * 20)}`)
      .join('|');
    if (signature !== this._buildingSignature && r.ovBuildingList) {
      this._buildingSignature = signature;
      r.ovBuildingList.innerHTML = '';
      state.buildings.forEach((b) => {
        const def = BUILDINGS[b.type];
        if (!def) return;
        const li = el('li');
        const dot = el('span', 'b-dot');
        if (b.status !== BUILDING_STATUS.OPERATIONAL) dot.classList.add('build');
        li.appendChild(dot);
        li.appendChild(el('span', 'b-name', def.name));
        const metaText = b.status === BUILDING_STATUS.OPERATIONAL
          ? this._buildingEffectText(def)
          : `施工 ${Math.floor(safeNumber(b.progress, 0) * 100)}%`;
        li.appendChild(el('span', 'b-meta', metaText));
        r.ovBuildingList.appendChild(li);
      });
      if (r.bldTag) r.bldTag.textContent = `${state.buildings.length} 座`;
    }

    // 离线报告（阶段6：真实结算结果）
    if (r.offlineBox) {
      const o = state.offline;
      if (o && o.shown !== true) {
        r.offlineBox.hidden = false;
        r.offlineBox.innerHTML = '';
        const head = el('div', 'card-head');
        head.appendChild(el('span', '', '离线报告'));
        const tone = o.settled ? 'ok' : 'warn';
        head.appendChild(el('span', `tag ${tone}`, o.settled ? '已结算' : '未结算'));
        r.offlineBox.appendChild(head);

        const viewBtn = el('button', 'btn offline-view-btn', '查看报告');
        viewBtn.type = 'button';
        viewBtn.dataset.action = 'view-offline-report';
        viewBtn.addEventListener('click', () => {
          r.offlineBox.dataset.viewed = 'true';
          viewBtn.hidden = true;
        });
        r.offlineBox.appendChild(viewBtn);

        const durRow = el('div', 'kv');
        durRow.appendChild(el('span', '', '离线时长'));
        let durText = o.text || '';
        if (o.capped && o.rawSeconds > o.seconds) {
          durText += `（原 ${formatDuration(o.rawSeconds)}，已按上限截断）`;
        }
        durRow.appendChild(el('span', '', durText));
        r.offlineBox.appendChild(durRow);

        // 结算明细
        (o.lines || []).forEach((line) => {
          r.offlineBox.appendChild(el('div', 'kv dim', line));
        });

        // 确认按钮
        const btnRow = el('div', 'offline-actions');
        const btn = el('button', 'btn', '知道了');
        btn.type = 'button';
        btn.dataset.action = 'dismiss-offline-report';
        btn.addEventListener('click', () => {
          if (this.handlers.onDismissOfflineReport) this.handlers.onDismissOfflineReport();
        });
        btnRow.appendChild(btn);
        r.offlineBox.appendChild(btnRow);
      } else if (!o) {
        r.offlineBox.hidden = true;
      }
    }
  }

  /** 建筑效果的一行摘要 */
  _buildingEffectText(def) {
    const parts = [];
    const eff = def.effects || {};
    if (eff.commandCapacity) parts.push(`指挥+${eff.commandCapacity}`);
    if (eff.powerCapacity) parts.push(`电力+${eff.powerCapacity}`);
    if (eff.supplyPerSec) parts.push(`补给+${eff.supplyPerSec}/s`);
    if (eff.alloyPerSec) parts.push(`合金+${eff.alloyPerSec}/s`);
    if (eff.supplyCap) parts.push(`上限+${eff.supplyCap}`);
    if (def.power && def.power.consume) parts.push(`耗电${def.power.consume}`);
    return parts.length ? parts.join(' ') : '运行中';
  }

  /** 消息栏 */
  _updateLog(state) {
    const list = this.refs.logList;
    if (!list) return;
    const log = state.log || [];
    const signature = `${log.length}:${log.length ? log[log.length - 1].id : ''}`;
    if (signature === this._logSignature) return;
    this._logSignature = signature;

    list.innerHTML = '';
    log.forEach((entry) => {
      const li = el('li', entry.level || 'info');
      li.appendChild(el('span', 't', `[${entry.time}]`));
      li.appendChild(el('span', 'm', entry.text));
      list.appendChild(li);
    });
    list.scrollTop = list.scrollHeight;
    setText(this.refs.logCount, `${log.length} / 30`);
  }
}
