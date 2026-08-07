# 《钢铁指令》阶段 8.2E-A.2 交付说明

## 结论

阶段 8.2E-A.2 已完成：浏览器取证改为系统 Chromium 自动解析，浏览器与临时服务器均使用有界托管退出；新增真实 `withdraw` 活动战斗证据；Manifest 绑定真实战报结果、指纹、模式与截图 SHA；最终 ZIP 会在全新解压目录重新跑测试和浏览器取证。

本轮没有新增 RTS 撤退/失败模板，也没有修改正式战斗求解、HP、结算、奖励、占领、返航时长、SAVE_VERSION=7 或存档结构。真实撤退仍使用旧 `BattleRenderer`。

## 浏览器与进程

- `tests/browser/chromium-resolver.mjs`：环境变量 → PATH → macOS/Windows/Linux 常见路径；失败返回 `chromium_not_found` 与完整候选清单。
- `tests/browser/managed-browser-process.mjs`：spawn 错误监听、DevTools 15 秒超时、stderr 尾部诊断、POSIX 进程组、SIGTERM/SIGKILL 清理和临时 profile 删除。
- Linux root 自动追加 `--no-sandbox`；普通桌面环境不强制追加；支持 `IRON_COMMAND_CHROMIUM_EXTRA_ARGS`。
- `tests/managed-verifier-process.mjs`：服务器独立子进程，退出 Promise 在终止前建立，3 秒 SIGTERM + 1 秒 SIGKILL 上限，并检查端口释放。
- 正式根页面 bootstrap 超时时记录 URL、标题、readyState、可见文本、Runtime/console 错误、资源列表和 HTTP 地址。

## 真实撤退取证

`tests/browser/formal-withdraw-evidence.mjs` 通过正式页面 API 完成建设、科研、生产、编队、scrap_mine 前置占领，再创建独立五单位编队搜索并 dispatch 真实 `withdraw` seed。该战报满足：恰好一个 `retreat` 事件、`capture=false`、奖励为空；偏好保持 `auto`，实际模式自动为 `legacy`。

取证共生成 12 张 A.2 PNG，胜利模式切换证据与真实撤退证据使用不同 `battleId`/`reportId`。Manifest：`screenshots/stage8-2E-A2-screenshot-manifest.json`。

## 实际环境

- 实际测试平台：macOS 26.5.2，Build 25F84；Node.js v25.2.1。
- 实际浏览器：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，Chrome 151.0.7922.76；本机非 root，因此未使用 `--no-sandbox`。
- HTTP 地址：每次取证使用 `127.0.0.1` 临时端口；服务器与 Chromium 均在结束路径清理。
- Linux/Windows：本轮未启动真实浏览器；候选路径生成、PATH 解析、root 参数决策和失败清理由 A.2 自动测试覆盖，不宣称跨平台浏览器实跑通过。

## 测试与封包

- `npm test`：正式及 A.1/A.2 回归全部通过；A.2 专项为 62/62。
- `npm run browser:evidence`：12 张 PNG，12 个 SHA 唯一，胜利与撤退两场独立战斗，page/runtime/console errors 均为空。
- `tests/build-stage8-2E-A-2-delivery-package.mjs`：生成最终包并调用解压后验证器。
- `tests/verify-stage8-2E-A-2-delivery-package.mjs`：阶段进度、300 秒总超时、解压后 npm/全部沙盒/浏览器二次取证、Manifest 真实结果、SHA、端口和进程清理检查。

## 最终文件

交付包：`iron-command-stage8-2E-A-2-browser-evidence-final.zip`。

测试输出：`tests/outputs/stage8-2E-A-2-full-test-output.txt`、`tests/outputs/stage8-2E-A-2-browser-evidence-output.txt`、`tests/outputs/stage8-2E-A-2-verification-output.txt`。

正式边界入口因 `package.json` 新增 A.2/A.2.1 命令而更新为 `c2a87e086e3391eda24ccef3c9a7555f2b624d3f79a2ff01b9c3d3f62ddab733`；正式战斗业务与表现文件内容未变。

## 尚未解决的问题

本轮没有已知未解决问题。Linux/Windows 浏览器只完成候选路径与进程策略测试，未在对应操作系统进行真实 Chromium 截图运行；撤退 RTS/失败模板与原创 Sprite 资源仍不属于本轮范围。
