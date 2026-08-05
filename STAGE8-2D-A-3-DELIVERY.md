# 《钢铁指令》阶段 8.2D-A.3 交付记录

## 结论

阶段 8.2D-A.3 已完成并停止；未进入 8.2D-B，未接入 35 秒 RTS 模板或正式战斗画面。`CURRENT_STAGE=8`、`SAVE_VERSION=7` 保持不变，package version 更新为 `0.8.1-hotfix.3`。

## 非确定性根因与修复

A.2 中正式求解器的目标排序比较器在 `Array.sort()` 内调用 `rng.chance(0.5)`。比较器调用顺序和次数受 JavaScript 引擎排序实现影响，导致同 seed 的后续 RNG 位置、伤害、维修、摧毁和最终战报产生差异。

新增 `js/battle-targeting.js`：

- 优先级仍为攻击方类别对应的目标类别优先级；其次当前 HP；再次由 `hashString(tieSalt + actor.id + target.id)` 生成的预计算 `tieKey`；最后 ID 字典序。
- 每次非空选敌恰好消费一次 `rng.int(0, 0xFFFFFFFF)` 作为 tie salt；空目标消费 0 次；消费次数不依赖候选数量或排序比较次数。
- `compareTargetRanking()` 只读取 `priority / hp / tieKey / id`，不调用 RNG、不改对象、不读时间。
- 正式求解器通过 `targetSortImplementation` 注入 native / insertion / merge 三种排序实现，生产默认 native。

## 确定性验证

- 当前运行时：Node `v25.2.1`，V8 `14.1.146.11-node.14`。
- 未测试 Node 20、Node 22 或其他未安装运行时；不虚构跨版本结果。
- A.3 正式测试：19 / 19。
- 原生 / 插入排序：1000 组候选完整顺序一致。
- 原生 / 归并排序：1000 组候选完整顺序一致。
- 四个 Fixture 场景 seed 1..200：三种排序生成的完整正式战报 `compareBattleReports().ok === true`。
- 旧公路 seed 2：`withdraw`、`capture=false`、`rewards={}`、唯一 retreat、完整性通过。

跨进程 8 / 8 哈希：

```text
campaign-victory:          2a141200b5a4768ce601ae54dbf2c005f347887002ad4b9e7057e7648adc2a81
campaign-withdraw:         340464358baa984bf4aa5a787ad5dd471134fcb709c61a92e28a9e2297d462ec
campaign-defeat-or-wiped:  81d192431b3160f29eb73cae2ac042289cfe22b7e6707174b46826690d391191
operation-result:           8c842113d3f03b5bd6af8f2c0cf6b3badf27332e21282e72652f03adce27f07d
```

## 最终 Fixture 与 Manifest

| Fixture | seed | result | actors | events | damage / repair / destroy / retreat | validation | supported |
| --- | ---: | --- | ---: | ---: | --- | --- | --- |
| campaign-victory | 1 | victory | 6 / 6 | 120 | 41 / 5 / 7 / 0 | true | true |
| campaign-withdraw | 12 | withdraw | 5 / 6 | 150 | 60 / 3 / 7 / 1 | true | true |
| campaign-defeat-or-wiped | 1 | wiped | 1 / 10 | 32 | 12 / 0 / 1 / 0 | true | false |
| operation-result | 1 | victory | 5 / 2 | 35 | 12 / 0 / 2 / 0 | true | true |

Manifest 正式边界包含：`battle.js`、`battle-targeting.js`、`battle-outcome.js`、`utils.js`、`config.js`、`integrity.js`、`research.js`、`state.js`、`units.js` 和 Fixture 场景文件。边界聚合 SHA-256：

`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`

截图绑定已写入 Manifest，四张截图 SHA-256：

```text
01-victory-contract.png: d0495754fa46f4a0d01c06bb72a0c5504385cba5a45a01175f2d35c812528572
02-withdraw-contract.png: 18818491365fb28c68684da8a3ef6e6e161330d1ecef129992fec961fe0d3283
03-wiped-contract.png: cf8e4b5bb6c3471f9630ec0a03bf4d3bbf403ba9a1b1c0d0ddf5e5a510899b99
04-operation-contract.png: cd0dedc8dfb9fd6e32fe01b75aa0d7ca38ab5af0187168e64ff51d2b695c0576
```

截图已通过 Playwright 查看器重生成并检查：seed、report ID、events、damage、repair、destroy、retreat、validation、supported 与 Manifest 一致；console errors 为 0。

## 自包含发布与封包验证

唯一发布入口：

```bash
node experiments/battle-sandbox/report-adapter/build-delivery-package.mjs
```

它依次执行工作区临时文件检查、Fixture write/check、8 进程确定性、正式 npm 测试、214 项沙盒测试、76 项 adapter、临时端口完整性测试、截图绑定检查，创建 ZIP 后立即调用 `verify-delivery-package.mjs`。

`verify-delivery-package.mjs` 从 ZIP 解压目录动态导入 `scripts/serve.mjs`，使用系统分配的临时端口启动服务器，并通过 `ADAPTER_BASE_URL` 运行完整性测试；不依赖预先运行的 8000 端口。最终实测输出包含：`sandbox-report-adapter-integrity-test: 85 passed / 85 total`、`screenshot/manifest bindings: ok`、`verify-delivery-package: ok`。

交付 ZIP：`iron-command-stage8-2D-A-3-cross-engine-determinism.zip`。ZIP SHA-256 由唯一发布脚本在成功自检后输出；该值不复制回 ZIP 内文档，避免修改文档后使 ZIP 自身哈希失效。最终终端输出中的 SHA-256 为本次交付权威值。

ZIP 根目录直接包含 `package.json`，不含旧 ZIP、node_modules、隐藏系统文件、`.backup`、`.tmp` 或日志缓存。

## 测试总览与未解决项

- 正式 npm：627 passed / 0 failed（既有 608 + A.3 19）。
- 五组沙盒：28 + 30 + 40 + 63 + 53 = 214 passed。
- adapter：76 / 76；integrity：85 / 85。
- 尚未解决问题：无 A.3 范围内未解决问题。
- 8.2D-B 的正式 renderer 接入、35 秒战斗视觉接入和新的存档版本仍未实现，按要求保持接口预留。
