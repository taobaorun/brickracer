import { ALL_PARTS, findPart } from "../content/catalog";
import { applyCommand, type BlueprintCommand } from "../domain/blueprint/commands";
import { deriveStats } from "../domain/blueprint/stats";
import type { InvalidReason, VehicleBlueprint } from "../domain/blueprint/types";
import { validateBlueprint } from "../domain/blueprint/validation";
import { applyRaceResult, purchasePart } from "../domain/progression/economy";
import type { SaveGameV1 } from "../domain/save/types";
import { SaveStore, wireStorageEvents } from "../infrastructure/saveStore";
import { AudioEngine } from "../game/audio/audioEngine";
import type { GameRuntime, RuntimeEvent, RuntimeSnapshot } from "../game/runtime/gameRuntime";
import { InputState } from "../input/inputState";
import { TRACK_BRICKWAY_1 } from "../content/track";
import type { AppSnapshot } from "./state";

export type ControllerListener = (snapshot: AppSnapshot) => void;

const SAVE_DEBOUNCE_MS = 400;

export interface Capabilities {
  webgl2: boolean;
  wasm: boolean;
  pointerEvents: boolean;
  webAudio: boolean;
}

export function detectCapabilities(): Capabilities {
  const canvas = document.createElement("canvas");
  return {
    webgl2: !!canvas.getContext("webgl2"),
    wasm: typeof WebAssembly !== "undefined",
    pointerEvents: "PointerEvent" in window,
    webAudio: "AudioContext" in window || "webkitAudioContext" in window,
  };
}

/**
 * AppController：低频应用状态机的唯一权威（界面/比赛/商店进出）。
 * React 只渲染它的不可变快照并回发命令。
 */
export class AppController {
  private snapshotValue: AppSnapshot;
  private readonly listeners = new Set<ControllerListener>();
  private readonly store: SaveStore;
  private runtimeValue: GameRuntime | null = null;
  readonly audio = new AudioEngine();
  readonly input = new InputState();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private detachStorage: (() => void) | null = null;
  private pendingRaceId: string | null = null;

