/**
 * config.js —— 全局静态配置（唯一数值来源）
 *
 * 约定：
 *  1. 所有核心数值（资源、建筑、单位、战区、策略、渲染参数）集中在本文件；
 *  2. 其它模块只读取本文件，禁止在别处硬编码数值；
 *  3. 阶段1 只使用其中一部分，其余为后续阶段预留（数据先行，避免重构）。
 */

/* ============================================================
 * 存档 / 时间
 * ========================================================== */

export const SAVE_VERSION = 7;
export const SAVE_KEY = 'iron-command.save.v1';

export const TIME = {
  startSeconds: 8 * 3600,   // 基地时钟起始时间 08:00:00
  logicStep: 0.05,          // 逻辑固定步长（游戏秒），保证与帧率无关
  maxFrameDelta: 0.25,      // 单帧最大真实时间步长（防止切后台后跳变）
  autoSaveInterval: 30,     // 自动保存间隔（真实秒）
  speeds: [0, 1, 2, 4],     // 暂停 / 1× / 2× / 4×
  defaultSpeed: 1,
  offlineMaxHours: 8,       // 离线结算上限
  offlineReportMinSeconds: 60
};

export const LOG = {
  maxEntries: 30            // 底部消息栏最多保留 30 条
};

/* ============================================================
 * 资源定义与基础经济
 * ========================================================== */

export const RESOURCE_DEFS = {
  supply: { key: 'supply', name: '补给', short: '补给', color: '#e8b45c' },
  alloy:  { key: 'alloy',  name: '合金', short: '合金', color: '#8fb9d8' },
  intel:  { key: 'intel',  name: '情报', short: '情报', color: '#7fdca4' }
};

export const ECONOMY = {
  /** 新游戏初始资源 */
  start: { supply: 1200, alloy: 1000, intel: 20 },
  /** 基础产量（每游戏秒） */
  baseRates: {
    supply: 2,      // 补给 +2/s
    alloy: 1,       // 合金 +1/s
    intel: 0.1      // 情报 每10秒 +1
  },
  /** 基础资源上限 */
  baseCaps: { supply: 5000, alloy: 5000, intel: 500 },
  /** 电力不足时的全局产量惩罚系数（阶段2启用） */
  brownoutFactor: 0.5
};

/* ============================================================
 * 基地布局（Canvas 伪2.5D 网格）
 * ========================================================== */

export const RENDER = {
  tileW: 64,            // 菱形地块宽
  tileH: 32,            // 菱形地块高
  padding: 48,          // 画面留白
  headroom: 70,         // 建筑高度预留空间
  maxDpr: 2,
  smokeSpawnInterval: 0.32,
  colors: {
    skyTop: '#0d1512',
    skyBottom: '#131c17',
    groundA: '#33422f',
    groundB: '#2c3a2a',
    groundEdge: '#1d2a1e',
    road: '#4a4f47',
    roadEdge: '#5c6157',
    roadLine: '#c9a14a',
    grid: 'rgba(140, 190, 150, 0.08)',
    slot: 'rgba(140, 200, 160, 0.35)'
  }
};

/** 基地网格与分区（网格坐标：gx 向右下，gy 向左下） */
export const BASE_LAYOUT = {
  cols: 14,
  rows: 14,
  /** 主干道：第6列与第6行为混凝土道路 */
  roads: { cols: [6], rows: [6] },
  /** 基地出口所在网格（道路尽头） */
  exit: { gx: 6, gy: 13 },
  zones: [
    { id: 'command',   name: '指挥区', gx: 0, gy: 0, w: 6, h: 6, color: '#5fb0d8' },
    { id: 'industry',  name: '工业区', gx: 7, gy: 0, w: 7, h: 6, color: '#d8a55f' },
    { id: 'barracks',  name: '军营区', gx: 0, gy: 7, w: 6, h: 7, color: '#8fd85f' },
    { id: 'logistics', name: '后勤区', gx: 7, gy: 7, w: 7, h: 7, color: '#b78fd8' }
  ],
  /** 静态景物（非建筑，仅用于氛围） */
  props: [
    { type: 'gate',       gx: 6,  gy: 13 },
    { type: 'watchtower', gx: 0,  gy: 0 },
    { type: 'watchtower', gx: 13, gy: 0 },
    { type: 'watchtower', gx: 13, gy: 13 },
    { type: 'tanks',      gx: 12, gy: 4 },
    { type: 'crates',     gx: 8,  gy: 11 },
    { type: 'crates',     gx: 9,  gy: 12 },
    { type: 'helipad',    gx: 3,  gy: 11 },
    { type: 'repairpad',  gx: 11, gy: 11 }
  ]
};

/* ============================================================
 * 建筑定义
 *  - slot：系统预设位置（玩家不可拖动摆放）
 *  - effects：建成后生效的加成
 *  - shape：渲染器使用的外形分支
 * ========================================================== */

