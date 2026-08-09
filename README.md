# 钢铁指令 IRON COMMAND

军事基地经营 + 自动战斗放置游戏原型。

玩家扮演基地指挥官，**不直接操作单位**：你只负责审批建设、编排部队、下达作战策略，剩下的交给系统自动推演。

> **当前版本：0.8.1-hotfix.6 · Stage 8.2G-E-C Offline / Idle Progression Closure**
> 在阶段 1～8.2G-D-C.1 与 E-A/E-A.1/E-B 之上，正式战斗已接入可恢复的派遣、结算、回放与离线长线循环；离线推进、战斗事实、正式战报和结算账本保持严格隔离。

---

## 一、启动方法

本项目是纯静态页面，**无需安装依赖、无需构建、无需后端**。
但因为使用了 ES Module（`<script type="module">`），浏览器的 `file://` 协议会触发 CORS 限制，**必须通过本地 HTTP 服务打开**。

### 方式 1：npm 脚本（推荐，仓库自带）

```bash
cd iron-command
npm start
```

浏览器访问 `serve` 输出的本地地址（默认 http://127.0.0.1:8000）。

也可以直接执行 `node scripts/serve.mjs`。项目不需要下载第三方服务器或运行依赖。

### 环境要求

- 任意支持 ES Module 与 Canvas 2D 的现代浏览器（Chrome / Edge / Firefox / Safari 均可）
- 建议窗口分辨率 **1366×768 以上**（低于 1200px 宽时右侧面板会自动折到下方）

> ⚠️ 直接双击 `index.html` 用 `file://` 打开会白屏，控制台报模块加载跨域错误。这是浏览器的安全策略，不是代码问题。

### 运行单元测试

阶段 3～8 内置自动化测试（Node 环境，零依赖）。`npm test` 依次运行：

- `tests/stage3-test.mjs`（63 项）：阶段标记与回归、单位解锁、资格错误码、入队扣费、队列上限、暂停 / 速度、完成结算、单位实例、取消返还、库存、进度查询、存档迁移容错、无主施工恢复、生产页构建、源码语法检查；
- `tests/stage4-test.mjs`（76 项）：阶段 1/2/3 兼容回归、编队创建 / 命名 / 上限、重命名 / 解散、成员加入 / 移除 / 双向归属、指挥容量动态计算与超限、预设模板原子性（combined=4 / armor=6 / recon=3）、编队评估 5 类提示、汇总属性、存档迁移与 `sanitizeFormations` 容错、UI 编队页构建、渲染器集结区只读表现、调试接口契约、本地服务器（`scripts/serve.mjs` 防穿越 403 / content-type / 真实请求）、源码语法检查；
- `tests/stage5-test.mjs`（99 项）：阶段 4 四类问题修复回归、战区配置与解锁链、战前情报（雷达精度）、派遣资格全分支、活动战斗推进与结算幂等、确定性求解器（同种子同结果 / 纯函数 / 战地抢救不变式）、占领奖励与持续收益、存档迁移 v3→v4（sanitize 系列 + round-trip）、UI 战区页 / 战报页构建（DOM 桩）、战斗渲染器只读表现、调试接口契约、本地服务器与全量语法检查；
- `tests/stage6-test.mjs`（116 项）：阶段标记与配置（版本/经验/损伤阈值/面板）、战斗修复（时间轴单调/防御只护我方/反装甲风险/车辆机动/压制阈值/战报 ID 含策略）、战斗修正接入（地形装甲攻击/车辆机动/压制修正/确定性/占领标记一致）、维修损伤判定与排队（canQueueRepair 全分支/queueRepair 脱编队）、维修推进完成取消（事件步进确定性/退款比例 50%·100%/递补）、维修存档容错（去重/释放归属/工位限额/孤儿回收）、维修离线推进与车间状态、离线结算（时长截断/事件步进/资源/施工/生产/维修/时钟）、离线报告（buildOfflineReport/dismiss/hasPending）、离线确定性与幂等、存档迁移 v4→v5 与离线接线（sanitizeRepairs 先于编队/导入不重放）、战斗结算加固（validate/buildPlan/事务/幂等/未结算禁止返回）、经验配置接入（单位 +5/+5、编队 +10/+10）、调试接口契约、UI 维修页与离线报告卡片、渲染器维修车间表现、全量语法检查。
- `tests/stage7-test.mjs`（65 项）：阶段7兼容回归、技术实验室、科研队列、九项科技效果、离线科研、UI/存档迁移与模块语法检查。
- `tests/stage8-test.mjs`（90 项）：科研依赖闭包与 revision 历史、生产/维修可信绑定、单位呼号与四档老兵、派遣快照重建、战报完整性、重复任务成本/奖励/冷却、离线 `operationsReady`、存档容错与接口契约。
- `tests/stage8-1-test.mjs`（36 项）：RTS战场导演/镜头/渲染器、权威伤害展示、结果浮层、返航状态机与旧结算迁移。
- `tests/stage8-1-1-test.mjs`（43 项）：真实 `WITHDRAW` + `RETREAT` 战报、结算阻断与一次性报错、安全关闭、旧存档确定性重建、阻断字段往返与无副作用。

```bash
npm test            # 依次运行阶段3～阶段8.2G-C测试（包含 B.1、B.1.1、证据篡改与 C 环境回归）
```

---

## 二、现阶段功能

### 已实现

