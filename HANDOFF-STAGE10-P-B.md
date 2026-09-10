# Stage 10-P-B — Full Command UI Migration · HANDOFF

## Branch / SHA
- branch: `auto/stage10-p-b-full-command-ui-migration`（基于 P-A.1 CLOSED 起点 `7cf9626`）
- final SHA: `72b2b14`
- commits:
  - `72b2b14` feat(stage10): migrate all remaining pages to shared Command UI (Stage 10-P-B)

## Changed files
- `js/command-ui.js` — CommandInspector 通用扩展：`sections` / `listSections` / `actions[]`（危险操作自动 `is-danger`）/ `inputs[]`（文本输入 + 提交，Enter 提交）
- `js/command-presentation.js` — 新增只读 P-B builders：`buildUnitRosterModels` / `buildFormationCommandModels` / `buildTheaterCommandModels` / `buildStrategyModels` / `buildRepairCommandModels` / `buildResearchCommandModels` / `buildReportModels` / `buildOverviewCommandModels`
- `js/ui.js` — 七个页面迁移到共享 CommandSurface 网格；Inspector action 统一路由到既有 authority handlers（onRenameUnit / onEquipEquipment / onRepair / onResearch / onCreateFormation / onDisbandFormation / onReplayReport …）；旧渲染代码保留为 `return;` 后的死代码（与 P-A 相同模式）
- `css/style.css` — 新增 roster / formation / theater / strategy / repair / report / overview 网格、Inspector 扩展、紧凑导航样式
- `tests/stage10-P-B-command-migration-test.mjs`、`tests/browser/stage10-P-B-command-migration.mjs`、`package.json`（`test:stage10-P-B`、`browser:stage10-P-B`）
- `evidence/stage10-P-B/stage10-P-B-browser.json`；截图在 `screenshots/stage10-P-B/`（gitignore）

## 各页面迁移说明
| 页面 | Tile 默认信息 | 详情去向 | 主操作 |
|---|---|---|---|
| Units | portrait、呼号、状态/等级/损伤角标 | Inspector：HP、实际属性、经验、装备、编队、呼号改名 | 点击开档案 |
| Formations | 名称、状态、单位数 | Inspector：汇总属性、编成评估、成员移出、编入、解散（危险操作仅 Inspector） | 点击开档案 |
| Theater | 战区名、状态角标、难度星、首占角标 | Inspector：地形/敌情/奖励/战绩/解锁条件 | 点击=选为行动目标 |
| Theater-策略 | 策略名、成本角标 | Inspector：优势/风险 | 点击=选择策略 |
| Repairs | 单位 portrait、损伤角标、进度覆盖 | Inspector：费用/时长/取消 | 点击=送修 |
| Research | 科技名、状态角标、进度 | Inspector：效果/成本/前置、开始/取消 | 点击=开始研究 |
| Reports | 战区、结果角标、时间、编队 | Inspector：完整战报（阶段/原因/时间轴）+ 回放/打捞 | 点击开战报 |
| Overview | 当前施工/生产/科研/维修/作战/可行动编队 tiles | Inspector | 点击查看 |

Construction / Unit Production / Equipment Production（P-A 已完成）本轮零改动。

## 交互规范落实
- Desktop click = 安全主操作；hover = QuickTooltip；长按/ⓘ/右键 = Inspector
- Mobile tap = 主操作；长按 = Inspector 且 `consumeClick()` 吞掉后续 click（browser smoke 验证：long-press 不改变任何 state）
- 危险操作（解散、各类取消）只在 Inspector actions 中出现，且 `is-danger` 样式
- Tile 可 focus，原生 Enter/Space 触发主操作，Escape 关闭 Inspector（browser smoke 验证）

## Test results
- `npm run test:stage10-P-B` → 17/17 passed
- `npm run test:stage10-P-A` → 19/19 passed + state-equivalence 4/4
- `node tests/lib/stage9-frozen-authority.mjs` → PASS（exit 0，未放宽）
- 抽样回归：stage7 ✔、stage8-2G-E-B ✔ (12/12)、stage8-2G-E-C ✔ (12/12)、stage9-A ✔ (21/21)、stage9-B ✔ (10/10)、stage9-D:fast ✔、stage9-E:fast ✔
- `npm run browser:stage10-P-B` → 36/36 passed，8 个代表场景截图，**0 page errors / 0 console errors**，desktop 1440 与 mobile 390 均无横向 overflow
- SAVE_VERSION === 10，package version 0.9.0 不变；无 gameplay authority 修改（stage9_*.json 回归产物已还原）

## 已知问题
1. 旧页面渲染代码以死代码形式留在 `js/ui.js`（`return;` 之后），约 1000 行；建议下轮清理
2. Units 页保留筛选下拉（类型/状态/等级/排序），是控件而非信息密度问题，未改为 chips
3. 战斗回放面板、部署确认面板沿用原结构（只做 CSS 紧凑化），未 Tile 化——它们是一次性确认流程，Tile 化收益低
4. Reports Inspector 的打捞/回放按钮在无对应 session 时不显示（与旧行为一致）

## 下一阶段建议
1. 清理 ui.js / theater.js 中的死代码与不再引用的渲染函数
2. Stage 10-A Operational Tasking（PATROL / RECON / SECURITY / Threat / Doctrine / Auto Dispatch，本轮严格未做）
3. 正式美术资源接入点：UNIT_IMAGES / BUILDING_IMAGES / EQUIPMENT_IMAGES 已集中在 command-presentation.js 顶部，可直接替换
4. 桌面左侧 command rail（本轮只做了紧凑 tab，未重建 shell）
