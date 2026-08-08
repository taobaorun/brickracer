import * as THREE from "three";
import { TRACK_BRICKWAY_1 } from "../../content/track";
import { RaceState } from "../../domain/race/raceState";
import type { VehicleBlueprint } from "../../domain/blueprint/types";
import { validateBlueprint } from "../../domain/blueprint/validation";
import { NEUTRAL_INPUT, type NormalizedInput } from "../../input/normalized";
import { generateAiBlueprint } from "../ai/generate";
import { driveToward, styleFromSeed, type DriverStyle } from "../ai/driver";
import { recoveryTransform, StuckDetector } from "../race/recovery";
import { initRapier, type RapierModule } from "../physics/rapier";
import { compileVehicle } from "../vehicle/compiler";
import { VehiclePhysics, type VehicleTelemetry } from "../vehicle/vehiclePhysics";
import { BuilderScene, type BuilderPickResult } from "../rendering/builderScene";
import { FragmentPool } from "../rendering/fragments";
import { RaceScene, type RacerVisual } from "../rendering/raceScene";
import { ResourceRegistry, qualityFor, type QualitySettings } from "../rendering/resources";
import { FIXED_DT, FixedStepAccumulator } from "./fixedLoop";

export interface RuntimeSnapshot {
  speed: number;
  lap: number;
  position: number;
  countdownMs: number;
  racePhase: "loading" | "countdown" | "racing" | "finished" | "paused";
  canReset: boolean;
}

export type RuntimeEvent =
  | {
      type: "raceFinished";
      result: { raceId: string; place: number; totalRacers: number; finishTimeMs: number; bestLapMs: number };
    }
  | { type: "hardCollision"; intensity: number }
  | { type: "fatalError"; code: string; recoverTo: "builder" | "boot" };

export interface RaceConfig {
  raceId: string;
  trackId: "brickway-1";
  laps: number;
  aiCount: number;
  seed: number;
  player: VehicleBlueprint;
}

const PLAYER_ID = "player";
const COUNTDOWN_MS = 3000;
const COLLISION_DECEL_THRESHOLD = 6; // m/s 单帧速度损失
const COLLISION_COOLDOWN_MS = 900;
const UPSIDE_DOWN_MS = 1500;
const RESET_LOCKOUT_MS = 800;
const MAX_DETACHED_BRICKS = 4;

interface Racer {
  id: string;
  isPlayer: boolean;
  vehicle: VehiclePhysics;
  visual: RacerVisual;
  driverStyle: DriverStyle | null;
  prevSpeed: number;
  lastCollisionMs: number;
  upsideDownSinceMs: number | null;
  inputLockedUntilMs: number;
  detached: string[];
  topSpeedMs: number;
  stuck: StuckDetector;
}

/**
 * GameRuntime 拥有 rAF、固定步长累加器、Three 场景、Rapier 世界与输入快照。
 * 发布节流 HUD 快照与无损类型事件；React 永不持有 Three/Rapier 可变对象。
 */
export class GameRuntime {
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly registry = new ResourceRegistry();
  private RAPIER: RapierModule | null = null;

  private builderScene: BuilderScene | null = null;
  private raceScene: RaceScene | null = null;
  private world: InstanceType<RapierModule["World"]> | null = null;
  private racers: Racer[] = [];
  private raceState: RaceState | null = null;
  private fragments: FragmentPool | null = null;

  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private accumulator = new FixedStepAccumulator();
  private input: NormalizedInput = NEUTRAL_INPUT;
  private paused = false;
  private raceClockMs = 0;
  private countdownRemainingMs = 0;
  private phase: RuntimeSnapshot["racePhase"] = "loading";
  private resultEmitted = false;
  private quality: QualitySettings = qualityFor("high");

  private snapshotListeners = new Set<(s: RuntimeSnapshot) => void>();
  private eventListeners = new Set<(e: RuntimeEvent) => void>();
  private lastSnapshotMs = -Infinity;
  private resizeObserver: ResizeObserver | null = null;
  /** 诊断模式：用 AI 同款驾驶员驱动玩家车（输入层等价物，I7）。 */
  debugAutopilot = false;

