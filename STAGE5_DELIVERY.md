# 钢铁指令 / IRON COMMAND —— 阶段 5 交付说明

> 版本：`CURRENT_STAGE = 5`，`SAVE_VERSION = 4`
> 交付日期：2026-08-04
> 类型：纯前端原型（零第三方依赖；ES Module；需经本地 HTTP 服务器运行）

---

## 一、本阶段目标

在阶段 1（框架 / 经济 / 渲染）、阶段 2（建设）、阶段 3（单位生产）、阶段 4（编队）的基础上，完成**战区派遣、作战策略与确定性自动战斗推演**：

- 3 个递进解锁的战区（废弃矿区 → 边境公路 → 敌方前哨站），占领后并入经济派生收益；
- 3 套作战策略（谨慎推进 / 正面突破 / 火力侦察），改变侦察、压制、伏击与成本；
- 派遣资格全分支校验 + 活动战斗生命周期（派遣 → 推进 → 结算幂等 → 返回基地）；
- **确定性战斗求解器**：相同种子 + 相同编队 + 相同策略 = 完全相同结果，可复盘、可验证；
- Canvas 四阶段战斗回放（与基地视图共用画布，只读事件时间轴）；
- 可解释战报（损失 / 奖励 / 胜负原因 / 事件时间轴 / 随机种子）与历史；
- 存档迁移 `v3 → v4`，活动战斗自愈，损坏数据载入不白屏；
- 科研 / 维修队列 / 离线收益结算 / 战斗中手动指挥 / 单位升级**仍未开放**，但数据结构与接口已全部预留。

---

## 二、增量交付范围（不重写已验收系统）

阶段 5 仅做**增量修改**，未重写 / 重建以下已验收系统：资源经济、固定步长逻辑循环、Canvas 分层渲染、建设系统、生产系统、单位实例、库存、编队与指挥容量、localStorage 存档与迁移自愈（阶段 4 既有的 `sanitizeFormations` 仍保留并继续生效）。

新增 / 改动文件：

| 文件 | 改动 |
| --- | --- |
| `js/theater.js` | **新增核心模块**：战区解锁链、战前情报（雷达精度）、3 策略、派遣资格 `canDispatch`、活动战斗生命周期（`dispatchFormation` / `tickActiveBattle` / `settleActiveBattle` 幂等 / `closeBattleResult`）、占领奖励与收益、`getReports` / `getReport`、战报裁剪、活动战斗自愈、`sanitizeTheaters` / `sanitizeActiveBattle` / `sanitizeBattles` 容错、调试接口所需全部导出 |
| `js/battle.js` | **新增确定性求解器**：`simulateBattle({state,formation,theaterId,strategyId,seed})` 纯函数（只读状态、绝不修改）；四阶段（侦察 → 接敌 → 交火 ≤ `BATTLE.maxRounds=8` 轮 → 结算战地抢救）；五类结果；`resultLabel` / `createEmptyReport` / `issueCommand` 导出 |
| `js/battle-renderer.js` | **新增**：Canvas 战斗回放，与 `BaseRenderer` 共用同一块画布；只读 `(report, elapsed)` 可随时完全重建；`setSuspended` 与基地渲染器协调避免双提示叠加 |
| `js/config.js` | 新增 `THEATERS` / `STRATEGIES` / `BATTLE` / `BATTLE_EVENT` / `BATTLE_PHASE` / `BATTLE_RESULT` / `THEATER_CODE` 配置块；`CURRENT_STAGE` 升到 5，`SAVE_VERSION` 升到 4 |
| `js/economy.js` | `recalcDerived` 依据 `THEATERS[id].captureIncome` 实时重算 `rates`（不信任存档 `income` 字段） |
| `js/save.js` | `migrate` 顺序：`sanitizeTheaters → sanitizeBattles → sanitizeActiveBattle`（透传 `activeFormationId`，早于 `sanitizeFormations`）→ `sanitizeFormations`；`SAVE_VERSION = 4`；`loadGame` 返回 `theaterRepaired` / `battleRepaired` 等布尔字段与修复日志 |
| `js/ui.js` | 「战区」分页（战区卡片 / 解锁原因 / 派遣控制台 / 策略卡 / 成本 / 资格原因 / 活动战斗面板 / 结算横幅）与「战报」分页（统计 / 历史列表 / 详情）构建与刷新 |
| `js/main.js` | 阶段 5 handler 接线（派遣 / 提前结算 / 关闭战斗 / 选战区 / 选战报）+ 调试接口（theaters/intel/strategies/missionCost/canDispatch/dispatch/activeBattle/settleBattle 等）+ 阶段 5 开场日志 |
| `js/renderer.js` | 主循环按 `state.activeBattle` 在 `BaseRenderer` 与 `BattleRenderer` 间切换，切换时 `BaseRenderer.setSuspended()` |
| `tests/stage5-test.mjs` | **新增**阶段 5 自动化测试（99 项） |
| `README.md` | 版本横幅、测试说明、右侧面板可用分页、阶段 5 战区与确定性自动战斗章节、调试接口、已知限制、开发路线全部更新 |

