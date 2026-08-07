# Iron Command Stage 8.2G-A.1.1

Production Visual Core Closure.

本阶段只收口测试可靠性、Debug 分层、语义阶段 Fixture、部署判定、footprint 空间验证和正式尺寸证据；不修改正式战斗求解器、HP、伤害、胜负、结算、返航或存档。

## 验证顺序

```bash
npm install
node tests/stage8-2E-A-2-4-test.mjs
node tests/stage8-2G-A-1-1-test.mjs
npm test
npm run build:stage8-2G-A-1-1
npm run verify:stage8-2G-A-1-1
```

`npm run build:stage8-2G-A-1-1` 会重新生成浏览器证据、全量测试日志、空间验证 JSON，并对最终 ZIP 做干净解压闭环；verifier 会再次在干净解压目录执行完整 `npm test`。

## 证据

- `tests/evidence/stage8_2g_a11_full_npm_test.log`
- `tests/evidence/stage8_2g_a11_full_npm_test.json`
- `tests/evidence/stage8_2g_a11_spatial_validation.json`
- `screenshots/stage8-2G-A-visual-manifest.json`
- `screenshots/stage8-2G-A/`
- `stage8_2g_a11_developer_selfcheck.json`

三份阶段 Fixture 位于 `tests/fixtures/battle-phases/`，分别覆盖快速接敌、长距离接近和多轮交火。

## 已知事项

`stage8_2g_a1_independent_audit.json` 未随当前工作区或上一轮 ZIP 提供，因此未被导入或替代为生产资源；本阶段以提示词列出的六项问题和实际干净包回归结果为验收基线。
