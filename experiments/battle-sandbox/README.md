# 阶段8.2C：独立固定 RTS 战斗沙盒

这是与正式《钢铁指令》战斗求解器、结算、存档、经济、科研和编队系统隔离的 Canvas 视觉实验。场景覆盖 0～35 秒的公路遭遇战：前 10 秒侦察与展开，10～20 秒呈现装甲受损、步兵受压换位、维修车前出与战地维修，20～35 秒呈现突破、防线崩溃、目标占领和重新集结。

## 启动

在项目根目录运行：

```bash
npm start
```

打开 <http://127.0.0.1:8000/experiments/battle-sandbox/>。

## 控制

- 播放 / 暂停、重新开始
- 0.5×、1×、2×播放速度
- 显示 / 隐藏简洁 HUD
- `Space` 暂停/继续，`R` 重新开始，`F` 尝试全屏

35 秒时场景自动暂停；受损、后撤、维修、disabled、突破、占领和重新集结仅为视觉状态，不写入正式战斗或存档。

## 文件边界

`sandbox-config.js` 保存固定世界、单位和时间轴；`sandbox-director.js` 只推进确定性视觉状态；`sandbox-renderer.js` 只负责 Canvas 绘制；`sandbox-camera.js` 只负责镜头；`sandbox-assets.js` 提供程序绘制 Sprite 缓存；`sandbox.js` 负责循环与控件。

沙盒不读取或写入正式存档，也没有引用正式项目的 `js/` 或 `css/` 文件。

## 自动测试

```bash
node experiments/battle-sandbox/tests/sandbox-opening-test.mjs
node experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs
node experiments/battle-sandbox/tests/sandbox-damage-repair-test.mjs
node experiments/battle-sandbox/tests/sandbox-breakthrough-capture-test.mjs
```

阶段8.2A.1 增量修补包括：`f_inf_2` 主动 `suppressing` 状态、固定种子子脉冲调度、敌军独立分批暴露、维修车 9.9 秒仍移动/10 秒才 holding，以及四组独立掩体战位和前后分层绘制。原 01～06 截图保留，并新增 07～12 截图。

阶段8.2B 增量包括：`f_tank_1` 在 11.45 秒被敌方 AT 火箭命中后保留为受损单位并沿后撤路径移动；`f_inf_1` 从压制转为两个小组错峰换位至第二掩体；`f_repair_1` 在 12～16.2 秒前出并于 16.2 秒进入工作距离，焊接火花与工作灯持续出现；`f_at_1` 在 16.9 秒向 `e_armor_2` 发射曲线火箭，17.55 秒命中并使其在 19.5 秒 disabled。所有视觉计划均由固定种子驱动，并提供损伤模型与维修 director 的单元测试。

阶段8.2C 增量包括：修复曳光弹过短、焊接接触点与维修车间距、disabled 轻装甲可读性；`f_tank_2` 在 22.35 秒主炮射击并于 22.72 秒摧毁 `e_armor_1`，保留残骸、烟尘和灼痕；敌方 AT 与步兵在 24～30 秒分批撤退，友方步兵在 23.8～31.5 秒推进至目标；目标点 28 秒进入 contested，31.5 秒 captured，受损坦克随后重新加入西侧集结线。

后段截图：`13-enemy-at-aiming-10-6s.png` 至 `20-stabilized-and-disabled-20s.png`，以及本阶段新增的 `21-short-tracers-fixed.png` 至 `32-final-regroup-35s.png`。`render_game_to_text()` 返回 `stage8.2C`、时间、结束状态、单位状态、视觉损伤、目标点、残骸、灼痕、活动脉冲来源和效果类型，浏览器回归使用 `window.advanceTime` 与固定截图采集验证。

### 阶段8.2C.1 集成准备补丁

新增 `sandbox-capture-tools.js` 与 `window.seekSandboxTime(seconds)`：每次从固定种子新建状态，使用固定逻辑步长和精确剩余步推进，返回暂停状态并立即重绘。单位状态同时保留路径锚点与 `visualCenter`；步兵中心由成员位置平均得到，车辆中心回退为锚点。摧毁过渡结束后原单位停止绘制，仅保留唯一残骸；坦克二号最终警戒位调整至 `(815,350)`，与残骸包围盒分离。占领和 35 秒结束统一使用 `TIME_EPSILON=1e-6`。

取帧清单位于 `screenshots/capture-manifest.json`，21～32 号截图使用绝对时间 8.8、17、20、22.42、22.82、25.2、26.2、29、30、31.6、33、35 秒重新生成，12 个 PNG SHA-256 全部不同。新增测试 `sandbox-integration-readiness-test.mjs`。

