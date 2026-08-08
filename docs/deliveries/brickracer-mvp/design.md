# Technical Design: brickracer 一期可公开试玩 MVP
Design: ad-technical-design/v1
Design ID / version: brickracer-mvp-design / 1.0
Status: review-ready
Content digest: sha256:7bb26173ece5b4b864134a743d391eb9c8f329d21d8e695e1019268dcaf728a7
Semantic content boundary: 从 `## Current behavior, constraints, and invariants` 到 `## Open technical decisions`（含首尾标题）的 UTF-8 字节；不包含本元数据块
Delivery root: docs/deliveries/brickracer-mvp
Artifact path: docs/deliveries/brickracer-mvp/design.md
Product Contract: brickracer-mvp-v1 (`docs/deliveries/brickracer-mvp/contract.md`)
Requirements: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11
Review / acceptance / Plan: `design-review.md` ready for current digest / accepted by product-design authority 2026-08-08 (ad-lfg envelope) / `plan.md` implementation-ready

## Current behavior, constraints, and invariants

### Current baseline

- 仓库没有应用代码、构建系统、测试、历史版本或兼容接口；现有持久产物只有已确认的产品契约。
- 产品必须作为静态可部署的客户端网页运行，不依赖账号、后端、远程存档、社交或商业化服务。
- 首版需要同时覆盖桌面与移动浏览器，并在同一套领域规则上提供鼠标/键盘与触控输入。
- 游戏同时包含高频实时循环与低频界面状态。渲染、物理和音频不能依赖 React 每帧重渲染；React 也不能成为物理状态的权威来源。
- 一期存档只包含单个玩家的赛车蓝图、积分、永久解锁部件、设置和新手引导状态，规模很小。

### Design Gate result

正式技术方案是必需的：本交付会建立 UI、3D 渲染、物理、车辆控制、AI、音频、进度和持久化之间的模块边界，引入新的运行时状态机与版本化存档结构，并存在逐积木物理与聚合车辆物理等具有显著性能和产品风险差异的方案。

### Invariants

- I1 — `VehicleBlueprint` 只有通过统一验证器后才能保存、进入比赛或交给 AI；基础底盘、基础动力能力和必要功能槽始终存在。
- I2 — 比赛开始时从当前蓝图生成不可变的 `RaceVehicleSpec`。比赛中的视觉脱落、暂停、复位或结果结算不得反向修改玩家蓝图。
- I3 — 车辆动力学使用一个聚合底盘刚体和轮胎射线控制器；普通积木通过总质量、重心偏移和视觉外形影响车辆，不创建持续存在的逐积木竞赛刚体。
- I4 — 装饰积木脱落只改变当场视觉实例。它不改变权威车辆质量、碰撞体、性能、存档或赛后蓝图。
- I5 — 一次比赛结果最多结算一次，奖励永不为负；失败、复位和浏览器重载都不能重复发奖或扣除积分。
- I6 — 存档被视为不可信输入。加载时必须校验版本、字段、部件 ID、积木坐标和数值范围；无效主存档只能回退到有效备份或安全默认值。
- I7 — 键盘、鼠标、指针和触控都先转换为同一组领域动作；车辆、搭建和经济规则不得按输入设备分叉。
- I8 — 物理以固定时间步推进，渲染按显示帧率插值。后台切换或低帧率不得让模拟无限追帧、奖励重复或车辆穿越赛道。
- I9 — 所有运行时资源都有明确所有者和 `dispose` 生命周期，包括 Three.js 几何体/材质、Rapier 世界、事件监听器、动画帧、音频节点和临时碎片池。
- I10 — 所有积木、模型、纹理和音频使用原创或已获授权的素材，不依赖第三方积木品牌身份。

## Proposed structure and responsibilities

### Technology baseline

