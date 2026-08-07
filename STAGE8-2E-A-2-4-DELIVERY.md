# 《钢铁指令》阶段 8.2E-A.2.4 交付说明

## 结论

A.2.4 收口验证器超时测试去抖、慢环境启动稳定性和最终封包验证；未修改 `js/`、CSS、HTML、正式战斗旁路、战斗结果、结算、奖励、Fixture 或截图业务语义。

## 实际统计

统计由最终构建流程真实采集并回填：

| 测试组 | 通过 | 总数 |
|---|---: |---: |

## 稳定性记录

- A.2.2 连续运行次数：10 次；失败次数：0。
- CPU 压力配置：2 个有界 Node 忙循环进程，每个 300ms；压力循环：5/5，失败：0。
- ready 握手：A.2.4 输出记录 readyHandshakeObservation={"startupMs":764,"startupTimeoutMs":1500,"businessTimeoutMs":1000}。
- 业务超时：外部 Node worker 测试统一不低于 1000ms，标准值 1500ms；长运行 worker 保持 10 秒。
- 输出重定向：passed；stdout bytes=3761，stderr bytes=454。
- PID 稳定性：10 次轮询等待 runner 注册子进程，不使用 1ms 观察窗口。

## 最终验证器记录

- 验证顺序：ZIP 结构 → 解压 → `npm test` → 额外 Node 测试 → Fixture check → 跨进程确定性 → 服务器完整性 → 静态/临时证据一致性 → 浏览器阶段。
- 浏览器受限环境：`navigation_blocked_by_policy` 仅作为结构化环境失败，不宣称为项目成功。
- 全局超时：仍使用退出码 124，并验证子进程、服务器、端口、隔离根和解压根清理。
- 不对正式测试失败执行通用重试；稳定性问题通过 ready 握手与合理时间预算解决。

## 证据

- 权威浏览器证据保留 12 张 PNG、Screenshot Manifest、浏览器输出和验证输出。
- `evidenceRunId`、victory/withdraw 的 `battleId` 与 `reportId` 三方一致。
- 临时浏览器自检写入隔离证据目录，只比较语义，不覆盖 ZIP 内静态权威证据。

## 文件

- 最终包：`iron-command-stage8-2E-A-2-4-verifier-stability-final.zip`
- 稳定性测试：`tests/stage8-2E-A-2-4-test.mjs`
- 超时 worker：`tests/fixtures/verifier-timeout-output-worker.mjs`
- 慢启动 worker：`tests/fixtures/verifier-ready-worker.mjs`
- 最终验证器：`tests/verify-stage8-2E-A-2-4-delivery-package.mjs`

## 尚未解决的问题

Linux/Windows 未进行真实 Chromium 截图实跑；企业策略阻断路径仍是环境诊断，不作为成功浏览器环境的替代。允许本地 HTTP 的成功浏览器环境需在相应机器上运行最终验证器确认返回 0。