export const BUILDINGS = {
  command_center: {
    id: 'command_center',
    name: '指挥中心',
    zone: 'command',
    shape: 'command',
    initial: true,               // 新游戏时已存在
    buildable: false,
    cost: {},
    buildTime: 0,
    power: { produce: 0, consume: 0 },
    effects: { commandCapacity: 6 },
    slot: { gx: 1, gy: 1, w: 3, h: 3, height: 46 },
    desc: '基地核心。提供6点指挥容量，解锁基础建设项目。'
  },
  power_plant: {
    id: 'power_plant',
    name: '小型发电站',
    zone: 'industry',
    shape: 'power',
    initial: true,
    buildable: false,
    cost: {},
    buildTime: 0,
    power: { produce: 30, consume: 0 },
    effects: { powerCapacity: 30 },
    slot: { gx: 8, gy: 1, w: 2, h: 2, height: 30 },
    desc: '为基地提供30点电力，设备持续运行。'
  },

  /* ---- 以下为阶段2开放的可建造项目（数据先行） ---- */
  supply_depot: {
    id: 'supply_depot',
    name: '补给仓库',
    zone: 'logistics',
    shape: 'depot',
    initial: false,
    buildable: true,
    unlockStage: 2,
    cost: { alloy: 200, supply: 100 },
    buildTime: 20,
    power: { produce: 0, consume: 2 },
    requires: [],
    effects: { supplyPerSec: 2, supplyCap: 1000 },
    slot: { gx: 8, gy: 8, w: 2, h: 2, height: 26 },
    desc: '补给产量 +2/s，补给上限 +1000。'
  },
  alloy_plant: {
    id: 'alloy_plant',
    name: '合金加工厂',
    zone: 'industry',
    shape: 'factory',
    initial: false,
    buildable: true,
    unlockStage: 2,
    cost: { alloy: 300, supply: 150 },
    buildTime: 30,
    power: { produce: 0, consume: 5 },
    requires: [],
    effects: { alloyPerSec: 2 },
    slot: { gx: 11, gy: 1, w: 2, h: 2, height: 34 },
    desc: '合金产量 +2/s，烟囱持续排烟。'
  },
  barracks: {
    id: 'barracks',
    name: '兵营',
    zone: 'barracks',
    shape: 'barracks',
    initial: false,
    buildable: true,
    unlockStage: 2,
    cost: { alloy: 250, supply: 200 },
    buildTime: 25,
    power: { produce: 0, consume: 4 },
    requires: [],
    effects: {},
    unlocks: ['infantry', 'at_infantry'],
    slot: { gx: 1, gy: 8, w: 3, h: 2, height: 24 },
    desc: '解锁步兵班与反装甲班训练。'
  },
  armor_factory: {
    id: 'armor_factory',
    name: '装甲工厂',
    zone: 'industry',
    shape: 'factory_big',
    initial: false,
    buildable: true,
    unlockStage: 2,
    cost: { alloy: 500, supply: 300 },
    buildTime: 45,
    power: { produce: 0, consume: 8 },
    requires: ['barracks'],
    effects: {},
    unlocks: ['scout_car', 'mbt', 'repair_vehicle'],
    slot: { gx: 8, gy: 4, w: 3, h: 2, height: 32 },
    desc: '解锁侦察车、主战坦克与维修车生产。'
  },
  radar_station: {
    id: 'radar_station',
    name: '雷达站',
    zone: 'command',
    shape: 'radar',
    initial: false,
    buildable: true,
    unlockStage: 2,
    cost: { alloy: 350, supply: 150, intel: 10 },
    buildTime: 35,
    power: { produce: 0, consume: 6 },
    requires: [],
    effects: { scouting: 10, ambushResist: 0.25, intelAccuracy: 1 },
    slot: { gx: 1, gy: 4, w: 2, h: 2, height: 28 },
    desc: '提升战前情报准确度，降低伏击概率。'
  },
  research_center: {
    id: 'research_center',
    name: '技术实验室',
    zone: 'command',
    shape: 'research',
    initial: false,
    buildable: true,
    unlockStage: 7,
    cost: { alloy: 600, supply: 300, intel: 25 },
    buildTime: 50,
    power: { produce: 0, consume: 5 },
    requires: ['radar_station'],
    effects: { researchSlots: 1 },
    slot: { gx: 4, gy: 1, w: 2, h: 2, height: 30 },
    desc: '解锁科技研究。能够同时执行一项研究任务。'
  }
};

/** 建筑状态常量 */
export const BUILDING_STATUS = {
  OPERATIONAL: 'operational',
  UNDER_CONSTRUCTION: 'under_construction',
  OFFLINE: 'offline'
};