| Concern | Decision | Boundary |
| --- | --- | --- |
| Language and toolchain | TypeScript strict mode、Node.js 24 LTS、npm lockfile、Vite | Node 23 已终止支持，不作为开发或 CI 基线；所有依赖锁定确切版本，不使用浮动安装结果 |
| UI shell | React | 负责页面、HUD、商店、引导、设置与低频应用状态；不保存逐帧物理状态 |
| 3D rendering | Three.js `WebGLRenderer` | 一个受控 canvas；积木优先使用共享几何/材质与 `InstancedMesh`，通过资源注册表统一释放 |
| Physics | `@dimforge/rapier3d` WebAssembly，通过本项目 facade 使用 `DynamicRayCastVehicleController` | Rapier 类型和 handle 不泄漏到领域、UI、存档或内容层；异步加载失败有可恢复错误界面 |
| Audio | 原生 Web Audio API 加同源、已授权的短循环与一次性音效 | 首次用户手势后创建或恢复 `AudioContext`；静音和音量由 UI 控制并持久化 |
| Persistence | 版本化 JSON + `localStorage` 主/备份键 | 只在稳定领域事件上写入，不在渲染或物理循环内同步写入 |
| Unit/integration tests | Vitest，Node 环境为主 | 纯领域逻辑和 headless Rapier 集成使用确定种子与固定步长 |
| Browser tests | Playwright Chromium/WebKit/Firefox 项目与移动设备模拟 | 覆盖真实 DOM、WebGL 启动、布局、输入和核心闭环；真实手机负责 GPU、音频与触感确认 |

选择 Node.js 24 LTS 是一项工具链约束：当前机器的 Node 23.11.0 已属于 EOL 线，且当前测试工具并不声明支持 Node 23。实现阶段必须通过 `engines` 和一个仓库内版本文件让本地与 CI 一致。

### Proposed source layout

```text
src/
  app/                 # React shell, application state machine, composition root
  domain/
    blueprint/         # vehicle schema, placement commands, validation, stats
    progression/       # catalog, rewards, unlock/purchase rules
    race/              # race config/result/checkpoint/lap rules
    save/              # versioned save schema and recovery policy
  game/
    runtime/           # fixed-step loop, lifecycle, snapshots
    rendering/         # Three scene, cameras, instancing, quality tiers
    physics/           # Rapier facade, world, collisions, vehicle adapter
    vehicle/           # blueprint -> aggregate race vehicle compilation
    ai/                # seeded blueprint generation and racing driver
    audio/             # Web Audio graph and vehicle/event sonification
  content/             # immutable part catalog, colors, one track definition
  input/               # keyboard/pointer/touch -> normalized actions
  ui/                  # builder, race HUD, results, shop, settings, onboarding
  infrastructure/      # localStorage adapter, asset loading, diagnostics
tests/
  unit/                # pure domain and state-machine checks
  integration/         # headless physics/AI/save integration
  e2e/                 # Playwright desktop/mobile journeys
public/
  audio/               # licensed engine loops and event sounds
  textures/            # original or licensed texture assets if needed
```

### Responsibility boundaries

