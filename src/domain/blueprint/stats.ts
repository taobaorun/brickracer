import {
  CHASSIS_BASE_MASS,
  findBrickType,
  findPart,
  type AeroPart,
  type BumperPart,
  type EnginePart,
  type WheelSetPart,
} from "../../content/catalog";
import { cellsOf } from "./validation";
import type { VehicleBlueprint, VehicleStats } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 功能件主导性能；普通积木只通过总质量与重心偏移产生受控影响（I3/I4）。
 * 输入必须已通过 validateBlueprint。
 */
export function deriveStats(bp: VehicleBlueprint): VehicleStats {
  const engine = findPart(bp.slots.engineId) as EnginePart;
  const wheels = findPart(bp.slots.wheelSetId) as WheelSetPart;
  const aero = bp.slots.aeroId ? (findPart(bp.slots.aeroId) as AeroPart) : undefined;
  const bumper = bp.slots.bumperId ? (findPart(bp.slots.bumperId) as BumperPart) : undefined;

  let mass = CHASSIS_BASE_MASS + (bumper?.massBonus ?? 0);
  let wx = 0;
  let wy = 0;
  let wz = 0;
  for (const brick of bp.bricks) {
    const type = findBrickType(brick.brickTypeId);
    if (!type) continue;
    const cells = cellsOf(brick);
    const per = type.mass / Math.max(1, cells.length);
    for (const c of cells) {
      mass += per;
      wx += per * c.x;
      wy += per * c.y;
      wz += per * c.z;
    }
  }
  const centerOfMass = {
    x: clamp(wx / mass, -1.5, 1.5),
    y: clamp(wy / mass, 0, 3),
    z: clamp(wz / mass, -2, 2),
  };

  const massRatio = CHASSIS_BASE_MASS / mass;
  const acceleration = clamp(engine.engineForce * massRatio * 1.6, 2, 40);
  const topSpeed = clamp(
    engine.topSpeed * (0.85 + 0.3 * massRatio) + (aero?.topSpeedBonus ?? 0),
    10,
    60,
  );
  const grip = clamp(wheels.grip * (1 - Math.abs(centerOfMass.x) * 0.15), 0.3, 2);
  const braking = clamp(wheels.braking * (0.9 + 0.2 * massRatio), 0.3, 2);
  const stability = clamp(
    1 - centerOfMass.y * 0.18 + (aero?.stabilityBonus ?? 0) + (bumper?.stabilityBonus ?? 0),
    0.2,
    1.5,
  );

  const matchmakingRating =
    acceleration * 8 + topSpeed * 4 + grip * 30 + braking * 20 + stability * 40;

  return {
    mass,
    centerOfMass,
    acceleration,
    topSpeed,
    grip,
    braking,
    stability,
    matchmakingRating,
  };
}
