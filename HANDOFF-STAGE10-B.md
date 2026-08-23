# Stage 10-B — Dynamic Theater Pressure · HANDOFF

Branch: `auto/stage10-b-dynamic-theater-pressure`
Parent: `auto/stage10-a1a-offline-boundary-final-closure`（起始 HEAD `ce33ca24ee189eceab0fcb2fa7982ea206e18269`）
Implementation SHA: `fda6c2a`
Final HEAD: `fda6c2a`（单 commit，含本 handoff 前的实现提交）

## State shape
```js
state.theaterPressure = {
  [theaterId]: { threat, control, recon, security }   // 各 0~100
}
```
- 随正式 serialize / migrate 持久化（save.js migrate 增加一行 additive 透传）。
- 老存档（Stage9 / Stage10-A）无此字段：读路径 `theaterPressureView` 返回默认值（不写 state）；main.js 启动 `ensureTheaterPressure` 幂等补齐。SAVE_VERSION 保持 10。

## 数值规则（全部集中在 js/theater-pressure.js，不进 frozen config.js）
- 每支任务编队每游戏秒（同战区叠加）：PATROL control +0.02 / threat −0.005；RECON recon +0.02；SECURITY security +0.02 / threat −0.015。
- 无任务战区漂移：threat +0.002/s 回升，control / recon / security 各 −0.001/s 衰减。
- 二态规则：战区有执行中任务时只应用任务速率（任务未覆盖的指标保持不变）；无任务时只应用漂移。召回后该编队影响立即停止。
- 全指标 clamp 0~100；仅由 game time 驱动（dt≤0 不推进），无 Date.now / Math.random；线性速率 → online 与 offline 结果等价（容差 <1e-6，有测试）。
- Stage10-A 语义不变：资源不足的任务保持 active（missed interval），pressure 效果照常。

## 接入
- 在线：`stepLogic` 中 `tickOperationalTasks → tickTheaterPressure` 同序推进。
- 离线：`settleOfflineProgress` 事件循环内同序调用，直接适配现有 event step，未新增 offline 事件边界。
- UI：战区 Tile 显示 `THREAT n` / `CTRL n` 徽标（实时刷新）+ 任务叠加徽标；Inspector 新增 THEATER PRESSURE section 展示四指标与任务影响摘要。未改 Command UI 框架。
- 未接触：battle resolver / 战斗伤害 / 结算 / rewards / capture / 解锁 / salvage / operation cooldown。

## Changed files
`js/theater-pressure.js`（新）、`js/save.js`（migrate 一行透传；guard 移入 semantic-shared）、`js/main.js`（tick / ensure / 调试 API `theaterPressure(id)`）、`js/offline.js`（循环内一行 tick）、`js/command-presentation.js`（Tile 徽标 + Inspector section）、`tests/lib/stage9-frozen-authority.mjs`（save.js 转 semantic-shared）、`tests/stage10-B-theater-pressure-test.mjs`（新）、`tests/browser/stage10-B-theater-pressure.mjs`（新）、`tests/stage10-P-B-command-migration-test.mjs`（徽标数契约放宽 ≤6）、`package.json`、`evidence/stage10-B/`。

## Tests
- `npm run test:stage10-B` → 16/16（PATROL/RECON/SECURITY 效果、recall 停止、战区隔离、叠加、clamp、pause、save/load、老存档初始化、online/offline 等价、Stage10-A lifecycle 不受影响、builder 纯度、UI 契约）
- `npm run test:stage10-A` → 27/27 + 5/5；`test:stage10-P-B` → 22/22；`test:stage10-P-A` → 19/19
- `node tests/lib/stage9-frozen-authority.mjs` → PASS（save.js 现为 additive-only shared；其余 byte-frozen 不变）
- Stage9 语义回归：9-A ✔、9-D 17/17、9-E(fast) 23/23、stage7 ✔、8-2G-E-C 12/12
- Browser smoke：18/18，3 场景截图，0 page errors / 0 console errors

## Known limitations
1. 数值为简单线性速率，未做平衡调优（常量集中在 THEATER_PRESSURE，可后续直接调）。
2. threat 被 SECURITY 长期压制后会触底 0；漂移回升仅在无任务战区生效（二态规则的设计选择）。
3. pressure 目前不反馈到任何战斗/情报/解锁判定（按要求留给后续阶段）。
4. 在线/离线等价为浮点线性等价（容差 1e-6），非 bit-exact。
5. 老存档首次读档时 pressure 为默认值，不回溯历史任务时长。
