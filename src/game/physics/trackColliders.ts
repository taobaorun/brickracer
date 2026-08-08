import type { TrackDefinition } from "../../content/track";
import { collisionGroups, GROUP_CAR, GROUP_TRACK } from "./groups";
import type { RapierModule } from "./rapier";

export interface RailSegment {
  cx: number;
  cz: number;
  yaw: number;
  len: number;
}

/**
 * 护轨几何的唯一来源：内外两道矩形围墙（8 根连续长条，零缝隙、不自交）。
 * 弯道角落与圆角中线之间存在小口袋区，但全程封闭；卡死检测负责兜底复位。
 * 物理（碰撞体）与视觉（raceScene）共用。
 */
export function railSegments(track: TrackDefinition): RailSegment[] {
  let maxX = 0;
  let maxZ = 0;
  for (const p of track.centerline) {
    maxX = Math.max(maxX, Math.abs(p.x));
    maxZ = Math.max(maxZ, Math.abs(p.z));
  }
  const inner = { x: maxX - track.halfWidth - 0.4, z: maxZ - track.halfWidth - 0.4 };
  const outer = { x: maxX + track.halfWidth + 0.4, z: maxZ + track.halfWidth + 0.4 };
  const mk = (cx: number, cz: number, lenX: number, lenZ: number): RailSegment => ({
    cx,
    cz,
    yaw: lenX > lenZ ? Math.PI / 2 : 0, // 长轴沿 x 的段旋转 90°
    len: Math.max(lenX, lenZ),
  });
  return [
    // 外圈
    mk(0, -outer.z, outer.x * 2, 0),
    mk(0, outer.z, outer.x * 2, 0),
    mk(-outer.x, 0, 0, outer.z * 2),
    mk(outer.x, 0, 0, outer.z * 2),
    // 内圈
    mk(0, -inner.z, inner.x * 2, 0),
    mk(0, inner.z, inner.x * 2, 0),
    mk(-inner.x, 0, 0, inner.z * 2),
    mk(inner.x, 0, 0, inner.z * 2),
  ];
}

/**
 * 赛道静态碰撞体的唯一来源：地面 + 两侧护轨。
 * 渲染层（raceScene）与 headless 集成测试共用，保证行为一致。
 */
export function buildTrackColliders(
  RAPIER: RapierModule,
  world: InstanceType<RapierModule["World"]>,
  track: TrackDefinition,
): void {
  const ground = RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
    .setTranslation(0, -0.5, 0)
    .setFriction(1)
    .setCollisionGroups(collisionGroups(GROUP_TRACK, GROUP_CAR));
  world.createCollider(ground);

  for (const seg of railSegments(track)) {
    const col = RAPIER.ColliderDesc.cuboid(0.175, 0.45, seg.len / 2 + 0.02)
      .setTranslation(seg.cx, 0.45, seg.cz)
      .setRotation(yawQuat(seg.yaw))
      .setFriction(0.08)
      .setRestitution(0.25)
      .setCollisionGroups(collisionGroups(GROUP_TRACK, GROUP_CAR));
    world.createCollider(col);
  }
}

function yawQuat(yaw: number) {
  const half = yaw / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