### 阶段8.2D-A 战报契约适配实验

本增量仍是独立实验，不改动正式 `js/`、`css/`、根 `index.html`、正式测试或 Canvas 战斗渲染器。适配器将正式 `simulateBattle()` 的真实报告归一化为稳定的演员、事件、结果和权威锚点契约，并确定性绑定战术角色；它不生成坐标、不读取 Canvas 状态、不写存档，也不使用 `Math.random` / `Date.now` 生成契约。

启动项目本地服务器后打开：

<http://127.0.0.1:8000/experiments/battle-sandbox/report-adapter/fixture-viewer.html>

查看器只读加载 `fixtures/`，通过 `window.selectFixture(id)` 切换四份真实战报，通过 `window.render_contract_to_text()` 返回当前契约摘要。四份 fixture 分别覆盖 campaign victory、campaign withdraw、campaign wiped 和 operation result；由 `fixture-generator.mjs` 从正式求解器生成并重算比对。

适配器自动测试：

~~~bash
node experiments/battle-sandbox/tests/sandbox-report-adapter-test.mjs
node experiments/battle-sandbox/report-adapter/fixture-generator.mjs
~~~

本阶段只交付“正式战报 → 35 秒演出契约”的数据准备层；8.2D-B 才预留把契约接入 35 秒模板的工作。

### 阶段8.2D-B 真实胜利战报驱动 35 秒演出

新增隔离入口：

<http://127.0.0.1:8000/experiments/battle-sandbox/contract-demo/>

页面只加载 `campaign-victory.json`，严格执行 `fixture → buildPresentationContract → template slots → authority anchors → Canvas` 链路。真实演员为 6 个友军和 6 个敌军：1 普通步兵、1 反装甲班、1 侦察车、2 主战坦克、1 维修车，对阵 4 步兵和 2 反装甲组；不存在敌装甲演员或第二普通步兵班。

演示提供播放/暂停、重新开始、0.5×/1×/2×、HUD 和默认关闭的权威调试层。`window.seekContractDemoTime(seconds)` 从新 Fixture 和契约以固定逻辑步长精确取帧；`window.render_contract_demo_to_text()` 返回演员 HP/alive、authority anchor 覆盖、目标占领、残骸和错误。35 秒最终为 `victory`、`captured`，领头坦克永久摧毁、支援坦克 123/160、维修车 32/110。

新增文件位于 `contract-demo/`，包括时间映射、槽位解析、计划构建、权威状态、效果、移动、镜头、渲染和取帧工具；截图与 `capture-manifest.json` 位于 `contract-demo/screenshots/`。独立测试：

```bash
node experiments/battle-sandbox/tests/contract-driven-victory-demo-test.mjs
```

本阶段仍不接入正式 `main.js`、正式战斗 renderer、结算、资源或存档。

### 阶段8.2D-B.1 契约演出视觉完整性修补

在 B 的真实胜利战报演示上新增确定性维修编排、视觉包围盒校验、短弹道几何和独立表现状态解析。维修车按真实 repair anchors 前出、接触、工作、撤回；机械臂端点与焊接火花绑定真实接触点。所有弹道亮段限制在 40 px 内，35 秒时临时受击/维修/压制/开火状态全部收束。新增 `window.seekContractDemoTime(seconds)` 精确取帧覆盖的 11～15 号截图，以及 `contract-demo-visual-integrity-test.mjs`。

### 阶段8.2D-A.1 一致性与身份加固

新增 `fixture-manifest.json`、`fixture-integrity.js` 和 `schema.js`。Fixture 生成器现在明确区分：

~~~bash
node experiments/battle-sandbox/report-adapter/fixture-generator.mjs --check
node experiments/battle-sandbox/report-adapter/fixture-generator.mjs --write
~~~

`--check` 只读比较当前正式 solver 重建结果、磁盘 Fixture、`index.json` 和 Manifest；`--write` 先写临时目录、完整验证后再原子替换。Manifest 同时保存 Fixture 统计、scenario/report/file hash 和正式战斗输入边界 hash。

契约 Schema 固定为整数 `contractVersion: 1`，`templateId` 只存在于 `presentation.templateId`。归一化会保留 duplicate actor、初末集合缺失、身份字段变化、基础属性变化和非法元数据错误；严格结果校验要求 victory/pyrrhic 的敌方可战斗单位数为 0。新增 `sandbox-report-adapter-integrity-test.mjs` 覆盖这些完整性边界。