/** 同时只允许进行的大型建设项目数量 */
export const CONSTRUCTION = {
  maxConcurrent: 1,
  refundRatio: 0.5      // 取消建设的返还比例（阶段2使用）
};

/**
 * 建设界面文案（纯 UI 配置，不含任何数值规则）
 * 数值一律由 BUILDINGS / RESOURCE_DEFS 提供，这里只负责措辞。
 */
export const CONSTRUCTION_UI = {
  /** 建造按钮在不同情形下的文字 */
  buttonLabel: {
    ready: '批准建设',
    built: '已建成',
    building: '施工中',
    busy: '工程队占用中',
    blocked: '暂不可建'
  },
  /** 建筑状态徽标 */
  statusLabel: {
    available: '可建造',
    built: '已建成',
    building: '施工中',
    locked: '条件不足'
  },
  /** 工程状态区文案 */
  idleTitle: '工程队当前空闲',
  idleHint: '可批准新项目。',
  pausedHint: '推演已暂停，施工进度不会推进。',
  cancelConfirm: (name) => `确定取消“${name}”的施工吗？只能返还${Math.round(CONSTRUCTION.refundRatio * 100)}%的建设资源。`,
  /** 禁用原因模板 */
  reason: {
    exists: '该建筑已建成',
    busyOther: '工程队正在执行其他项目',
    busySelf: '该项目正在施工中',
    notBuildable: '该建筑不可由玩家建造',
    unknown: '未知建筑类型',
    lackResource: (name, amount) => `${name}不足，缺少${amount}`,
    lackPower: (need, free) => `电力不足：需要${need}，当前剩余${free}`,
    needPrereq: (name) => `需要先建成${name}`
  }
};

/* ============================================================
 * 单位定义（阶段3启用，数据先行，禁止在别处重复声明）
 * ========================================================== */

export const UNITS = {
  infantry: {
    id: 'infantry', name: '步兵班', category: 'infantry', shape: 'infantry',
    cost: { supply: 100 }, buildTime: 10, from: 'barracks',
    stats: { attack: 12, antiArmor: 4, defense: 10, scouting: 2, mobility: 5, repair: 0, hp: 100 },
    upkeep: 1, command: 1,
    desc: '地形适应好，可为车辆提供掩护，单独面对装甲较弱。'
  },
  at_infantry: {
    id: 'at_infantry', name: '反装甲班', category: 'infantry', shape: 'at_infantry',
    cost: { supply: 130, alloy: 30 }, buildTime: 14, from: 'barracks',
    stats: { attack: 18, antiArmor: 25, defense: 7, scouting: 2, mobility: 4, repair: 0, hp: 90 },
    upkeep: 2, command: 1,
    desc: '对坦克伤害高，但容易被压制。'
  },
  scout_car: {
    id: 'scout_car', name: '侦察车', category: 'vehicle', shape: 'scout',
    cost: { supply: 100, alloy: 120 }, buildTime: 18, from: 'armor_factory',
    stats: { attack: 6, antiArmor: 2, defense: 6, scouting: 20, mobility: 15, repair: 0, hp: 90 },
    upkeep: 2, command: 1,
    desc: '提升情报准确度、降低伏击风险，正面战斗力弱。'
  },
  mbt: {
    id: 'mbt', name: '主战坦克', category: 'armor', shape: 'tank',
    cost: { supply: 220, alloy: 300 }, buildTime: 30, from: 'armor_factory',
    stats: { attack: 35, antiArmor: 20, defense: 30, scouting: 3, mobility: 10, repair: 0, hp: 160 },
    upkeep: 5, command: 2,
    desc: '正面突破能力强，被反装甲单位克制，维修成本高。'
  },
  repair_vehicle: {
    id: 'repair_vehicle', name: '维修车', category: 'support', shape: 'repair',
    cost: { supply: 150, alloy: 180 }, buildTime: 24, from: 'armor_factory',
    stats: { attack: 0, antiArmor: 0, defense: 8, scouting: 2, mobility: 8, repair: 20, hp: 110 },
    upkeep: 3, command: 1,
    desc: '降低战后永久损失，战斗中恢复少量装甲耐久，无攻击能力。'
  }
};

/** 单位老兵等级：等级由经验动态推导，不从存档读取。 */
export const UNIT_RANKS = {
  recruit: {
    id: 'recruit', name: '新兵', minExperience: 0,
    modifiers: { attack: 1, antiArmor: 1, defense: 1, scouting: 1, mobility: 1, repair: 1 }
  },
  trained: {
    id: 'trained', name: '训练有素', minExperience: 10,
    modifiers: { attack: 1.03, antiArmor: 1.03, defense: 1.03, scouting: 1, mobility: 1, repair: 1 }
  },
  veteran: {
    id: 'veteran', name: '老兵', minExperience: 30,
    modifiers: { attack: 1.06, antiArmor: 1.06, defense: 1.06, scouting: 1.05, mobility: 1, repair: 1.05 }
  },
  elite: {
    id: 'elite', name: '精锐', minExperience: 60,
    modifiers: { attack: 1.10, antiArmor: 1.10, defense: 1.10, scouting: 1.10, mobility: 1.05, repair: 1.10 }
  }
};

