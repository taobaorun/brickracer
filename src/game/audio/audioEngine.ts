import { AUDIO_ASSETS } from "../../content/assetManifest";

export interface AudioTelemetry {
  /** 0..1 的速度占比与油门。 */
  speedRatio: number;
  throttle: number;
}

export type AudioStatus = "locked" | "ready" | "degraded";

/**
 * Web Audio 引擎（R7）：
 * - 首次用户手势后才创建/恢复 AudioContext；
 * - 三层转速循环按遥测交叉淡化 + 变调；碰撞等一次性音效限频；
 * - 初始化/解码失败降级为静音可玩，不阻断游戏；
 * - 不读取 Rapier 或 React 状态，只消费 AudioTelemetry 与语义事件。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loops: Array<{ id: string; gain: GainNode; source: AudioBufferSourceNode }> = [];
  private lastOneShot = new Map<string, number>();
  private status: AudioStatus = "locked";
  private volume = 0.8;
  private muted = false;

  getStatus(): AudioStatus {
    return this.status;
  }

  /** 必须由用户手势触发。 */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        this.status = "degraded";
        return;
      }
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyMaster();
      this.status = "ready";
    } catch {
      this.status = "degraded";
      this.ctx = null;
      this.master = null;
    }
  }

  /** 按需拉取并解码音频（懒加载，失败即降级）。 */
  async load(): Promise<void> {
    if (!this.ctx || this.status !== "ready") return;
    try {
      await Promise.all(
        AUDIO_ASSETS.map(async (asset) => {
          const res = await fetch(asset.url);
          if (!res.ok) throw new Error(`audio ${asset.id} ${res.status}`);
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(asset.id, buf);
        }),
      );
      this.startEngineLoops();
    } catch {
      this.status = "degraded";
    }
  }

  private startEngineLoops(): void {
    if (!this.ctx || !this.master) return;
    for (const id of ["engine-idle", "engine-mid", "engine-high"]) {
      const buffer = this.buffers.get(id);
      if (!buffer) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.loops.push({ id, gain, source });
    }
  }

  /** 每帧（或节流）更新发动机声浪映射。 */
  updateTelemetry(t: AudioTelemetry): void {
    if (!this.ctx || this.loops.length === 0) return;
    const r = Math.min(1, Math.max(0, t.speedRatio));
    const load = Math.min(1, Math.max(0, 0.35 + t.throttle * 0.65));
    const idle = Math.max(0, 1 - r * 2.2);
    const high = Math.max(0, r - 0.55) * 2.2;
    const mid = Math.max(0, 1 - idle - high);
    const now = this.ctx.currentTime;
    for (const loop of this.loops) {
      const level = loop.id === "engine-idle" ? idle : loop.id === "engine-mid" ? mid : high;
      loop.gain.gain.setTargetAtTime(level * load * 0.5, now, 0.08);
      loop.source.playbackRate.setTargetAtTime(0.8 + r * 0.9, now, 0.1);
    }
  }

  playOneShot(id: "collision" | "checkpoint" | "purchase", intensity = 1): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const now = performance.now();
    const last = this.lastOneShot.get(id) ?? -Infinity;
    if (now - last < 120) return; // 限频
    this.lastOneShot.set(id, now);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(1, Math.max(0.15, intensity)) * 0.9;
    source.connect(gain).connect(this.master);
    source.start();
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /** 比赛结束等场景：发动机声渐停。 */
  quietEngine(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const loop of this.loops) loop.gain.gain.setTargetAtTime(0, now, 0.15);
  }

  dispose(): void {
    for (const loop of this.loops) {
      try {
        loop.source.stop();
      } catch {
        // 已停止
      }
      loop.source.disconnect();
      loop.gain.disconnect();
    }
    this.loops = [];
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
    this.status = "locked";
  }
}
