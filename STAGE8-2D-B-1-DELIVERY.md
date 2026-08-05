# 《钢铁指令》阶段 8.2D-B.1 交付说明

## 交付结论

阶段 8.2D-B.1 已完成。本轮只修补隔离的真实战报演示表现，不接入正式战斗、结算、资源、存档、`main.js` 或正式 renderer。

- 页面：`http://127.0.0.1:8000/experiments/battle-sandbox/contract-demo/`
- 交付入口：`experiments/battle-sandbox/contract-demo/index.html`
- Fixture：`experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json`
- report：`battle_1_fixture-f_border_road_breakthrough`
- reportHash：`2a141200b5a4768ce601ae54dbf2c005f347887002ad4b9e7057e7648adc2a81`
- formalBoundaryHash：`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`

## 本轮修补

### 真实维修接触

新增 `repair-choreography.js`、`visual-bounds.js`，维修组由 5 个真实 repair anchors 自动分组，不再由 renderer 根据时间硬编码机械臂。

| 维修组 | approach | work | retract | 目标 | 锚点 |
| --- | ---: | ---: | ---: | --- | ---: |
| repair-group-1 | 12.797445 | 13.447445–20.048322 | 20.048322–20.708322 | `unit_fixture-u-4` | 13.867445, 19.408322 |
| repair-group-2 | 27.199851 | 27.849851–33.651304 | 33.651304–34.311304 | `unit_fixture-u-5` | 28.199851, 30.799403, 32.991304 |

每个锚点都满足：维修车中心距目标 55～82 px、车辆包围盒不相交、机械臂端点距接触点不超过 6 px、火花距接触点不超过 8 px。接触偏移使用目标朝向旋转的 target-relative offset `{x:-62,y:38}`；维修车状态按 `stowed → deploying → working → retracting` 收束。

### 短弹道

新增 `projectile-geometry.js`。所有弹道都由 `start/end/control + launchTime/duration/segmentLength` 生成短段，不再绘制 source→target 的全长亮线。

| 武器 | 段长 | 生命周期 |
| --- | ---: | ---: |
| rifle | 22 px | 0.18 s |
| light tracer | 28 px | 0.22 s |
| coax | 34 px | 0.24 s |
| cannon | 28 px | 0.36 s |
| rocket head | 22 px | 0.58 s |

统一上限为 40 px，火箭仍保留曲线控制点但只显示短弹头段。

### 状态收束

`authority-state.js` 只保留 HP、alive、damage、repair、suppression 等权威事实；`presentation-status-resolver.js` 独立解析临时视觉状态。35 秒严格为：

| 演员 | 35 秒状态 |
| --- | --- |
| 普通步兵 | `holding_objective` |
| 反装甲班 | `holding_objective` |
| 侦察车 | `scanning` |
| 领头坦克 | `destroyed` |
| 支援坦克 | `damaged_overwatch` |
| 维修车 | `damaged_support_holding` |

35 秒没有 `hit`、`being_repaired`、`repairing`、`suppressed`、`firing` 或其它临时状态残留。

## 精确取帧

`experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json` 已更新为 15 张图。新增：

- `11-short-projectile-8s.png`
- `12-lead-tank-repair-contact-13-9s.png`
- `13-lead-tank-second-repair-19-4s.png`
- `14-support-tank-repair-contact-28-2s.png`
- `15-final-status-clean-35s.png`

五个新增取帧的 `actualTime` 与 `requestedTime` 完全一致；浏览器 console/page errors 均为空。第 10、15 张均为同一确定性 35 秒终帧，因此有意共享 PNG SHA，其余 14 张 SHA 均不同。

## 测试输出

```text
npm test                                      627 passed / 0 failed
sandbox-opening-test.mjs                       28 passed
sandbox-opening-patch-test.mjs                30 passed
sandbox-damage-repair-test.mjs                40 passed
sandbox-breakthrough-capture-test.mjs         63 passed
sandbox-integration-readiness-test.mjs        53 passed
fixture-generator.mjs --check                  ok
cross-process-determinism.mjs                  4 fixtures × 8/8 same
sandbox-report-adapter-test.mjs                76 passed
sandbox-report-adapter-integrity-test.mjs     85 passed
contract-driven-victory-demo-test.mjs          85 passed
contract-demo-visual-integrity-test.mjs       135 passed
```

视觉完整性测试覆盖维修分组/时序/距离/包围盒/机械臂/火花、60 fps 平滑性、五个精确契约时刻、真实 HP 增量、短弹道几何、临时状态收束、15 张截图 SHA、入口加载链和正式边界哈希。

## 边界与交付包

本轮变更仅位于：

- `experiments/battle-sandbox/contract-demo/`
- `experiments/battle-sandbox/tests/contract-demo-visual-integrity-test.mjs`
- `experiments/battle-sandbox/README.md`
- `STAGE8-2D-B-1-DELIVERY.md`
- `progress.md`

正式输入边界哈希仍为 A.3 基线 `2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`。

交付包：`iron-command-stage8-2D-B-1-visual-integrity-patch.zip`。封包后执行 `unzip -t`、关键文件检查及包内视觉完整性测试。
