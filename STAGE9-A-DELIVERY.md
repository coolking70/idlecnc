# Stage 9-A delivery

本阶段在 `auto/stage9-a-theater-expansion` 分支完成 Stage9-A 战区与重复任务扩展。

## 实现范围

- 新增 `river_crossing`、`relay_station`、`mountain_pass` 三个战区，形成无环 `requires` 链，总战区数为 6。
- 新增 `river_ferry`、`relay_intercept`、`pass_patrol` 三个重复任务，总重复任务数为 6。
- 新配置复用既有 `ENEMY_UNITS`，成本、冷却、奖励、占领收益和任务身份仍由现有权威模块读取。
- 旧存档迁移、资格校验、失败零副作用、双击防重、正式结算、存档/重载、离线暂停和只读回放均有 Stage9 专项覆盖。

## 覆盖与证据

- 真实 scenario corpus：canonical 120 + fuzz 1000，12 个 mission ID，矩阵 60 cells，覆盖 44，未观测 16；覆盖 JSON 由 generator 实际重建，不在生产代码中读取 sandbox 文件。相较旧值 30 cells / 26 covered / 4 unobserved，60 = 12 missions × 5 results；44/16 来自 generator 重建结果。
- Stage9-A 单元/回归：21/21；性能样本 500 轮，记录真实 Node 环境和 p95/max；Stage8 E-A/E-A.1/E-B/E-C/D-C.1 回归均纳入性能脚本。
- 浏览器证据：18/18 唯一 PNG，4 次真实 `Page.reload`（deployment review、running battle、result、replay），新增战区选择、部署确认、正式结算、重复任务 review/cancel、回放均由生产 DOM 操作完成，页面/控制台错误为 0。
- 旧前哨链作为浏览器测试前置状态被明确披露；新增战区的真实可捕获性由正式 `dispatchFormation`/`tickActiveBattle` 单元测试验证。
- 篡改拒绝：80/80，`passedFlagOnlyCases=0`。

## 运行入口

```bash
npm run test:stage9-A
npm run browser:stage9-A
npm run gate:stage8-2G
npm run verify:clean-clone
```

`posttest` 已追加 `test:stage9-A`；完整 `gate:stage8-2G` 已追加 `browser:stage9-A`；GitHub Actions 也保留并追加 Stage9 focused/browser 两步。

## Authority Freeze

本阶段未修改 Solver、Planner、Choreographer、`tests/lib/` 或正式战斗表现规则；只扩展配置、覆盖快照断言和 Stage9 专项测试/证据链。