| 区域 | 功能 |
| --- | --- |
| **顶部资源栏** | 补给 / 合金 / 情报（当前值、上限、每秒产量）、电力负载、指挥容量、基地时间、速度控制 |
| **中央画面** | Canvas 伪 2.5D 等距基地，14×14 网格，四大分区（指挥/工业/军营/后勤），主干道与基地出口 |
| **建筑** | 指挥中心、小型发电站、五种阶段2建筑与技术实验室；实验室有天线、屏幕、状态灯和研究扫描动画 |
| **动画** | 雷达扫描扇形、烟雾粒子、设备呼吸灯、巡逻车沿主干道行驶、道闸开合、工地施工火花、兵营 / 装甲工厂生产时增强动画 |
| **资源经济** | 补给 +2/s、合金 +1/s、情报 +0.1/s；科研可动态增加产量、资源上限和指挥容量 |
| **速度控制** | 暂停 / 1× / 2× / 4×，逻辑采用固定步长推进，结果与帧率无关 |
| **事件日志** | 底部滚动消息栏，最多保留 30 条，按信息/良好/警告/危险分色 |
| **右侧面板** | 概览 / 建设 / 生产 / 编队 / 部队 / 战区 / 维修 / 科研 / 战报全部可用；部队页管理档案与呼号，战区页提供占领后的重复任务 |
| **建设系统** | 「建设」分页可批准 5 种建筑；每种最多 1 座；施工动画、电力约束、前置链、取消 50% 返还、施工存档与恢复 |
| **生产系统** | 「生产」分页：当前生产线（进度条 / 百分比 / 剩余 / 暂停提示 / 取消）、等待队列、5 张单位卡片、实时库存统计 |
| **单位实例** | 完成生产生成带呼号、经验、战斗次数和创建时间的单位档案；经验动态映射新兵 / 训练有素 / 老兵 / 精锐 |
| **库存** | 单位实例存入 `state.units`，**不占用指挥容量**；页面实时统计总数 / 待命 / 已编入 / 维修中 |
| **存档** | 每 30 秒自动保存 + 关闭页面前保存 + 手动保存/读取/新游戏；保存版本7支持阶段7旧档迁移、科研历史裁剪、单位档案与重复任务记录修复 |

### 初始状态

- 补给 **1200** / 合金 **1000** / 情报 **20**
- 已有建筑：指挥中心 ×1、小型发电站 ×1
- 基地时间从 **08:00** 开始

### 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `空格` | 暂停 / 继续（记住上一次速度） |
| `1` | 1× 速度 |
| `2` | 2× 速度 |
| `3` | 4× 速度 |

### 鼠标交互

- 悬停任意建筑 → 显示名称、状态、产出与耗电提示条
- 虚线菱形地块为**预留建设位**，阶段 2 起可在其上建造

---

## 二·五、阶段 2 建设系统（回顾）

### 五种可建造建筑

每种建筑**同时只能建造 1 座**（系统预设槽位，玩家不可自由摆放、不可升级、不可拆除）。

| 建筑 | 造价 | 工期 | 耗电 | 前置 | 建成后效果 |
| --- | --- | --- | --- | --- | --- |
| 补给仓库 | 合金 200 / 补给 100 | 20s | 2 | — | 补给 +2/s、补给上限 +1000 |
| 合金加工厂 | 合金 300 / 补给 150 | 30s | 5 | — | 合金 +2/s |
| 兵营 | 合金 250 / 补给 200 | 25s | 4 | — | 解锁步兵班、反装甲班（阶段 3 生产） |
| 装甲工厂 | 合金 500 / 补给 300 | 45s | 8 | 兵营 | 解锁侦察车、主战坦克、维修车 |
| 雷达站 | 合金 350 / 补给 150 / 情报 10 | 35s | 6 | — | 提升情报准确度、降低伏击概率 |

> 数值来源：`js/config.js` 的 `BUILDINGS` 与 `ECONOMY`，平衡性调整只改此处。

### 建造规则

1. **工程队单线作业**：同一时间只能有 1 个施工项目；开工后其他项目显示"工程队占用中"，自身显示"施工中"。
2. **资格检查**：资源不足、电力不足、前置未达成、已建成、不可建造（指挥中心 / 发电站）都会被拒绝，并在卡片上显示明确原因。
3. **电力约束**：电力不足时不许开工，文案形如"电力不足：需要 8，当前剩余 4"。发电厂总产能 30。
4. **施工中不生效**：未落成的建筑不消耗电力、不加成、不解锁单位；落成瞬间才结算并播放动画。
5. **防连点 / 防重复**：重复点击、并发调用均被拒绝，绝不会双扣费或建出第二座。
6. **取消返还**：施工中可随时取消，按 `CONSTRUCTION.refundRatio = 0.5` 返还（向下取整），返还受资源上限钳制，不会溢出。

### 存档与自愈（施工）

- 施工中保存后刷新，进度、剩余时间、已扣费用都会原样恢复，**不会重复扣费**。
- 存档损坏（施工任务格式非法、找不到对应建筑、状态不符、重复建筑、未知建筑类型等）时 `sanitizeConstruction()` 会**自动修复**并补记日志，游戏照常运行：无主工地恢复为已建成（不重复扣费），非法任务被清除。

---

## 二·六、阶段 3 单位生产系统

### 五种可生产单位

建成对应建筑后解锁（兵营 → 步兵班 / 反装甲班；装甲工厂 → 侦察车 / 主战坦克 / 维修车）。数值全部来自 `js/config.js` 的 `UNITS`，平衡性调整只改此处。

| 单位 | 来源 | 造价 | 工期 | 生命 | 攻击 | 反装甲 | 防御 | 侦察 | 机动 | 维修 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 步兵班 | 兵营 | 补给 100 | 10s | 100 | 12 | 4 | 10 | 2 | 5 | 0 |
| 反装甲班 | 兵营 | 补给 130 / 合金 30 | 14s | 90 | 18 | 25 | 7 | 2 | 4 | 0 |
| 侦察车 | 装甲工厂 | 补给 100 / 合金 120 | 18s | 90 | 6 | 2 | 6 | 20 | 15 | 0 |
| 主战坦克 | 装甲工厂 | 补给 220 / 合金 300 | 30s | 160 | 35 | 20 | 30 | 3 | 10 | 0 |
| 维修车 | 装甲工厂 | 补给 150 / 合金 180 | 24s | 110 | 0 | 0 | 8 | 2 | 8 | 20 |

> 属性为阶段 3 设定的基础数值，已在阶段 4（编队占用）与阶段 5（战斗推演）中被真正使用。

### 生产规则

