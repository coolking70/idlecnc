# 阶段8.2A 交付说明

## 交付内容

已新增独立视觉实验目录：`experiments/battle-sandbox/`。

该沙盒使用原生 HTML/CSS/ES Module/Canvas 2D，固定世界尺寸 1280×720、固定种子 82021，严格覆盖 0～10 秒：侦察车前出、北南两路步兵展开、两辆坦克沿不同道路推进、敌军进入掩体并逐渐暴露，以及首次多点重叠交火。10 秒后自动暂停并显示阶段结束文案。

## 修改文件清单

本轮新增：

- `experiments/battle-sandbox/index.html`
- `experiments/battle-sandbox/sandbox.css`
- `experiments/battle-sandbox/sandbox.js`
- `experiments/battle-sandbox/sandbox-config.js`
- `experiments/battle-sandbox/sandbox-assets.js`
- `experiments/battle-sandbox/sandbox-director.js`
- `experiments/battle-sandbox/sandbox-renderer.js`
- `experiments/battle-sandbox/sandbox-camera.js`
- `experiments/battle-sandbox/README.md`
- `experiments/battle-sandbox/tests/sandbox-opening-test.mjs`
- `experiments/battle-sandbox/screenshots/` 下 6 张浏览器截图
- `STAGE8-2A-DELIVERY.md`

`progress.md` 追加了本阶段记录。正式项目的 `js/battle.js`、`js/theater.js`、`js/integrity.js`、`js/save.js`、`js/state.js`、`js/main.js`、`js/battle-renderer.js`、`js/battle-visual-director.js`、`js/battle-camera.js`、`css/style.css` 与根 `index.html` 未因本沙盒改动。

## 启动与测试

```bash
npm start
```

浏览器访问：`http://127.0.0.1:8000/experiments/battle-sandbox/`

沙盒测试：

```bash
node experiments/battle-sandbox/tests/sandbox-opening-test.mjs
```

结果：`sandbox-opening-test: 28 passed`。

正式项目回归：

```bash
npm test
```

当前工作区正式测试套件结果：588 passed，0 failed（阶段3～8、8.1、8.1.1）。

## 人工浏览器验收

- 0～3 秒：侦察车从左侧前出，北南步兵路线分离，场景包含公路、建筑、掩体和阴影。
- 3～7 秒：两辆坦克沿不同道路位置推进，步兵靠近两组友军掩体，敌军在两侧掩体与建筑附近展开，维修车始终留在后方。
- 7～10 秒：北侧步兵互射、南侧压制、坦克炮口焰与炮弹、敌方火箭尾焰、侦察车横向脱离和敌轻装甲射击同时可见；10 秒自动暂停。
- 暂停验证：真实浏览器状态时间保持约 `0.133s`，`paused=true`。
- 2 倍速验证：真实浏览器状态报告 `speed=2`，时间推进约 `4.531s`，只改变播放速度。
- 截图与状态文件均来自本地沙盒页面，浏览器控制台无新增错误。

## 截图

- `experiments/battle-sandbox/screenshots/01-scout-advance.png`
- `experiments/battle-sandbox/screenshots/02-two-lane-deployment.png`
- `experiments/battle-sandbox/screenshots/03-tank-road-advance.png`
- `experiments/battle-sandbox/screenshots/04-enemy-cover.png`
- `experiments/battle-sandbox/screenshots/05-overlapping-fire-8s.png`
- `experiments/battle-sandbox/screenshots/06-overlapping-fire-10s.png`

## 未解决问题

本轮明确不加入音频、伤亡结算、敌军撤退、占领目标、正式战报、正式存档、资源、科研、维修逻辑或编队接入。程序绘制图形是原创临时表现，不代表正式游戏美术资产。

## 10～20 秒接口预留

下一段可继续复用 `sandbox-director.js` 的 `updateSandboxState(state, dt)` 和配置中的 `FIRE_PLAN`/`PATHS` 结构，追加 10 秒后的只读视觉计划。`state.ended` 是本阶段停止边界；当前沙盒不持有正式项目状态，也不应把下一段逻辑接入正式求解器或存档。

