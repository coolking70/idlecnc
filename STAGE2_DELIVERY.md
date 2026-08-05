# 钢铁指令 IRON COMMAND —— 阶段 2 交付说明

> 交付日期：2026-08-03
> 交付内容：在阶段 1 已运行的项目骨架之上，新增**完整建设系统**。
> 约束：仅修改既有代码，未重新创建项目，未大规模重写基地渲染 / 资源系统 / 存档系统 / 主循环。
> 范围：仅 5 种建筑、每种最多 1 座；未进入单位生产 / 编队 / 战斗（阶段 3+）。

---

## ① 修改文件清单

| 文件 | 改动性质 | 说明 |
| --- | --- | --- |
| `js/config.js` | 增量修改 | 升级阶段标记、新增 `CONSTRUCTION_UI` 文案、补齐 `CONFIG` 导出 |
| `js/construction.js` | 重写（逻辑复用） | 资格检查 / 开工 / 推进 / 完成 / 取消 / 进度 / 存档容错 |
| `js/save.js` | 增量修改 | `lastSpeed` 恢复、迁移报告回传、施工自愈接入 |
| `js/ui.js` | 增量修改 | 建设分页完整界面、概览页阶段标记、刷新挂钩 |
| `js/main.js` | 增量修改 | 建造 / 取消接线、读档备注、自动落盘、调试句柄扩展 |
| `js/renderer.js` | 增量修改 | 悬停文案（进度/剩余/效果）、工地动画（吊钩/警示灯/扫描线/火花） |
| `css/style.css` | 增量修改 | 建设页全部样式 |
| `README.md` | 增量修改 | 阶段 2 文档、建筑表、规则、限制、调试句柄 |
| `package.json` | 新增 | 项目元信息（name/version/type，标注纯前端无依赖） |

> 自测脚本（不在游戏运行路径内，仅供验证）：`../.cache/stage2-test.mjs`
> 运行：`node .cache/stage2-test.mjs` → **178 项通过，0 失败**。

---

## ② 每文件修改摘要

### `js/config.js`
- `CURRENT_STAGE` 由 `1` 改为 `2`。
- 新增 `CONSTRUCTION_UI`：纯 UI 文案（按钮文字、状态徽标、空闲/暂停提示、`cancelConfirm` 模板、失败原因模板 `lackResource/lackPower/needPrereq/exists/busyOther/busySelf/...`）。
- `STAGE_PLACEHOLDER[2]` 改为"建设系统已开放（阶段2）…"。
- `CONFIG` 导出新增 `CONSTRUCTION_UI`。
- **建筑数值（`BUILDINGS`）零改动**，仅数据先行已就绪的 5 种可建造建筑沿用。

### `js/construction.js`（核心）
- `canBuild(state, typeId)` → 返回 `{ok, code, reasons[], reason}`，`code` 枚举：`ready/unknown/not_buildable/exists/building_self/busy/prereq/resource/power`；资源不足文案"合金不足，缺少150"，电力不足"电力不足：需要8，当前剩余4"。
- `requestBuild(state, typeId)`：内部再校验 + **双保险**（已有 `current` 直接拒绝）防连点双建筑；扣费后建 `UNDER_CONSTRUCTION` 实例、写 `construction.current`、派发 `construction:started`、刷新派生数值。
- `tickConstruction(state, dt)`：新增**浮点吸附**——`elapsed >= duration - 1e-6` 时吸附到 `duration`，杜绝"卡在 99.99% 永远不落成"；`job.done` 守卫。
- `completeConstruction(state, job)`：`job.done` 标记 + 立即清空 `current` 防重复结算；落成转 `OPERATIONAL`、解锁单位（`state.unlocks.units` 去重）、刷新数值、写日志、派发 `construction:completed`、预留排队自动开工（阶段 3）。
- `getConstructionProgress(state)`：返回完整进度对象（`name/elapsed/duration/remaining/progress/percent/elapsedText/remainingText`），空闲返回 `null`。
- `cancelConstruction(state)`：`CONSTRUCTION.refundRatio=0.5` 返还（`Math.floor`），经 `grant()` 按上限钳制；派发 `construction:cancelled`。
- `sanitizeConstruction(saveState)`：纯数据容错（任务非对象 / 类型无效 / elapsed·duration 非法 / 找不到建筑 / 状态不符 / 无主工地→恢复为已建成不重复扣费 / 重复建筑去重 / 未知建筑丢弃），返回 `{repaired, notes}`。
- `buildableList()`：返回可建造定义数组（供 UI 稳定排序）。

