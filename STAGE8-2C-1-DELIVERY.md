# 《钢铁指令》阶段 8.2C.1 交付说明

## 范围

本轮是 RTS 沙盒集成准备补丁，未延长 35 秒战斗、未接入正式战报，也未修改正式项目。改动集中在 `experiments/battle-sandbox/`，另含本交付说明、`progress.md` 和交付压缩包。

## 已解决问题

- 新增 `sandbox-capture-tools.js` 和 `window.seekSandboxTime(seconds)`：每次从 `SANDBOX_SEED=82021` 全新建 state，以固定逻辑步长推进，最后使用精确剩余时间，钳制到 0～35 秒，返回暂停状态并立即重绘。
- 取帧状态不依赖旧进度、速度、暂停状态，不继承旧粒子或残骸；`render_game_to_text()` 增加单位 `anchor`、`visualCenter` 和 `memberPositions`。
- 步兵/反装甲班的 `visualCenter` 使用成员位置平均值，用于班组弹道目标、尘土、标签和文本查询；车辆视觉中心等于路径锚点。
- 摧毁过渡为 22.72～23.10 秒；过渡结束后 `e_armor_1` 原车体停止绘制，只保留唯一 `wreck_e_armor_1`。
- 坦克二号 30～35 秒最终警戒位调整为 `(815,350)`；通过矩形包围盒检查，与残骸不相交，距残骸中心超过 60px，炮塔仍朝东。
- 新增 `TIME_EPSILON=1e-6`，31.5 秒目标严格为 `captured/progress=1`，35 秒严格为 `ended/time=35`。

## 修改文件清单

沙盒代码：

- `experiments/battle-sandbox/sandbox-capture-tools.js`
- `experiments/battle-sandbox/sandbox-config.js`
- `experiments/battle-sandbox/sandbox-director.js`
- `experiments/battle-sandbox/sandbox-objective-director.js`
- `experiments/battle-sandbox/sandbox-renderer.js`
- `experiments/battle-sandbox/sandbox.js`
- `experiments/battle-sandbox/README.md`

测试与取证：

- `experiments/battle-sandbox/tests/sandbox-integration-readiness-test.mjs`
- `experiments/battle-sandbox/screenshots/capture-manifest.json`
- `experiments/battle-sandbox/screenshots/14-tank-hit-11-5s.png`
- `experiments/battle-sandbox/screenshots/15-infantry-suppressed-12s.png`
- `experiments/battle-sandbox/screenshots/21-short-tracers-fixed.png` ～ `32-final-regroup-35s.png`
- `progress.md`
- `STAGE8-2C-1-DELIVERY.md`

正式 `js/`、`css/`、根 `index.html`、`package.json`、`tests/`、`scripts/` 文件未修改。与上一版 `iron-command-stage8-2C-sandbox.zip` 中的 36 个正式文件逐一 SHA-256 比较：`mismatches=[]`。

## 五组沙盒测试实际输出

```text
sandbox-opening-test: 28 passed
sandbox-opening-patch-test: 30 passed
sandbox-damage-repair-test: 40 passed
sandbox-breakthrough-capture-test: 63 passed
sandbox-integration-readiness-test: 53 passed
```

正式回归：

```text
npm test
588 passed / 0 failed
```

## 精确截图取证

14、15 号截图分别使用 11.50 秒、12.00 秒重新取帧；21～32 使用绝对时间接口重新取帧。`capture-manifest.json` 记录请求时间、实际时间、状态摘要、状态签名和 PNG SHA-256；21～32 的 12 个文件全部不同，实际时间误差均为 0。

| 文件 | 时间 | SHA-256 |
| --- | ---: | --- |
| 21-short-tracers-fixed.png | 8.80 | `9be8931905d157b5962a3b894cca7e35669feecb432ba704d90c60b49c2ea987` |
| 22-repair-spacing-fixed.png | 17.00 | `77eeed615b4a0c9f34501682d766683cc72ed2a296907257474660bba86d6c24` |
| 23-disabled-armor-readable.png | 20.00 | `1f0aa5b1e41095ce09ca3e36fec81c50d5bfdeff24504de8e169e9b76bf1d397` |
| 24-tank-main-gun-22-4s.png | 22.42 | `ec32acfa5abfbc4b8605618cf6369852d202a2e998fb23a1cb5854bdf7bb69b3` |
| 25-enemy-armor-destroyed-22-8s.png | 22.82 | `c33d01cd35b63390e772f5331e6a48ef7834b8801f8d33988d8a553cd65da55f` |
| 26-infantry-bounding-advance-25s.png | 25.20 | `7fe51ac67342d133296330ebb6870c793daa87d92e5981a86578204a61e7f095` |
| 27-enemy-at-retreat-26s.png | 26.20 | `e03f8a8a8a4a14177d025bc502d83ed53e7f0ff14fc14ad42061dbdc35733ea3` |
| 28-defense-collapse-29s.png | 29.00 | `2577edbc829b1eea88ee222761457e543a10aa570c271ffe26396ee8b256ad0f` |
| 29-objective-capturing-30s.png | 30.00 | `b98434040550c107c8ad7a8731103f0ae901d6d1b702662c916ae15eaae55da9` |
| 30-objective-captured-31-6s.png | 31.60 | `863d058abba680b2254043bd2e94cba3c0831e48fa49fd795bf3bb3cebb793af` |
| 31-damaged-tank-rejoining-33s.png | 33.00 | `a54efa613da127fbbd098408d4ccbcd0cefdcebc62b48987670b56e12e6be490` |
| 32-final-regroup-35s.png | 35.00 | `58d5a723fa86ffd26183254dc16eacb9bd50ffba27049ff06147847a0996c90e` |

关键状态：30 号为 `objective=captured`；32 号为 `ended=true`、`objective=captured`、`wreckCount=1`。21、24、26、27、28、29 之间均通过 SHA 验证为不同图片。

## 浏览器人工验收

使用页面公开接口依次执行：

```text
seekSandboxTime(8.8)
seekSandboxTime(17)
seekSandboxTime(20)
seekSandboxTime(22.42)
seekSandboxTime(22.82)
seekSandboxTime(25.2)
seekSandboxTime(26.2)
seekSandboxTime(29)
seekSandboxTime(30)
seekSandboxTime(31.6)
seekSandboxTime(33)
seekSandboxTime(35)
```

每次页面保持暂停且不积累旧效果；HUD 与返回状态时间一致。官方 Playwright 客户端烟雾回归通过，`render_game_to_text()` 正常返回，console error 为 0。35 秒终帧为 `time=35`、`ended=true`、目标已占领、单个装甲残骸，坦克二号未与残骸重叠。

## 尚未解决的问题与 8.2D 预留

本轮未发现 8.2C.1 范围内的功能性遗留问题。仍然保留的边界是：取帧状态和占领结果均为沙盒视觉 director，不写入正式战报、奖励或存档。阶段 8.2D 只预留正式战报映射接口、多目标/多波次配置和更长战斗编排，本轮不实现、不进入 35 秒之后内容。
