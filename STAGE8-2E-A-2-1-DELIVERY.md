# 《钢铁指令》阶段 8.2E-A.2.1 交付说明

## 结论

A.2.1 只收口验收工具：新增专属临时根、子进程 TMPDIR/TMP/TEMP 隔离、浏览器策略阻断诊断、profile 自有路径清理和失败路径验证。未修改 `js/`、CSS、HTML、正式旁路、战斗求解、HP、结果、结算、奖励、返航或 SAVE_VERSION=7。

## 实际环境

- 操作系统：macOS 26.5.2，Build 25F84。
- Node.js：v25.2.1。
- 实际浏览器：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，Chrome 151.0.7922.76。
- 本机非 root；未使用 `--no-sandbox`。Linux root 参数通过自动化单元测试覆盖。
- 实际平台：macOS；Linux/Windows 只完成候选路径、root 参数、失败进程和策略数据的模拟测试，未宣称真实浏览器截图跨平台通过。

## 隔离与策略诊断

- `tests/browser/isolated-temp-root.mjs` 为每次构建/验证建立 `tmp/`、`browser-profiles/`、`extracted/`、`logs/` 专属根，并向所有子进程传递 TMPDIR/TMP/TEMP。
- 测试创建带相同前缀的外部污染文件和目录，但只验证本次 profile 路径；外部项目不会被扫描或删除。
- `tests/browser/browser-policy-diagnostics.mjs` 将 Chromium `chrome-error://` + 组织策略文本分类为 `navigation_blocked_by_policy`；普通 404 保留 `navigation_http_error`，普通初始化超时保留 `formal_page_bootstrap_timeout`。
- 策略阻断仍返回非零、关闭浏览器/服务器、删除专属临时根，不复用旧 PNG 作为成功证据。

## 证据与验证

- 允许本地 HTTP 的真实 Chromium 重新生成 12 张 A.2 截图；Manifest 仍记录独立 victory/withdraw 两场战斗、真实结果、模式、指纹和 PNG SHA。
- 浏览器取证运行约 6 秒；解压后二次封包验证约 50 秒，实际耗时以对应输出文件中的阶段日志为准。
- A.2 原有测试继续通过；A.2.1 新增测试覆盖 46 项隔离、策略、进程、证据和回归要求。
- 最终 ZIP 不包含 `.git/`、`node_modules/`、临时 profile、解压目录、旧 ZIP、PID 文件或测试缓存。
- 正式边界入口因验收命令追加更新为 `c2a87e086e3391eda24ccef3c9a7555f2b624d3f79a2ff01b9c3d3f62ddab733`；正式业务/表现文件未改。

## 输出文件

- 最终包：`iron-command-stage8-2E-A-2-1-evidence-isolation-final.zip`
- Manifest：`screenshots/stage8-2E-A2-screenshot-manifest.json`
- 测试输出：`tests/outputs/stage8-2E-A-2-1-full-test-output.txt`
- 浏览器输出：`tests/outputs/stage8-2E-A-2-1-browser-evidence-output.txt`
- 解压后二次验证输出：`tests/outputs/stage8-2E-A-2-1-verification-output.txt`

## 尚未解决的问题

本轮没有已知未解决问题。Linux/Windows 未进行真实 Chromium 截图实跑；企业策略阻断为结构化模拟诊断覆盖，未将模拟结果宣称为真实企业策略环境验收。