1. **单线生产**：同一时间只能有 1 个进行中的生产项目（`PRODUCTION.maxConcurrent = 1`）；其余入队等待。
2. **队列上限**：当前生产 + 等待队列最多 `PRODUCTION.maxQueueSize = 5` 项；队满时再入队被拒，并提示"生产队列已满"。
3. **立即扣费**：点击「训练 / 制造」立即扣除成本（库存不足按钮禁用并给出原因）；多座同名建筑时只从**运行中**的那座扣任务归属。
4. **防连点 / 防重复扣费**：重复点击、并发调用被拒绝，绝不会双扣费或重复入队。
5. **暂停 / 速度联动**：暂停（速度 0）时生产进度完全冻结；1× / 2× / 4× 仅改变每帧推进步数，结果一致、与帧率无关。
6. **完成结算**：进度达 100% 生成单位实例 → 写入 `state.units` 库存 → `stats.unitsBuilt` +1 → 自动开工队列下一项 → 画面播放出厂表现。
7. **库存不占指挥容量**：单位实例库存独立于指挥容量上限，阶段 4 编队时才占用。

### 资格错误码

`canQueueUnit(state, type)` 返回 `{ ok, code, reason, reasons[] }`，`code` 取值：

| code | 含义 |
| --- | --- |
| `unknown` | 未知单位类型 |
| `locked` | 单位尚未解锁（对应建筑未建成） |
| `producer_missing` | 来源建筑（兵营 / 装甲工厂）不存在 |
| `producer_offline` | 来源建筑存在但当前非运行中（施工中 / 离线） |
| `queue_full` | 生产队列已满 |
| `resource` | 资源不足 |

### 取消与返还

| 操作 | 返还比例 | 说明 |
| --- | --- | --- |
| 取消**当前**生产 | `PRODUCTION.activeCancelRefundRatio = 0.5` | 返还已扣成本的一半，受资源上限钳制 |
| 取消**等待队列**项 | `PRODUCTION.queuedCancelRefundRatio = 1` | 全额返还（入队时已扣费，等待项未开工） |

- 返还经 `grant` 钳制，不会溢出资源上限。
- 连续点击取消不会重复返还（当前项标记 `done` 后立刻清空，等待项按 `jobId` 精准移除）。

### 速度与离线

- 暂停（速度 0）时生产进度**完全冻结**，恢复后从原处继续；与帧率无关。
- **离线完整结算**：刷新 / 关闭页面后，资源、施工、生产、维修和科研按事件步进推进；1～59秒静默，60秒及以上显示离线报告。

### 存档与自愈（生产）

- 生产中 / 排队中保存后刷新，进度、剩余时间、已扣费用、等待队列都会原样恢复，**不会重复扣费**。
- 阶段3存档迁移逻辑仍由当前版本兼容；生产任务会保留创建时的科研时间快照。
- 半途生产恢复：刷新后进度从原处继续，绝不会凭空多产出单位。

---

## 二·七、阶段 4 编队系统

**核心约束**：玩家不直接操作单位，只能通过编队下达指令；库存单位不占指挥容量，正式编入后才占用。

### 编队规则

| 规则 | 数值 / 说明 |
| --- | --- |
| 编队数量上限 | `FORMATION.maxFormations = 6` 支 |
| 编队名称 | 自动生成「第一战斗群…第十战斗群」，可重命名（去空格、截断到 `maxNameLength = 20`）；空名被拒 |
| 可编辑状态 | 仅 `idle`（待命）可重命名 / 调整成员 / 解散；阶段 4 不存在其它状态 |
| 双向归属 | 同一单位不能同时属于两支编队；`formation.unitIds` 与 `unit.formationId` 必须一致 |
| 指挥容量 | 由已建成建筑的 `effects.commandCapacity` 提供（指挥中心 6 点）；占用 = Σ 编入成员 `UNITS[type].command`，**每次读档不信任存档、由成员重算** |

### 预设模板（原子操作）

`applyPreset` 先经 `canApplyPreset` 预检（模板存在 → 编队数量 → 库存充足 → 指挥容量），全部通过才一次性建编队并编入单位；任一项不满足皆不产生副作用。

| 预设 | 组成 | 指挥消耗 |
| --- | --- | --- |
| 综合战斗群 `combined` | 步兵班 ×2、反装甲班 ×1、侦察车 ×1 | **4** |
| 装甲突击群 `armor` | 主战坦克 ×2、步兵班 ×1、维修车 ×1 | **6** |
| 侦察分队 `recon` | 侦察车 ×2、步兵班 ×1 | **3** |

### 编队评估提示（只读建议）

`getFormationWarnings` 不改任何属性，返回以下提示（可叠加）：编队为空、侦察不足（scouting<8）、装甲缺步兵掩护、装甲缺维修车、反装甲不足（antiArmor<25）。

### 基地集结表现（Canvas，只读状态）

渲染层只按 `state.formations` / `state.units` 摆放已编入单位，**绝不修改单位归属或任何数值**：单位从基地出口大门（`RALLY.gate`）入场、按编队分站位区、编队名标签（"名·数量"）、新建 / 变更时选中高亮脉冲；动画走真实时间，暂停时调整编队也有视觉反馈。

### 存档与自愈（编队）

- 编队数据与单位实例一起保存；载入时 `sanitizeFormations()`（6 类检查）修复：引用不存在的单位、同一单位多编队、非待命状态复位为 idle 并清空 strategy/theaterId、编队数量超限、指挥容量超限（确定性移出末支编队尾部成员）、名称非法 / 过长；`command` 按真实成员重算。

---

## 二·八、阶段 5 战区与确定性自动战斗

**核心约束**：战斗结果在**派遣瞬间**由求解器一次性算出；画面（Canvas 战斗回放）只按事件时间轴播放，**暂停 / 加速都不会改变胜负**。相同种子 + 相同编队 + 相同策略 = 完全相同结果，可用于复盘与验证。

### 战区（递进解锁链）

| 战区 | 地形 | 难度 | 敌方编成 | 补给系数 | 首占奖励 | 占领收益 | 前置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 废弃矿区 `scrap_mine` | 开阔地 | 1 | 敌方步兵 ×3 | ×5 | 合金 300 | 合金 +1/s | — |
| 边境公路 `border_road` | 公路 | 2 | 敌方步兵 ×4、反装甲 ×2 | ×8 | 补给 400、情报 10 | 补给 +1/s | 废弃矿区 |
| 敌方前哨站 `enemy_outpost` | 防御阵地 | 3 | 敌方步兵 ×5、反装甲 ×3、轻型装甲 ×2 | ×12 | 合金 500、情报 25 | — | 边境公路 |

