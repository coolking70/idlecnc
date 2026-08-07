# 《钢铁指令》阶段 8.2E-A.2.3 交付说明

## 结论

A.2.3 只收口发布验证器、证据构建和测试可信度；未修改 `js/`、CSS、HTML、正式战斗旁路、Fixture、战斗结果或 `SAVE_VERSION=7`。

## 实际统计

统计由本轮最终构建流程的真实 `npm test` 输出生成：

| 测试组 | 通过 | 总数 |
|---|---: |---: |
| stage8-2D-A-2-test | 20 | 20 |
| stage8-2D-A-3-test | 19 | 19 |
| stage8-2E-A-test | 102 | 102 |
| formal-contract-presentation-integration-test | 16 | 16 |
| stage8-2E-A-1-test | 14 | 14 |
| stage8-2E-A-2-test | 72 | 72 |
| stage8-2E-A-2-1-test | 37 | 37 |
| stage8-2E-A-2-2-test | 62 | 62 |
| stage8-2E-A-2-3-test | 52 | 52 |

## 证据与清理

- 权威浏览器运行生成 12 张正式 PNG、同一 `evidenceRunId` 的浏览器输出和 Screenshot Manifest。
- 最终验证器在隔离临时证据目录运行第二次浏览器自检，仅做语义比较，不覆盖 ZIP 内权威证据。
- 静态三元证据同时校验 `evidenceRunId`、victory/withdraw 的 `reportId` 和 `battleId`。
- 全局超时测试实际检查子进程、服务器、端口、解压目录、隔离根和退出码 124；并覆盖竞态与纯 Promise 阶段。

## 文件

- 最终包：`iron-command-stage8-2E-A-2-3-evidence-consistency-final.zip`
- 新测试：`tests/stage8-2E-A-2-3-test.mjs`
- 超时夹具：`tests/fixtures/global-timeout-worker.mjs`、`tests/fixtures/global-timeout-fixture.mjs`
- 权威 Manifest：`screenshots/stage8-2E-A2-screenshot-manifest.json`

## 尚未解决的问题

Linux/Windows 未进行真实 Chromium 截图实跑；企业策略路径仍只作为结构化诊断实验，不宣称为成功环境。