1. **`AppController`** owns the low-frequency application state machine and is the only authority allowed to enter or leave builder, race, results and shop states. React renders its immutable snapshots and sends commands back.
2. **Blueprint domain** owns legal grid placement, connectivity, overlap, restricted zones, functional slots and derived vehicle stats. It contains no Three.js or Rapier objects, so the same validator serves the player, AI generator, save loader and tests.
3. **`GameRuntime`** owns `requestAnimationFrame`, the fixed-step accumulator, active Three scene, Rapier world and current input snapshot. It publishes throttled HUD snapshots rather than raw frame objects.
4. **Vehicle compiler** converts one validated blueprint into two products: render instances and one aggregate physics specification. It computes mass and center of mass from ordinary bricks, then applies functional-part tuning for engine force, grip, braking and steering.
5. **Race domain** owns countdown, ordered checkpoints, laps, finish order, reset eligibility and the single-use result token. It receives observations from the runtime but contains no rendering code.
6. **AI** has two independent stages: a seeded legal blueprint generator constrained by a target rating band, and a driver that converts fixed-track look-ahead targets into the same normalized steering/throttle/brake actions used by the player.
7. **Progression** is a pure transaction boundary. It calculates non-negative rewards and validates permanent unlock purchases before producing a new save snapshot.
8. **Persistence adapter** serializes only durable domain values. Runtime handles, animation state, detached fragments, AI transient state and current race physics are never saved.
9. **Audio engine** consumes a small `AudioTelemetry` snapshot and semantic events. It never reads Rapier or React state directly.
10. **Content definitions** are immutable, typed and imported by ID. The single track, part catalog, default blueprint and progression table are reviewed content, not user-generated data.
11. **Asset loader** owns phase-specific module and asset loading, visible progress, same-origin URL resolution and cache-safe failure/retry. UI, runtime and audio request named asset groups instead of fetching arbitrary URLs.

## Interfaces and data/control flow

### Durable domain shapes

```ts
type QuarterTurn = 0 | 1 | 2 | 3;

interface GridPosition {
  x: number;
  y: number;
  z: number;
}

interface BrickPlacement {
  instanceId: string;
  brickTypeId: string;
  colorId: string;
  position: GridPosition;
  rotation: QuarterTurn;
}

interface FunctionalSlots {
  engineId: string;
  wheelSetId: string;
  aeroId?: string;
  bumperId?: string;
}

interface VehicleBlueprint {
  schemaVersion: 1;
  bricks: BrickPlacement[];
  slots: FunctionalSlots;
}

interface VehicleStats {
  mass: number;
  centerOfMass: { x: number; y: number; z: number };
  acceleration: number;
  topSpeed: number;
  grip: number;
  braking: number;
  stability: number;
  matchmakingRating: number;
}

interface SaveGameV1 {
  schemaVersion: 1;
  revision: number;
  points: number;
  unlockedPartIds: string[];
  activeBlueprint: VehicleBlueprint;
  settings: { masterVolume: number; muted: boolean; quality: "auto" | "low" | "high" };
  onboarding: { completedSteps: string[] };
  lastAppliedRaceId?: string;
}
```

坐标、数值、字符串长度、数组数量和引用 ID 均有上限。TypeScript 类型只提供开发期约束，运行时加载仍经过显式验证。存档不包含自由文本、HTML、远程 URL 或可执行内容。

### Runtime contracts

```ts
interface NormalizedInput {
  steer: number;     // -1..1
  throttle: number;  // 0..1
  brake: number;     // 0..1
  resetPressed: boolean;
  pausePressed: boolean;
}

interface RaceConfig {
  raceId: string;
  trackId: "brickway-1";
  laps: number;
  aiCount: number;
  seed: number;
  player: VehicleBlueprint;
}

interface RuntimeSnapshot {
  speed: number;
  lap: number;
  position: number;
  countdownMs: number;
  racePhase: "loading" | "countdown" | "racing" | "finished" | "paused";
  canReset: boolean;
}

type RuntimeEvent =
  | {
      type: "raceFinished";
      result: {
        raceId: string;
        place: number;
        totalRacers: number;
        finishTimeMs: number;
        bestLapMs: number;
      };
    }
  | { type: "fatalError"; code: string; recoverTo: "builder" | "boot" };

interface GameRuntime {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  showBuilder(blueprint: VehicleBlueprint): void;
  startRace(config: RaceConfig): Promise<void>;
  updateInput(input: NormalizedInput): void;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeEvents(listener: (event: RuntimeEvent) => void): () => void;
  stopActiveMode(): void;
  dispose(): void;
}
```

The runtime exposes plain data and commands. Throttled snapshots drive HUD rendering; lossless typed events drive exactly-once settlement and fatal-error recovery. React never retains mutable Three/Rapier objects, and render/physics modules never import React.

