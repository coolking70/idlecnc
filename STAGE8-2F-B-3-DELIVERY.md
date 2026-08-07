# Stage 8.2F-B.3 交付记录：正式覆盖矩阵与默认启用

## 目标

把 B.2 通用 Renderer 的正式覆盖范围固化为生产准入矩阵，并让 `auto` 在已覆盖正式战报上默认启用通用演出。未观测矩阵格、未知任务和运行异常继续保持可诊断、可回退，不把 fuzz 或失败样本伪装成正式覆盖。

## 默认策略

- `auto` + 已观测矩阵格：默认尝试 `universal_battle`。
- `border_road/victory`：保留已有契约特化 Renderer 优先，确保正式道路胜利演出不降级。
- 未观测矩阵格/未知矩阵格：不宣称通用默认支持，回退 legacy。
- 显式 `universal`：继续允许完整通用计划验证通过的旁路，用于验收和诊断；这不扩大 `auto` 的覆盖承诺。
- 通用 Renderer 或计划失败：沿用一次性、有界的 legacy 回退。

## 覆盖矩阵

当前正式覆盖为 6 个任务 × 5 个结果的 30 格矩阵：26 格已观测、4 格未观测。未观测格明确保留为：

- `enemy_outpost/victory`
- `enemy_outpost/pyrrhic`
- `outpost_sweep/victory`
- `salvage_run/defeat`

生产模块 `universal-coverage-matrix.js` 内置该政策快照；它不读取 sandbox 的 `coverage.json`，coverage JSON 只用于测试前后对比和交付证据。

## 验证

- `node tests/stage8-2F-B-3-test.mjs`：9/9。
- B.1：12/12；B.2：8/8。
- 正式页面证据重新生成 12 张：胜利契约优先；withdraw 活动/返航帧 `auto → universal_battle`；页面错误 0、控制台错误 0。
- 官方 Playwright 默认路由 Canvas 烟测：`operation/salvage_run/victory` 与 `border_road/withdraw` 均显示 `auto → universal_battle`，文本状态 errors 为空，截图已人工检查。
- 全量 `npm test`、coverage 120 canonical + 1000 fuzz、26/30 矩阵、抽取包回归均由 B.3 builder 执行。

## 最终封包

- 文件：`iron-command-stage8-2F-B-3-formal-coverage-default-final.zip`
- 生成命令：`npm run build:stage8-2F-B-3`
- SHA-256：以 `npm run build:stage8-2F-B-3` 最终 stdout 和外部校验值为准（封包不在内部硬编码自身 SHA，避免自引用）。
- 大小：以最终封包文件的外部 `stat` 校验为准；解压自包含验证通过，`delivery-file-manifest.json` 文件哈希一致。
- 构建门禁：120 canonical、1000 fuzz、26 covered、4 unobserved、12 formal screenshots；抽取包 `npm test` 通过。
