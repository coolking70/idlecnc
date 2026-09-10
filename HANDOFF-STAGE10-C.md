# Stage 10-C — Command Doctrine · HANDOFF

Branch: `auto/stage10-c-command-doctrine`
Parent: `auto/stage10-b-dynamic-theater-pressure`（起始 HEAD `854a21dd73247e450566ae795e1c047ae4fb59e5`）
Implementation SHA: `6a10d32`

## Doctrine state shape
```js
state.doctrine = 'balanced' | 'recon' | 'control' | 'security'   // 顶层 canonical 字符串
```
- 新游戏默认 BALANCED（`ensureDoctrine` 补写）；老存档无该字段时 `getActiveDoctrine` 读取回落 BALANCED，main.js 启动 / 手动读档 / 新游戏三条路径都调用 `ensureDoctrine` 规范化。
- `save.js migrate()` 增加一行 additive 透传（save.js 已在 Stage 10-B 转入 additive-only semantic-shared 契约）；**SAVE_VERSION 保持 10**。

## Modifier rules（全部集中在 js/doctrine.js 的 DOCTRINE 常量）
| Doctrine | 任务效果倍率 | 维护倍率 |
|---|---|---|
| BALANCED | 全部 1× | 全部 1× |
| RECON | RECON→recon 增长 ×1.5 | RECON upkeep ×1.25 |
| CONTROL | PATROL→control 增长 ×1.5 | PATROL upkeep ×1.25 |
| SECURITY | SECURITY→security 增长与 threat 压制 ×1.5 | SECURITY upkeep ×1.25 |

- tasking.js 周期结算调用 `getUpkeepMultiplier(state, taskType)` + `scaleCost`；theater-pressure.js 每 tick 调用 `getTaskEffectMultiplier(state, taskType, metric)` —— 两处均不硬编码 Doctrine 细节。
- 切换立即生效（`setDoctrine` 写 canonical + 立即保存），只影响之后的推进，不追溯；无冷却 / 无成本 / 无多 Doctrine 叠加。
- online 与 offline 走同一条 modifier 路径（等价性有测试）；暂停 dt=0 无变化；BALANCED 下 Stage 10-A/B 结果逐值保持不变（有测试）。

## P3 顺手修复
手动 load（`handleLoad`）与新游戏（`handleNewGame`）现在立即调用 `ensureTheaterPressure` + `ensureDoctrine`，canonical theaterPressure / doctrine 不再依赖下一次 tick 才补齐。

## Changed files
`js/doctrine.js`（新）、`js/tasking.js`（upkeep modifier 一处）、`js/theater-pressure.js`（效果 modifier 一处）、`js/save.js`（migrate 一行透传）、`js/main.js`（handler / 三条初始化路径 / 调试 API `doctrine()` & `setDoctrine()`）、`js/ui.js`（Overview COMMAND DOCTRINE 区 + 路由）、`js/command-presentation.js`（`buildDoctrineModels`）、`css/style.css`（doctrine tile 网格）、`tests/stage10-C-command-doctrine-test.mjs`（新）、`tests/browser/stage10-C-command-doctrine.mjs`（新）、`package.json`、`evidence/stage10-C/`。

## Tests
- `npm run test:stage10-C` → 15/15（默认 BALANCED、三种 modifier、upkeep、立即生效、不追溯、save/load、old save 回落、online/offline 等价、Stage10-A lifecycle、BALANCED 下 10-B 基础结果不变、UI ACTIVE、builder 纯度）
- `npm run test:stage10-B` 16/16；`test:stage10-A` 27/27 + 5/5；`test:stage10-P-B` 22/22；`test:stage10-P-A` 19/19
- `node tests/lib/stage9-frozen-authority.mjs` → PASS
- Stage9 语义回归：9-A ✔、9-D 17/17、9-E(fast) 23/23、stage7 ✔、8-2G-E-C 12/12
- Browser smoke：15/15，3 场景截图（BALANCED 初始 → 切换 RECON → RECON 增益运行 1.5×=60），**0 page errors / 0 console errors**

## Known limitations
1. 数值（+50% / +25%）为简单固定倍率，未做平衡调优；常量集中在 DOCTRINE 可直接调整。
2. Doctrine 不影响 reconPoints（Stage 10-A 任务结果计数）、战斗判定或任何 Stage 9 权威（按本轮范围要求）。
3. 切换无确认弹窗（按规格设计）；误触可直接再切回，无额外代价。
4. UI 中 doctrine tile 的 inspector “当前倍率实测” 行固定展示 recon 维度示例。