### Application lifecycle

```text
boot
  -> loading-save-and-capabilities
  -> builder
  -> race-loading
  -> countdown
  -> racing <-> paused
  -> results
  -> shop
  -> builder
```

- `boot` loads and validates the main save, falls back to backup, then creates a default save if both fail.
- The initial HTML/React shell contains only navigation, save/capability checks and loading/error UI. Three.js, Rapier and race content are code-split into a game-runtime chunk loaded when the builder is entered; audio files are fetched/decoded only after the player enables sound or starts a race.
- 3D and Rapier initialize asynchronously behind asset-group progress. WebGL/WASM/module/asset failure leads to an actionable unsupported/retry screen, not a blank canvas; a retry first disposes the partial group.
- Runtime assets use hashed, same-origin production URLs with long-lived immutable caching. No cross-origin runtime CDN is required; deployment rollback selects a complete previous artifact rather than mixing asset versions.
- Starting a race first validates and snapshots the blueprint, creates a `RaceConfig` with a unique ID and seed, then disables builder mutations until the race ends.
- Results are calculated from immutable race facts. `Progression.applyResult` refuses a race ID already present in `lastAppliedRaceId`; the new reward state is persisted before the results screen exposes purchase actions.
- Returning to the builder tears down race-only physics bodies, AI drivers and fragments while retaining reusable renderer assets where safe.

### Builder flow

1. Pointer or touch hits a visible placement plane/brick using Three.js raycasting.
2. The input adapter emits a domain command such as `placeBrick`, `removeBrick`, `rotatePreview` or `equipPart`.
3. The blueprint reducer snaps to integer grid coordinates and runs overlap, restricted-zone, bounds and connectivity checks.
4. An invalid command leaves the authoritative blueprint unchanged and returns a short reason code for icon/text feedback.
5. A valid command creates a new blueprint value, recomputes derived stats, updates render instances and schedules a debounced save.
6. “开始比赛” performs full validation once more; only a valid result can cross into race loading.

Connectivity is calculated as a graph from the immutable chassis anchor through face-compatible brick cells. Functional slots use named chassis anchors rather than arbitrary grid positions. Rendering helpers may cache occupancy maps, but the validator remains the authority.

The builder and non-race screens remain usable in both portrait and landscape orientations. The race presentation targets landscape so steering and pedals retain large touch areas. Entering or rotating to portrait pauses active driving and shows an in-app rotation prompt; resume, mute/settings and exit-to-builder remain reachable without relying on the Screen Orientation API.

### Vehicle physics and rendering flow

- The compiler turns a valid blueprint into one dynamic chassis body with a bounded set of simple compound colliders. Decorative studs and fine brick detail remain visual and do not become collision shapes.
- Total decorative brick mass and weighted grid positions contribute a clamped mass delta and center-of-mass offset. Functional parts provide the dominant engine, braking, suspension, steering and friction parameters.
- Rapier's dynamic ray-cast vehicle controller owns wheel-ground contact. A local `VehiclePhysics` facade translates normalized input to engine force, steering and braking, then exposes plain telemetry.
- Simulation runs at a fixed 60 Hz step with a capped accumulator. Rendering interpolates transforms and may run at 30–60 Hz; after a long suspension, excess accumulated time is discarded and the race resumes from a safe bounded state.
- Auto-righting applies only after low-speed upside-down detection for a configured duration. Manual reset moves the car to the last valid checkpoint, clears unsafe velocity and applies a short input lockout.
- Bricks are drawn in geometry/material batches using instancing. Per-car color and transform data are instance attributes; wheels and a small number of functional parts may use ordinary meshes.

### Track, checkpoints and AI flow

