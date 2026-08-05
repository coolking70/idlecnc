# 钢铁指令 IRON COMMAND —— 阶段 6 交付说明

## 一、本轮目标

**阶段 6：战斗结算加固、单位维修与完整离线结算。**

在阶段 1–5 已通过验收的系统之上增量修改，未创建新项目、未大规模重写已有系统。保留 `npm start` / `npm test`、零第三方依赖、全部旧测试（63 + 76 + 99 = 238 项）与阶段 4/5 功能及存档迁移。

---

## 二、版本与测试

- `package.json` 版本：`0.6.0`
- `config.js` `CURRENT_STAGE = 6`、`SAVE_VERSION = 5`
- `npm test` 依次运行 stage3 / stage4 / stage5 / stage6，共 **354 项全部通过**（63 + 76 + 99 + 116）
- `tests/stage6-test.mjs`：116 项，覆盖规格 #三十二~#三十三 的 90 项最低覆盖要求

---

## 三、按规格实现的改动清单

### #一~#五 配置（`config.js`）

- `SAVE_VERSION` 4 → 5；`CURRENT_STAGE` 5 → 6；`version` 0.4.0 → 0.6.0
- 新增 `DAMAGE_THRESHOLDS = { intact: 1, light: 0.5 }`
- `REPAIR` 扩展：`maxQueueSize: 8`、`activeCancelRefundRatio: 0.5`、`queuedCancelRefundRatio: 1`（保留 times/cost/maxConcurrent:2）
- `BATTLE.experience = { unitParticipation:5, unitVictory:5, formationParticipation:10, formationVictory:10 }`
- `PANEL_TABS`：新增 `repairs(6,'维修与补员')`，`research` 移到 7；`STAGE_PLACEHOLDER` 更新
- `CONFIG` 导出加入 `DAMAGE_THRESHOLDS`

### #二1~#二8 战斗修复（`battle.js`）

1. `createEmptyReport` 的 id 现含策略：`battle_<seed>_<formation>_<theater>_<strategy>`
2. `computeDamage` 重写：防御修正仅保护我方；`mitigation = 100/(100+effectiveDefense*2)`；`terrain.armorAttack` 接入；`atRisk` 反装甲风险
3. 新增 `effectiveMobility`（车辆/装甲受 `terrain.vehicleMobility` 影响）→ 行动顺序排序
4. 新增 `suppressThreshold`：`base / (modifiers.suppression||1)`
5. **时间轴修复**：先 `pushEvent(RESULT)` 再统一分配 `event.t = index/(total-1)*duration*0.95`，保证单调不减、首个 0、末尾 < duration

### #二9~#二10 / #四 派遣加固（`theater.js`）

- `THEATER_CODE` 新增：`BATTLE_NOT_FINISHED / REPORT_INVALID / SETTLEMENT_FAILED / SIMULATION_FAILED / DUPLICATE_MEMBER / MEMBER_OWNERSHIP / MEMBER_STATUS / UNKNOWN_UNIT`
- `canDispatch`：成员双向校验（重复/未知单位/归属/状态）；维修中与损毁 → `UNIT_UNAVAILABLE`，其它非 assigned → `MEMBER_STATUS`
- `dispatchFormation`：try/catch 包裹求解，异常则 `grant` 退款 + 编队保持 idle + 不消耗 attempts；新增 `dispatchedUnitIds` 快照
- 新增纯函数 `validateBattleReportForSettlement`（元数据/结果/奖励/阵容/时间轴单调/参战名单一致）
- 新增 `buildSettlementPlan`（只读）：含 unitUpdates（经验 +5/+5）、unitRemovals、formationUpdate（+10/+10）、theaterUpdate、rewards、reportToStore
- 新增 `applySettlementPlan`：JSON 快照回滚的事务写入
- `settleActiveBattle` 重写为：validate → build → apply → 成功才置 `settlementReceipt` + `settled`（最后置位）
- `closeBattleResult`：未结算禁止返回基地

### #六~#十九 维修系统（`repairs.js` 新建）

- `REPAIR_CODE` 全结果码；`getDamageState` / `damageStateOfUnit` 损伤判定
- `canQueueRepair` 全分支：unknown_unit / unknown_type / destroyed / not_damaged / already_queued / unit_busy / queue_full / insufficient / ready
- `queueRepair`：spend → 脱离编队（formation.unitIds 移除 + formationId=null + status='repairing'）→ 入队 → startQueuedRepairs → recalcDerived
- `tickRepairs`：事件步进并行推进（找下一个完成事件切分步长，MAX_STEPS=4096），保证任意 dt 与多次小 dt 结果一致
- `completeRepair`：恢复满耐久、status='ready'、递补队列
- `cancelRepair`：active 退 50%、queued 全额
- `getActiveRepairs / getQueuedRepairs / getRepairProgress / getRepairRemaining`
- `advanceOffline`：复用 tickRepairs（离线/在线一致）
- `sanitizeRepairs`：必在 sanitizeFormations 之前，释放维修单位编队归属、去重、限长、工位限额、孤儿回收
- `hasRepairShop`、`REPAIR_API`

### #二十~#二十八 离线结算（`offline.js` 新建）

