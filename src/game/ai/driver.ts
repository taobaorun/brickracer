import type { NormalizedInput } from "../../input/normalized";
import { mulberry32 } from "./rng";

export interface DriverStyle {
  /** 反应与线路偏移、保守刹车程度都由种子决定；不瞬移、不改玩家物理。 */
  laneOffset: number;
  aggression: number; // 0..1，影响目标速度系数
  lookahead: number; // 前视距离（米）
}

export function styleFromSeed(seed: number): DriverStyle {
  const rng = mulberry32(seed);
  return {
    laneOffset: (rng() - 0.5) * 2.4,
    aggression: 0.85 + rng() * 0.15,
    lookahead: 7 + rng() * 4,
  };
}

export interface CenterlinePoint {
  x: number;
  z: number;
}

/** 找中线上最近点索引。 */
export function nearestCenterlineIndex(
  centerline: readonly CenterlinePoint[],
  pos: { x: number; z: number },
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centerline.length; i += 1) {
    const p = centerline[i]!;
    const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * AI 驾驶员：沿固定中线前视选目标点，按弯道曲率选目标速度，
 * 产出与玩家相同的归一化输入（I7）。
 */
export function driveToward(
  centerline: readonly CenterlinePoint[],
  style: DriverStyle,
  state: { position: { x: number; z: number }; rotationY: number; forwardSpeed: number; topSpeedMs: number },
): NormalizedInput {
  const n = centerline.length;
  const near = nearestCenterlineIndex(centerline, state.position);
  // 按弧长近似取前视点（中线点距约 4.5m）
  const aheadIdx = (near + Math.max(1, Math.round(style.lookahead / 5))) % n;
  const target = centerline[aheadIdx]!;
  // 车道偏移：垂直于前进方向
  const prev = centerline[(aheadIdx + n - 1) % n]!;
  const dirX = target.x - prev.x;
  const dirZ = target.z - prev.z;
  const len = Math.hypot(dirX, dirZ) || 1;
  const offX = (-dirZ / len) * style.laneOffset;
  const offZ = (dirX / len) * style.laneOffset;

  const dx = target.x + offX - state.position.x;
  const dz = target.z + offZ - state.position.z;
  // 车头朝向约定：yaw=0 朝 +z（Rapier 车辆本地 +z 前进），heading=(sin yaw, cos yaw)
  const targetYaw = Math.atan2(dx, dz);
  const yawError = normalizeAngle(targetYaw - state.rotationY);
  const steer = Math.max(-1, Math.min(1, yawError * 1.3));

  // 曲率 → 目标速度：用前视两段方向夹角估计
  const next = centerline[(aheadIdx + 1) % n]!;
  const nDirX = next.x - target.x;
  const nDirZ = next.z - target.z;
  const turn = Math.abs(normalizeAngle(Math.atan2(nDirX, nDirZ) - Math.atan2(dirX, dirZ)));
  const cornerFactor = Math.max(0.75, 1 - turn);
  const targetSpeed = state.topSpeedMs * style.aggression * cornerFactor;

  const braking = state.forwardSpeed > targetSpeed + 1.2;
  const throttle = braking ? 0 : state.forwardSpeed < targetSpeed ? 1 : 0.6;

  return {
    steer,
    throttle,
    brake: braking ? 0.8 : 0,
    resetPressed: false,
    pausePressed: false,
  };
}