### `js/save.js`
- 新增 `resolveLastSpeed(timeData)`：`lastSpeed` 合法(1/2/4)→用它；否则 `speed` 合法→用它；否则 `defaultSpeed`；`0` 不被采用。
- `migrate(data, report={})`：接收 `report` 出参；`time.lastSpeed` 走 `resolveLastSpeed`；建筑迁移增加未知类型过滤 + 状态/进度合法性修复；`construction` 迁移后调用 `sanitizeConstruction` 写入 `report.notes/constructionRepaired`。
- `loadGame()`：包 try/catch，返回新增 `{repaired, repairNotes}`；离线只记录时长、**不推进施工**（阶段 2 不发放离线收益）；派发 `save:loaded` 带 `repaired`。
- `importSave()`：同步更新 `report`。

### `js/ui.js`
- 导入新增 `UNITS, CONSTRUCTION, CONSTRUCTION_UI, canBuild, getConstructionProgress, buildableList`。
- 构造函数 `handlers` 新增 `onBuild/onCancelConstruction`；新增 `this._buildLocked` 防连点。
- `_buildLockedBlock()` 移除 construction 的 detail 文本；新增 `_buildConstructionPage()`（工程状态区 idle/active + 5 张卡片 + 说明）。
- `_renderBuildCard(def)`：结构 `bc-head/bc-desc/bc-grid/bc-cost/bc-effect/btn/bc-reason`，成本 chip 带 `data-res`。
- `_onBuildClick()`（临时锁按钮）、`_setBuildButtonsDisabled()`、`_effectSummary(def)`、`_updateConstruction(state)`（刷新进度条/百分比/剩余/暂停提示 + 每卡片状态徽标/按钮文字/禁用原因/缺料高亮）、`refreshConstruction(state)`（供 main.js 即时刷新）。
- `_buildOverview()`：briefTag 改为动态`阶段 ${CURRENT_STAGE}`；核对表改为阶段 2 八项；hint 更新。
- `update()` 增加 `this._updateConstruction(state)`。
- 进度条宽度改用 `job.percent`（与百分比标签一致）。

### `js/main.js`
- 导入新增 `BUILDINGS, CONSTRUCTION_UI, requestBuild, cancelConstruction, canBuild, getConstructionProgress, on`，以及 `BUILDING_STATUS`。
- `handleBuild(typeId)`：`buildBusy` 守卫 → `requestBuild` → toast → 静默落盘 → `ui.refreshConstruction`。
- `handleCancelConstruction({confirm})`：二次确认（`CONSTRUCTION_UI.cancelConfirm`）→ `cancelConstruction` → toast → 刷新 → 落盘。
- `handleLoad()` 改写调用 `writeLoadNotes(state, res)`（离线时长 + 施工自愈 + 施工中恢复日志）。
- `writeWelcomeLog()` 改为阶段 2 文案。
- UI handlers 新增 `onBuild/onCancelConstruction`。
- `boot()` 读档后调用 `writeLoadNotes`；新增 `on('construction:completed', () => saveGame(silent))` 自动落盘。
- `__IRON_COMMAND__` 调试句柄新增 `canBuild/build/cancelConstruction/getConstructionProgress/built`（非法参数返回失败对象不抛异常）。

### `js/renderer.js`
- 导入新增 `UNITS, formatDuration`。
- `_updateTip(state)`（签名加 `state`）：施工中显示"状态：施工中 / 施工进度 X% / 剩余时间 Y / 建成后：desc"；已建成显示状态/电力/效果摘要（`_effectLines(def)`）；预留位显示耗时/电力/开放阶段。
- `_emitBuildingSmoke()`：施工中建筑加焊接火花 + 工地扬尘。
- `_drawConstructionSite()`：新增吊钩、上下扫描线、四角交替警示灯（`_light`）。
- `render()` 中调用 `this._updateTip(state)`。

### `css/style.css`
- 新增建设页样式段：`.section-head / .build-status / .cs-idle-* / .cs-bar-wrap / .bar.build > i / .cs-pct / .cs-paused / .btn(.primary/.danger/.disabled) / .cs-cancel / .build-list / .build-card(.is-built/.is-building) / .bc-head/.bc-name/.bc-status/.bc-desc/.bc-grid/.bc-cell/.bc-cost/.cost-chip[data-res](.lack)/.bc-effect/.bc-reason`，窄屏 `@media (max-width:1400px)` 单列。

### `README.md`
- 版本横幅改为阶段 2；「已实现」表增加建设系统行；新增「二·五、阶段 2 建设系统」（建筑表 / 规则 / 速度离线 / 存档自愈）；目录结构标注 `construction.js` 已实现；「已知限制」更新为阶段 2；开发路线表阶段 2 标 ✅；调试句柄补充 5 个新方法。

### `package.json`（新增）
- `name: iron-command`, `version: 0.2.0`, `type: module`，描述标注纯前端无依赖。

---

## ③ 自测结果

**集成测试（Node 环境，DOM 桩）：`node .cache/stage2-test.mjs` → 通过 178 / 失败 0。**

