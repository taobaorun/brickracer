# Implementation Plan: brickracer 一期可公开试玩 MVP
Plan: ad-implementation-plan/v1
Status: implementation-ready
Identity: brickracer-mvp-plan / 1.0
Delivery root: docs/deliveries/brickracer-mvp
Artifact path: docs/deliveries/brickracer-mvp/plan.md
Product Contract: brickracer-mvp-v1 (`contract.md`)
Technical Design: brickracer-mvp-design / 1.0, accepted, digest sha256:7bb26173ece5b4b864134a743d391eb9c8f329d21d8e695e1019268dcaf728a7 (`design.md`; `design-review.md` verdict ready at current digest)
Commit policy: `delivery-only` — 执行期间不做本地 commit；交付阶段一次性建立初始 git 历史。Authority: ad-lfg 授权信封默认值（本地 commit 权限模糊、交付 commit 权限存在时的规则默认值）。
Terminal state: `merge-ready`（不 push、不合并、不部署；公网托管是契约定义的后续独立交付动作）

## Baseline and environment contract

- 仓库基线为空白：无源码、无构建、无 commit。所有单元在新建的 `src/`、`tests/`、`public/` 树内工作，不触碰 `docs/` 交付根以外的既有文件。
- 基线检查（每个单元完成后必须全绿）：`npm run typecheck`（tsc strict，无 emit）、`npm run test`（Vitest 单元+集成）、`npm run build`（Vite 生产构建）。引入 Playwright 后增加对应 e2e 项目。
- 环境前置（U0 的一部分）：本机 Node 为 23.11.0（EOL），设计基线要求 Node 24 LTS。通过 Homebrew 安装 `node@24` 并使 `node` 指向 24.x；仓库内以 `package.json engines` + `.node-version` 锁定。若安装被拒绝或失败 → Hard Blocker（environment）。
- 所有依赖锁定确切版本并提交 lockfile（交付时）。

## Implementation units

设计强制约束：第一个执行单元之后、内容密集工作之前，必须证明最小垂直车辆切片（U4）。U4 的 Rapier 车辆接缝失败将把设计退回 revision，而不是触发计划外重写。

### U0 — 工具链与骨架
- Traces: R1（可构建、可部署静态客户端的工具链前提）
- Modules: 仓库根 `package.json`/`tsconfig`/`vite.config`/`.node-version`、`src/app/` 最小 React shell、`tests/e2e/` Playwright 配置骨架
- Depends on: 无
- 交付行为：`npm create` 非交互脚手架 → typecheck/test/build 全绿；Playwright 可启动并渲染占位 shell；`engines` 拒绝 Node 23
- Verification (required): 干净 `npm ci` 后 typecheck + build 通过；Playwright chromium 项目加载 shell 并断言根节点可见
- 恢复边界：删除全部生成文件即回滚

### U1 — 蓝图领域与内容目录
- Traces: R2（默认基础车）、R3（受约束搭建规则）、R4（性能派生）
- Modules: `src/domain/blueprint/`（schema、placement commands、validator、stats）、`src/content/`（积木/功能件目录、默认蓝图）
- Depends on: U0
- 交付行为：统一纯函数验证器（网格、重叠、禁区、连通性、功能槽、上限）；默认蓝图合法；stats 派生确定
- Verification (required): Vitest 单元 + 属性/边界测试（放置、重叠、悬空、非法槽位、坐标/数量上限）；默认蓝图通过验证且含全部必要核心件
- 恢复边界：单元新增文件独立，删除即回滚

### U2 — 存档与持久化恢复
- Traces: R10（本地保存/恢复）、R9（积分持久性前提）、I5/I6
- Modules: `src/domain/save/`（V1 schema、运行时验证、迁移失败关闭策略）、`src/infrastructure/`（localStorage 适配器、主/备键、revision 校验事务、`storage` 事件 stale 标记）
- Depends on: U1（蓝图 schema）
- 交付行为：加载校验版本/字段/ID/范围；写前复制备份；revision 单调；stale 写拒绝并回载；quota/安全异常降级为“进度未保存”且可继续游玩
- Verification (required): Vitest 覆盖损坏 JSON、未知新版 schema、quota 拒绝、stale revision、主备回退、默认值生成
- Fallback（见下文 Evidence roles）：两标签页冲突以 Playwright `browser.newContext()` 双页面模拟

### U3 — 成长经济
- Traces: R9（无负循环、永久解锁、幂等结算）
- Modules: `src/domain/progression/`（奖励计算、购买事务、`applyResult` 幂等 + `lastAppliedRaceId`）
- Depends on: U1、U2
- 交付行为：完赛基础分 + 名次奖励，永不为负；同一 raceId 拒绝重复结算；购买校验余额与目录，部件永久可复用
- Verification (required): 奖励/购买不变量单元测试（含重复 raceId、负奖励注入、余额不足）

