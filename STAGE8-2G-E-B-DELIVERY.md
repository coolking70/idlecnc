# Stage 8.2G-E-B 交付说明

本阶段把已有生产战斗循环接成可恢复的玩家指挥流程：任务资格与成本透明化、部署确认快照、操作失败反馈、真实 reload 安全回退、双击幂等和只读回放入口。

## 范围与权威边界

- UI 只消费 `canDispatch` / `canDispatchOperationMission`、`getMissionCost` / `getOperationCost` 和 `buildDispatchSnapshot` 的结果。
- 新增 `js/mission-command-presentation.js` 只承载任务类型、错误码、冷却和单位状态展示元数据。
- 未修改 Formal Solver、Universal Planner、Engagement Choreographer、Formal Report、战斗结果/奖励/结算计算、D-C 表现层或 Replay 表现逻辑。
- `js/theater.js` 仅将既有 `buildDispatchSnapshot` 导出给独立测试与展示层，未改变其规则实现。

## 真实证据

- 浏览器证据 18 帧，真实 DOM click 覆盖选区、策略、编队、部署确认、确认/取消、战报、返回基地和只读回放。
- 4 次真实 `Page.reload` 覆盖部署确认、战斗中、结算结果、只读回放；verifier 独立比较数值 `timeOrigin`、loaderId 与 reason 覆盖。
- 最新 E-B tamper 数量与 rejectionCount 记录在 `stage8_2g_eb_tamper_results.json`，所有用例保留声明字段，不以把 `passed` 改成 false 作为证据。

## 门禁

```bash
npm run test:stage8-2G-E-B
npm run browser:stage8-2G-E-B
npm test
npm run build:stage8-2G-E-B
npm run verify:stage8-2G-E-B
```

性能门禁固定为 warmup 20、samples 120、p95 `< 16.7ms`。派遣 UI 路径不执行全量 save hash/diff、storage 读取或完整 production state 深拷贝；已有 D-C.1 victory p95 作为回归事实继续检查。

## 交付前自检问答

1. Solver / Planner / Choreographer / Formal Report / Reward / Settlement：否。
2. E-A / E-A.1 冻结契约：否。
3. Replay sanitize 分支不向 `sanitizeFormations` 透传 `activeFormationId`：是。
4. 冷却、资格、资源失败路径 save diff：0 变更。
5. 双击派遣：`battleSessionSequence` delta 严格为 1。
6. 部署确认单位清单：来自 `buildDispatchSnapshot`。
7. 派遣与回放：真实 DOM click，`dispatchApiUsed=false`、`replayApiUsed=false`。
8. reload 的 `after.timeOrigin < before.timeOrigin`：verifier 拒绝。
9. 两次 reason 都为 `running_battle`：verifier 拒绝 reason coverage。
10. 仅修改 passed flag 的 tamper：0。
11. CI：真实执行 `browser:stage8-2G-E-B`。
12. Victory p95：继续使用 D-C.1 现有实测，预算仍为 `< 16.7ms`。

最终 ZIP 的 SHA-256、字节数、entries、final HEAD 和干净目录全量结果以 `stage8_2g_eb_final_package_record.json` 为准。
