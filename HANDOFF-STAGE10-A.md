# Stage 10-A — Operational Tasking Core · HANDOFF

Branch: `auto/stage10-a-operational-tasking-core`
Parent: `auto/stage10-p-b1-command-ui-hotfix`（起始 SHA `fac089833060f1486cdd623c9a2a87d0241494a6`）
Final HEAD: `605a622`

## Authority design
- 新增 `js/tasking.js` 是持续性作战任务的唯一权威：`canAssignOperationalTask` / `assignOperationalTask` / `recallOperationalTask` / `getOperationalTask` / `listOperationalTasks` / `tickOperationalTasks` / `describeOperationalTask`，mutation API 全部返回 `{ ok, code, reason, ... }`。
- `formation.status` 保持 Stage 9 生命周期（idle / rallying / marching / fighting / returning / repairing）不变；任务占用由 `formation.tasking.status === 'active'` 表达，tasking.js 是二者一致性的单一来源（资格校验同时检查两边）。
- 资格校验（全在 authority，UI 只消费）：编队存在、非空、idle、未处于 battle lifecycle、成员无维修冲突、战区存在且已解锁、未在执行其它任务。

## Task state structure（canonical）
```js
formation.tasking = {
  type: 'patrol' | 'recon' | 'security',
  theaterId, status: 'active',
  startedAt, lastTickAt,            // state.time.game（游戏秒）
  stats: { timeSec, intervalsCharged, missedIntervals },
  results: { patrolTime | reconPoints | securityTime }
}
```
旧存档无 tasking 字段 → getter 返回 null，正常加载运行。

## 三个任务的生命周期
- **下达**：Formation Tile → Inspector → OPERATIONAL TASK → `下达 PATROL/RECON/SECURITY`（choose-task，纯 UI 选择态）→ Inspector 内选择目标战区（每战区实时 canAssign 校验禁用）→ assign-task → authority 写入。
- **执行**：`stepLogic` 每逻辑步 `tickOperationalTasks(state, step)`；每 30s 任务时长结算一次周期消耗（PATROL 补给10 / RECON 补给6 / SECURITY 补给8；资源不足则跳过并计入 missedIntervals，不自动召回）；RECON 按同周期累积整数侦察点；PATROL/SECURITY 累积任务时长。确定性：无 Math.random / Date.now / 定时器，分步累加分片不变（split-invariant 已测试）。
- **召回**：Inspector 显式 `召回作战任务` action（danger 通道），formation.tasking = null，编队恢复待命并可派遣。

## Save / offline integration
- 在线 tick 进 main `stepLogic`（暂停 speed=0 → step=0 → 不推进；1×/2×/4× 与 game time 一致）。
- 离线：`offline.settleOfflineProgress` 循环内新增 `tickOperationalTasks(state, step)`，与施工/维修/科研同粒度推进（additive 一行钩子）。
- 持久化：tasking 随 formation 走正式 `serialize → migrate → sanitizeFormations`（原地保留未知字段），SAVE_VERSION 保持 10；save → reload 任务保留、旧存档无 tasking 正常运行（均有测试覆盖）。

## Stage 9 freeze 调整方式
- `tests/lib/stage9-frozen-authority.mjs` 拆成两轨：
  - **byte freeze（不变）**：config / state / construction / production / equipment / save / formations / battle / battle-salvage / production-battle-session / save-diff + universal planner 前缀；
  - **semantic-shared（新）**：`js/theater.js`、`js/offline.js` 允许 Stage 10 additive 扩展，但受三层保护：(1) guard 结构化校验 baseline 导出名必须全部保留（禁止删除/重命名）；(2) Stage 9 语义由既有 stage9 套件继续证明（本分支实测 9-A 21/21、9-B 10/10、9-C 10/10、9-D 17/17、9-E 23/23）；(3) 新增 Stage 10-A targeted tests 覆盖 additive 行为。
- 共享文件的实际改动均为最小钩子：theater.js 新增 `FORMATION_TASKED` 码 + canDispatch 两行互斥；offline.js 循环内一行 tick 调用；另 operations.js（未冻结）同样加互斥。

## Battle / task 互斥
- 任务编队：`canDispatch` / `canDispatchOperation` 返回 `formation_tasked`，必须先召回。
- battle lifecycle / 非 idle 编队：不能接受任务；任务编队的成员调整与解散被命令层守卫拦截（presentation 同步禁用）。
- tasking 未触碰 battle resolver / settlement / salvage / replay（对应文件全部仍 byte-frozen；并有“无关 tasking 不改变 Stage9 战报”测试）。

## Changed files
`js/tasking.js`（新）、`js/theater.js`、`js/offline.js`、`js/operations.js`、`js/main.js`（tick/handlers/debug API）、`js/ui.js`（choose-task/assign-task/recall-task 路由 + 战区选择 Inspector）、`js/command-presentation.js`（编队 Tile 任务徽标 + OPERATIONAL TASK section）、`tests/lib/stage9-frozen-authority.mjs`、`tests/stage10-A-operational-tasking-test.mjs`（新）、`tests/browser/stage10-A-operational-tasking.mjs`（新）、`package.json`、`evidence/stage10-A/stage10-A-browser.json`。

## Test results
- `npm run test:stage10-A` → 20/20
- `npm run test:stage10-P-B` → 22/22；`npm run test:stage10-P-A` → 19/19 + equivalence 4/4
- Stage 9 语义回归：9-A 21/21、9-B 10/10、9-C 10/10、9-D 17/17、9-E(fast) 23/23、stage7 ✔、8-2G-E-B ✔、8-2G-E-C ✔
- `node tests/lib/stage9-frozen-authority.mjs` → PASS（新双轨契约）
- Browser smoke（真实 CDP 浏览器）：17/17，4 场景截图，**0 page errors / 0 console errors**
- SAVE_VERSION = 10、package 0.9.0 不变

## Known limitations
1. PATROL/SECURITY 只有时长与周期消耗，无战略收益（Threat/Control 属 Stage 10-B，未实现）；RECON 点数暂无消费方。
2. 任务编队的成员/解散拦截在 main.js 命令层 + presentation，formations.js 自身 API 未加校验（该文件按新边界保持 byte-frozen）；直接调用 formations authority 的旁路不会触发拦截。
3. 周期消耗不足时任务继续执行并记录 missedIntervals，不自动召回（设计选择，规则简单确定）。
4. 任务无自动结束条件（持续时间无限，直至召回）。

## 下一步建议（Stage 10-B 候选）
- Threat / Control / 动态战区压力系统，消费 patrolTime / reconPoints / securityTime。
- formations authority 正式集成 tasking 校验（把命令层守卫下沉）。
- 任务收益与情报质量系统（recon intelligence quality）。