- 解锁由 `theaters[id].captured` 驱动：`isUnlocked` 要求全部前置战区已占领；未解锁卡片显示明确原因（"需要先占领：废弃矿区"）。

### 战前情报（雷达决定精度）

- 建成并运行**雷达站** → 敌情精确（逐单位数量与名称）；否则为侦察估算（数量给区间、高威胁单位标"疑似"）。
- 隐蔽度 `concealment` 决定伏击等级（enemy_outpost = high）；地形效果（装甲攻击 / 车辆机动 / 敌方防御 / 我方攻击 / 伏击风险）随战区写入情报。

### 作战策略（3 套）

| 策略 | 关键修正 | 额外成本 |
| --- | --- | --- |
| 谨慎推进 `cautious` | 侦察 +30%、防御 +15%、时间 +25%、伏击 −、输出 −8% | 无 |
| 正面突破 `breakthrough` | 首轮攻击 +25%、装甲攻击 +15%、补给 +25%、侦察不足时反装甲风险升高 | 无 |
| 火力侦察 `recon_by_fire` | 侦察 +20%、压制 +25%、更易提前发现高威胁、步兵攻击 −8% | 情报 5 |

### 派遣资格（全分支）

`canDispatch` 返回 `{ ok, code, reason, cost, missing }`，`code` 取值：`STATE_INVALID` / `UNKNOWN_THEATER` / `UNKNOWN_STRATEGY` / `BATTLE_ACTIVE`（同一时间只能一场作战）/ `CAPTURED` / `LOCKED` / `FORMATION_NOT_FOUND` / `FORMATION_BUSY` / `FORMATION_EMPTY` / `UNIT_UNAVAILABLE`（维修中或已损毁）/ `NO_COMBAT_UNIT` / `READY`。

- 任务成本 = `Σ(单位维持值) × 战区补给系数 × 策略补给倍率` + 策略固定成本（如 recon_by_fire 的情报 5）。

### 活动战斗生命周期

1. `dispatchFormation`：再校验 → 扣成本 → 一次性求解 → 建立 `state.activeBattle`（playing），编队转 `fighting`、成员 `deployed`；
2. `tickActiveBattle(dt)`：仅推进 `elapsed`（固定步长主循环调用），到时自动结算；
3. `settleActiveBattle`：**幂等**，写回存活单位耐久 / 移除永久损失 / 占领与首占奖励 / 战报入库 / 编队转 `returning`；
4. `settleActiveBattle`：只写入一次结算凭证，编队进入 `returning` 展示阶段（`returnDuration=5`）。
5. `tickBattleReturn(dt)`：只推进返航视觉计时；5 个游戏秒后自动完成返航。`skipBattleReturn` 只结束展示，不重新结算、不重复发奖；旧 `closeBattleResult` 保留为兼容别名。

### 确定性求解器（`battle.js`）

- `simulateBattle({ state, formation, theaterId, strategyId, seed })` 纯函数：只读 `state` / `formation` / 真实单位，**绝不修改**；相同 `seed` 产出逐字节一致的事件序列与战报。
- 四阶段：侦察 → 接敌 → 交火（最多 `BATTLE.maxRounds = 8` 轮）→ 结算（战地抢救）。
- 战地抢救**只对装甲 / 车辆**生效（维修车在场时按修复力概率抢回耐久归零的装甲 / 车辆）。
- 结果五类：`victory` 胜利 / `pyrrhic` 惨胜 / `defeat` 失败 / `withdraw` 主动撤退 / `wiped` 编队失去战斗能力；`victory` / `pyrrhic` 即占领。

### 占领奖励与收益

- 首次占领发放 `firstReward`（只发一次，`firstRewardTaken` 锁定）；
- 占领后由 `economy.recalcDerived` 按 `THEATERS[id].captureIncome` **实时重算**并入 `rates`，绝信任存档 `income` 字段（迁移时丢弃）。

### 战报与历史

- 每场战斗生成完整战报（初始 / 最终阵型、四阶段摘要、事件时间轴、损失与奖励、胜负原因、侦察判定、随机种子）；
- 历史战报按最新在前，`BATTLE.maxReports = 20` 条上限；
- 「战报」分页可查看统计、历史列表与任意一份完整复盘。

### 画面（Canvas RTS 战术战场）

- 与基地视图**共用同一块画布**：有活动战斗时 `main.js` 切到 `BattleRenderer`，无战斗时切回 `BaseRenderer`；切换时基地渲染器 `setSuspended` 避免两套提示叠加。
- 战斗画面只读 `(report, elapsed)`，可随时由 `(report, elapsed)` 完全重建，因此读档恢复到战斗中途也能正确显示。
- 新增 `battle-visual-director.js` 与 `battle-camera.js`：固定 `1200×700` 世界坐标、不同路线、开阔地/公路/防御阵地道具、多成员步兵和反装甲组，并支持总览/聚焦/打击/结果镜头。
- 视觉生命值只由战报 `DAMAGE` / `DESTROY` 权威事件改变，装饰效果不能写回战报或状态；主视图不再以「第N轮」作为呈现。
- 战术战场隐藏基地图例，结果时全局显示「查看完整战报」与「跳过返航动画」，不依赖右侧当前分页。

### 存档与自愈（战区 / 战报）

- 战区与战报存档会继续经过严格元数据、参战名单、快照数值、时间轴和奖励校验。
- 损坏的活动战斗不会白屏，`loadGame` 自动修复并提示。

---

## 二·九、阶段 6/7 数据完整性、单位维修与离线结算

### 战斗结算加固（10 项阻断性修复）

