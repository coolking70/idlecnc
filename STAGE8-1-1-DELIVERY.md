# IRON COMMAND · Stage 8.1.1 Hotfix 交付说明

版本：`0.8.1-hotfix.1`  
当前阶段：`CURRENT_STAGE=8`  
存档版本：`SAVE_VERSION=7`

## 本轮范围

- `simulateBattle()` 在 `WITHDRAW` 结果的 `RESULT` 事件前写入权威 `RETREAT` 事件；不改变战斗数值、奖励或占领规则。
- 活动战斗新增 `settlementAttempted`、`settlementBlocked`、`settlementError`、`settlementErrorLogged` 与 `loggedErrors` 字段，并对旧活动战斗自动补齐。
- `tickActiveBattle()` 遇到永久结算错误后停止重试并返回 `settlement_blocked`；时序错误仍可重试。
- 新增 `abortInvalidBattle(state)` 与 `__IRON_COMMAND__.abortInvalidBattle()`：只对已阻断战斗安全关闭，恢复编队和合法成员状态，不应用奖励、损失、经验或占领。
- 旧存档中的 `WITHDRAW` 战报如果缺少 `RETREAT`，优先按 `dispatchSnapshot + seed` 确定性重建，并同步修正战报时长/活动进度；无法重建时保留活动战斗并阻断，不重复扣费、重试或刷日志。
- 未修改 `battle-renderer.js`、`battle-visual-director.js`、`battle-camera.js`、CSS 与阶段8.1视觉表现。

## 自动测试

```text
stage3: 63 passed
stage4: 76 passed
stage5: 99 passed
stage6: 116 passed
stage7: 65 passed
stage8: 90 passed
stage8.1: 36 passed
stage8.1.1: 43 passed
total: 588 passed, 0 failed
```

新增测试：`tests/stage8-1-1-test.mjs`。固定正式求解器种子为 `seed=1`，两名步兵在 `scrap_mine` 使用 `cautious` 策略时得到真实 `WITHDRAW`，并验证 `RETREAT` 位于 `RESULT` 之前。

## 浏览器验收

- 使用官方 Playwright 客户端访问 `http://127.0.0.1:8080/`，执行动作突发并生成 `output/web-game/shot-0.png`、`shot-1.png` 与对应 `render_game_to_text` 输出。
- 截图确认基地画面正常显示；文本状态包含 `stage=8`、`activeBattle=false`，无新增 `pageerror` / `console.error`。
- 浏览器调试接口确认 `__IRON_COMMAND__.stage === 8`，无活动战斗时 `abortInvalidBattle()` 返回 `no_battle`，不抛异常。

## 交付文件

- `iron-command-stage8-1-1-hotfix.zip`
- `STAGE8-1-1-DELIVERY.md`
- `tests/stage8-1-1-test.mjs`

阶段9的装备、新单位、新建筑、新战区、随机事件与战斗中手动指挥仍保持预留，不在本轮扩展。
