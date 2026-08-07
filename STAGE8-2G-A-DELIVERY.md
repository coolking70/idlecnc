# Stage 8.2G-A 交付说明

本包完成生产级战斗视觉核心与“废弃矿区·混编胜利”垂直切片。正式战斗报告、求解器、结算、单位 HP、存档和资源语义仍是唯一权威；本阶段只把正式报告映射为确定性的战场视觉状态。

## 交付内容

- 正式通用 Renderer：地形、掩体道具、步兵成员队形、坦克炮塔、残骸、弹道、命中特效、爆炸、火花、烟雾和地面毁伤贴花。
- 演员状态机：`move`、`aim`、`fire`、`reload`、`hit`、`destroying`、`wreck`，毁伤先经过短暂的 destroying 状态，再生成 persistent wreck。
- 混编武器视觉：步兵小武器、反装甲火箭、坦克主炮、侦察车机枪和维修工具使用不同的节奏、弹道和冲击表现。
- 正式/调试分离：生产层不调用路线、区域、碰撞形状或 Actor ID 绘制；调试 overlay 使用同一 plan/state，只在 `setBattlePresentationDebug(true, options)` 时显示。
- `render_game_to_text()` 暴露当前正式战斗 scene 摘要，包含 visual stage、actors、projectiles、effects、decals、smoke、wrecks 和 rendering layers。
- 正式页面响应式证据覆盖：默认尺寸、窄窗口、生产模式和调试模式均已通过浏览器取证。

## 浏览器证据

证据脚本：`tests/browser/stage8-2G-A-evidence.mjs`。

证据清单：`screenshots/stage8-2G-A-visual-manifest.json`。

十张图位于 `screenshots/stage8-2G-A/`，依次覆盖 deploy、approach、first contact、main engagement、critical hit/destruction、battle end、production、debug overlay、formal default size 和 formal narrow size。最近一次运行结果为：seed 1、scrap_mine、breakthrough、victory、10 张 PNG、SHA 全部唯一、pageErrors/consoleErrors 均为空。

## 测试与边界

- `node tests/stage8-2G-A-test.mjs`：7/7。
- `npm test`：全量回归通过，包含 8.2G-A、8.2F-B.1～B.6、8.2E-A.2.4 及 1120 个通用规划语料样本。
- 视觉状态由 report/plan/时间采样确定性推导，不使用 `Math.random()`，不修改 authority report。
- 本阶段未实现更高阶的编队学习、科技树新效果或跨战斗持久化视觉伤痕；这些属于后续阶段，不在本包的垂直切片范围内。
- 独立审计 JSON 不作为运行资源；本文件对应的 `stage8_2g_a_developer_selfcheck.json` 是开发自检，不是独立审计结论。

## 本地运行

```bash
npm start
```

浏览器打开 `http://127.0.0.1:8000/`。调试 overlay 仅供开发取证，可通过页面控制台调用：

```js
window.__IRON_COMMAND__.setBattlePresentationDebug(true, {
  showRoutes: true,
  showZones: true,
  showCollisionShapes: true,
  showActorIds: true,
  showEventAnchors: true
});
```