  constructor(storage: Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void }) {
    this.store = new SaveStore(storage);
    const { save } = this.store.load();
    this.snapshotValue = {
      screen: { name: "boot" },
      save,
      saveStatus: "clean",
    };
  }

  get snapshot(): AppSnapshot {
    return this.snapshotValue;
  }

  /** 游戏运行时在 boot 后可用；UI 只在 builder/race 等界面访问。 */
  get runtime(): GameRuntime {
    if (!this.runtimeValue) throw new Error("runtime not booted");
    return this.runtimeValue;
  }

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<AppSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const l of this.listeners) l(this.snapshotValue);
  }

  private booted = false;

  /** boot：能力检测 + 运行时初始化（进入搭建器前懒加载游戏块）。幂等：重复调用直接进搭建器。 */
  async boot(canvas: HTMLCanvasElement): Promise<void> {
    if (this.booted) {
      this.enterBuilder();
      return;
    }
    const caps = detectCapabilities();
    if (!caps.webgl2 || !caps.wasm || !caps.pointerEvents) {
      this.set({
        screen: {
          name: "unsupported",
          reason: "这台浏览器缺少游戏需要的图形能力（WebGL2/WASM/指针事件）。请换用新版浏览器。",
        },
      });
      return;
    }
    // TN1：Three/Rapier 运行时代码分割，进入游戏前才加载
    const { GameRuntime } = await import("../game/runtime/gameRuntime");
    this.runtimeValue = new GameRuntime();
    await this.runtimeValue.initialize(canvas, this.snapshotValue.save.settings.quality);
    this.detachStorage = wireStorageEvents(this.store, window);
    this.runtimeValue.subscribeEvents((e) => this.onRuntimeEvent(e));
    this.input.subscribe((input) => this.runtimeValue?.updateInput(input));
    this.booted = true;
    this.enterBuilder();
  }

  subscribeRuntimeSnapshots(l: (s: RuntimeSnapshot) => void): () => void {
    return this.runtime.subscribe(l);
  }

  // ---------- 导航 ----------

  enterBuilder(): void {
    this.runtime.stopActiveMode();
    this.runtime.showBuilder(this.snapshotValue.save.activeBlueprint);
    this.audio.quietEngine();
    this.set({ screen: { name: "builder" } });
    this.completeOnboardingStep("saw-builder");
  }

  async startRace(): Promise<{ ok: boolean; reason?: InvalidReason }> {
    const bp = this.snapshotValue.save.activeBlueprint;
    const verdict = validateBlueprint(bp);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    await this.audio.unlock();
    void this.audio.load();
    this.flushSave();
    this.input.reset(); // 清除搭建期可能锁存的边沿触发位
    const raceId = `race-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.pendingRaceId = raceId;
    this.set({ screen: { name: "race-loading" } });
    try {
      await this.runtime.startRace({
        raceId,
        trackId: TRACK_BRICKWAY_1.id,
        laps: TRACK_BRICKWAY_1.laps,
        aiCount: TRACK_BRICKWAY_1.aiCount,
        seed: Math.floor(Math.random() * 2 ** 31),
        player: structuredClone(bp),
      });
    } catch {
      this.pendingRaceId = null;
      this.enterBuilder();
      return { ok: false, reason: "missing-core" };
    }
    this.set({ screen: { name: "racing", paused: false } });
    this.completeOnboardingStep("started-race");
    return { ok: true };
  }

  setRacePaused(paused: boolean): void {
    this.runtime.setPaused(paused);
    const screen = this.snapshotValue.screen;
    if (screen.name === "racing") this.set({ screen: { name: "racing", paused } });
  }

  openShop(): void {
    this.set({ screen: { name: "shop" } });
    this.completeOnboardingStep("saw-shop");
  }

  openSettings(): void {
    this.set({ screen: { name: "settings" } });
  }

  // ---------- 搭建 ----------

  /** 搭建命令入口：非法命令返回原因码，权威蓝图不变。 */
  builderCommand(cmd: BlueprintCommand): { ok: boolean; reason?: InvalidReason } {
    const current = this.snapshotValue.save.activeBlueprint;
    const result = applyCommand(current, cmd);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.updateBlueprint(result.blueprint);
    this.completeOnboardingStep("edited-car");
    return { ok: true };
  }

  private updateBlueprint(bp: VehicleBlueprint): void {
    const save = { ...this.snapshotValue.save, activeBlueprint: bp };
    this.set({ save });
    this.runtime.showBuilder(bp);
    this.scheduleSave();
  }

  stats() {
    return deriveStats(this.snapshotValue.save.activeBlueprint);
  }

  // ---------- 结算 / 商店 ----------

  private onRuntimeEvent(event: RuntimeEvent): void {
    if (event.type === "raceFinished") {
      if (event.result.raceId !== this.pendingRaceId) return; // 过期事件不结算
      this.pendingRaceId = null;
      this.audio.quietEngine();
      this.audio.playOneShot("checkpoint", 1);
      // 结算并持久化；若因另一标签页更新而 stale，在最新存档上重试（最多 2 次），不丢奖
      let awarded = 0;
      let settled = false;
      for (let attempt = 0; attempt < 2 && !settled; attempt += 1) {
        const applied = applyRaceResult(this.stripRevision(this.snapshotValue.save), event.result);
        if (!applied.ok) return; // 幂等：重复 raceId 不再发奖
        awarded = applied.awarded;
        const persisted = this.commitNow(applied.save);
        settled = persisted.status !== "stale";
      }
      this.set({
        screen: { name: "results", place: event.result.place, awarded, points: this.snapshotValue.save.points },
      });
      this.completeOnboardingStep("finished-race");
    } else if (event.type === "hardCollision") {
      this.audio.playOneShot("collision", event.intensity);
    } else if (event.type === "fatalError") {
      // 放弃未结算结果，保留赛前存档，回搭建器
      this.pendingRaceId = null;
      this.enterBuilder();
    }
  }

  purchase(partId: string): { ok: boolean; reason?: string } {
    const current = this.stripRevision(this.snapshotValue.save);
    const outcome = purchasePart(current, partId);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    const persisted = this.commitNow(outcome.save);
    this.set({ save: persisted.save });
    this.audio.playOneShot("purchase", 0.8);
    this.completeOnboardingStep("bought-part");
    return { ok: true };
  }

  equip(partId: string): { ok: boolean; reason?: string } {
    const part = findPart(partId);
    if (!part) return { ok: false, reason: "unknown-part" };
    if (!this.snapshotValue.save.unlockedPartIds.includes(partId)) {
      return { ok: false, reason: "locked" };
    }
    const slot =
      part.kind === "engine"
        ? ("engineId" as const)
        : part.kind === "wheelSet"
          ? ("wheelSetId" as const)
          : part.kind === "aero"
            ? ("aeroId" as const)
            : ("bumperId" as const);
    const result = this.builderCommand({ type: "equipPart", slot, partId });
    if (result.ok) this.completeOnboardingStep("equipped-part");
    return result;
  }

  // ---------- 设置 ----------

  setVolume(volume: number): void {
    const save = {
      ...this.snapshotValue.save,
      settings: { ...this.snapshotValue.save.settings, masterVolume: volume },
    };
    this.set({ save });
    this.audio.setVolume(volume, save.settings.muted);
    this.scheduleSave();
  }

  setMuted(muted: boolean): void {
    const save = {
      ...this.snapshotValue.save,
      settings: { ...this.snapshotValue.save.settings, muted },
    };
    this.set({ save });
    this.audio.setVolume(save.settings.masterVolume, muted);
    this.scheduleSave();
  }

  setQuality(quality: "auto" | "low" | "high"): void {
    const save = {
      ...this.snapshotValue.save,
      settings: { ...this.snapshotValue.save.settings, quality },
    };
    this.set({ save });
    this.runtime.setQuality(quality);
    this.scheduleSave();
  }

  // ---------- 引导 ----------

  completeOnboardingStep(step: string): void {
    const current = this.snapshotValue.save;
    if (current.onboarding.completedSteps.includes(step)) return;
    const save = {
      ...current,
      onboarding: { completedSteps: [...current.onboarding.completedSteps, step] },
    };
    this.set({ save });
    this.scheduleSave();
  }

  // ---------- 持久化 ----------

  private stripRevision(save: SaveGameV1): Omit<SaveGameV1, "revision"> {
    const { revision: _revision, ...rest } = save;
    return rest;
  }

  /** 立即提交（结算/购买等关键事务）。 */
  private commitNow(candidate: Omit<SaveGameV1, "revision">): {
    save: SaveGameV1;
    status: "ok" | "stale" | "unsaved";
  } {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const result = this.store.commit(candidate, this.snapshotValue.save.revision);
    if (result.status === "stale") {
      this.set({ save: result.save, saveStatus: "stale-external" });
      return { save: result.save, status: "stale" };
    }
    if (result.status === "unsaved") {
      const merged: SaveGameV1 = { ...result.save, revision: this.snapshotValue.save.revision };
      this.set({ saveStatus: "unsaved" });
      return { save: merged, status: "unsaved" };
    }
    this.set({ save: result.save, saveStatus: "clean" });
    return { save: result.save, status: "ok" };
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.commitNow(this.stripRevision(this.snapshotValue.save));
    }, SAVE_DEBOUNCE_MS);
  }

  /** 关键节点前冲刷防抖写入。 */
  flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.commitNow(this.stripRevision(this.snapshotValue.save));
    }
  }

  dispose(): void {
    this.flushSave();
    this.detachStorage?.();
    this.runtimeValue?.dispose();
    this.audio.dispose();
  }
}

export { ALL_PARTS };