- `MIN_STEP=0.001, MAX_STEPS=4096`
- `calculateOfflineSeconds`：按 `TIME.offlineMaxHours=8` 截断，返回 {seconds, rawSeconds, capped, maxSeconds}
- `settleOfflineProgress`：事件步进（constructionRemaining/productionRemaining/repairRemaining 取最小为步进点），段内 tickEconomy → advanceConstruction → advanceProduction → tickRepairs，推进 game/played，写 state.offline
- `buildOfflineReport`：纯函数，组装 gains/buildingsCompleted/unitsProduced/repairsCompleted/lines/text
- `dismissOfflineReport`：state.offline=null；`hasPendingOfflineReport`
- `OFFLINE_API`

### #二十九 迁移顺序（`save.js`）

- 导入 `sanitizeRepairs`、`calculateOfflineSeconds`、`settleOfflineProgress`
- `migrate`：生产容错后补挂 `merged.repairs`，`sanitizeRepairs(merged)` 放在 `sanitizeFormations` 之前，`report.repairRepaired`
- `loadGame`：真实离线结算 `calculateOfflineSeconds(savedAt, now, maxHours)` → `settleOfflineProgress`（失败降级为只显示时长）；结算后 `savedAt = Date.now()`（防重放）；返回 `offlineReport` / `repairQueueRepaired`
- `importSave`：`savedAt = Date.now(); offline = null`（禁止导入触发离线收益）

### #三十 调试接口（`main.js`）

`window.__IRON_COMMAND__` 新增 11 项 + repairRules：
`damageState(unitId)` / `canRepair(unitId)` / `repair(unitId)` / `repairs()` / `advanceRepairs(seconds)` / `cancelRepair(jobId)` / `settleOffline(seconds)` / `offlineReport()` / `dismissOfflineReport()` / `validateActiveBattle()` / `settlementPlan()` / `repairRules()`

接线：imports 改从 repairs.js 导入 tickRepairs；stepLogic 调 repairs.tickRepairs；新增 handleRepair / handleCancelRepair / handleSettleOffline / handleDismissOfflineReport；读档后 writeLoadNotes 接真实离线报告；repair:completed / offline:settled 事件落盘。

### #三十一 模块职责

- `repairs.js`：只处理损伤判定 + 维修排队 + 并行推进 + 完成/取消；不碰 DOM/Canvas，通过事件总线广播
- `offline.js`：只负责离线时长计算 + 事件步进推进世界 + 生成报告；不碰 DOM/Canvas；幂等
- 两者均复用 `economy.recalcDerived` / `construction.advanceOffline` / `production.advanceOffline` / `repairs.tickRepairs`

### #三十二~#三十三 自动测试（`tests/stage6-test.mjs`）

116 项（≥90 项最低覆盖），分 17 组（A~Q）：阶段标记与配置、战斗修复、战斗修正接入、维修损伤判定与排队、维修推进完成取消、维修存档容错、维修离线推进与车间状态、离线结算、离线报告、离线确定性与幂等、存档迁移 v4→v5 与离线接线、战斗结算加固、经验配置接入、调试接口契约、UI 维修页与离线报告卡片、渲染器维修车间表现、全量语法检查。

### #三十四 人工测试要点

- 战斗后受损单位出现在「维修」分页，点击「送去维修」排队
- 维修完成单位返回库存，可重新编队
- 关闭页面 5+ 分钟后重新打开，概览页弹离线报告卡片
- 导入存档不重复发放离线收益

### #三十五 禁止事项（已遵守）

- 不实现科研 / 单位升级 / 装备 / 手动指挥 / 重复战区任务 / 新战区
- 不大规模重写已通过验收的系统；保留 npm start / npm test / 零依赖 / 所有旧测试 / 阶段 4/5 功能与存档迁移

### #三十六 README 清理

README.md 已更新：版本横幅、测试说明（含 stage6）、面板描述、新增二·九阶段 6 章节、目录结构（含 repairs.js/offline.js）、存档版本 5、调试接口 11 项、已知限制、路线图。

### #三十七 提交要求

`iron-command-stage6.zip` 已打包，全部路径正斜杠，含 `js/repairs.js`、`js/offline.js`、`tests/stage6-test.mjs`。

---

## 四、新增 / 修改文件

| 文件 | 操作 |
| --- | --- |
| `js/config.js` | 修改（版本/REPAIR/BATTLE.experience/PANEL_TABS/DAMAGE_THRESHOLDS） |
| `js/battle.js` | 修改（时间轴/防御/压制/战报ID/机动） |
| `js/theater.js` | 修改（事务结算加固/canDispatch 双向校验/新结果码） |
| `js/repairs.js` | **新建**（维修系统） |
| `js/offline.js` | **新建**（离线结算） |
| `js/save.js` | 修改（v4→v5 迁移/离线接线/导入防重放） |
| `js/main.js` | 修改（接线/调试接口 11 项/handlers） |
| `js/ui.js` | 修改（维修页/离线报告卡片/refreshRepairs/refreshOverview） |
| `js/renderer.js` | 修改（维修车间表现 repairUnits Map） |
| `js/production.js` | 修改（移除占位 tickRepairs 桩） |
| `css/style.css` | 修改（维修页/离线报告卡片样式） |
| `tests/stage6-test.mjs` | **新建**（116 项） |
| `package.json` | 修改（version 0.6.0 / test 链含 stage6） |
| `README.md` | 修改（阶段 6 文档） |
| `STAGE6_DELIVERY.md` | **新建**（本文件） |

---

## 五、验收结论

- `npm test`：354 项全绿（63 + 76 + 99 + 116）
- 全部 `js/*.js` 通过 `node --check`
- 未实现阶段 7 内容，按要求在此停止。
