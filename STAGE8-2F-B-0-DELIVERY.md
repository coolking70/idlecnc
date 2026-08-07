# 阶段 8.2F-B.0：覆盖真实性收口

## 交付结论

B.0 已完成。覆盖统计现在读取真实 schema；mission×result 覆盖矩阵保留真实未观察组合；canonical 语料保留严格 convoy 取证样本；浏览器证据谓词同时校验任务与结果；最新自包含 ZIP 已完成构建和验证。

## 覆盖事实

- canonical reports：120
- deterministic fuzz specs：1000
- 规划总量：1120
- 规划失败：0
- 连续布局失败：0
- 语义失败：0
- mission×result：26/30 个组合有样本
- 明确未观察组合：`enemy_outpost×victory`、`enemy_outpost×pyrrhic`、`outpost_sweep×victory`、`salvage_run×defeat`
- 未删除、过滤或伪造上一轮失败样本；`scenarios/fuzz.json` 仍不是生产运行资源

## 正式浏览器证据

`screenshots/manifest.json` 当前 12 张截图均有唯一 SHA，且 page/console errors 均为空。convoy 证据严格对应：

- `03-convoy-victory-clear.png` → `convoy_escort` / `victory`
- `04-convoy-withdraw-returned.png` → `convoy_escort` / `withdraw`
- `05-convoy-wiped-stopped.png` → `convoy_escort` / `wiped`

## 验证

- `npm test`：退出码 0
- Playwright smoke：退出码 0，页面截图成功
- `coverage-report.mjs`：退出码 0
- 最终包验证：退出码 0，345 个文件，120 canonical，1000 fuzz，12 张截图
- ZIP：`iron-command-stage8-2F-A-2-universal-spatial-final.zip`
- ZIP SHA-256：`4c4f80209a2a2e436c69dcb6e4cff9c718e3ae3ba25f76bf8549b5b8f9969030`

## 边界

B.0 仍是覆盖真实性和证据收口，不代表通用规划器已经接入正式主路由。正式 runtime adapter、render state、缓存和 production renderer 属于后续 B.1。
