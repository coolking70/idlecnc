# 《钢铁指令》阶段 8.2C 交付说明

## 交付范围

本阶段只扩展 `experiments/battle-sandbox/` 内的独立固定 Canvas RTS 视觉沙盒，不接入正式战斗求解器、结算、存档、经济、科研或编队系统。时间轴由 0～20 秒延展至 0～35 秒，35 秒自动暂停。

## 实现内容

- 20～35 秒：友方坦克突破、主炮曲线射击、敌方装甲摧毁、敌方 AT 与步兵分批撤退、防线崩溃后的目标推进。
- 目标占领：目标点 28 秒进入 `contested`，31.5 秒达到 `captured`；友方两组步兵进入固定北/南占领战位并显示进度环、旗帜和状态灯。
- 重新集结：受损坦克保持受损/低机动表现，维修车完成支援后沿回归路线重新加入西侧集结线；友方主战坦克在目标附近转入 `overwatch`。
- 战场残留：摧毁的 `e_armor_1` 生成永久残骸、灼痕、烟尘和短暂余烬；道路火箭偏转保留冲击灼痕。
- 8.2B 修补：曳光弹统一为可读的短段且最长不超过 40px；维修接触点落在受损坦克边缘 8px 内并保持工作距离；disabled 轻装甲取消误导性灯光/天线并使用倾斜、炮塔失效、悬挂下沉和持续烟尘表达。

## 固定时间轴验收点

| 时间 | 结果 |
| --- | --- |
| 20.0s | 受损坦克稳定、敌方轻装甲 disabled，进入突破段 |
| 22.35s | `f_tank_2` 主炮发射 |
| 22.72s | `e_armor_1` 摧毁并生成残骸 |
| 24～30s | 敌方 AT、步兵分批压制后撤并退出战场 |
| 28.0s | 目标进入 `contested` |
| 31.5s | 目标进入 `captured` |
| 33～35s | 受损坦克重新集结，35 秒自动停止 |

## 修改文件清单

沙盒核心与新增模块：

- `experiments/battle-sandbox/index.html`
- `experiments/battle-sandbox/sandbox-config.js`
- `experiments/battle-sandbox/sandbox-director.js`
- `experiments/battle-sandbox/sandbox-renderer.js`
- `experiments/battle-sandbox/sandbox-camera.js`
- `experiments/battle-sandbox/sandbox.js`
- `experiments/battle-sandbox/sandbox-damage-model.js`
- `experiments/battle-sandbox/sandbox-repair-director.js`
- `experiments/battle-sandbox/sandbox-pulse-scheduler.js`
- `experiments/battle-sandbox/sandbox-objective-director.js`
- `experiments/battle-sandbox/sandbox-retreat-director.js`
- `experiments/battle-sandbox/sandbox-wrecks.js`

文档、测试和截图：

- `experiments/battle-sandbox/README.md`
- `experiments/battle-sandbox/tests/sandbox-opening-test.mjs`
- `experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs`
- `experiments/battle-sandbox/tests/sandbox-damage-repair-test.mjs`
- `experiments/battle-sandbox/tests/sandbox-breakthrough-capture-test.mjs`
- `experiments/battle-sandbox/screenshots/21-short-tracers-fixed.png` ～ `32-final-regroup-35s.png`
- `progress.md`
- `STAGE8-2C-DELIVERY.md`

正式项目 `js/`、`css/`、根 `index.html`、`package.json` 和正式测试未修改。

## 测试与验证

四个沙盒测试真实输出：

```text
sandbox-opening-test: 28 passed
sandbox-opening-patch-test: 30 passed
sandbox-damage-repair-test: 40 passed
sandbox-breakthrough-capture-test: 63 passed
```

正式回归：

```text
npm test
588 passed / 0 failed
```

浏览器验收使用官方 `develop-web-game` Playwright 客户端、`window.advanceTime` 和 `window.render_game_to_text`。21.484 秒采样无错误；35.000 秒终帧状态为 `ended=true`、`objective.status=captured`、`objective.progress=1`，包含 1 个装甲残骸和 2 个灼痕，敌方 AT 单位 `alpha=0/status=escaped`，控制台错误文件为空。最终截图已用 `view_image` 检查，HUD 显示 `00:35 / 00:35`。

## 交付边界与 8.2D 预留

本阶段仍是固定演示沙盒：目标占领、突破、撤退和维修均为确定性视觉 director，不写入正式战斗结果或存档。8.2D 仅预留更长战斗、多目标/多波次、正式战报接口和可配置事件编排；本阶段不实现这些内容。