- **时间轴单调**：先 push 完所有事件（含 RESULT），再统一按 `index/(total-1)*duration*0.95` 分配时间，保证单调不减、首个为 0、最后一个严格小于 duration，回放不再跳回开头。
- **防御只护我方**：`defenseMod = target.side==='friendly' ? (m.defense||1) : 1`，敌方防御不再被我方攻击穿透。
- **反装甲风险**：`at_infantry` 攻击我方 `armor` 时按 `atRisk` 倍率加成。
- **车辆机动**：新增 `effectiveMobility`，车辆/装甲受 `terrain.vehicleMobility` 影响，决定行动顺序。
- **压制阈值**：`suppressThreshold = base / (modifiers.suppression||1)`，火力侦察更易压制。
- **战报 ID 含策略**：`battle_<seed>_<formation>_<theater>_<strategy>`，不同策略产生不同 ID。
- **事务性结算**：`validateBattleReportForSettlement` → `buildSettlementPlan`（只读）→ `applySettlementPlan`（JSON 快照回滚写入）→ 成功后才置 `settled`；任一步失败不留半成品。
- **未结算禁止返回基地**：`closeBattleResult` 检查 `settled`，播放中途点按钮不再提前拿结果。
- **派遣失败完整回滚**：求解异常时 `grant(state, mission.cost)` 退款、编队保持 idle、不消耗 attempts、不建立活动战斗。
- **参战快照**：`dispatchedUnitIds` 去重固定顺序，结算只认这份名单，结算前改编队不影响写回。

### 经验配置

`BATTLE.experience`：单位参与 `+5`、胜利 `+5`；编队参与 `+10`、胜利 `+10`。结算时按存活/胜利写入 `unit.experience` / `formation.experience`。

### 单位维修系统（`repairs.js`）

| 规则 | 数值 / 说明 |
| --- | --- |
| 损伤判定 | `hp<=0` 损毁 / `ratio>=1` 完好 / `ratio>=0.5` 轻伤 / 否则重伤；损毁与完好不可维修 |
| 维修耗时 | 轻伤 15s、重伤 35s（`REPAIR.times`） |
| 维修成本 | 轻伤 补给20/合金15、重伤 补给50/合金45（`REPAIR.cost`） |
| 并行工位 | `REPAIR.maxConcurrent = 2`，同时推进 2 项维修 |
| 队列上限 | `REPAIR.maxQueueSize = 8`（含进行中） |
| 取消退款 | 进行中退 50%、排队中全额退（`activeCancelRefundRatio`/`queuedCancelRefundRatio`） |

- **安全脱编队**：单位进入维修即从 `formation.unitIds` 移除、`formationId=null`、`status='repairing'`，释放指挥容量；完成后回到库存 `ready`。
- **事件步进推进**：`tickRepairs` 按下一个完成事件切分步长，保证一次大 dt 与多次小 dt 结果完全一致（与离线结算共用同一套逻辑）。
- **存档容错**：`sanitizeRepairs`（**必须在 `sanitizeFormations` 之前**）丢弃引用不存在单位的任务、去重同一单位、释放维修单位的编队归属、活跃工位超限降级为排队、孤儿维修单位恢复待命。

### 完整离线结算（`offline.js`）

- **时长截断**：`calculateOfflineSeconds` 按 `TIME.offlineMaxHours = 8` 截断，超出提示"仅结算最近 8 小时"。
- **事件步进推进**：`settleOfflineProgress` 把下一个施工完成 / 生产完成 / 维修完成 / 离线结束当作步进点，每段内才用稳定 rates 推进资源；与在线推进结果一致（刚建好的仓库会提高上限、刚完工的建筑会贡献产量）。
- **离线报告**：写入 `state.offline`，含时长、资源收益、完工工程、出厂单位、维修完成明细行，概览页弹卡片 + 「知道了」按钮关闭。
- **幂等 / 防重放**：结算后立刻刷新 `savedAt`，同一段离线不重复结算；`importSave` 设 `savedAt=now, offline=null`，导入存档不触发离线收益。

### 存档与自愈（维修 / 离线）

- 存档版本 `SAVE_VERSION = 6`，兼容阶段6版本5；`sanitizeRepairs` 在 `sanitizeFormations` 之前运行，科研状态随后规范化并保留未完成任务。
- `loadGame` 调 `calculateOfflineSeconds` → `settleOfflineProgress` 真实结算，返回 `offlineReport` / `repairQueueRepaired`；结算失败降级为"只显示时长"，不让读档失败。

---

## 三、目录结构

```
iron-command/
├── index.html              页面骨架（四区布局：顶栏 / 画面 / 侧栏 / 日志）
├── README.md               本文件
├── package.json            零依赖，仅含 start / test 脚本
├── css/
│   └── style.css           深色军事指挥终端主题（含生产页样式）
├── js/
│   ├── config.js           ★ 全部数值配置（唯一数据源，含 UNITS / PRODUCTION / THEATERS / STRATEGIES）
│   ├── utils.js            工具函数、格式化、确定性随机数（mulberry32）
│   ├── state.js            全局状态创建与访问
│   ├── events.js           事件日志 + 模块间事件总线
│   ├── economy.js          资源产出、上限、电力与派生数值（含战区占领收益）
│   ├── construction.js     建设系统：资格/扣费/推进/完成/取消/进度/存档容错（阶段 2）
│   ├── production.js       单位生产：解锁/资格/扣费/队列/推进/完成/取消/库存/进度/存档容错（阶段 3）
│   ├── formations.js       编队管理        （阶段 4）
│   ├── theater.js          战区/策略/派遣/活动战斗生命周期/战报/事务结算/存档容错（阶段 5，阶段 6 加固）
│   ├── battle.js           确定性自动战斗求解器（阶段 5，阶段 6 修复时间轴/防御/压制）
│   ├── battle-renderer.js  Canvas 战斗回放渲染器（与基地渲染器共用画布）
│   ├── repairs.js          单位维修：损伤判定/排队/并行推进/完成/取消/离线推进/存档容错（阶段 6/7）
│   ├── research.js         技术实验室、科研队列、科研版本历史与存档容错（阶段 7/8）
│   ├── units.js            单位档案、呼号、老兵等级与有效属性（阶段 8）
│   ├── operations.js       重复任务成本、冷却与操作记录（阶段 8）
│   ├── integrity.js        科研闭包、战报结果与确定性比较（阶段 8）
│   ├── unit-status.js      统一单位损伤等级纯逻辑模块（阶段 7）
│   ├── offline.js          完整离线结算：令牌/静默阈值/事件步进/离线科研报告（阶段 6/7）
│   ├── save.js             存档序列化、校验、迁移（v1→v7）、离线结算接线、自动保存
│   ├── renderer.js         Canvas 伪2.5D 渲染器（只读状态；生产/出厂/集结区/维修车间表现）
│   ├── ui.js               DOM 界面更新与事件绑定（含部队档案/重复任务/离线报告）
│   └── main.js             启动入口、固定步长主循环、调试接口 __IRON_COMMAND__（阶段 8 接口）
├── scripts/
│   └── serve.mjs           零依赖本地静态服务器（防路径穿越 403 / 正确 content-type）
└── tests/
    ├── stage3-test.mjs     阶段 3 自动化测试（node:assert/strict，零依赖桩）
    ├── stage4-test.mjs     阶段 4 自动化测试（编队/指挥容量/UI/服务器）
    ├── stage5-test.mjs     阶段 5 自动化测试（战区/策略/求解器/战报/迁移/UI/服务器）
    ├── stage6-test.mjs     阶段 6 自动化测试（战斗修复/维修/离线结算/迁移/调试接口/UI/渲染器）
    ├── stage7-test.mjs     阶段 7 自动化测试（数据完整性/科研/离线科研/UI/存档）
    └── stage8-test.mjs     阶段 8 自动化测试（完整性/老兵/重复任务/离线就绪）
```