---

## 三、关键数值与业务规则

### 战区（递进解锁链）

| 战区 | 地形 | 难度 | 敌方编成 | 补给系数 | 首占奖励 | 占领收益 | 前置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scrap_mine` 废弃矿区 | 开阔地 | 1 | 敌方步兵 ×3 | ×5 | 合金 300 | 合金 +1/s | — |
| `border_road` 边境公路 | 公路 | 2 | 敌方步兵 ×4、反装甲 ×2 | ×8 | 补给 400、情报 10 | 补给 +1/s | 废弃矿区 |
| `enemy_outpost` 敌方前哨站 | 防御阵地 | 3 | 敌方步兵 ×5、反装甲 ×3、轻型装甲 ×2 | ×12 | 合金 500、情报 25 | — | 边境公路 |

解锁由 `theaters[id].captured` 驱动：`isUnlocked` 要求全部前置战区已占领；未解锁卡片明确显示原因（"需要先占领：废弃矿区"）。

### 战前情报（雷达决定精度）

- 建成并运行**雷达站** → 敌情精确（逐单位数量与名称）；否则为侦察估算（数量给区间、高威胁单位标"疑似"）；
- 隐蔽度 `concealment` 决定伏击等级（`enemy_outpost = high`）；地形效果（装甲攻击 / 车辆机动 / 敌方防御 / 我方攻击 / 伏击风险）随战区写入情报。

### 作战策略（3 套）

| 策略 | 关键修正 | 额外成本 |
| --- | --- | --- |
| `cautious` 谨慎推进 | 侦察 +30%、防御 +15%、时间 +25%、伏击 −、输出 −8% | 无 |
| `breakthrough` 正面突破 | 首轮攻击 +25%、装甲攻击 +15%、补给 +25%、侦察不足时反装甲风险升高 | 无 |
| `recon_by_fire` 火力侦察 | 侦察 +20%、压制 +25%、更易提前发现高威胁、步兵攻击 −8% | 情报 5 |

### 派遣资格（`canDispatch`，全分支）

返回 `{ ok, code, reason, cost, missing }`，`code` 取值：

`STATE_INVALID` / `UNKNOWN_THEATER` / `UNKNOWN_STRATEGY` / `BATTLE_ACTIVE`（同一时间只能一场作战）/ `CAPTURED` / `LOCKED` / `FORMATION_NOT_FOUND` / `FORMATION_BUSY` / `FORMATION_EMPTY` / `UNIT_UNAVAILABLE`（维修中或已损毁）/ `NO_COMBAT_UNIT` / `READY`。

任务成本 = `Σ(单位维持值) × 战区补给系数 × 策略补给倍率` + 策略固定成本（如 `recon_by_fire` 的情报 5）。

### 活动战斗生命周期

1. `dispatchFormation`：再校验 → 扣成本 → 一次性确定性求解 → 建立 `state.activeBattle`（playing），编队转 `fighting`、成员 `deployed`；
2. `tickActiveBattle(dt)`：仅推进 `elapsed`（固定步长主循环驱动），到时自动结算；
3. `settleActiveBattle`：**幂等**，写回存活单位耐久 / 移除永久损失 / 占领与首占奖励 / 战报入库 / 编队转 `returning`；
4. `closeBattleResult`：玩家点「返回基地」→ 编队复位 `idle`、成员 `assigned`、清空 `activeBattle`。

### 确定性求解器（`battle.js`）

- `simulateBattle({ state, formation, theaterId, strategyId, seed })` 纯函数：只读 `state` / `formation` / 真实单位，**绝不修改**；相同 `seed` 产出逐字节一致的事件序列与战报；
- 四阶段：侦察 → 接敌 → 交火（最多 `BATTLE.maxRounds = 8` 轮）→ 结算（战地抢救）；
- 战地抢救**只对装甲 / 车辆**生效（维修车在场时按修复力概率抢回耐久归零的装甲 / 车辆）；
- 结果五类：`victory` 胜利 / `pyrrhic` 惨胜 / `defeat` 失败 / `withdraw` 主动撤退 / `wiped` 编队失去战斗能力；`victory` / `pyrrhic` 即占领。

### 占领奖励与收益

- 首次占领发放 `firstReward`（只发一次，`firstRewardTaken` 锁定）；
- 占领后由 `economy.recalcDerived` 按 `THEATERS[id].captureIncome` **实时重算**并入 `rates`，绝不信任存档 `income` 字段（迁移时丢弃）。

### 战报与历史

- 每场战斗生成完整战报（初始 / 最终阵型、四阶段摘要、事件时间轴、损失与奖励、胜负原因、侦察判定、随机种子）；
- 历史战报按最新在前，`BATTLE.maxReports = 20` 条上限；「战报」分页可查看统计、历史列表与任意一份完整复盘。

### 画面（Canvas 战斗回放，只读）

- 与基地视图共用同一块画布：有活动战斗时 `main.js` 切到 `BattleRenderer`，无战斗时切回 `BaseRenderer`；切换时基地渲染器 `setSuspended` 避免两套提示叠加；
- 战斗画面只读 `(report, elapsed)`，可随时由 `(report, elapsed)` 完全重建，因此读档恢复到战斗中途也能正确显示。

### 存档与自愈（战区 / 战报，v3 → v4）

- `SAVE_VERSION = 4`，兼容 v1 / v2 / v3；`migrate()` 顺序：`sanitizeTheaters`（补齐 / 剔除未知战区、丢弃 `income`、首占标记对齐）→ `sanitizeBattles`（过滤无效 / 限长 / 去重）→ `sanitizeActiveBattle`（**必须在 `sanitizeFormations` 之前**，透传 `activeFormationId`，已结算战斗的编队修正为 `returning`）→ `sanitizeFormations`；
- 损坏的活动战斗不会白屏，`loadGame` 自动修复并提示。

---

## 四、如何运行与验证

### 启动（任选其一）

```bash
npm start                 # node scripts/serve.mjs  → http://127.0.0.1:8000
# 或
node scripts/serve.mjs 8080
# 或
python -m http.server 8000
```

部署后浏览器打开 `http://127.0.0.1:8000`，进入「战区」分页即可组建部队并派遣作战（前提是已建成兵营 / 装甲工厂并有可战单位）；「战报」分页查看复盘。