### U4 — 最小垂直车辆切片（设计接缝证明）
- Traces: R4（受控车辆确定性性能对比）、R5（实时驾驶手感前提）、I3/I7/I8/I9
- Modules: `src/game/physics/`（Rapier facade）、`src/game/vehicle/`（蓝图→聚合底盘编译）、`src/game/runtime/`（固定步长循环）、`src/game/rendering/`（最小 Three 场景）、`src/input/`（归一化输入）
- Depends on: U1
- 交付行为：默认蓝图编译为单聚合刚体 + `DynamicRayCastVehicleController`；60 Hz 固定步长 + 有界累加器；归一化输入驱动引擎/转向/刹车；headless 下确定性可测
- Verification (required): Vitest Node 环境 headless Rapier 集成测试——固定种子/步长下直线加速、制动距离、转向响应确定；资源 dispose 后 body/listener 计数归零
- **Gate**: Rapier 车辆接缝若不可用或不可控 → 设计退回 revision（Hard Blocker 路径），不得即兴更换物理方案
- 恢复边界：`src/game/` 内新增文件，删除即回滚

### U5 — 搭建器 UI 与交互
- Traces: R2、R3（吸附/移除/槽位/合法性反馈）、R1（桌面+触控）
- Modules: `src/ui/builder/`、`src/app/`（状态机 builder 段）、渲染实例更新
- Depends on: U1、U4（渲染/输入接缝）
- 交付行为：raycast 拾取 → 领域命令 → reducer 吸附与校验 → 非法返回 reason code 图标/文本反馈；合法更新实例并防抖保存；“开始比赛”前全量校验
- Verification (required): Vitest reducer 命令测试；Playwright 桌面 chromium + 移动触控模拟项目完成放置/移除/换装/非法反馈
- Verification (preferred): 双方向（竖/横屏）布局无阻断（设计 D2）

### U6 — 赛道与比赛领域
- Traces: R5（复位/回正）、R6（默认赛道、名次、结算）
- Modules: `src/content/track-brickway-1`、`src/domain/race/`（倒计时、有序检查点、圈数、名次、单次结算令牌）、运行时复位/自动回正
- Depends on: U4
- 交付行为：固定赛道定义生成网格/碰撞体；检查点有序通过为唯一计圈权威；低速翻倒计时后自动回正；手动复位回最近检查点并短暂锁输入
- Verification (required): 集成测试——跳检查点不计圈、完赛名次确定、复位清速度、自动回正触发条件

### U7 — AI 对手
- Traces: R6（随机外观/配置、实力匹配、不预定胜负）
- Modules: `src/game/ai/`（种子蓝图生成器 + 中线 lookahead 驾驶员）
- Depends on: U1、U6
- 交付行为：从默认核心出发、仅用 AI 可用内容、按玩家 rating 目标带生成并经共享验证器校验；有界重试后回退策展蓝图；驾驶员产出与玩家相同的归一化输入
- Verification (required): 属性测试（N 个种子全部合法）；分布测试（低/中/高玩家 rating 下 AI 完赛时间分布不交叠成必胜/必败）；源码断言 AI 路径不可修改玩家物理

### U8 — 比赛运行时整合与 HUD
- Traces: R5、R6、R1（移动端方向/暂停）
- Modules: `src/game/runtime/`（RuntimeSnapshot 节流 + RuntimeEvent 无损通道）、`src/ui/race-hud/`、`src/app/` 完整比赛状态机、致命错误恢复
- Depends on: U4、U6、U7
- 交付行为：loading→countdown→racing⇄paused→results 全链路；竖屏暂停+旋转提示；fatalError 放弃未结算结果并回 builder
- Verification (required): Playwright 完整比赛 journey（桌面 + 移动模拟）；`raceFinished` 恰好一次；暂停/旋转/退出控制可用

### U9 — 碰撞飞散
- Traces: R8、I4
- Modules: `src/game/rendering/fragments`（池化视觉碎片）、碰撞事件阈值/冷却
- Depends on: U8
- 交付行为：硬碰撞隐藏有界装饰实例并生成短生命周期碎片；核心/功能件永不脱落；比赛停止全部复原；碎片不进碰撞组、不进存档
- Verification (required): 集成测试——碰撞前后权威 stats/碰撞体数不变、蓝图不变、退出后实例复原；E2E 视觉断言碎片出现

### U10 — 音频
- Traces: R7、I10、A1（授权素材）
- Modules: `src/game/audio/`（Web Audio 图、引擎循环交叉淡化、碰撞一次性音效、主增益）、资产清单（origin/license）
- Depends on: U8
- 交付行为：首次手势后 unlock；速度/油门平滑映射音高/音量；静音/音量持久化；解码失败降级为静音可玩
- Verification (required): 浏览器测试——手势门控、静音状态、遥测映射单元测试；资产清单许可审计
- Verification (experiential, pending-human): 产品负责人真实听测验收 — 永不自动升级为 accepted

