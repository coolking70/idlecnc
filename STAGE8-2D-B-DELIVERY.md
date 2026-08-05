# 《钢铁指令》阶段 8.2D-B 交付说明

## 交付结论

阶段 8.2D-B 已完成。新增页面是隔离的真实胜利战报演示，不接入正式战斗页面，不修改正式结算、资源、存档或 `main.js`。

- 页面：`http://127.0.0.1:8000/experiments/battle-sandbox/contract-demo/`
- 交付入口：`experiments/battle-sandbox/contract-demo/index.html`
- Fixture：`experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json`
- report：`battle_1_fixture-f_border_road_breakthrough`
- reportHash：`2a141200b5a4768ce601ae54dbf2c005f347887002ad4b9e7057e7648adc2a81`
- formalBoundaryHash：`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`

入口严格执行：

```js
const fixture = await loadVictoryFixture();
const contract = buildPresentationContract(fixture.report);
```

启动前强制检查 `validation.ok`、`diagnostics.supported`、`presentation.templateId === null` 和正式结果 `victory`；失败时显示错误并停止，不降级为固定假演出。

## 真实演员与槽位

| 真实演员 | 类型 | 演出槽位 |
| --- | --- | --- |
| `unit_fixture-u-3` | `scout_car` | `friendly_scout_flank` |
| `unit_fixture-u-1` | `infantry` | `friendly_north_assault` |
| `unit_fixture-u-2` | `at_infantry` | `friendly_south_at_assault` |
| `unit_fixture-u-4` | `mbt` | `friendly_lead_tank` |
| `unit_fixture-u-5` | `mbt` | `friendly_support_tank` |
| `unit_fixture-u-6` | `repair_vehicle` | `friendly_repair_rear` |
| `enemy_infantry_1` | `enemy_infantry` | `enemy_north_cover` |
| `enemy_infantry_2` | `enemy_infantry` | `enemy_center_checkpoint` |
| `enemy_infantry_3` | `enemy_infantry` | `enemy_south_cover` |
| `enemy_infantry_4` | `enemy_infantry` | `enemy_rear_reserve` |
| `enemy_at_1` | `enemy_at` | `enemy_north_at_nest` |
| `enemy_at_2` | `enemy_at` | `enemy_south_at_nest` |

计划验证确认真实演员 12、视觉逻辑演员 12、无额外演员、无敌装甲演员。步兵子成员只保存 `parentActorId`，不进入 `authorityState`。

## 时间与锚点

| source | presentation |
| ---: | ---: |
| 0.00 | 0.00 |
| 2.30 | 7.00 |
| 16.86 | 16.00 |
| 31.04 | 25.00 |
| 44.45 | 32.00 |
| 45.60 | 35.00 |

线性分段映射保持单调，按原事件 index 稳定排序。全量 120 个 authority anchors 进入调度表；required 71 个恰好应用一次：damage 41、suppress 17、repair 5、destroy 7、result 1。FIRE 与 DAMAGE 按原事件顺序配对 41 组；FIRE 不扣血，DAMAGE 才扣血，DESTROY 才设置 `alive=false`。

## 最终权威状态

| 演员 | 最终 HP | alive |
| --- | ---: | --- |
| `unit_fixture-u-1` 普通步兵 | 100 / 100 | true |
| `unit_fixture-u-2` 反装甲班 | 90 / 90 | true |
| `unit_fixture-u-3` 侦察车 | 90 / 90 | true |
| `unit_fixture-u-4` 领头坦克 | 0 / 160 | false |
| `unit_fixture-u-5` 支援坦克 | 123 / 160 | true |
| `unit_fixture-u-6` 维修车 | 32 / 110 | true |
| `enemy_infantry_1..4` | 0 / 85 | false |
| `enemy_at_1..2` | 0 / 80 | false |

35 秒验证结果：`result=victory`、`capture=true`、目标 `captured`、7 个逻辑演员被摧毁、只有 1 辆车辆残骸、5 个友军逻辑演员存活。

## 精确取帧

截图位于 `experiments/battle-sandbox/contract-demo/screenshots/`，共 10 张，Manifest 为 `capture-manifest.json`，每张来自真实浏览器页面和 `window.seekContractDemoTime(seconds)`，10 个 PNG SHA-256 全部不同，浏览器错误为空。

首个敌军 `destroy` 的映射时间是 12.445742 秒，领头坦克 `destroy` 的映射时间是 24.028914 秒；为使对应 12 秒、24 秒命名截图清楚呈现失能/残骸，实际取帧记录为 12.5 秒和 24.1 秒，Manifest 已如实记录 `requestedTime` 与 `actualTime`。

## 测试输出

按提示词规定的顺序执行并通过：

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
```

正式 Fixture 基线保持：friendly 6、enemy 6、events 120、damage 41、repair 5、destroy 7、retreat 0、validation true、supported true。

## 只读边界与项目哈希

本轮只在以下范围增加/修改：

- `experiments/battle-sandbox/contract-demo/`
- `experiments/battle-sandbox/tests/contract-driven-victory-demo-test.mjs`
- `experiments/battle-sandbox/README.md`
- `STAGE8-2D-B-DELIVERY.md`
- `progress.md`

正式战斗输入边界 SHA 与 A.3 Manifest 相同：`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`。本轮没有改动 `js/`、根 `css/`、根 `index.html`、`package.json`、`scripts/`、Fixture、Manifest 或 Stage 3～8.2D-A.3 测试。

## 尚未解决的问题

没有未解决的契约、状态或浏览器错误。仅保留取帧命名与权威映射之间的两个小数秒差异，已在截图 Manifest 和上文记录，未修改任何 authority time。

## 下一阶段接口

当前页面继续保持隔离。后续如进入 8.2D-C，可复用 `buildPresentationContract`、`buildPresentationPlan`、`resolveTemplateSlots`、`seekContractDemoTime` 和 `render_contract_demo_to_text` 建立 withdraw/defeat 模板；如进入 8.2E-A，必须另行审查正式页面接入边界，不能把本轮 Canvas 直接接到 `main.js`。