/** 生产队列限制（阶段3） */
export const PRODUCTION = {
  maxConcurrent: 1,        // 同时只有一个单位实际生产
  maxQueueSize: 5,         // 当前生产 + 等待队列总数上限
  activeCancelRefundRatio: 0.5,  // 取消正在生产的单位返还 50% 成本
  queuedCancelRefundRatio: 1      // 取消尚未开工的等待项目返还 100% 成本
};

/**
 * 生产界面文案（纯 UI 配置，不含任何数值规则）
 * 数值一律由 UNITS / PRODUCTION 提供，这里只负责措辞。
 */
export const PRODUCTION_UI = {
  /** 生产按钮文字 */
  buttonLabel: {
    train: '加入训练队列',
    manufacture: '加入制造队列',
    producing: '生产中',
    queued: '已排队'
  },
  /** 生产线状态徽标 */
  statusLabel: {
    idle: '空闲',
    producing: '生产中',
    queued: '等待中'
  },
  /** 当前生产线区文案 */
  idleTitle: '生产线当前空闲',
  idleHint: '可批准新的训练或制造任务。',
  pausedHint: '基地推演已暂停，生产进度不会推进。',
  queueHead: '等待队列',
  inventoryHead: '单位库存',
  /** 取消确认文案 */
  cancelCurrentConfirm: (name) => `确定取消"${name}"的生产吗？只能返还${Math.round(PRODUCTION.activeCancelRefundRatio * 100)}%的已支付资源。`,
  cancelQueuedConfirm: (name) => `确定从队列中移除"${name}"吗？尚未开工，将返还全部已支付资源。`,
  /** 禁用原因模板 */
  reason: {
    unknown: '未知单位类型',
    locked: '尚未解锁该单位',
    needBarracks: '需要先建成兵营',
    needArmorFactory: '需要先建成装甲工厂',
    producerOffline: (name) => `${name}当前无法生产`,
    queueFull: (max) => `生产队列已满：最多${max}项`,
    lackResource: (name, amount) => `${name}不足，缺少${amount}`
  }
};

/* ============================================================
 * 单位损伤与维修（阶段6启用）
 * ========================================================== */

export const DAMAGE_STATES = {
  INTACT: 'intact',
  LIGHT: 'light',
  HEAVY: 'heavy',
  DESTROYED: 'destroyed'
};

/**
 * 损伤等级判定阈值（hp / maxHp）：
 *   ratio >= intact → 完好（不可维修）
 *   light <= ratio < intact → 轻伤
 *   ratio < light 且 > 0 → 重伤
 *   ratio <= 0 → 阵亡（不可维修）
 */
export const DAMAGE_THRESHOLDS = {
  intact: 0.75,
  light: 0.40
};

export const REPAIR = {
  times: { light: 15, heavy: 35 },
  cost: {
    light: { supply: 20, alloy: 15 },
    heavy: { supply: 50, alloy: 45 }
  },
  /** 同时进行的维修工位数量 */
  maxConcurrent: 2,
  /** 维修队列（含进行中）最大长度 */
  maxQueueSize: 8,
  /** 取消进行中的维修：返还 50% */
  activeCancelRefundRatio: 0.5,
  /** 取消排队中的维修：全额返还 */
  queuedCancelRefundRatio: 1
};

/* ============================================================
 * 科研（阶段7）
 * ========================================================== */

export const RESEARCH = {
  maxConcurrent: 1,
  maxQueueSize: 3,
  activeCancelRefundRatio: 0.5,
  queuedCancelRefundRatio: 1
};