### U11 — 结算/商店/引导/设置与完整闭环
- Traces: R9（得分→购买→换装→再赛）、R11 工程侧（游戏内引导/低信息密度）、R2（新玩家起点）
- Modules: `src/ui/results/`、`src/ui/shop/`、`src/ui/onboarding/`、`src/ui/settings/`
- Depends on: U3、U8、U9
- 交付行为：结果页在结算持久化后才暴露购买；商店永久解锁并可重复装备；新手引导覆盖搭车→比赛→得分→购买→改车→再赛；设置含音量/静音/画质
- Verification (required): Playwright 全流程闭环 E2E（首局默认车完赛 → 得分 → 购买 → 换装 → 再赛），刷新后进度恢复（R10 E2E 段）
- Verification (experiential, pending-human): R11 产品负责人组织 8–12 岁儿童观察式验收 — 工程证据不可替代

### U12 — 性能与画质分级
- Traces: R1（帧预算、冷启动预算）、设计性能策略
- Modules: 画质分级（DPR 上限/阴影/粒子/抗锯齿）、开发诊断计数器、实例化与池化审计
- Depends on: U9（满负载场景就绪）
- 交付行为：代表性满负载比赛（最大积木预算 + 满编 AI + 碎片池峰值）预热 15s 后测 60s：桌面 p95 ≤16.7ms、移动 ≤33.3ms、物理积压 ≤2 步；冷启动（10Mbps/100ms）shell ≤2.5s、可交互 builder ≤8s；画质调节不触物理/奖励/AI/检查点
- Verification (required): 桌面性能场景自动化 + 冷启动节流 profile 检查
- Verification (preferred): 真机 iOS Safari + Android Chrome 性能与操控确认
- Fallback: 无真机时以 Playwright 移动模拟 + 桌面阈值证据交付，R1 移动性能声明保持 `preferred-unverified` 并记入交付回执（权威：契约授权默认值 + 设计浏览器矩阵；后果：不构成 R1 完全验证声明，公网发布前必须补真机证据）

### U13 — 发布硬化与交付
- Traces: R1（多浏览器、公开入口前提）、全部回归
- Modules: Playwright 全矩阵（chromium/webkit/firefox + 双移动模拟）、资产许可终审、生产构建产物
- Depends on: 全部前置单元
- 交付行为：干净安装 → typecheck → 单元/集成 → e2e 全矩阵 → 生产构建全绿；许可清单无未知来源资产；按 `delivery-only` 策略建立初始 git 历史
- Verification (required): 上述全量回归 + 构建产物静态可服务性冒烟
- Honest skips: 公网部署与 URL 验证（契约划为后续交付动作）；真机测试按 U12 fallback 规则

## Evidence roles

| 角色 | 内容 |
| --- | --- |
| required | 各单元标注的自动化测试（Vitest 单元/集成、Playwright e2e）、typecheck、生产构建、资产许可审计、桌面性能与冷启动阈值 |
| preferred | 真机 iOS Safari / Android Chrome 的性能、音频、触感与方向确认（U5/U10/U12） |
| fallback | U12 定义的移动模拟替代路径，含保真边界与交付后果；除此之外不允许任何证据降级——ad-verify 不得在观察到失败后现场发明替代证据 |

Experiential acceptance（永远保持 pending-human，不阻塞 merge-ready，但阻塞“可公开发布”声明）：
- R7 听测 — 产品负责人，真实浏览器听测
- R11 儿童可用性 — 产品负责人组织 8–12 岁目标玩家观察式验收

## Recovery and completion

- 检查点边界 = 单元。仓库无中间 commit（delivery-only 策略）：每单元新增/修改文件集中在其模块路径内，回滚 = 删除/还原该单元文件（`git status` 未跟踪清单即影响面）。禁止任何 force/reset 操作。
- 普通实现/测试失败在单元内修复重试；U4 接缝失败走设计 revision Hard Blocker；契约冲突退回 ad-align。
- 每次树变更后，既有验证证据作废并重跑受影响检查。
- Definition of Done: U0–U13 全部 required 证据通过；最终全量回归通过；证据（测试报告、性能数据、许可清单）发布到 `docs/deliveries/brickracer-mvp/evidence/`；初始 git 历史建立；交付回执注明 pending-human 项（R7/R11）、preferred-unverified 项（真机，若 fallback 生效）与 deferred 相邻工作。

## Deferred adjacent work（不在本交付）

更多赛道、多人、账号/云同步、方案分享、深度调校、运营内容、商业化；公网托管与域名（后续独立交付，需另行授权）。