- `brickway-1` is a fixed, authored content definition containing a closed centerline, width/safety bounds, start grid, ordered checkpoints, recovery transforms and a speed profile. Generating meshes/colliders from this fixed definition does not create randomized or player-generated tracks.
- The AI blueprint generator starts from the same default core, selects only unlocked-for-AI content, uses the player rating as a target band, and validates every candidate through the shared blueprint validator. A bounded retry count falls back to curated valid blueprints.
- Each AI driver looks ahead on the fixed centerline, chooses a target speed from curvature/speed-profile data and produces normalized controls. Seeded variance changes reaction, line offset and conservative braking; it does not teleport vehicles, alter player physics or guarantee a result.
- Ordered checkpoint passage is the only authority for laps and finish. Visual world position alone cannot complete a lap.

### Collision fragments and audio flow

- Rapier collision-force events and sudden vehicle deceleration feed a thresholded semantic `hardCollision` event with cooldown.
- The fragment system hides a bounded subset of decorative brick instances and spawns pooled, short-lived visual fragments at their world transforms. Fragment bodies are non-authoritative and excluded from vehicle collision groups; core and functional parts are never candidates.
- Stopping the race restores all hidden instances and clears the pool. No fragment state crosses into save or progression.
- The audio engine unlocks only after a user gesture. It crossfades/pitch-shifts licensed idle, mid-load and high-load engine loops from smoothed speed/throttle telemetry and plays rate-limited collision one-shots.
- A master gain implements persisted volume/mute. Audio initialization or decoding failure degrades to a silent but fully playable game and surfaces a non-blocking status.

### Persistence and recovery flow

- Keys are namespaced, for example `brickracer.save.v1` and `brickracer.save.backup.v1`.
- Save writes occur after valid builder changes, successful purchase, result application, settings changes and onboarding milestones—not every frame.
- Before replacing the main key, the last valid main payload is copied to backup. A monotonically increasing revision helps select the newest valid candidate.
- Every durable transaction re-reads the current valid main revision before writing. If it differs from the transaction's base revision, the stale write is rejected, the newest save is loaded, and the player sees a short “进度已在另一个页面更新” message instead of silently overwriting points, unlocks or a blueprint.
- A `storage` event listener detects changes made by another tab and marks the in-memory save stale before the next purchase, result settlement or builder save. This is conflict prevention, not cross-device synchronization.
- Quota/security exceptions leave the in-memory game playable, show a non-blocking “进度未保存” state and allow later retry. They never convert a purchase into a negative balance.
- Schema migration begins as an explicit pure-function chain when a future version exists. For V1, unknown newer schemas fail closed to backup/default rather than being partially interpreted.

### Performance and quality policy

- Baseline rendering uses WebGL2. Unsupported capability produces a clear incompatibility screen.
- `auto` quality starts from device capability and adapts only presentation cost: device pixel ratio cap, shadows, particles, antialiasing and decorative detail. It never changes physics, rewards, AI rules, checkpoint logic or blueprint validity.
- The representative full-race workload is the default track with the maximum planned player-car brick budget, the configured maximum AI field and the maximum fragment-pool burst. After 15 seconds of warm-up, measure 60 seconds of uninterrupted driving: desktop target is p95 frame time at or below 16.7 ms; mobile release requirement is p95 at or below 33.3 ms. Neither run may accumulate more than two fixed physics steps of backlog or change race timing when visual quality adapts.
- Instanced bricks, aggregate vehicle bodies, simple track colliders, pooled fragments and capped AI count are mandatory first-line controls. OffscreenCanvas and worker rendering are not baseline dependencies because support and integration differ across target browsers.
- Runtime diagnostics available in development/test builds expose frame time, physics step time, draw calls, triangles, active bodies and fragment count. Production UI does not expose a telemetry or analytics service.
- Cold-load verification uses an uncached 10 Mbps downstream / 100 ms round-trip profile: visible interactive shell within 2.5 seconds and first interactive builder within 8 seconds. The first vertical slice may tighten these budgets but cannot relax them without a design revision; failure on the physical-device matrix blocks R1 verification.

