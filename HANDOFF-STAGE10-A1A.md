# Stage 10-A.1a — Offline Task Boundary Capacity Final Closure

Branch: `auto/stage10-a1a-offline-boundary-final-closure`
Parent: `auto/stage10-a1-tasking-consistency-hotfix`（起始 SHA `a213f92a76ae64b7e0c6760c887761f4c9b56092`）
Final HEAD: `a7781da`

## 修改点
- `js/offline.js`：新增 `offlineStepLimit(state, totalSeconds)` —— 基础预算仍是 Stage 9 的 `MAX_STEPS=4096`（无作战任务时离线行为与 Stage 9 完全一致）；有活动任务时按“每支任务在 total 秒内最多 floor(total/30)+2 个错相周期边界”的理论上界追加专属预算（6 支 × 8h → 5760 边界，预算 9868）。安全阀保留：预算为推导值而非移除，超出预算的异常状态仍会安全截断。离线报告的 `maxSteps` 改为记录实际生效的动态预算。
- 实测：6 支错相编队 × 8h 结算 steps=5760（旧阀门 4096 必截断），truncated=false。
- `tests/stage10-A1a-offline-boundary-test.mjs`（新，挂入 `npm run test:stage10-A`）。
- 未修改任务规则 / SAVE_VERSION / 历史资料。

## 测试结果
- `npm run test:stage10-A` → 27/27 + 5/5（含新回归：truncated=false、remainingSeconds=0、每支任务推进 28800s+相位、每支恰好 960 个周期全结算 0 缺失、无任务时 maxSteps 仍为 4096）
- `node tests/lib/stage9-frozen-authority.mjs` → PASS
- 回归：stage10-P-B 22/22、stage10-P-A 19/19、stage9-A ✔、stage9-E(fast) 23/23、8-2G-E-C 离线推进 12/12
- `browser:stage10-A` 重跑 → 27/27，0 page errors / 0 console errors（未新增截图场景）
