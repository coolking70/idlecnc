# 阶段 8.2F-B.1：正式通用旁路

## 交付结论

B.1 已将通用战斗演出从隔离规划器接入正式页面的 session-only 旁路。正式路由可显式选择 `universal`；旁路只读取 `activeBattle.report`，通过正式报告契约、通用计划、连续空间校验和 fingerprint 准入，不修改权威结算、战报、存档或经济状态。

`auto` 保持 A.2 的既有 `contract → legacy` 默认策略，避免改变已验收的正式浏览器证据；`universal` 适用于通用任务、地形、策略和五类结局，渲染失败会在当前 battle/session 内一次性回退 legacy。

## 新增正式旁路

- `universal-battle-adapter.js`：报告准入、非变异检查、计划/空间校验。
- `universal-plan-cache.js`：按报告 fingerprint 的 session 缓存与命中诊断。
- `universal-render-state.js`：权威 damage/repair/destroy 时间采样、最终状态收束和返航视觉状态。
- `universal-battle-renderer.js` / `universal-hud-policy.js`：正式 Canvas 战术场景和安全 HUD。
- `presentation-router.js`：新增 `universal` 偏好、`universal_battle` 模式、缓存诊断和有界回退。

## 验证

- B.1 专项：12/12
- 旧正式旁路 8.2E-A：102/102
- 完整 `npm test`：退出码 0
- 通用语料：1120 plans passed
- 连续布局：1123 checks passed
- Playwright universal renderer smoke：退出码 0，无 page/console error 文件
- 真实截图：`tests/browser/universal-sidecar-smoke.html` 已检查，Canvas、通用 HUD、演员、路线和空间区域均可见
- 最终包：`iron-command-stage8-2F-B-1-universal-sidecar-final.zip`，353 个文件，SHA-256 `05847b1f403baff82f5036bccd1bf1b32d19bb30adff9ca9d23f4ba5b61bafd4`

## 边界

通用旁路是正式演出 renderer 的可控入口，不改变 `simulateBattle()`、settle、report 或 save。`auto` 默认仍不自动扩大准入；后续如需将 universal 纳入自动选择，应单独增加真实正式多任务浏览器证据和结果矩阵门禁。