export const TECHNOLOGIES = {
  logistics_optimization: {
    id: 'logistics_optimization', name: '后勤优化', branch: 'industry', tier: 1,
    cost: { intel: 20, alloy: 100 }, researchTime: 30, requires: [],
    effects: { supplyPerSec: 1 }, desc: '改进运输调度和仓储周转，使补给产量增加1/s。'
  },
  alloy_recycling: {
    id: 'alloy_recycling', name: '合金回收工艺', branch: 'industry', tier: 2,
    cost: { intel: 25, alloy: 150 }, researchTime: 40, requires: ['logistics_optimization'],
    effects: { alloyPerSec: 1 }, desc: '提高废料回收与再加工效率，使合金产量增加1/s。'
  },
  expanded_storage: {
    id: 'expanded_storage', name: '扩建储备设施', branch: 'industry', tier: 3,
    cost: { intel: 30, alloy: 200 }, researchTime: 50, requires: ['alloy_recycling'],
    effects: { supplyCap: 1000, alloyCap: 1000 }, desc: '扩建标准化储存设施，使补给和合金上限各增加1000。'
  },
  standardized_training: {
    id: 'standardized_training', name: '标准化训练', branch: 'military', tier: 1,
    cost: { intel: 20, supply: 150 }, researchTime: 35, requires: [],
    effects: { infantryProductionTimeMultiplier: 0.85 }, desc: '步兵类单位的未来训练时间缩短15%。'
  },
  modular_assembly: {
    id: 'modular_assembly', name: '模块化装配', branch: 'military', tier: 2,
    cost: { intel: 30, alloy: 200 }, researchTime: 45, requires: ['standardized_training'],
    effects: { vehicleProductionTimeMultiplier: 0.85 }, desc: '车辆类单位的未来制造时间缩短15%。'
  },
  composite_armor: {
    id: 'composite_armor', name: '复合装甲', branch: 'military', tier: 3,
    cost: { intel: 40, alloy: 300 }, researchTime: 60, requires: ['modular_assembly'],
    effects: { armorBattleDefenseMultiplier: 1.10 }, desc: '装甲和车辆单位在战斗中的有效防御提高10%。'
  },
  tactical_datalink: {
    id: 'tactical_datalink', name: '战术数据链', branch: 'command', tier: 1,
    cost: { intel: 25, alloy: 100 }, researchTime: 35, requires: [],
    effects: { battleScoutingMultiplier: 1.15 }, desc: '编队在战斗中的有效侦察提高15%。'
  },
  field_maintenance: {
    id: 'field_maintenance', name: '野战维护规程', branch: 'command', tier: 2,
    cost: { intel: 30, alloy: 150 }, researchTime: 45, requires: ['tactical_datalink'],
    effects: { repairTimeMultiplier: 0.80 }, desc: '未来创建的维修任务耗时缩短20%。'
  },
  expanded_command_network: {
    id: 'expanded_command_network', name: '扩展指挥网络', branch: 'command', tier: 3,
    cost: { intel: 50, alloy: 250 }, researchTime: 60, requires: ['field_maintenance'],
    effects: { commandCapacity: 2 }, desc: '指挥容量上限增加2点。'
  }
};

/* ============================================================
 * 编队（阶段4启用）
 * ========================================================== */

export const FORMATION_STATUS = {
  IDLE: 'idle',           // 待命
  RALLYING: 'rallying',   // 集结
  MARCHING: 'marching',   // 行军
  FIGHTING: 'fighting',   // 战斗
  RETURNING: 'returning', // 返回
  REPAIRING: 'repairing'  // 维修
};

export const FORMATION_STATUS_LABEL = {
  idle: '待命', rallying: '集结', marching: '行军',
  fighting: '战斗', returning: '返回', repairing: '维修'
};

/** 预设编队模板 */
export const FORMATION_PRESETS = [
  { id: 'combined', name: '综合战斗群', units: { infantry: 2, at_infantry: 1, scout_car: 1 } },
  { id: 'armor',    name: '装甲突击群', units: { mbt: 2, infantry: 1, repair_vehicle: 1 } },
  { id: 'recon',    name: '侦察分队',   units: { scout_car: 2, infantry: 1 } }
];

/* ============================================================
 * 编队规则（阶段4）
 *  - 所有数值与文案集中在此，业务/UI 不得硬编码；
 *  - 初始指挥中心提供 6 点指挥容量（BUILDINGS.command_center.effects）；
 *  - 库存单位不占用指挥容量，只有正式加入编队的单位才占用。
 * ========================================================== */

export const FORMATION = {
  /** 最多可建立的编队数量 */
  maxFormations: 6,
  /** 编队名称最大长度 */
  maxNameLength: 20,
  /** 允许编辑（重命名/调整成员/解散）的状态，阶段4只有 idle */
  editableStatuses: ['idle'],
  /** 默认名称前缀与中文序数（用于自动生成“第N战斗群”） */
  defaultPrefix: '战斗群',
  nameOrdinals: ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'],
  /** 禁用 / 失败原因模板（纯文案，无数值规则） */
  reasons: {
    limitReached: (max) => `编队数量已达上限：最多${max}支`,
    nameInvalid: '名称不能为空',
    notFound: '编队不存在',
    notIdle: '只有待命编队可以调整',
    unitInvalid: '单位不存在',
    unitAssigned: '该单位已属于其它编队',
    unitNotReady: '该单位尚未就绪，不能编入编队',
    unitRepairing: '维修中的单位不能编入编队',
    alreadyMember: '该单位已经在此编队中',
    capacity: (need, free) => `指挥容量不足：需要${need}，当前剩余${free}`,
    presetUnknown: '未知预设模板',
    insufficientInventory: (list) => `库存不足：${list}`,
    presetCapacity: (need, free) => `指挥容量不足：模板需要${need}，当前剩余${free}`
  },
  /** 事件日志文案模板 */
  messages: {
    created: (name) => `编队「${name}」已建立。`,
    disbanded: (name, n) => `编队「${name}」已解散，${n}个单位返回库存。`,
    added: (unitName, name) => `${unitName}已加入「${name}」。`,
    addedCapacity: (unitName, name, free) => `${unitName}已加入「${name}」，指挥容量剩余${free}。`,
    removed: (unitName, name) => `${unitName}已从「${name}」移出并返回库存。`,
    renamed: (from, to) => `编队「${from}」已更名为「${to}」。`,
    presetDone: (name) => `${name}组建完成。`,
    presetFailCapacity: (name) => `无法组建${name}：指挥容量不足。`
  }
};

