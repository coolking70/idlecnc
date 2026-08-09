# Stage 8.2G-E-C 交付说明

本阶段收口离线 / Idle Progression 与长线循环：离线窗口 fail-closed、原始秒数与上限真实可见、Exactly-once、MAX_STEPS 截断续接、待阅报告 reload 保留，以及活动战斗和只读 Replay 的离线隔离。

## 权威边界

- Formal Solver、Universal Planner、Engagement Choreographer、Formal Report、战斗/奖励/结算计算、D-C 表现层与 HUD 保持只读。
- `js/offline.js` 负责离线窗口和逐步结算元数据；`js/save.js` 只负责 save/load 边界、报告迁移与部分 MAX_STEPS 窗口续接。
- 离线进行中的正式战斗不会推进 session、elapsed、战报或 ledger；只读 Replay 不写入 canonical session。
- 证据 JSON 是验证输出，不是生产运行资源；未导入任何 independent-audit JSON，也未删除或过滤失败样本。

## 真实浏览器证据

- 生产入口真实 DOM click，覆盖 E-B 的派遣/战报/回放动作，以及离线报告查看和关闭。
- 17 张唯一 PNG、0 page/console errors，5 次真实 `Page.reload`。
- reload 证据由 verifier 独立重算 `before.timeOrigin` / `after.timeOrigin`、loaderId 变化和 `Page.reload` 方法；离线时间通过 savedAt/localStorage 路径注入，不调用 settle API。
- 覆盖待阅报告 reload 保留、关闭后 reload 清除、运行中战斗暂停隔离、Replay 只读隔离。

## 门禁

```bash
npm run test:stage8-2G-E-C
npm run browser:stage8-2G-E-C
npm test
npm run build:stage8-2G-E-C
npm run verify:stage8-2G-E-C
```

性能门禁为 warmup 20、samples 120、每场景 p95 `< 16.7ms`。E-C true-value tamper 为 80/80 拒绝，`passedFlagOnlyCases=0`，并包含 fake same-timeOrigin、flag mismatch、same-loader 三类真实 reload 篡改。

最终 ZIP 的 SHA-256、字节数、entries、final HEAD、CI 与干净目录全量结果以 `stage8_2g_ec_final_package_record.json` 为准。
