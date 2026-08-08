# Verification Evidence: brickracer-mvp-v1
Evidence: ad-work-evidence/v1
Collected: 2026-08-08
Tree state: 未提交（commit policy: delivery-only，待交付阶段建立初始历史）
Design: brickracer-mvp-design/1.0 sha256:7bb26173ece5b4b864134a743d391eb9c8f329d21d8e695e1019268dcaf728a7

## Toolchain

- Node v24.5.0（官方 tarball，/tmp；`engines` 锁定 >=24 <25，`.node-version`=24）
- 依赖经 package-lock.json 锁定确切版本

## Required evidence（全部通过）

| 检查 | 结果 |
| --- | --- |
| 单元+集成测试（Vitest，Node/headless Rapier） | 40/40 通过（7 文件，连续 3 次运行稳定） |
| TypeScript strict typecheck | 通过（含于 build） |
| 生产构建（vite build） | 通过；懒加载分包：index 231KB(gzip 73KB) + gameRuntime 26KB(9KB) + game-runtime vendor 2527KB(879KB)，进入游戏才加载 |
| E2E 主矩阵（desktop-chromium / desktop-webkit / mobile-chromium(Pixel 7) / mobile-webkit(iPhone 14) / firefox smoke） | 41/41 通过 |
| E2E 完整成长闭环 loop-*（4 项目串行） | 4/4 通过：真实管道完赛（~90–120s）→ 积分 → 购买 → 换装 → 再赛 → 刷新恢复 |
| E2E 性能项目（串行） | 通过：满负载比赛 p95 帧时间 16.80ms（headless 环境，断言阈值 33.4ms）；冷启动（10Mbps/100ms）shell 314ms ≤2.5s、可交互 builder 1679ms ≤8s |
| 资产许可审计（scripts/audit-assets.mjs） | 通过：全部音频为仓库内脚本生成原创素材并登记清单，无远程运行时 URL，无第三方品牌资产 |
| CSP | index.html 内置 CSP meta（default-src 'self'，wasm-unsafe-eval 仅供 Rapier WASM） |

## 需求追踪摘要

- R2–R4：blueprint 验证器/属性测试 + builder e2e（放/选/转/删、非法反馈、锁定部件不可装备）
- R5：headless 确定性车辆测试（加速/极速/制动/转向/复位/自动回正）+ race e2e（倒计时/加速/暂停/复位/退出）
- R6：AI 200 种子合法性属性测试、rating 带分布、策展回退；完整比赛集成测试（2 圈、名次、单次结算令牌）+ loop e2e
- R7：音频手势解锁/静音持久化 e2e + 遥测映射单元路径（**听测 pending-human**）
- R8：碰撞碎片集成断言（权威 stats/碰撞体不变、赛后复原）+ e2e 碎片出现/退出清空
- R9：奖励/购买不变量、幂等结算（重复 raceId 拒绝）、完整闭环 e2e
- R10：损坏/未知版本/quota/stale revision 单元测试 + 双标签冲突 e2e + 刷新恢复 e2e
- R11：工程侧引导/低信息密度已实现（onboarding hint、大触控目标、短原因码）；**目标儿童观察验收 pending-human**
- R1：多浏览器矩阵 + 冷启动/帧率阈值（桌面自动化）；**真机 iOS/Android preferred 未执行** → 按 Plan fallback 记录为 preferred-unverified，公网发布前必须补

## Bounded engineering decisions（契约授权范围内）

- 幽灵车决策：车辆间不碰撞（碰撞分组：车↔赛道）。消除起跑堆叠与多车不可恢复卡死；驾驶容错由护轨/复位/自动回正/卡死自救提供。AI 匹配不受影响（rating 带生成）。
- 赛道护轨为内外两道矩形围墙（零缝隙；角落口袋由卡死自救覆盖）。
- 比赛参数（delegated）：2 圈、3 辆 AI、单圈约 40–60s。
- 经济（delegated）：完赛基础 60 分 + 名次奖励（1st +60 / 2nd +35 / 3rd +20）；部件 50–260 分；首场完赛必可购买防撞杠且有结余。
- 音频为仓库内脚本生成的原创 WAV（三层转速循环交叉淡化 + 限频一次性音效），满足 A1/I10。

## Known limitations / honest skips

- 真机 iOS Safari / Android Chrome 性能、音频、触感、方向确认：未执行（环境无设备）→ R1 移动性能声明 preferred-unverified
- 公网部署与公开 URL 验证：契约划为后续交付动作，未授权本轮执行
- R7 主观听测、R11 儿童观察：pending-human，不阻塞 merge-ready，阻塞"可公开发布"声明
- Firefox e2e 仅冒烟（启动/布局）；WebGL 行为覆盖在 Chromium/WebKit（设计既定）
