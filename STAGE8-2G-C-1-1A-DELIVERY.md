# Stage 8.2G-C.1.1a Delivery

本阶段关闭 Visual Alias、Final Screen Metric、Cover Presentation Route 和 Asset Runtime readiness 的证据缺口。

```bash
npm run test:stage8-2G-C-1-1a
npm run browser:stage8-2G-C-1-1a
npm run build:stage8-2G-C-1-1a
npm run verify:stage8-2G-C-1-1a
```

`enemy_at` 归一化为 `anti_armor_infantry`，使用步兵 Renderer family 和敌方程序化阵营表现。Renderer、浏览器证据和验证器消费同一份 `finalDrawGeometry`；掩护推进和撤退使用编舞器明确生成的 presentation route，环境净空审计使用同一路线段。

封包默认验证会安装干净依赖并运行完整 `npm test`；`--skip-full` 仅跳过这两项慢门禁，不跳过证据、篡改、历史 C/B 回归或 hygiene。
