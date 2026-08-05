# 阶段8.2A.1 交付说明

## 本轮修补

仅修改 `experiments/battle-sandbox/` 沙盒目录，未修改正式项目文件。

- `f_inf_2` 在 7.6～10 秒为主动 `suppressing`，保持掩体后稳定射击。
- 新增 `sandbox-pulse-scheduler.js`，为北路步枪、南路压制和坦克同轴机枪生成固定种子多子脉冲；曳光弹生命周期短，不保留历史弹道。
- 每个敌军使用独立 `revealStart/revealEnd`，北侧先于南侧显现，并有短暂小型菱形侦察标记。
- 维修车复用 `getRepairVehicleState()`：3.5～10 秒 moving，10 秒到达终点后 holding。
- 新增四组 `COVER_SLOTS`，步兵从编队偏移平滑过渡到独立掩体战位；掩体拆为 back/front 两层绘制。

## 文件清单

新增/更新：

- `experiments/battle-sandbox/sandbox-config.js`
- `experiments/battle-sandbox/sandbox-director.js`
- `experiments/battle-sandbox/sandbox-renderer.js`
- `experiments/battle-sandbox/sandbox-pulse-scheduler.js`
- `experiments/battle-sandbox/sandbox.js`
- `experiments/battle-sandbox/README.md`
- `experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs`
- `experiments/battle-sandbox/screenshots/07-north-cover-slots.png` 至 `12-opening-final-frame.png`
- `STAGE8-2A-1-DELIVERY.md`

原阶段8.2A文件与 01～06 截图均保留。

## 自动测试

```bash
node experiments/battle-sandbox/tests/sandbox-opening-test.mjs
node experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs
```

真实输出：

- `sandbox-opening-test: 28 passed`
- `sandbox-opening-patch-test: 30 passed`
- 正式项目 `npm test`：588 passed，0 failed。

覆盖状态修补、脉冲数量/顺序/种子/生命周期、分批暴露、维修车边界、战位唯一性与平滑过渡、8.8 秒并行火力、配置只读和全部沙盒 JS 语法。

## 浏览器人工验收

访问 `http://127.0.0.1:8000/experiments/battle-sandbox/`，使用固定种子页面实际采集 07～12 截图。验证结果：

- 05.6 秒：北路四名步兵已分散到独立战位，站姿/蹲姿有差异。
- 约 05.3 秒：敌军按北侧、南侧顺序逐批显现，标记短暂且不遮挡单位。
- 约 08.3/08.8 秒：南路状态为 `suppressing`，北路、南路、坦克同轴至少三组脉冲火力并行。
- 约 09.5 秒：维修车仍为 moving 且在主力后方。
- 10 秒：维修车到达终点并为 holding，场景自动暂停，保留烟雾与交火残留。
- Playwright 页面输出无 console error。
- 控件链路：暂停点击后时间保持约 0.223 秒且 `paused=true`；2× 点击后 `speed=2` 且时间推进约 3.565 秒。

## 未解决问题

本阶段仍不实现伤亡、维修、撤退、占领、返航、正式战报、正式存档或 10 秒后的战斗内容；无音频和外部素材。

## 阶段8.2B接口预留

后续 10～20 秒可继续沿用 `updateSandboxState(state, dt)`、`PULSE_ACTIONS`、`PATHS` 与 `state.ended` 边界，新增只读视觉事件即可。当前不开放正式战斗求解器或状态接入。
