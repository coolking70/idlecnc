# 《钢铁指令》阶段 8.2B 交付说明

## 交付范围

本次只扩展 `experiments/battle-sandbox/` 内的独立固定 Canvas RTS 视觉沙盒，不接入正式战斗求解器、结算、存档、经济、科研或编队系统。0～10 秒既有表现保持；新增 10～20 秒受损、换位与战地维修表现，20 秒自动暂停。

## 关键表现

- 10.85 秒敌方 AT 曲线火箭出射，11.45 秒命中 `f_tank_1`；车辆保留、冒烟、机动性下降并沿 11.8～14.2 秒后撤路径退至维修位置。
- `f_inf_1` 于 11.2 秒受压，12.2 秒起由两个错峰小组换位，14.8 秒抵达 `friendlyNorthSecondary` 第二掩体并恢复从新掩体开火。
- `f_repair_1` 于 12～16.2 秒前出，16.2～19 秒保持工作距离；机械臂、焊接火花和蓝白工作灯表现维修过程。坦克 19 秒进入 `stabilized`，只恢复部分机动性并保留轻烟。
- `f_at_1` 于 16.9 秒发射曲线火箭，17.55 秒命中 `e_armor_2`；敌方轻装甲冒烟、失去炮塔作业并于 19.5 秒进入 `disabled`，不做爆炸摧毁。
- 10～20 秒继续保留多个固定种子背景火力源、短寿命曳光弹、冲击火花、破片、持续烟尘和受损履带尘。

## 验证

```bash
node experiments/battle-sandbox/tests/sandbox-opening-test.mjs
node experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs
node experiments/battle-sandbox/tests/sandbox-damage-repair-test.mjs
npm test
```

结果：沙盒测试 `28 + 30 + 40` 项通过；正式项目 `npm test` 为 `588 passed / 0 failed`。真实浏览器使用官方 `web_game_playwright_client.js`、`window.advanceTime` 和 `window.render_game_to_text` 推进验证，20.000 秒状态为 `ended=true`，无 console error。

## 截图

保留阶段 8.2A/8.2A.1 的 01～12 号截图，并新增：

- `13-enemy-at-aiming-10-6s.png`
- `14-tank-hit-11-5s.png`
- `15-infantry-suppressed-12s.png`
- `16-bounding-move-13-5s.png`
- `17-repair-vehicle-advance-15s.png`
- `18-field-repair-17s.png`
- `19-friendly-at-hit-17-6s.png`
- `20-stabilized-and-disabled-20s.png`

## 文件边界

本次变更集中在 `experiments/battle-sandbox/`，另含本说明、`progress.md` 阶段记录和交付压缩包；未修改正式 `js/`、`css/`、根 `index.html`、`package.json` 或正式测试。
