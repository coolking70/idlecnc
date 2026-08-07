# Stage 8.2G-B.1.1a Delivery

本阶段只修复证据完整性与最终封包记录，不修改正式战斗求解器、HP、伤害、胜负、奖励、存档、返航、Choreographer、Target Selector、Suppression、Cover Advance、Retreat 或武器逻辑。

## Evidence architecture

- `stage8_2g_b11a_machine_semantic_evidence.json` 由纯 Node 当前规划/渲染状态独立生成，包含 24 个语义帧、稳定 `sceneHash`、canonical `stateSignature`、语义谓词和源战报。
- `stage8_2g_b11a_browser_capture_manifest.json` 由托管 Chromium 当前代码实时生成；浏览器只读取 Machine Evidence 的目标帧列表，并从当前 Renderer 状态读取签名与状态快照。
- `tests/lib/verify-stage8-2G-B-1-1a-evidence.mjs` 重算 Machine 状态、比较 Machine ↔ Browser 的 scene/seed/time/hash/signature/semanticFrameId，并校验命名谓词和 PNG SHA-256。

## Tamper and regression coverage

`tests/stage8-2G-B-1-1a-evidence-tamper-test.mjs` 覆盖错误 sceneHash、stateSignature、semanticFrameId、timestamp、事件语义、PNG、重复 PNG、Machine Evidence、Browser Manifest、fallback 标记和浏览器状态快照；每类篡改均必须失败。

浏览器启动、导航、页面错误、取证超时或解析帧缺失均硬失败，不使用旧截图、旧 Manifest 或缓存证据。

## Package record

最终 ZIP 为：`iron-command-stage8-2G-B-1-1a-evidence-integrity-hotfix.zip`。

最终 ZIP 的 SHA-256、大小、Verifier exit code、clean `npm install && npm test` 结果写入 ZIP 外部的 `iron-command-stage8-2G-B-1-1a-final-package-record.json`，避免 ZIP 自引用哈希。