---

## 四、架构约定

理解这几条，后续阶段扩展就不会踩坑：

1. **数值只写在 `config.js`。** 任何平衡性调整都改这一个文件，其他模块只读取，不硬编码数字。
2. **状态只存在 `state.js`。** 其他模块通过 `getState()` 拿到同一个对象，禁止各自维护副本。
3. **经济逻辑与画面完全分离。** `economy.js` 不认识 Canvas，`renderer.js` 只读状态、绝不修改状态。把渲染整个删掉，游戏逻辑照常运行。
4. **战斗逻辑与动画分离。** `battle.js`（阶段 5）先一次性算完整场战斗并产出事件序列，`renderer.js` 只负责按时间轴回放。动画快慢不影响结果。
5. **固定步长推进。** 主循环按 `TIME.logicStep = 0.05` 秒累积推进，60fps 和 30fps 下推演结果完全一致，4× 速度只是每帧多跑几步。
6. **确定性随机。** `utils.js` 的 `createRng(seed)` 提供可复现随机数，保证"相同种子 + 相同编队 + 相同策略 = 相同战斗结果"。
7. **单向依赖，无循环引用。** 依赖方向固定为 `config / utils → state → events → 逻辑层 → renderer / ui → main`。
8. **模块间用事件总线通信。** 逻辑层通过 `emit('production:completed', {unitType, sourceBuildingId, sourceBuildingType})` 广播，渲染层订阅后播放出厂动画，两边互不持有引用。
9. **逻辑层不碰 DOM / Canvas。** `production.js` 与 `construction.js` 只改状态；`ui.js` 只读状态转交回调；`renderer.js` 只读状态绘制。

---

## 五、存档说明

- 存储键：`iron-command.save.v1`（localStorage）
- 自动保存：每 **30 秒**（真实时间）一次，另在关闭/刷新页面前补存一次
- 容错：存档损坏、版本不符、字段缺失时会**自动回退到新游戏**并在日志中提示，不会白屏
- 版本迁移：`SAVE_VERSION` 当前为 **6**，兼容阶段6版本5存档；老存档加载时还会规范化科研任务、单位损伤、维修成本和离线账本，并立即持久化离线结算结果。
- 离线规则：`time.game` 会推进，`time.played` 不会因离线增加；1～59秒静默推进，60秒及以上生成报告。活动战斗在离线期间保持暂停；相同结算令牌只会执行一次。
- 隐私模式或禁用 localStorage 时，游戏仍可正常运行，仅提示"存储不可用"

**手动清档**：点击右侧面板的「新游戏」按钮，或在浏览器控制台执行 `__IRON_COMMAND__.reset()`。

---

## 六、调试

页面加载后，浏览器控制台可用调试句柄：