/** 编队评估阈值（仅用于建议提示，不改变属性） */
export const FORMATION_WARNINGS = {
  /** 总侦察低于该值：侦察能力较弱 */
  scoutingLow: 8,
  /** 总反装甲低于该值：应对敌方装甲能力较弱 */
  antiArmorLow: 25,
  /** 提示文案（业务层不得硬编码） */
  messages: {
    empty: '编队为空，请先加入单位。',
    scouting: '侦察能力不足，遭遇伏击的风险较高。',
    armorNoInfantry: '装甲缺少步兵掩护，容易被反装甲单位偷袭。',
    armorNoRepair: '装甲部队缺少维修车，战损恢复较慢。',
    antiArmor: '反装甲能力不足，难以应对敌方装甲。'
  }
};

/**
 * Canvas 集结区表现参数（阶段4）
 *  - 仅影响画面，不参与任何数值计算；
 *  - 渲染层只按这里的规则摆放已编入编队的单位，绝不修改单位归属。
 */
export const RALLY = {
  /** 集结区中心（基地出口内侧的空地） */
  center: { gx: 6, gy: 10.4 },
  /** 单位入场 / 退场使用的大门坐标 */
  gate: { gx: 6, gy: 13.4 },
  /** 相邻编队之间的横向间隔（网格单位） */
  formationGap: 1.5,
  /** 编队内单位的列距与行距 */
  unitGapX: 0.42,
  unitGapY: 0.46,
  /** 每列最多排几个单位，超出则换列 */
  perColumn: 3,
  /** 加入 / 离开动画时长（秒，真实时间） */
  joinDuration: 0.85,
  leaveDuration: 0.6,
  /** 站位插值速度（越大越快贴合目标点） */
  easing: 6,
  /** 编队名标签字号（屏幕像素） */
  labelSize: 10,
  colors: {
    label: '#c8d8c0',
    labelSelected: '#f0d98a',
    pad: 'rgba(120, 160, 130, 0.10)',
    padEdge: 'rgba(150, 200, 160, 0.22)',
    selected: '#e8c15a',
    selectedFill: 'rgba(232, 193, 90, 0.12)'
  }
};

/* ============================================================
 * 战区与作战策略（阶段5启用）
 * ========================================================== */

export const THEATERS = {
  scrap_mine: {
    id: 'scrap_mine', name: '废弃矿区', terrain: 'open', terrainName: '开阔地',
    difficulty: 1, requires: [], concealment: 4,
    enemy: { enemy_infantry: 3 },
    firstReward: { alloy: 300 },
    captureIncome: { alloyPerSec: 1 },
    supplyMultiplier: 5,
    desc: '少量敌方步兵驻守的旧采掘场。'
  },
  border_road: {
    id: 'border_road', name: '边境公路', terrain: 'road', terrainName: '公路',
    difficulty: 2, requires: ['scrap_mine'], concealment: 8,
    enemy: { enemy_infantry: 4, enemy_at: 2 },
    firstReward: { supply: 400, intel: 10 },
    captureIncome: { supplyPerSec: 1 },
    supplyMultiplier: 8,
    desc: '敌方巡逻队与反装甲小组控制的运输干线。'
  },
  enemy_outpost: {
    id: 'enemy_outpost', name: '敌方前哨站', terrain: 'fortified', terrainName: '防御阵地',
    difficulty: 3, requires: ['border_road'], concealment: 14,
    enemy: { enemy_infantry: 5, enemy_at: 3, enemy_light_armor: 2 },
    firstReward: { alloy: 500, intel: 25 },
    captureIncome: {},
    supplyMultiplier: 12,
    desc: '构筑了工事的前进基地，火力密集。'
  }
};

