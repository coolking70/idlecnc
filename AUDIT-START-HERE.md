# Stage 8.2G-C.1 Audit Start Here

## C.1 verification entry points

```bash
npm run test:stage8-2G-C-1
npm run browser:stage8-2G-C-1
npm run build:stage8-2G-C-1
npm run verify:stage8-2G-C-1
```

C.1 evidence recomputes expected state from the current source code and canonical
scenarios. The independent-audit JSON and tamper-proof text supplied for the
previous review are external baseline/reference material only; they are not
loaded by production code, and their failed samples are not filtered.

本交付以 Stage 8.2G-B.1.1a 为基线，新增 Environment Grammar、持久破坏、矿区环境视觉、武器视觉档案和离线 Asset Manifest。表现层不修改 solver、HP、damage、destroy、result、reward、save、Choreographer 或 authoritative event order；证据继续使用 B.1.1a 强绑定原则。

## Clean reproduction

```sh
npm install
npm run test:stage8-2G-C
npm run browser:stage8-2G-C
npm run verify:stage8-2G-C
npm test
npm run build:stage8-2G-C
npm run verify:stage8-2G-C
```

上一轮独立审计现已由用户提供：[`stage8_2g_b1_independent_audit.json`](/Users/coolking70/Downloads/stage8_2g_b1_independent_audit.json)。该文件的 B.1 结论为 `not_passed`，明确建议进入 `8.2G-B.1.1`；其失败样本和审计结论只作为本轮回归基线使用，未导入生产代码、未替代、未过滤或用于抹平失败样本。本文件仍不把 B.1 独立审计误写成通过。

基线阻塞项为：旧截图/Manifest 复用而非事件解析（B1）、跨 Phase Assignment 被截断（B2）、撤退后卫没有实际演出射击（B3）、权威 Shot 使用移动朝向而非弹道向量（B4），以及 B.1.1a 审计发现的强绑定可篡改问题。B.1.1 已覆盖战斗功能回归；B.1.1a 只覆盖证据完整性。

## Required evidence

- Machine/browser evidence: `stage8_2g_c_machine_evidence.json`, `stage8_2g_c_browser_capture_manifest.json`
- Environment/destruction/asset/seek/authority/performance evidence: `stage8_2g_c_environment_manifest.json`, `stage8_2g_c_persistent_destruction.json`, `stage8_2g_c_weapon_visual_profiles.json`, `stage8_2g_c_asset_manifest_check.json`, `stage8_2g_c_seek_determinism.json`, `stage8_2g_c_authority_check.json`, `stage8_2g_c_performance_check.json`
- Selfcheck/delivery: `stage8_2g_c_developer_selfcheck.json`, `STAGE8-2G-C-DELIVERY.md`
- C verifier/test: `tests/verify-stage8-2G-C-evidence.mjs`, `tests/stage8-2G-C-test.mjs`
- Screenshots: `screenshots/stage8-2G-C/`

## Commands and platform

- Node/npm/OS are recorded by the C clean-package runner in `stage8_2g_c_clean_package_test.json`.
- The browser command must fail when Chromium cannot start or navigate; it has no B-stage screenshot fallback.
- The package verifier extracts the ZIP, rejects `.DS_Store`, `__MACOSX`, nested `*.zip`, `node_modules`, `.git`, temporary artifacts/profiles, recomputes Machine/Browser/Environment/Destruction bindings, checks PNG SHA-256, then runs clean `npm install`, C, B regression and `npm test`.
- `packageSha256` is written by the external clean-package report after the final ZIP is built, avoiding self-referential ZIP hashing.

Final package record: `stage8_2g_c_final_package_record.json` (external to the ZIP).
