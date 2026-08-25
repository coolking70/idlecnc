# Stage 10-E — Strategic Loop Closure · HANDOFF

Branch: `auto/stage10-e-strategic-loop-closure`
Parent SHA: `97bc1ffaad6cbcb285a59113a76d8fae46e9fef2`（`auto/stage10-d1-stage9-freeze-guard-hotfix`，即 Stage 10-D.1 合并后主开发线 HEAD）
Implementation SHA: `5515799`

## Modifier 公式（js/strategic-loop.js，初始 pressure 时均为 1）
```
supplyMultiplier = clamp(1 + (threat-50)*0.003 - control*0.0015 - security*0.001, 0.75, 1.40)
intelMultiplier  = clamp(1 - recon*0.0025, 0.75, 1.00)
```
- 接入点：`theater.getMissionCost`（Math.round）与 `operations.getOperationCost`（supply Math.ceil / intel 整数取整）——首次出击与 repeat Operation 走同一权威，UI 只消费 authority 结果，不复制公式。
- Inspector `STRATEGIC EFFECTS` section 显示 ×x.xx 与来源摘要（整百分比过滤，初始显示“基准态势”）。

## Battle → Pressure 表（全部 clamp 0~100，recon 不变）
| Result | threat | control | security |
|---|---|---|---|
| VICTORY | -10 | +10 | +5 |
| PYRRHIC | -4 | +5 | +2 |
| WITHDRAW | +5 | -4 | -3 |
| DEFEAT | +10 | -8 | -5 |
| WIPED | +15 | -12 | -8 |

## Exactly-once 接入点
`theater.settleActiveBattle` 的正式结算提交块：在 `ab.settlementReceipt` 创建之后、写入 battleSession 凭证之前调用 `applyStrategicSettlementPressure`，并在 receipt 上盖 `strategicPressure` 章（两份凭证保持一致）。防护 = settled 标记 + `battleSettlementLedger` + receipt 幂等章；replay / 查看战报 / skip return / save-load 均不会重复应用（测试覆盖）。结算日志输出“战区态势变化：…”。
`save-diff.js` 移入 additive-only semantic-shared 契约，正式结算 diff 只允许本次战区的 `theaterPressure.<id>.**`（及旧档首结算创建容器时的根键），其余路径维持原契约。

## 其它实现说明
- `theater-pressure.js` 任务类型键改为稳定字面量，消除 strategic-loop 引入的模块环 TDZ（值与 tasking.OPERATIONAL_TASK_TYPE 相同）。
- SAVE_VERSION 保持 10；战略计算无 Math.random / Date.now。
- 未改：resolver / 命中伤害 / 敌军生成 / capture / salvage / reward 数量 / Doctrine / Auto Operations planner / task lifecycle。

## Tests
- `npm run test:stage10-E` → 15/15（初值成本不变、各向单调、clamp、双路径同源、成本落位、VICTORY/DEFEAT/WIPED delta、0~100 clamp、exactly-once、replay/view 不重复、reload 不重复、Doctrine/AutoOps/lifecycle 完好、builder 只读、Inspector 契约）
- `node tests/lib/stage9-frozen-authority.mjs` → PASS（63 checks；save-diff.js 转 semantic-shared）
- `test:stage10-A` 27/27 + 5/5；`test:stage10-B` 16/16；`test:stage10-C` 15/15；`test:stage10-D` 21/21；`test:stage10-P-B` 22/22
- Stage9 语义：9-A ✔（含 E-A-1 replay-reload 5/5）、9-D 17/17、9-E(fast) 23/23、stage7 ✔、8-2G-E-C 12/12
- Browser smoke：17/17，3 场景截图（初始成本 → Recon/Control 折扣 → 战斗后压力 + 重结算/回放/reload 稳定），**0 page errors / 0 console errors**

## Known limitations
1. 成本公式为连续线性插值，未做平衡调优；倍率边界（0.75/1.40）集中定义可直接调整。
2. 战斗→压力为固定离散表，不随难度/规模缩放。
3. theaterPressure 的战略影响暂未回馈到敌情（intel 精度）或 capture 难度（按要求留给后续）。
4. 结算 save-diff 允许了战斗战区的 theaterPressure 路径（含旧档首结算的容器根键），粒度为该战区整行。