```js
__IRON_COMMAND__.getState()          // 查看当前完整状态
__IRON_COMMAND__.save()              // 立即保存
__IRON_COMMAND__.load()              // 重新读档
__IRON_COMMAND__.reset()             // 清档重开

// —— 建设（阶段 2）——
__IRON_COMMAND__.canBuild('supply_depot')        // 查询某建筑能否建造（返回 {ok, code, reason}）
__IRON_COMMAND__.built()             // 列出已建成的建筑类型
__IRON_COMMAND__.cancelConstruction()// 取消当前施工（等同点击取消按钮）
__IRON_COMMAND__.getConstructionProgress()       // 返回当前施工进度详情或 null

// —— 生产（阶段 3）——
__IRON_COMMAND__.canProduce('infantry')          // 查询某单位能否生产（返回 {ok, code, reason}）
__IRON_COMMAND__.produce('infantry')             // 入队生产某单位（等同点击卡片按钮）
__IRON_COMMAND__.getProductionProgress()         // 返回当前生产进度详情或 null
__IRON_COMMAND__.cancelCurrentProduction()       // 取消当前生产（返还 50%）
__IRON_COMMAND__.cancelQueuedProduction(jobId)   // 取消等待队列中的某一项（按 jobId 全额返还）
__IRON_COMMAND__.productionQueue()               // 返回当前生产 + 等待队列的快照
__IRON_COMMAND__.inventory()                     // 返回库存统计（按类型计数 + 总数 / 待命 / 已编入 / 维修中）

// —— 编队（阶段 4）——
__IRON_COMMAND__.formations()                  // 列出全部编队（浅拷贝快照）
__IRON_COMMAND__.command()                     // 指挥容量占用 {capacity,used,free}
__IRON_COMMAND__.canCreateFormation()          // 是否还能建立新编队
__IRON_COMMAND__.createFormation('名称')        // 建立空编队（不传名称自动生成「第N战斗群」）
__IRON_COMMAND__.renameFormation(id,'名称')     // 重命名编队
__IRON_COMMAND__.disbandFormation(id)           // 解散编队（默认跳过确认弹窗）
__IRON_COMMAND__.canAddUnit(id,unitId)          // 单位能否加入编队
__IRON_COMMAND__.addUnit(id,unitId)             // 单位入队
__IRON_COMMAND__.removeUnit(id,unitId)          // 单位移出编队
__IRON_COMMAND__.canApplyPreset('combined')     // 预设模板能否套用（combined/armor/recon）
__IRON_COMMAND__.applyPreset('combined')        // 套用预设模板（原子操作）
__IRON_COMMAND__.presets()                      // 预设模板列表与指挥消耗
__IRON_COMMAND__.getFormationStats(id)          // 编队汇总属性
__IRON_COMMAND__.getFormationWarnings(id)       // 编队评估提示（字符串数组）
__IRON_COMMAND__.getFormationCommandCost(id)    // 某编队占用的指挥点
__IRON_COMMAND__.availableUnits('infantry')     // 可加入编队的库存单位（可传类型过滤）
__IRON_COMMAND__.formationRules()               // 编队规则常量 {maxFormations,maxNameLength,editableStatuses}

// —— 战区与战斗（阶段 5）——
__IRON_COMMAND__.theaters()                     // 全部战区视图（解锁/占领/战绩）
__IRON_COMMAND__.theater('scrap_mine')          // 单个战区视图
__IRON_COMMAND__.intel('scrap_mine')            // 战区敌情（雷达在线时为精确值）
__IRON_COMMAND__.strategies()                   // 作战策略列表
__IRON_COMMAND__.missionCost(fmtId,'scrap_mine','cautious')  // 任务成本预览（含明细）
__IRON_COMMAND__.canDispatch(fmtId,'scrap_mine','cautious')  // 派遣资格校验（不修改状态）
__IRON_COMMAND__.dispatch(fmtId,'scrap_mine','cautious'[,seed]) // 派遣出击；传 seed 可复现同一场战斗
__IRON_COMMAND__.activeBattle()                 // 当前活动战斗（含播放进度与结算标记）
__IRON_COMMAND__.battleFinished()               // 战斗是否已结算完毕
__IRON_COMMAND__.tickBattle(2)                  // 手动推进战斗播放进度（游戏秒），到点自动结算
__IRON_COMMAND__.settleBattle()                 // 立即结算当前战斗（幂等）
__IRON_COMMAND__.abortInvalidBattle()           // 仅安全关闭已被永久阻断的无效战斗
__IRON_COMMAND__.closeBattle()                  // 返回基地，关闭结算面板
__IRON_COMMAND__.reports()                      // 历史战报（最新在前）
__IRON_COMMAND__.report(reportId)               // 按 ID 取某份战报
__IRON_COMMAND__.simulate(fmtId,'scrap_mine','cautious',123) // 纯求解：不扣资源不改状态，只算结果（验证确定性）
__IRON_COMMAND__.hasRadar()                     // 雷达站是否在线（决定敌情精度）
__IRON_COMMAND__.battleRules()                  // 战斗规则常量 {maxRounds,baseDuration,maxReports,...}

// —— 维修与离线结算（阶段 6/7）——
__IRON_COMMAND__.damageState(unitId)            // 查询单位损伤等级 {damage,hp,maxHp}
__IRON_COMMAND__.canRepair(unitId)               // 查询单位能否维修（返回 {ok,code,reason,severity,cost,duration,missing}）
__IRON_COMMAND__.repair(unitId)                 // 把单位送去维修（等同点击维修按钮）
__IRON_COMMAND__.repairs()                      // 当前维修队列 {active,queued} 快照
__IRON_COMMAND__.advanceRepairs(60)             // 手动推进维修队列 N 游戏秒（事件步进，与离线一致）
__IRON_COMMAND__.cancelRepair(jobId)             // 取消维修任务（默认跳过确认，按状态退款 50%/100%）
__IRON_COMMAND__.settleOffline(3600)             // 手动触发离线结算（推进真实秒数，调试用）
__IRON_COMMAND__.offlineReport()                 // 当前离线报告（无报告返回 null）
__IRON_COMMAND__.dismissOfflineReport()          // 关闭离线报告卡片（玩家点「知道了」）
__IRON_COMMAND__.validateActiveBattle()          // 校验当前活动战斗战报能否结算（只读）
__IRON_COMMAND__.settlementPlan()                // 生成当前活动战斗的结算计划（只读）
__IRON_COMMAND__.repairRules()                   // 维修规则常量 {maxConcurrent,maxQueueSize,refundRatio,times,cost}

// —— 技术实验室与科研（阶段 7）——
__IRON_COMMAND__.technologies()                  // 九项科技及当前状态
__IRON_COMMAND__.technology('logistics_optimization')
__IRON_COMMAND__.canResearch('logistics_optimization')
__IRON_COMMAND__.research('logistics_optimization')
__IRON_COMMAND__.researchQueue()                 // 当前 / 等待研究任务
__IRON_COMMAND__.researchProgress()
__IRON_COMMAND__.advanceResearch(30)
__IRON_COMMAND__.cancelCurrentResearch({confirm:false})
__IRON_COMMAND__.cancelQueuedResearch(jobId,{confirm:false})
__IRON_COMMAND__.completedResearch()
__IRON_COMMAND__.researchModifiers()
__IRON_COMMAND__.sanitizeResearch()
__IRON_COMMAND__.settleOffline(3600,{token:'manual-test-001'}) // 离线令牌只结算一次

// —— 部队档案与重复任务（阶段 8）——
__IRON_COMMAND__.units()                       // 单位档案、呼号、经验与状态
__IRON_COMMAND__.unit(unitId)                   // 单个单位档案
__IRON_COMMAND__.unitRank(experience)           // 等级与动态进度
__IRON_COMMAND__.renameUnit(unitId,'先锋')       // 保存呼号（最多12字）
__IRON_COMMAND__.unitEffectiveStats(unitId)     // 战斗中实际属性（含等级修正）
__IRON_COMMAND__.operations()                   // 三个重复任务及冷却 / 战绩
__IRON_COMMAND__.operation('salvage_run')       // 单个重复任务状态
__IRON_COMMAND__.canDispatchOperation(fmtId,'salvage_run','cautious')
__IRON_COMMAND__.dispatchOperation(fmtId,'salvage_run','cautious',{seed:123})
__IRON_COMMAND__.operationCooldown('salvage_run')
__IRON_COMMAND__.researchHistory()              // 最近64个科研版本
__IRON_COMMAND__.validateResearchHistory()      // 科研历史完整性检查
__IRON_COMMAND__.validateActiveBattleDeterministically()
```

