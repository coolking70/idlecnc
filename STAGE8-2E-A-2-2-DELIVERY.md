# 《钢铁指令》阶段 8.2E-A.2.2 交付说明

## 结论

A.2.2 收口最终验证器的可伸缩调度、进程树清理、按需服务器生命周期、全局超时和真实输出统计。未修改 `js/`、CSS、HTML、正式战斗旁路、Fixture、Screenshot Manifest 战报内容或 `SAVE_VERSION=7`。

## 验证器

- `tests/verification-runner.mjs` 统一管理阶段、活动子进程、活动服务器、隔离临时根和解压目录。
- 全局超时默认 900000ms，可由 `IRON_COMMAND_VERIFY_TIMEOUT_MS` 覆盖，环境值范围为 60000–1800000ms；阶段延迟测试由 `IRON_COMMAND_VERIFY_STAGE_DELAY_MS` 注入。
- 超时先标记 `global_verification_timeout`，终止进程组和服务器、等待退出、释放端口并删除隔离根，最后设置退出码 124；没有全局裸 `process.exit()`。
- 服务器仅在 `sandbox-report-adapter-integrity-test`、HTTP 路由检查阶段启动，关闭后才进入独立浏览器取证。
- `tests/verification-test-manifest.mjs` 使用显式清单，不扫描沙盒目录，也不重复 npm 已覆盖的正式集成测试。

## 实际统计

统计来自 `tests/outputs/stage8-2E-A-2-2-full-test-output.txt` 的实际输出摘要：

| 测试组 | 通过 | 总数 |
|---|---:|---:|
| stage8-2E-A-2-test | 72 | 72 |
| stage8-2E-A-2-1-test | 37 | 37 |
| stage8-2E-A-2-2-test | 62 | 62 |

## 证据与清理

- 成功 Chrome/Chromium 环境重新生成 12 张正式截图；Manifest 保持 victory 与 withdraw 两场不同战斗、撤退恰好一个 retreat、`capture=false`、`rewards={}`，页面错误和控制台错误均为 0。
- 慢环境模拟：每阶段延迟 250ms、全局超时 120000ms，流程成功完成。
- 强制全局超时：1.5s 假流程有界失败，当前阶段输出为 `forced global timeout stage`，退出码为 124，子进程/服务器/临时根清理完成。
- 策略阻断输出明确标记为模拟失败路径，不作为成功环境验收。
- 最终包不含 `.git/`、`node_modules/`、浏览器 profile、解压目录、旧 ZIP、PID 文件或测试缓存；根目录 `.openai/hosting.json` 是项目配置并保留。

## 文件

- 最终包：`iron-command-stage8-2E-A-2-2-verifier-final.zip`
- Manifest：`screenshots/stage8-2E-A2-screenshot-manifest.json`
- 输出：`tests/outputs/stage8-2E-A-2-2-full-test-output.txt`、`stage8-2E-A-2-2-browser-evidence-output.txt`、`stage8-2E-A-2-2-verification-output.txt`
- 清理与模拟输出：`stage8-2E-A-2-2-process-cleanup-output.txt`、`stage8-2E-A-2-2-slow-environment-output.txt`、`stage8-2E-A-2-2-timeout-cleanup-output.txt`、`stage8-2E-A-2-2-policy-block-output.txt`

## 尚未解决的问题

Linux/Windows 未进行真实 Chromium 截图实跑；企业策略阻断证据为结构化模拟诊断，未将模拟结果宣称为成功环境通过。
