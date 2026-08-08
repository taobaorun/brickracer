import type { TrackDefinition } from "../../content/track";

export interface RecoveryTransform {
  position: { x: number; y: number; z: number };
  rotationY: number;
}

/**
 * 复位点计算的唯一来源（R5 容错）：取当前位置最近的检查点，
 * 朝向下一个检查点。运行时与 headless 测试共用。
 */
export function recoveryTransform(
  track: TrackDefinition,
  pos: { x: number; z: number },
): RecoveryTransform {
  const cps = track.checkpoints;
  let best = 0;
  let bestD = Infinity;
  cps.forEach((cp, i) => {
    const d = Math.hypot(cp.x - pos.x, cp.z - pos.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const cp = cps[best]!;
  const next = cps[(best + 1) % cps.length]!;
  return {
    position: { x: cp.x, y: 1.2, z: cp.z },
    rotationY: Math.atan2(next.x - cp.x, next.z - cp.z),
  };
}

/** 卡死检测：全油门但近乎静止持续 stuckMs 视为被困（护轨夹缝等）。 */
export class StuckDetector {
  private stuckSinceMs: number | null = null;

  update(speed: number, throttle: number, nowMs: number, stuckMs = 2500): boolean {
    const stuck = Math.abs(speed) < 0.5 && throttle > 0.7;
    if (!stuck) {
      this.stuckSinceMs = null;
      return false;
    }
    this.stuckSinceMs ??= nowMs;
    return nowMs - this.stuckSinceMs > stuckMs;
  }

  reset(): void {
    this.stuckSinceMs = null;
  }
}