### 自动化测试

```bash
npm test
# 等价于
node tests/stage3-test.mjs   # 63 项（阶段 1/2/3 回归）
node tests/stage4-test.mjs   # 76 项（阶段 4 全量）
node tests/stage5-test.mjs   # 99 项（阶段 5 全量）
```

阶段 5 测试覆盖（共 12 节 A–L）：阶段 4 四类问题修复回归、战区配置与解锁链、战前情报（雷达精度）、派遣资格全分支、活动战斗推进与结算幂等、确定性求解器（同种子同结果 / 纯函数 / 战地抢救不变式）、占领奖励与持续收益、存档迁移 v3→v4（`sanitize` 系列 + round-trip）、UI 战区页 / 战报页构建（DOM 桩）、战斗渲染器只读表现、调试接口契约、本地服务器与全量语法检查。**当前结果：阶段 3 = 63/63，阶段 4 = 76/76，阶段 5 = 99/99，三套合计 238 项全绿。**

---

## 五、明确不在本阶段范围（已预留，后续阶段开放）

- 科研 / 科技树（右侧面板「科技」页显示"后续阶段开放"）；
- 单位维修队列与损伤状态真正接入（接口预留，电力不足 / 损毁惩罚逻辑已写好但尚未触发）；
- 离线收益结算（仅计算并显示离线时长，不推进施工 / 生产 / 战斗、不发放资源）；
- 战斗中手动指挥单位（确定性求解器在派遣瞬间已算完一场战斗，玩家只能选策略与是否提前结算）；
- 单位升级与数值平衡（数据接口预留，阶段 6 接入）。

---

## 六、交付物清单

- 源码：`index.html`、`css/style.css`、`js/*.js`（含 `theater.js`、`battle.js`、`battle-renderer.js`、`config.js`、`economy.js`、`save.js`、`ui.js`、`main.js`、`renderer.js` 等）
- 本地服务器：`scripts/serve.mjs`（零依赖）
- 测试：`tests/stage3-test.mjs`、`tests/stage4-test.mjs`、`tests/stage5-test.mjs`
- 文档：`README.md`、`STAGE2_DELIVERY.md`、`STAGE3_DELIVERY.md`、`STAGE4_DELIVERY.md`、`STAGE5_DELIVERY.md`（本文件）
- 构建元数据：`package.json`（含 `start` / `test` 脚本）
- 打包：`iron-command-stage5.zip`（正斜杠路径，含 tests + scripts + 交付说明）