覆盖 15 个区块：
1. 基础回归（阶段 1 未被破坏）：阶段标记、初始建筑/电力/指挥容量/产量、建设分页开放 ✅
2. `canBuild` 状态与失败原因文案（资源/电力/前置/不可建造/未知 ID）✅
3. 建造流程 / 防连点（扣费、工地即时出现、双保险、占用提示）✅
4. 施工推进（暂停 dt=0 不动、帧率无关、单帧巨 dt 不重复完成、浮点吸附落成）✅
5. 完成结算 / 防重复（产量/上限/电力/统计/日志不重复）✅
6. 解锁与前置链（兵营→步兵班/反装甲班；装甲工厂→三种载具；去重）✅
7. 五建筑全建成（7 座、合计耗电 25、不超载、无限电惩罚）✅
8. 取消工程（50% 返还、钳制不溢出、取消后可重建、空闲取消不报错）✅
9. `getConstructionProgress` 接口（null / 名称 / 40% / 剩余 21s / 总时长 / 无 undefined）✅
10. 存档 `lastSpeed` 恢复（4/2/1 / 缺省回退 / 非法 / 0 不采用 / 完全缺失）✅
11. 施工中存档与恢复（50% 原样恢复、不重复扣费、续建生效、不二次扣费）✅
12. 施工存档容错（9 种损坏场景 + 老阶段 1 存档，均不抛异常并自愈）✅
13. 离线不跳完成 / 不重复扣费 ✅
14. UI 建设页渲染（5 卡、按钮态、进度 50%、剩余 10s、暂停提示、取消、建成态、缺料高亮）✅
15. 日志上限（≤30 条）✅

**人工/浏览器层面**：本环境无浏览器，未做真实 Canvas 渲染截图验证；逻辑层与 DOM 桩已全量覆盖，渲染差异仅限视觉表现。

---

## ④ 未解决 / 已知限制

- **生产未启用**：兵营 / 装甲工厂解锁的单位仅写入 `state.unlocks.units`，`production.js` 阶段 3 才消费；当前「建设」分页无法发起生产。
- **离线收益未实装**：阶段 2 离线仅记录时长并报告，不推进施工、不发放资源（设计如此，阶段 6 接入）。
- **电力不足惩罚 / 建筑损毁 / 单位维修**：逻辑已写好但当前触发不到（阶段 3+/6 才会用到）。
- **建筑不可升级 / 拆除 / 自由摆放**：阶段 2 限定每种最多 1 座、系统预设槽位。
- **画面固定视角**：暂不支持缩放与平移。
- **未做真实浏览器端到端验证**：本环境无 GUI 浏览器，渲染相关（吊钩/警示灯/扫描线/火花/悬停条）仅经代码与 DOM 桩验证，未截图核对像素表现。
- 自测脚本依赖 ES Module 动态 `import`，需 Node ≥ 14；置于 `../.cache/`（与 `iron-command/` 平级）以匹配相对导入路径。

---

## ⑤ 阶段 3 接口说明（供后续开发）

建设系统已为阶段 3 预留下列稳定接口，**阶段 3 仅消费、不改动本阶段逻辑**：

1. **解锁入口**：`state.unlocks.units`（数组，已去重）。兵营→`['infantry','at_infantry']`，装甲工厂→`['scout_car','mbt','repair_vehicle']`。生产模块应只读此列表决定可训练单位。
2. **建筑查询**：`findBuilding(state, typeId)` / `hasBuilding(state, typeId)`（`state.js`）——判断前置与槽位占用。
3. **建造派生数值**：`recalcDerived(state)`（`economy.js`）在每座建筑 `OPERATIONAL` 后已重算 `rates/caps/power`，生产耗时与产出可直接复用 `state.rates` 与 `BUILDINGS[id].effects`。
4. **施工完成事件**：`on('construction:completed', ({typeId, buildingId}) => ...)`（`events.js`）——阶段 3 可在落成时自动排队生产（当前 `completeConstruction` 内已留 `CONSTRUCTION.maxConcurrent===1` 时自动开工 `queue` 的占位分支，但阶段 2 不产生 `queue` 数据）。
5. **生产状态位**：`state.production`（阶段 3 新增）与建筑解耦；`PRODUCTION.maxConcurrent=1` 已在 `config.js` 预留。
6. **调试句柄**：`__IRON_COMMAND__.built()` 返回已建成类型数组；`canBuild/built/cancelConstruction/getConstructionProgress` 可直接复用。
7. **数值唯一源**：所有新增建筑 / 单位 / 造价 / 效果继续写在 `config.js`，阶段 3 的单位生产逻辑只读取，不硬编码。

> 接入建议：阶段 3 在「生产」分页读取 `state.unlocks.units` 渲染可生产单位，点击后写入 `state.production.queue`，主循环 `tickProduction` 按 `UNITS[id].buildTime` 推进；落成单位进入 `state.units` 并占用 `state.command.used`（指挥容量已在 `state.command` 预留）。