/** 已占领战区上的可重复作战任务。 */
export const OPERATIONS = {
  salvage_run: {
    id: 'salvage_run', name: '废料回收', theaterId: 'scrap_mine', missionKind: 'operation',
    requiresCaptured: true, cooldown: 300, enemy: { enemy_infantry: 2 },
    supplyMultiplier: 4, intelCost: 0, rewards: { alloy: { min: 100, max: 180 } },
    experienceMultiplier: 0.8, desc: '清理矿区残余威胁，并回收可用合金。'
  },
  convoy_escort: {
    id: 'convoy_escort', name: '补给护送', theaterId: 'border_road', missionKind: 'operation',
    requiresCaptured: true, cooldown: 600, enemy: { enemy_infantry: 3, enemy_at: 1 },
    supplyMultiplier: 7, intelCost: 0,
    rewards: { supply: { min: 180, max: 300 }, intel: { min: 2, max: 5 } },
    experienceMultiplier: 1, desc: '护送运输队穿过仍不稳定的边境公路。'
  },
  outpost_sweep: {
    id: 'outpost_sweep', name: '残敌清剿', theaterId: 'enemy_outpost', missionKind: 'operation',
    requiresCaptured: true, cooldown: 900, enemy: { enemy_infantry: 4, enemy_at: 2, enemy_light_armor: 1 },
    supplyMultiplier: 10, intelCost: 3,
    rewards: { alloy: { min: 220, max: 360 }, intel: { min: 6, max: 12 } },
    experienceMultiplier: 1.25, desc: '清剿前哨站周边残余武装，获取情报和工业材料。'
  }
};

/** 敌方战斗单位模板（不与玩家单位实例共享） */
export const ENEMY_UNITS = {
  enemy_infantry: {
    id: 'enemy_infantry', name: '敌方步兵班', category: 'infantry', shape: 'infantry',
    stats: { attack: 10, antiArmor: 2, defense: 8, scouting: 2, mobility: 5, repair: 0, hp: 85 }
  },
  enemy_at: {
    id: 'enemy_at', name: '敌方反装甲小组', category: 'at_infantry', shape: 'at_infantry',
    stats: { attack: 15, antiArmor: 22, defense: 6, scouting: 2, mobility: 4, repair: 0, hp: 80 }
  },
  enemy_light_armor: {
    id: 'enemy_light_armor', name: '敌方轻型装甲车', category: 'vehicle', shape: 'scout',
    stats: { attack: 22, antiArmor: 10, defense: 18, scouting: 4, mobility: 11, repair: 0, hp: 120 }
  }
};

export const STRATEGIES = {
  cautious: {
    id: 'cautious', name: '谨慎推进',
    mods: { scouting: 1.30, defense: 1.15, timeScale: 1.25, ambush: -0.35, damage: 0.92 },
    cost: {},
    advantages: [
      '侦察充分，提前发现敌方反装甲阵地',
      '防御稳固，承受首轮打击更稳',
      '伏击概率显著降低'
    ],
    risks: [
      '整体输出下降约 8%',
      '行军与战斗时间更长'
    ],
    desc: '侦察 +30%，防御 +15%，行军与战斗时间 +25%，伏击概率降低，输出略降约 8%。'
  },
  breakthrough: {
    id: 'breakthrough', name: '正面突破',
    mods: { firstPhaseAttack: 1.25, armorAttack: 1.15, upkeep: 1.25, atRisk: 0.3 },
    cost: {},
    advantages: [
      '首轮攻击 +25%',
      '装甲单位攻击额外 +15%'
    ],
    risks: [
      '任务补给成本 +25%',
      '侦察不足时受反装甲伤害风险升高'
    ],
    desc: '首阶段攻击 +25%，装甲攻击额外提高，补给消耗 +25%，侦察不足时反装甲损失风险增加。'
  },
  recon_by_fire: {
    id: 'recon_by_fire', name: '火力侦察',
    mods: { scouting: 1.20, suppression: 1.25, infantryAttack: 0.92, revealChance: 0.5 },
    cost: { intel: 5 },
    advantages: [
      '侦察 +20%',
      '压制能力 +25%',
      '更易提前发现高威胁单位'
    ],
    risks: [
      '步兵攻击 -8%',
      '额外消耗情报 5'
    ],
    desc: '侦察与压制提高，有概率提前发现高威胁单位，步兵攻击略降，消耗 5 点情报。'
  }
};

/** 战斗结果类型（阶段5启用） */
export const BATTLE_RESULT = {
  VICTORY: 'victory',
  PYRRHIC: 'pyrrhic',
  DEFEAT: 'defeat',
  WITHDRAW: 'withdraw',
  WIPED: 'wiped'
};