## Alternatives and rejected approaches

| Alternative | Decision | Reason |
| --- | --- | --- |
| React Three Fiber owns the entire scene graph | Rejected for V1 | It improves declarative scene composition but makes ownership between React state, fixed-step physics and mutable instanced data easier to blur. Plain Three.js behind `GameRuntime` keeps the high-frequency boundary explicit while React remains appropriate for UI. |
| Custom kinematic arcade movement | Rejected | It is simpler initially but weakens collision, mass, grip and suspension behavior required by R4/R5. Rapier dynamic bodies plus a ray-cast vehicle controller provide the correct physical seam while tuning can retain arcade forgiveness. |
| One Rapier rigid body per attached brick | Rejected | It multiplies bodies, joints, contacts and synchronization cost on mobile, makes generated AI cars expensive, and conflicts with R8's requirement that visual detachment not affect performance. |
| WebGPU-first renderer | Rejected | It would narrow browser compatibility and add a fallback path without changing the MVP outcome. WebGL2 is sufficient for the bounded scene. |
| IndexedDB for V1 saves | Rejected | The durable payload is a small JSON object with event-based writes. `localStorage` matches the contract and is simpler; its synchronous cost is contained by never writing in the real-time loop. |
| Backend service for saves/economy | Rejected | Accounts, cloud sync and server-backed economy are explicitly out of scope. A backend would create cost, security and lifecycle not authorized by the contract. |
| Fully procedural engine synthesis | Rejected as the primary sound source | It minimizes assets but is unlikely to satisfy the requested recognizable engine character. Layered, licensed loops controlled through Web Audio provide a better quality/size tradeoff; synthesis may supplement but not replace them. |
| General ECS/framework or plugin architecture | Rejected for V1 | The bounded single-game runtime has clear domain and runtime seams. A generalized extension system would add abstractions for deferred tracks/content without a current requirement. |

## Compatibility, migration, and recovery

### Browser and device matrix

- Production target follows the modern browser baseline emitted by the selected locked Vite version, with explicit smoke coverage for Chromium, WebKit/Safari and Firefox.
- Required automated projects: desktop Chromium, desktop WebKit, one touch/phone Chromium emulation and one touch/phone WebKit emulation. Firefox receives boot/build/layout smoke coverage; full WebGL behavioral coverage may remain on Chromium/WebKit when automation support differs.
- Required pre-release real-device checks: one current iOS Safari device and one current Android Chrome device, both exercising builder gestures, full race controls, orientation/layout, audio unlock/mute and local-save reload.
- Required orientation behavior: builder/results/shop support portrait and landscape; racing is landscape-targeted with safe pause and an accessible rotation prompt in portrait.
- Playwright mobile projects emulate viewport, user agent and touch behavior; they do not count as evidence of real mobile GPU/audio performance. Real-device evidence remains separate.
- The game requires JavaScript, WebAssembly, WebGL2, Pointer Events and Web Audio. A missing required capability yields an explanatory screen; audio alone is degradable.

### Save compatibility

- V1 begins with schema version 1 and no legacy migration obligation.
- Every supported historical schema must have an explicit pure migration to the current version before it can be loaded. Unknown future versions, corrupt JSON and references to missing content never enter the runtime unchecked.
- A catalog ID may not be removed or semantically repurposed while saves using it are supported. A future removal needs a migration/default substitution decision in a later design.

### Runtime recovery and rollback

- Asset or Rapier initialization failure supports retry without a page reload and always releases partial resources first.
- Off-track/upside-down recovery returns a vehicle to its latest safe checkpoint rather than rebuilding the world.
- A fatal active-race error abandons the uncommitted race result, preserves the pre-race save and returns to a recoverable menu; it cannot award or deduct points.
- Implementation units keep content and tuning behind typed data. A faulty new part/track/audio asset can be disabled without changing the save schema or core runtime interfaces.
- Production deployment is a static versioned artifact. Rollback is replacement with the previous built artifact; save readers must fail safely when they encounter a newer schema after rollback.

