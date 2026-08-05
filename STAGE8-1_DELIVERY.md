# IRON COMMAND · Stage 8.1 交付说明

版本：`0.8.1`  
当前阶段：`CURRENT_STAGE=8`  
存档版本：`SAVE_VERSION=7`

## 本轮范围

- 新增确定性战术视觉导演 `js/battle-visual-director.js` 与镜头模块 `js/battle-camera.js`。
- 重构 `js/battle-renderer.js`：1200×700 世界坐标、多路线推进、步兵四人组、反装甲三人组、侦察车、主战坦克、维修车、目标点、掩体与地形道具。
- 战斗视图不再用“第N轮”作为主呈现；只用 scout / approach / engage / resolve 视觉阶段。
- 只有 `DAMAGE` / `DESTROY` 事件能改变视觉 HP 或死亡；装饰火花、尘土、掩体命中不触碰战报与状态。
- 新增总览 / 聚焦 / 打击 / 结果镜头及自动镜头。
- 结算后进入 `presentationPhase='returning'`，5 个游戏秒自动完成返航；“跳过返航动画”不重新结算、不重复发奖。
- 全局结果浮层提供“查看完整战报”和“跳过返航动画”，与右侧当前分页解耦；战术视图隐藏基地图例。
- 旧 Stage8 已结算活动战斗在读取时迁移为返航展示状态，保留原结算凭证，不重复结算。

## 测试输出

`npm test` 已串联阶段3～8以及新增阶段8.1测试：

```text
stage3: 63 passed
stage4: 76 passed
stage5: 99 passed
stage6: 116 passed
stage7: 65 passed
stage8: 90 passed
stage8.1: 36 passed
total: 545 passed, 0 failed
```

新增测试文件：`tests/stage8-1-test.mjs`，共36项，覆盖视觉计划确定性、路线与多成员、地形差异、权威伤害、镜头、只读渲染、返航状态机、跳过返航、旧存档迁移与全局UI接线。

## 浏览器验收

使用本地服务器 `http://127.0.0.1:8000/` 和 Playwright 客户端/浏览器手测：

- 开阔地：通过；
- 防御阵地：通过；
- 连续火力与重叠行动：通过；
- 结算控件：点击“查看完整战报”切换到战报页；点击“跳过返航动画”清空活动战斗；通过；
- 返航中：`returnElapsed` 可见并随游戏秒推进；5秒后自动清空活动战斗；通过；
- 浏览器 `pageerror` / `console.error`：0。

## 截图

- `screenshots/stage8-1-open-field.png`
- `screenshots/stage8-1-fortified.png`
- `screenshots/stage8-1-overlapping-fire.png`
- `screenshots/stage8-1-result-controls.png`
- `screenshots/stage8-1-returning.png`

## 已知限制与后续

本轮没有实现装备、新单位、新建筑、新战区、新科技、指挥官或战斗手动微操。Stage9 仍只保留接口方向。