右下角状态芯片显示实时 FPS 与逻辑步进情况。

---

## 七、已知限制（阶段 8.1）

- 科研必须先建成雷达站，再建成唯一的技术实验室；科研只有单条队列，最多包含当前任务与两项等待任务
- 兵营 / 装甲工厂解锁的 5 种单位**已可生产、入库、编队、进入自动战斗推演并在受损后维修**
- `battle.js` 的 `simulateBattle()` 已实现**确定性求解器**：相同种子 + 相同编队 + 相同策略 = 完全相同结果
- **离线收益已完整发放**：刷新 / 关闭页面后，离线期间的资源产出、施工、生产、维修进度按事件步进一次性结算并弹报告卡片，与在线推进结果一致
- **受损单位维修**：战斗中耐久下降的单位可在「维修」分页排队修复，完成后返回库存待命；取消维修按状态退款
- 电力不足惩罚、建筑损毁等逻辑已写好但当前触发不到（维修队列已接入，单位损伤会真正影响后续派遣）
- **战斗为全自动推演**：玩家无法在中途手动指挥单位，只能选择策略与是否提前结算（确定性求解器在派遣瞬间已算完一场战斗）
- 镜头为确定性自动镔头，玩家不直接操作单位，也不提供手动微操作
- 建筑不可升级、不可拆除、不可自由摆放（阶段 2 限定：每种最多 1 座，系统预设槽位）
- 单位等级只提供配置化的战斗快照修正；装备、指挥官、随机事件、新战区和手动指挥仍未开放
- 重复任务必须先占领对应战区；奖励与冷却只在可信战报通过校验后写入

---

## 八、开发路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 项目骨架与基地画面 | ✅ 已完成 |
| 2 | 建设系统（造价、工期、施工动画、电力约束、取消、施工存档） | ✅ 已完成 |
| 3 | 单位生产与兵种数据（解锁、单线生产、队列、库存、出厂表现、生产存档） | ✅ 已完成 |
| 4 | 编队系统与指挥容量 | ✅ 已完成 |
| 5 | 战区、作战策略与自动战斗推演 | ✅ 已完成 |
| 6 | 战斗结算加固、单位维修与完整离线结算 | ✅ 已完成 |
| 7 | 数据完整性修复、技术实验室与科研系统 | ✅ 已完成 |
| 8 | 科研版本、战斗完整性、单位档案、老兵等级与重复任务 | ✅ 已完成 |
| 8.1 | RTS战术战场、镜头、结算后返航与全局结果控件 | ✅ 已完成 |
| 9 | 装备系统与新战区扩展 | 预留接口 |

## Stage 8.2D-A.2

- 新增 `js/battle-outcome.js`，统一正式求解器、完整性校验与 report adapter 的可战斗单位判定和胜负语义。
- victory / pyrrhic 严格要求敌方可战斗单位为 0；campaign / operation 的占领、失败奖励和 withdraw retreat 时序均由同一校验契约约束。
- campaign-victory 使用 `infantry + at_infantry + scout_car + mbt + mbt + repair_vehicle` 严格支持阵容；四份 Fixture 均由正式求解器确定性生成。
- Manifest 增加 `validation`、`supported`、`missingRequirements`；新增交付包自检器和 20 项 A.2 正式测试。
- `npm test`：608 passed / 0 failed；adapter 76 / 76；integrity 85 / 85；五组旧沙盒测试全部通过。
- 完成 `STAGE8-2D-A-2-DELIVERY.md` 与 `iron-command-stage8-2D-A-2-outcome-fixture-hotfix.zip`；8.2D-B 未启动。

## Stage 8.2D-A.3

- 新增 `js/battle-targeting.js`，移除正式目标排序比较器中的 RNG 副作用；非空选敌固定消费一次 tie salt。
- 原生、插入、归并排序在 1000 组候选数据和正式 Fixture seed 1..200 下生成完全一致战报；8 个独立 Node 进程 Fixture 哈希一致。
- Manifest 正式边界补入 `js/battle-targeting.js` 与 `js/utils.js`，四张截图增加 `viewerScreenshot` SHA 和 Fixture report hash 绑定。
- `verify-delivery-package.mjs` 和 `build-delivery-package.mjs` 均自启临时 HTTP 服务器，不依赖预先运行的 8000 端口。
- package version 更新为 `0.8.1-hotfix.3`；`npm test` 为 627 passed / 0 failed；完成 `STAGE8-2D-A-3-DELIVERY.md` 与 A.3 交付 ZIP。
- 8.2D-B 未启动。

## Stage 8.2E-A

- 正式战斗页面已接入 `js/battle-presentation/` 参数化公路胜利演出侧车，默认自动准入正式 `activeBattle.report`，不读取 `experiments/`。
- 支持 session-only 的 `auto / legacy / contract` 偏好；实际模式为 `contract_road_victory` 或 `legacy`，任何不支持报告或渲染异常都会安全回退旧 BattleRenderer。
- 演出时间由正式战斗 elapsed 驱动，计划按 battle/report/seed/result 缓存；结算、返航、跳过返航、读档与回基地均保持原业务语义。
- 交付说明见 `STAGE8-2E-A-DELIVERY.md`，浏览器取帧见 `screenshots/stage8-2E-A-screenshot-manifest.json`，自包含封包验证由 `tests/build-stage8-2E-A-delivery-package.mjs` / `tests/verify-stage8-2E-A-delivery-package.mjs` 完成。
# 阶段 8.2E-A.2.2 验证器收口

最终交付验证命令：

```bash
npm run verify:stage8-2E-A-2-2
npm run build:stage8-2E-A-2-2
```

验证器采用显式测试清单、按需静态服务器、进程组终止和可配置全局超时；统计从实际测试输出生成。详见 `STAGE8-2E-A-2-2-DELIVERY.md`。