### Resource lifecycle

- Every mode transition has an ownership checklist: input listeners, animation frame, physics world/bodies/controllers, scene objects, cached assets, audio sources and subscriptions.
- Shared geometries, materials and decoded audio buffers live in an application asset registry with reference ownership. Per-race bodies, fragments, AI drivers and sources are disposed at race exit.
- Automated lifecycle tests repeatedly enter/leave builder and race and assert stable listener/body/resource counts.

## Risks and verification approach

| Risk | Mitigation | Evidence |
| --- | --- | --- |
| Mobile GPU/CPU overload | Instancing, aggregate car physics, simple colliders, fragment pooling, pixel-ratio cap and adaptive visual quality | Performance scenario on representative desktop and physical iOS/Android devices; development counters captured under full race load |
| Vehicle feels either uncontrollable or cosmetically fake | Tunable physics profile over dynamic contacts, clamped mass/center effects, auto-right/reset and one fixed benchmark track | Deterministic acceleration/brake/turn tests plus product-owner and target-child driving sessions |
| Adaptive AI becomes rubber-banding or predetermined | Match only pre-race blueprint rating/driver parameters; no player-specific mid-race stat changes; seeded repeated-race analysis | Distribution test across low/mid/high player ratings plus source-level assertion that AI cannot mutate player physics |
| Invalid or disconnected builds leak into race | One shared pure validator at all crossings and immutable validated race snapshot | Property/boundary tests for placement, overlap, connectivity and generated AI; E2E cannot start race from invalid state |
| Visual fragments accidentally change physics/save | Collision groups and ownership separate fragment pool from vehicle compiler and persistence | Integration test compares authoritative stats/collider count before/after hard collision and verifies restored blueprint |
| Audio blocked or annoying | Gesture-gated `AudioContext`, explicit mute/volume, smoothing and rate limits | Chromium/WebKit tests for control state plus real-device listening check |
| Local storage corruption, quota failure or stale tabs lose progress | Runtime validation, main/backup keys, revision-checked transactions, `storage` conflict detection, safe defaults, event-based writes and visible unsaved state | Corrupt/newer/quota-denied/stale-revision tests, two-tab conflict E2E and reload E2E |
| Child cannot discover the loop | Large touch targets, short reason codes with icon feedback, contextual onboarding and low information density | Required human observation with representative 8–12-year-old players; engineering evidence cannot replace it |
| Third-party asset/license exposure | Asset manifest records origin/license; default to original procedural visuals and licensed audio | Release audit blocks unknown-license assets and remote runtime asset URLs |
| Dependency or browser regression | Exact lockfile, Node 24 LTS baseline, production build and multi-engine Playwright matrix | Clean install, typecheck, unit/integration, browser projects and release build in final verification |

### Requirement-to-design verification map

| Requirements | Primary verification |
| --- | --- |
| R1 | Production build; cold-load and full-workload frame-time thresholds; Chromium/WebKit desktop and touch E2E; real iOS Safari and Android Chrome smoke/performance/orientation checks; public URL load check at delivery |
| R2–R4 | Blueprint validator/stat unit tests, builder interaction E2E and controlled vehicle comparison on benchmark straight/turn scenarios |
| R5 | Headless fixed-step vehicle tests, reset/auto-right integration tests and desktop/mobile real-driving acceptance |
| R6 | Seeded AI blueprint property tests, rating-band distribution tests, ordered checkpoint/lap integration and repeated full races |
| R7 | Audio telemetry mapping tests, gesture-unlock/mute browser tests and human listening acceptance |
| R8 | Hard-collision fragment integration, no-stat/no-save-mutation assertions and race-exit restoration E2E |
| R9 | Reward/purchase invariant tests and full results → shop → builder → next-race journey |
| R10 | Version/validation/backup/quota/stale-revision tests plus two-tab conflict and browser reload persistence E2E |
| R11 | Product-owner-run observed usability session with representative 8–12-year-old players; status remains pending until completed |

