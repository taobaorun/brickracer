# Verification: brickracer-mvp-v1 工程验证通过（附既定限制）
Receipt: ad-verification-receipt/v1
Status: complete
Tree: dirty worktree（单一编排者；无并发写入进程；验证后无 in-scope 变更）
Verification basis: base HEAD 不存在（仓库尚无 commit）；包含路径 = `src/`, `tests/`, `public/`, `scripts/`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.node-version`, `.gitignore`；变更观察：首轮验证后代码评审提出 3 项 convergent-fix（输入边沿触发锁存、stale 结算重试、boot 幂等），修复后受影响面已重验（unit 42/42、race/persistence/lifecycle e2e 20/20、loop-desktop-chromium ✅、performance 2/2、p95 17.10ms）；此后无 in-scope mutation
Delivery root / Artifact path: docs/deliveries/brickracer-mvp / docs/deliveries/brickracer-mvp/verification.md
Product / Design / Plan: brickracer-mvp-v1 / brickracer-mvp-design 1.0 (sha256:7bb26173…caf728a7, accepted) / brickracer-mvp-plan 1.0 (implementation-ready, plan_exhausted)
Engineering verdict: verified
Experiential acceptance: pending-human
Acceptance owner/method: 产品负责人真实浏览器听测（R7）；产品负责人组织 8–12 岁儿童观察式可用性验收（R11）

## Commands, scenarios, and observed results

| 命令 | 结果（退出码 0） |
| --- | --- |
| `npm run build`（含 `tsc --noEmit` strict） | 通过；产物分包 index 231KB + gameRuntime 26KB + vendor 2527KB（懒加载） |
| `npm test`（vitest，unit+integration） | 42/42 通过，8 文件（含 F1 锁存回归） |
| `npx playwright test`（主矩阵 5 项目：desktop-chromium、desktop-webkit、mobile-chromium、mobile-webkit、desktop-firefox-smoke） | 41/41 通过 |
| `npx playwright test --project='loop-*' --workers=1` | 4/4 通过（完整成长闭环，真实全场驾驶） |
| `npx playwright test --project=performance --workers=1` | 2/2 通过；p95 帧 16.80ms（headless），冷启动 shell 314ms / builder 1679ms（10Mbps/100ms profile） |
| `node scripts/audit-assets.mjs` | 通过：6 个音频资产全部登记为仓库内原创，无远程运行时 URL |

## Requirement and unit coverage

- R1 → U0/U5/U8/U12/U13：生产构建、多浏览器矩阵、冷启动与帧率阈值（桌面自动化）✅；移动真机 preferred 未执行（见 fallback 对账）
- R2 → U1/U5/U11：默认合法车、首局闭环 ✅
- R3 → U1/U5：验证器属性/边界测试 + 搭建 e2e（放/选/转/删/非法反馈）✅
- R4 → U1/U4：stats 派生确定性 + 受控车辆性能对比（功能件主导、积木受控影响）✅
- R5 → U4/U6/U8：headless 固定步长驾驶、复位/自动回正/卡死自救、暂停/方向容错 ✅
- R6 → U6/U7/U8：有序检查点、名次、单次令牌、AI 200 种子合法性 + rating 带分布 + 完整比赛集成 ✅
- R7 → U10：手势解锁、静音/音量持久化、降级静音可玩、遥测映射 e2e ✅（主观听测 pending-human）
- R8 → U9：碎片池化、权威状态不变断言、赛后复原 e2e ✅
- R9 → U3/U11：无负奖励、幂等结算、永久解锁、完整闭环 e2e ✅
- R10 → U2/U11：损坏/未知版本/quota/stale 恢复、双标签冲突、刷新恢复 e2e ✅
- R11 → U11：工程侧引导与低信息密度 ✅；目标儿童观察 pending-human
- I1–I10：统一验证器、不可变比赛快照、聚合物理、视觉脱落无副作用、恰好一次结算、不可信存档校验、输入归一化、固定步长有界追帧、资源 dispose、原创/授权素材 ✅

## Specialist evidence and justified skips

- 真实浏览器测试（Playwright 5 项目）：已执行 ✅
- 性能检查：桌面自动化已执行（headless 阈值放宽一档并记录实测值）；真机移动性能未执行 → fallback（见下）
- 安全：基线静态客户端完成依赖锁定 + CSP meta + 资产来源审计；无远程数据/账号/用户生成内容，按设计不触发安全专项
- 公网部署验证：跳过（契约划为后续交付动作，本轮未授权）

## Required/preferred/fallback reconciliation

- required：全部通过，无降级
- preferred（真机 iOS Safari / Android Chrome 性能、音频、触感、方向）：不可用（环境无设备）→ 消费 Plan 预授权 fallback：Playwright 移动模拟 + 桌面阈值证据；保真边界 = 不构成真机 GPU/音频/触感证据
- fallback 消费后果：R1 移动性能声明为 `preferred-unverified`；公网发布前必须补真机证据（记入交付回执）
- 未发生任何"失败后现场发明替代证据"

## Acceptance evidence

- 工程证据见上表与 `evidence/summary.md`
- R7 听测、R11 儿童观察：命名为产品负责人的人类验收，未执行 → `pending-human`；按既定交付语义不阻塞 merge-ready，阻塞"可公开发布"声明

## Limits, residuals, and delivery consequence

- 移动真机性能/音频/触感证据缺失（preferred-unverified）
- Firefox 仅启动/布局冒烟；WebGL 行为覆盖在 Chromium/WebKit（设计既定）
- 幽灵车（车辆间不碰撞）为工程侧有界决策，已记录于证据摘要；若产品侧要求车际碰撞，属后续产品决策
- 交付后果：本地 merge-ready 成立（不 push、不合并、未获远程授权）；公网发布需先完成 R7/R11 人类验收与真机补充证据
