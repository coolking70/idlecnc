# Stage 8.2G-D-A.1 Delivery

本轮收口目标是生产级语义动画证据与坦克炮塔独立朝向。需求主体为 D-A.1 开发提示词；`stage8_2g_da_github_independent_audit.json` 只作为失败基线与回归样本参考，不进入生产代码，也不通过删除/过滤样本让统计归零。

## 实现边界

- `universal-visual-scene.js` 将 movement/hull facing 与 aim/turret facing 分离。正式 Choreographer、Solver、route、combat report 和权威 shot 数据不改写。
- `production-visual-draw-spec.js` 输出 Hull/Turret direction、source rect、最终 `drawRect` 和 `visualMuzzlePoint`；Renderer 屏幕指标直接消费同一 Draw Spec。
- `stage8-2G-DA1-semantic-predicates.mjs` 和 `stage8-2G-DA1-semantic-frame-resolver.mjs` 负责文件名语义、真实状态 predicate、50ms 粗搜和不超过 16.7ms 的确定性细化；未知语义 fail-closed。

## 证据与验证

机器证据包含 12 个合成生产艺术覆盖帧和 1 个未修改正式矿区帧。浏览器证据由当前页面 Renderer 实时生成，逐帧重新读取 `battlePresentationEvidenceStateAt` 与 `battlePresentationScreenMetricsAt`，再用共享 predicate 复核；不读取旧 PNG 作为渲染输入。

验证覆盖：

- friendly/enemy lineup、步兵移动/开火、反装甲火箭、坦克 Hull/Turret 分离与坦克炮、混合火力、敌我残骸、窄窗口可读性、资产 fallback；
- authority facing/impact/time 不变，三类单位最终几何炮口对齐；
- hit → `hit`、destroy → `destroying`、wreck 保留最后 Hull 朝向；direct/linear/rewind seek 一致；
- 17 类篡改样本拒绝，包括错误资产、方向/Hull/Turret 帧、语义 ID/谓词、匹配 Actor、炮口视觉起点、时间、reload 重标开火、PNG 哈希、重复 PNG 和正式报告。

## 运行入口

```bash
npm run test:stage8-2G-D-A-1
npm run browser:stage8-2G-D-A-1
npm run build:stage8-2G-D-A-1
npm run verify:stage8-2G-D-A-1 -- --skip-full
npm run verify:stage8-2G-D-A-1
```

交付 ZIP 保持在工作区外部记录中，不加入 Git；记录文件为
`stage8_2g_da1_final_package_record.json`，其中 `cleanPackageGate` 由解压后的默认验证器更新。