### Verification specialists and delivery consequence

- Real-browser testing is required because canvas, pointer/touch, Web Audio and local storage behavior cannot be proven by unit tests alone.
- Performance verification is required because mobile real-time rendering/physics is a primary risk. Missing physical-device performance evidence blocks a claim that R1 is fully verified.
- Human experiential acceptance for R7 and R11 is required before public release readiness. Automated or agent dogfood may find friction but cannot substitute for the named owner.
- A security specialist becomes required only if implementation adds remote data, user-provided executable/HTML content, authentication or third-party runtime scripts; those would also be product scope changes. The baseline static client still receives dependency, CSP and asset-origin review.

## Scope deltas and specialist evidence

### Classified technical necessities

- TN1 — Capability/loading/error states and phase-specific asset loading are technically necessary for R1. Without them, WebGL/WASM/audio initialization or a large eager download can leave a blank or blocked mobile experience. The smallest change is a shell-first loader with progress, retry and unsupported-capability boundaries; it adds no new product actor or service.
- TN2 — Versioned runtime save validation, revision conflict checks and safe recovery are technically necessary for R9/R10. Without them, malformed local data can permanently prevent startup and concurrent tabs can overwrite newer points/unlocks. The smallest change is V1 validation plus main/backup/default recovery and stale-writer rejection; cloud recovery remains out of scope.
- TN3 — An asset manifest with license/origin metadata is technically necessary to honor Assumption A1 and R7. It does not add a content-management product.
- TN4 — A fixed-step simulation and presentation-only quality tiers are technically necessary to satisfy R1/R5 consistently across 30–60 FPS devices. Quality tiers may reduce visuals only, not gameplay rules.

No product delta was discovered. Offline/PWA support, analytics, service workers, generalized content authoring, cloud sync and multiplayer remain adjacent and deferred.

### Research evidence

- Vite provides TypeScript/React scaffolding and a static production build with an explicit modern-browser baseline: <https://vite.dev/guide/> and <https://vite.dev/guide/build>.
- Three.js `InstancedMesh` reduces draw calls for many shared-geometry objects, while Three resources require explicit cleanup: <https://threejs.org/docs/pages/InstancedMesh.html> and <https://threejs.org/manual/en/cleanup.html>.
- Rapier's JavaScript build is asynchronously loaded WebAssembly and exposes a dynamic ray-cast vehicle controller: <https://rapier.rs/docs/user_guides/javascript/getting_started_js/> and <https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html>.
- Web Audio must respect autoplay/user-gesture policy and user controls: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices>.
- `localStorage` persists by origin across sessions but is synchronous, supporting event-based small saves rather than frame-loop writes: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API>.
- Playwright supports Chromium, WebKit, Firefox and mobile emulation; emulation remains distinct from physical-device GPU/audio evidence: <https://playwright.dev/docs/browsers> and <https://playwright.dev/docs/emulation>.
- Node 24 is an LTS line in the implementation window: <https://nodejs.org/en/about/previous-releases>.

No throwaway prototype is required before planning: the selected renderer, physics controller, audio and browser-test capabilities have documented public seams, and the design isolates each behind a facade. The first execution unit must still prove a minimal vertical vehicle slice before content-heavy work; failure of the documented Rapier vehicle seam would return this design to revision rather than trigger an unplanned engine rewrite.

## Open technical decisions

None blocking. Exact package patch versions are locked during scaffolding; race duration/opponent count, physics tuning, rating band, progression numbers, catalog size, quality thresholds inside the stated performance target, and final control layout remain bounded implementation/tuning decisions already delegated by the Product Contract.
