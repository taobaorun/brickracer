import { findBrickType, findPart, rotatedSize, CHASSIS_CELLS } from "../../content/catalog";
import { deriveStats } from "../../domain/blueprint/stats";
import type { VehicleBlueprint } from "../../domain/blueprint/types";

/** 一格积木的世界尺寸（米）。 */
export const CELL_SIZE = 0.5;

export interface RenderInstance {
  instanceId: string;
  brickTypeId: string;
  colorId: string;
  /** 世界平移（相对底盘原点）与绕 y 旋转（弧度）。 */
  offset: { x: number; y: number; z: number };
  rotationY: number;
  size: { w: number; h: number; d: number };
}

/** 聚合车辆物理规格（I3）：单刚体 + 射线轮参数。坐标均以网格原点（底盘底面中心高度 y=0）为基准。 */
export interface VehiclePhysicsSpec {
  halfExtents: { x: number; y: number; z: number };
  /** 外接盒中心 = 碰撞体偏移。 */
  colliderCenter: { x: number; y: number; z: number };
  mass: number;
  comOffset: { x: number; y: number; z: number };
  engineForce: number;
  topSpeed: number;
  grip: number;
  braking: number;
  stability: number;
  wheelRadius: number;
  wheelPositions: Array<{ x: number; y: number; z: number }>;
}

export interface CompiledVehicle {
  renderInstances: RenderInstance[];
  physics: VehiclePhysicsSpec;
  matchmakingRating: number;
}

function rotationToY(rotation: 0 | 1 | 2 | 3): number {
  return (rotation * Math.PI) / 2;
}

/** 把合法蓝图编译为渲染实例 + 一个聚合物理规格。 */
export function compileVehicle(bp: VehicleBlueprint): CompiledVehicle {
  const stats = deriveStats(bp);

  const renderInstances: RenderInstance[] = bp.bricks.map((brick) => {
    const type = findBrickType(brick.brickTypeId);
    const size = type ? rotatedSize(type.size, brick.rotation) : { w: 1, h: 1, d: 1 };
    return {
      instanceId: brick.instanceId,
      brickTypeId: brick.brickTypeId,
      colorId: brick.colorId,
      offset: {
        x: (brick.position.x + size.w / 2) * CELL_SIZE,
        y: (brick.position.y + size.h / 2) * CELL_SIZE,
        z: (brick.position.z + size.d / 2) * CELL_SIZE,
      },
      rotationY: rotationToY(brick.rotation),
      size,
    };
  });

  // 底盘碰撞体：底盘格子范围 + 一格高度，含上方积木的外接盒
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of CHASSIS_CELLS) {
    minX = Math.min(minX, c.x * CELL_SIZE);
    maxX = Math.max(maxX, (c.x + 1) * CELL_SIZE);
    minZ = Math.min(minZ, c.z * CELL_SIZE);
    maxZ = Math.max(maxZ, (c.z + 1) * CELL_SIZE);
  }
  minY = 0;
  maxY = CELL_SIZE;
  for (const inst of renderInstances) {
    minX = Math.min(minX, inst.offset.x - (inst.size.w * CELL_SIZE) / 2);
    maxX = Math.max(maxX, inst.offset.x + (inst.size.w * CELL_SIZE) / 2);
    minY = Math.min(minY, inst.offset.y - (inst.size.h * CELL_SIZE) / 2);
    maxY = Math.max(maxY, inst.offset.y + (inst.size.h * CELL_SIZE) / 2);
    minZ = Math.min(minZ, inst.offset.z - (inst.size.d * CELL_SIZE) / 2);
    maxZ = Math.max(maxZ, inst.offset.z + (inst.size.d * CELL_SIZE) / 2);
  }
  const halfExtents = {
    x: (maxX - minX) / 2,
    y: (maxY - minY) / 2,
    z: (maxZ - minZ) / 2,
  };
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };

  const engine = findPart(bp.slots.engineId);
  const forceScale = engine && engine.kind === "engine" ? engine.engineForce : 10;

  const wheelRadius = 0.35;
  const wheelY = center.y - halfExtents.y;
  const wx = halfExtents.x + wheelRadius * 0.4;
  const wz = halfExtents.z * 0.72;

  return {
    renderInstances,
    physics: {
      halfExtents,
      colliderCenter: center,
      mass: stats.mass,
      comOffset: {
        x: center.x + stats.centerOfMass.x * CELL_SIZE,
        y: center.y + stats.centerOfMass.y * CELL_SIZE * 0.2,
        z: center.z + stats.centerOfMass.z * CELL_SIZE,
      },
      engineForce: forceScale * stats.mass * 0.9,
      topSpeed: stats.topSpeed,
      grip: stats.grip,
      braking: stats.braking,
      stability: stats.stability,
      wheelRadius,
      wheelPositions: [
        { x: -wx, y: wheelY, z: -wz }, // 前左（-z 为车头方向）
        { x: wx, y: wheelY, z: -wz }, // 前右
        { x: -wx, y: wheelY, z: wz }, // 后左
        { x: wx, y: wheelY, z: wz }, // 后右
      ],
    },
    matchmakingRating: stats.matchmakingRating,
  };
}