/** 地形效果（集中配置，战斗求解器只读这里） */
export const TERRAIN = {
  open: {
    id: 'open', name: '开阔地',
    armorAttack: 1.10,        // 装甲攻击 ×1.10
    vehicleMobility: 1.10,    // 车辆机动 ×1.10
    enemyDefense: 1.0,
    friendlyAttack: 1.0,
    ambushBias: 0.0
  },
  road: {
    id: 'road', name: '公路',
    armorAttack: 1.0,
    vehicleMobility: 1.10,    // 所有车辆机动 ×1.10
    enemyDefense: 1.0,
    friendlyAttack: 1.0,
    ambushBias: 0.05          // 伏击风险略高
  },
  fortified: {
    id: 'fortified', name: '防御阵地',
    armorAttack: 1.0,
    vehicleMobility: 1.0,
    enemyDefense: 1.20,       // 敌方防御 ×1.20
    friendlyAttack: 0.90,     // 我方攻击 ×0.90
    ambushBias: 0.0
  }
};

export const BATTLE = {
  maxRounds: 8,
  baseDuration: 48,           // 基础战斗时长（游戏秒），谨慎推进会按 timeScale 拉长
  maxReports: 20,             // 历史战报最多保留
  /** 压制：单次伤害达到最大生命值该比例 → 下次攻击下降 */
  suppress: { threshold: 0.20, factor: 0.80 },
  /** 维修车每轮修复量 = max(1, round(repairStat * ratio)) */
  repairRatio: 0.30,
  /** 战地抢救：装甲车/车辆生命归零时，存活维修车有机会抢回 */
  recovery: { hpRatio: 0.10, maxChance: 0.50 },
  /** 战斗经验（阶段6）：参战与获胜分别加成 */
  experience: {
    unitParticipation: 5,
    unitVictory: 5,
    formationParticipation: 10,
    formationVictory: 10
  },
  /** 克制系数：攻击方类别 → 目标类别 */
  counters: {
    infantry:   { infantry: 1.0, armor: 0.45, vehicle: 0.9,  support: 1.0 },
    at_infantry:{ infantry: 0.8, armor: 1.8,  vehicle: 1.3,  support: 1.1 },
    vehicle:    { infantry: 0.8, armor: 0.5,  vehicle: 1.0,  support: 1.0 },
    armor:      { infantry: 1.6, armor: 1.0,  vehicle: 1.4,  support: 1.5 },
    support:    { infantry: 0,   armor: 0,    vehicle: 0,    support: 0 }
  }
};

/* ============================================================
 * 右侧管理面板分页
 *  stage：该分页对应的开放阶段，阶段1只开放“概览”
 * ========================================================== */

export const CURRENT_STAGE = 8;

export const PANEL_TABS = [
  { id: 'overview',     label: '概览', stage: 1, title: '基地概览' },
  { id: 'construction', label: '建设', stage: 2, title: '建设项目' },
  { id: 'production',   label: '生产', stage: 3, title: '单位生产' },
  { id: 'units',        label: '部队', stage: 8, title: '单位档案' },
  { id: 'formations',   label: '编队', stage: 4, title: '作战编队' },
  { id: 'theater',      label: '战区', stage: 5, title: '战区目标' },
  { id: 'repairs',      label: '维修', stage: 6, title: '维修与补员' },
  { id: 'research',     label: '科研', stage: 7, title: '技术实验室' },
  { id: 'reports',      label: '战报', stage: 5, title: '战斗报告' }
];

/** 未开放分页的占位说明 */
export const STAGE_PLACEHOLDER = {
  2: '建设系统已开放（阶段2）：可批准补给仓库、合金加工厂、兵营、装甲工厂与雷达站。',
  3: '单位生产系统已开放（阶段3）：兵营与装甲工厂可训练/制造单位，支持生产队列与库存。',
  4: '作战编队系统已开放（阶段4）：创建编队、编入单位、指挥容量校验与三套预设模板。',
  5: '战区与自动战斗系统已开放（阶段5）：派遣编队、确定性战斗、战报回顾。',
  6: '维修与离线结算已开放（阶段6）：受损单位排队维修、完整离线进度结算。',
  7: '技术实验室与科研系统已开放。',
  8: '单位档案、老兵等级、呼号与可重复作战任务已开放。'
};

/** 汇总导出，便于调试时一次性查看 */
export const CONFIG = {
  SAVE_VERSION, SAVE_KEY, TIME, LOG, RESOURCE_DEFS, ECONOMY, RENDER, BASE_LAYOUT,
  BUILDINGS, BUILDING_STATUS, CONSTRUCTION, CONSTRUCTION_UI, UNITS, UNIT_RANKS, PRODUCTION, PRODUCTION_UI,
  DAMAGE_STATES, DAMAGE_THRESHOLDS, REPAIR, RESEARCH, TECHNOLOGIES,
  FORMATION_STATUS, FORMATION_PRESETS, FORMATION, FORMATION_WARNINGS,
  THEATERS, OPERATIONS, ENEMY_UNITS, STRATEGIES, TERRAIN, BATTLE, BATTLE_RESULT,
  PANEL_TABS, STAGE_PLACEHOLDER, CURRENT_STAGE
};