  async initialize(canvas: HTMLCanvasElement, quality: "auto" | "low" | "high" = "auto"): Promise<void> {
    this.canvas = canvas;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.quality = qualityFor(quality === "auto" ? "high" : quality, quality === "auto" ? memory : undefined);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    this.RAPIER = await initRapier();
    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(canvas);
    this.applySize();
    this.startLoop();
  }

  setQuality(level: "auto" | "low" | "high"): void {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.quality = qualityFor(level === "auto" ? "high" : level, level === "auto" ? memory : undefined);
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
      this.applySize();
    }
  }

  private applySize(): void {
    if (!this.canvas || !this.renderer) return;
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 240;
    this.renderer.setSize(w, h, false);
  }

  // ---------- builder mode ----------

  showBuilder(blueprint: VehicleBlueprint): void {
    this.teardownRace();
    if (!this.renderer) throw new Error("runtime not initialized");
    if (!this.builderScene) this.builderScene = new BuilderScene(this.renderer);
    this.builderScene.showBlueprint(blueprint);
    this.phase = "loading";
  }

  builderPick(nx: number, ny: number): BuilderPickResult {
    return this.builderScene?.pick(nx, ny) ?? { kind: "none" };
  }

  builderOrbit(deltaAzimuth: number, deltaPolar: number): void {
    this.builderScene?.orbit(deltaAzimuth, deltaPolar);
  }

  builderZoom(factor: number): void {
    this.builderScene?.zoom(factor);
  }

  builderCameraPosition(): { x: number; y: number; z: number } | null {
    return this.builderScene?.cameraPosition() ?? null;
  }

  builderSelect(instanceId: string | null): void {
    this.builderScene?.select(instanceId);
  }

  // ---------- race mode ----------

  async startRace(config: RaceConfig): Promise<void> {
    if (!this.RAPIER || !this.renderer) throw new Error("runtime not initialized");
    const verdict = validateBlueprint(config.player);
    if (!verdict.ok) throw new Error(`invalid player blueprint: ${verdict.reason}`);
    this.teardownRace();
    if (this.builderScene) {
      this.builderScene.dispose();
      this.builderScene = null;
    }

    const RAPIER = this.RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.raceScene = new RaceScene(RAPIER, this.world, TRACK_BRICKWAY_1);
    this.fragments = new FragmentPool(this.raceScene.scene);

    const playerCompiled = compileVehicle(config.player);
    const racers: Racer[] = [];
    const spawnAt = (i: number) => {
      const g = TRACK_BRICKWAY_1.startGrid[i % TRACK_BRICKWAY_1.startGrid.length]!;
      return { position: { x: g.x, y: g.y, z: g.z }, rotationY: g.rotationY };
    };

    const playerVehicle = VehiclePhysics.create(RAPIER, this.world, playerCompiled.physics, spawnAt(0));
    racers.push({
      id: PLAYER_ID,
      isPlayer: true,
      vehicle: playerVehicle,
      visual: this.raceScene.buildCarVisual(playerCompiled),
      driverStyle: null,
      prevSpeed: 0,
      lastCollisionMs: -Infinity,
      upsideDownSinceMs: null,
      inputLockedUntilMs: 0,
      detached: [],
      topSpeedMs: playerCompiled.physics.topSpeed / 3.6,
      stuck: new StuckDetector(),
    });

    for (let i = 0; i < config.aiCount; i += 1) {
      const gen = generateAiBlueprint({
        seed: config.seed + i * 7919,
        targetRating: playerCompiled.matchmakingRating,
        bandRatio: 0.3,
        maxAttempts: 30,
      });
      const compiled = compileVehicle(gen.blueprint);
      const vehicle = VehiclePhysics.create(RAPIER, this.world, compiled.physics, spawnAt(i + 1));
      racers.push({
        id: `ai-${i}`,
        isPlayer: false,
        vehicle,
        visual: this.raceScene.buildCarVisual(compiled),
        driverStyle: styleFromSeed(config.seed + i * 104729),
        prevSpeed: 0,
        lastCollisionMs: -Infinity,
        upsideDownSinceMs: null,
        inputLockedUntilMs: 0,
        detached: [],
        topSpeedMs: compiled.physics.topSpeed / 3.6,
        stuck: new StuckDetector(),
      });
    }
    this.racers = racers;

    this.raceState = new RaceState(
      config.raceId,
      config.laps,
      TRACK_BRICKWAY_1.checkpoints.map((c) => ({ x: c.x, z: c.z, radius: c.radius })),
      racers.map((r) => r.id),
    );
    this.phase = "countdown";
    this.countdownRemainingMs = COUNTDOWN_MS;
    this.raceClockMs = 0;
    this.resultEmitted = false;
    this.paused = false;
    this.accumulator.reset();
    this.emitSnapshot(true);
  }

  updateInput(input: NormalizedInput): void {
    // 保留未消费的边沿触发位，避免被后续连续值快照覆盖
    this.input = {
      ...input,
      resetPressed: input.resetPressed || this.input.resetPressed,
      pausePressed: input.pausePressed || this.input.pausePressed,
    };
  }

  setPaused(paused: boolean): void {
    if (this.phase === "racing" || this.phase === "paused") {
      this.paused = paused;
      this.phase = paused ? "paused" : "racing";
      this.emitSnapshot(true);
    }
  }

  subscribe(listener: (s: RuntimeSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  subscribeEvents(listener: (e: RuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  stopActiveMode(): void {
    this.teardownRace();
  }

  private teardownRace(): void {
    // 比赛退出：恢复隐藏实例、清空碎片池、释放每场比赛的身体/视觉（I9）
    for (const r of this.racers) this.restoreBricks(r);
    this.fragments?.dispose();
    this.fragments = null;
    if (this.raceScene) {
      for (const r of this.racers) this.raceScene.removeCarVisual(r.visual);
      this.raceScene.dispose();
      this.raceScene = null;
    }
    this.racers = [];
    this.raceState = null;
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this.phase = "loading";
  }

  // ---------- main loop ----------

  private startLoop(): void {
    if (this.rafId !== null) return;
    const frame = (nowMs: number) => {
      this.rafId = requestAnimationFrame(frame);
      const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
      this.lastFrameMs = nowMs;
      try {
        this.tick(dt, nowMs);
      } catch (err) {
        this.emitEvent({
          type: "fatalError",
          code: err instanceof Error ? err.message : "unknown",
          recoverTo: "builder",
        });
        this.teardownRace();
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private tick(dt: number, nowMs: number): void {
    if (!this.renderer) return;
    const aspect = (this.canvas?.clientWidth || 16) / (this.canvas?.clientHeight || 9);

    if (this.builderScene) {
      this.builderScene.render(aspect);
      return;
    }
    if (!this.world || !this.raceScene || !this.raceState) return;

    if (this.paused) {
      this.renderRace(aspect, 0);
      return;
    }

    if (this.phase === "countdown") {
      this.countdownRemainingMs -= dt * 1000;
      if (this.countdownRemainingMs <= 0) {
        this.phase = "racing";
        this.emitSnapshot(true);
      }
    }

    const steps = this.accumulator.advance(dt);
    for (let i = 0; i < steps; i += 1) {
      this.fixedStep();
    }
    this.renderRace(aspect, dt * 1000);
    if (nowMs - this.lastSnapshotMs > 100) {
      this.lastSnapshotMs = nowMs;
      this.emitSnapshot(false);
    }
  }

  private fixedStep(): void {
    if (!this.world || !this.raceState) return;
    const racing = this.phase === "racing";
    if (racing) this.raceClockMs += FIXED_DT * 1000;

    for (const r of this.racers) {
      let input = NEUTRAL_INPUT;
      if (racing && this.raceClockMs >= r.inputLockedUntilMs) {
        if (r.isPlayer && this.debugAutopilot) {
          const t = r.vehicle.telemetry();
          input = driveToward(TRACK_BRICKWAY_1.centerline, styleFromSeed(1234), {
            position: { x: t.position.x, z: t.position.z },
            rotationY: t.rotationY,
            forwardSpeed: t.forwardSpeed,
            topSpeedMs: r.topSpeedMs,
          });
        } else if (r.isPlayer) {
          input = this.input;
        } else if (r.driverStyle) {
          const t = r.vehicle.telemetry();
          input = driveToward(TRACK_BRICKWAY_1.centerline, r.driverStyle, {
            position: { x: t.position.x, z: t.position.z },
            rotationY: t.rotationY,
            forwardSpeed: t.forwardSpeed,
            topSpeedMs: r.topSpeedMs,
          });
        }
      }

      if (racing && input.resetPressed && r.isPlayer && this.raceClockMs >= r.inputLockedUntilMs) {
        this.resetRacer(r);
        // 消费边沿触发，防止锁定期后重复复位
        this.input = { ...this.input, resetPressed: false };
      }
      // Esc/P 暂停（I7 归一化输入语义动作）
      if (racing && input.pausePressed && r.isPlayer) {
        this.setPaused(true);
        this.input = { ...this.input, pausePressed: false };
      }
      // 卡死自救：全油门近乎静止超时 → 回最近检查点（R5 容错，AI 同样适用）
      const telForStuck = r.vehicle.telemetry();
      if (
        racing &&
        this.raceClockMs >= r.inputLockedUntilMs &&
        r.stuck.update(telForStuck.speed, input.throttle, this.raceClockMs)
      ) {
        this.resetRacer(r);
        r.stuck.reset();
      }
      // 低速翻车持续超时 → 自动回正（R5）
      const tel = r.vehicle.telemetry();
      if (racing && r.vehicle.isUpsideDown() && tel.speed < 1) {
        r.upsideDownSinceMs ??= this.raceClockMs;
        if (this.raceClockMs - r.upsideDownSinceMs > UPSIDE_DOWN_MS) {
          r.vehicle.upright();
          r.upsideDownSinceMs = null;
          r.inputLockedUntilMs = this.raceClockMs + RESET_LOCKOUT_MS;
        }
      } else {
        r.upsideDownSinceMs = null;
      }

      r.vehicle.setInput(input);
      r.vehicle.step(FIXED_DT);

      // 碰撞检测：单步速度骤降 → 语义 hardCollision（阈值 + 冷却）
      const after = r.vehicle.telemetry();
      if (racing && r.prevSpeed - after.speed > COLLISION_DECEL_THRESHOLD * FIXED_DT * 8) {
        if (this.raceClockMs - r.lastCollisionMs > COLLISION_COOLDOWN_MS) {
          r.lastCollisionMs = this.raceClockMs;
          this.onHardCollision(r, after.speed);
        }
      }
      r.prevSpeed = after.speed;

      if (racing) {
        this.raceState.observe(r.id, { x: after.position.x, z: after.position.z }, this.raceClockMs);
      }
    }

    this.world.timestep = FIXED_DT;
    this.world.step();

    // 完赛结算：无损事件恰好一次
    const player = this.racers.find((r) => r.isPlayer);
    if (racing && player && !this.resultEmitted && this.raceState.isFinished(PLAYER_ID)) {
      const facts = this.raceState.takeResult(PLAYER_ID);
      if (facts) {
        this.resultEmitted = true;
        this.phase = "finished";
        this.emitEvent({ type: "raceFinished", result: facts });
        this.emitSnapshot(true);
      }
    }
  }

  private onHardCollision(r: Racer, speedAfter: number): void {
    // 视觉飞散：隐藏有界装饰实例 + 池化碎片；权威状态不变（I4、R8）
    const t = r.vehicle.telemetry();
    const candidates = r.visual.brickMeshes.filter((b) => !r.detached.includes(b.instanceId));
    const count = Math.min(MAX_DETACHED_BRICKS, candidates.length, 2 + Math.floor(speedAfter));
    for (let i = 0; i < count; i += 1) {
      const b = candidates[i]!;
      b.mesh.visible = false;
      r.detached.push(b.instanceId);
      const worldPos = new THREE.Vector3();
      b.mesh.getWorldPosition(worldPos);
      this.fragments?.burst({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, 3, i * 7 + r.id.length);
    }
    if (r.isPlayer) {
      this.emitEvent({ type: "hardCollision", intensity: Math.min(1, r.prevSpeed / 15) });
    }
    void t;
  }

  private restoreBricks(r: Racer): void {
    for (const b of r.visual.brickMeshes) b.mesh.visible = true;
    r.detached = [];
  }

  private resetRacer(r: Racer): void {
    if (!this.raceState) return;
    const t = r.vehicle.telemetry();
    const spawn = recoveryTransform(TRACK_BRICKWAY_1, { x: t.position.x, z: t.position.z });
    r.vehicle.resetTo(spawn);
    r.inputLockedUntilMs = this.raceClockMs + RESET_LOCKOUT_MS;
  }

  private renderRace(aspect: number, dtMs: number): void {
    if (!this.renderer || !this.raceScene) return;
    for (const r of this.racers) {
      const t = r.vehicle.telemetry();
      r.visual.group.position.set(t.position.x, t.position.y, t.position.z);
      const body = r.vehicle.chassisBody();
      const q = body.rotation();
      r.visual.group.quaternion.set(q.x, q.y, q.z, q.w);
    }
    // 跟随镜头
    const player = this.racers.find((r) => r.isPlayer);
    if (player) {
      const t = player.vehicle.telemetry();
      const cam = this.raceScene.camera;
      const back = 7.5;
      const yaw = t.rotationY;
      cam.position.set(
        t.position.x - Math.sin(yaw) * back,
        t.position.y + 4,
        t.position.z - Math.cos(yaw) * back,
      );
      cam.lookAt(t.position.x, t.position.y + 0.8, t.position.z);
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    this.fragments?.update(dtMs);
    this.renderer.render(this.raceScene.scene, this.raceScene.camera);
  }

  private emitSnapshot(force: boolean): void {
    if (!force && this.snapshotListeners.size === 0) return;
    const player = this.racers.find((r) => r.isPlayer);
    const snapshot: RuntimeSnapshot = {
      speed: player ? player.vehicle.telemetry().speed * 3.6 : 0,
      lap: this.raceState ? this.raceState.lapOf(PLAYER_ID) : 0,
      position: this.raceState ? this.raceState.placeOf(PLAYER_ID) : 1,
      countdownMs: Math.max(0, this.countdownRemainingMs),
      racePhase: this.phase,
      canReset: this.phase === "racing",
    };
    for (const l of this.snapshotListeners) l(snapshot);
  }

  private emitEvent(event: RuntimeEvent): void {
    for (const l of this.eventListeners) l(event);
  }

  /** 测试/诊断用：当前物理身体数量。 */
  bodyCount(): number {
    return this.world?.bodies.len() ?? 0;
  }

  /** 开发/测试诊断：只读玩家遥测与碎片计数（生产 UI 不暴露，仅 diagnostics 模式挂载）。 */
  playerTelemetry(): VehicleTelemetry | null {
    const player = this.racers.find((r) => r.isPlayer);
    return player ? player.vehicle.telemetry() : null;
  }

  fragmentCount(): number {
    return this.fragments?.activeCount() ?? 0;
  }

  /** 诊断用：对玩家车制造一次确定性硬碰撞（隐藏装饰实例 + 碎片爆发）。 */
  debugTriggerCollision(): void {
    const player = this.racers.find((r) => r.isPlayer);
    if (player) this.onHardCollision(player, 5);
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.resizeObserver?.disconnect();
    this.teardownRace();
    if (this.builderScene) {
      this.builderScene.dispose();
      this.builderScene = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.registry.dispose();
    this.snapshotListeners.clear();
    this.eventListeners.clear();
  }
}
