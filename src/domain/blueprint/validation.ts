import {
  BUILD_BOUNDS,
  CHASSIS_CELLS,
  CHASSIS_LAYER_Y,
  MAX_BRICKS,
  MAX_INSTANCE_ID_LENGTH,
  RESERVED_WHEEL_CELLS,
  findBrickType,
  findColor,
  findPart,
  rotatedSize,
} from "../../content/catalog";
import type {
  BrickPlacement,
  GridPosition,
  ValidationResult,
  VehicleBlueprint,
} from "./types";

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export function cellsOf(brick: BrickPlacement): Cell[] {
  const type = findBrickType(brick.brickTypeId);
  if (!type) return [];
  const size = rotatedSize(type.size, brick.rotation);
  const cells: Cell[] = [];
  for (let dx = 0; dx < size.w; dx += 1) {
    for (let dy = 0; dy < size.h; dy += 1) {
      for (let dz = 0; dz < size.d; dz += 1) {
        cells.push({
          x: brick.position.x + dx,
          y: brick.position.y + dy,
          z: brick.position.z + dz,
        });
      }
    }
  }
  return cells;
}

function cellKey(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

function inBounds(c: Cell): boolean {
  return (
    c.x >= BUILD_BOUNDS.minX &&
    c.x <= BUILD_BOUNDS.maxX &&
    c.y >= BUILD_BOUNDS.minY &&
    c.y <= BUILD_BOUNDS.maxY &&
    c.z >= BUILD_BOUNDS.minZ &&
    c.z <= BUILD_BOUNDS.maxZ
  );
}

const RESERVED = new Set(RESERVED_WHEEL_CELLS.map((c) => cellKey(c)));
const CHASSIS_FOOTPRINT = new Set(CHASSIS_CELLS.map((c) => `${c.x},${c.z}`));

function isGroundedBrick(brick: BrickPlacement): boolean {
  return cellsOf(brick).some(
    (c) => c.y === CHASSIS_LAYER_Y + 1 && CHASSIS_FOOTPRINT.has(`${c.x},${c.z}`),
  );
}

function bricksAdjacent(a: BrickPlacement, b: BrickPlacement): boolean {
  const keys = new Set(cellsOf(a).map(cellKey));
  return cellsOf(b).some((c) => {
    return (
      keys.has(cellKey({ x: c.x + 1, y: c.y, z: c.z })) ||
      keys.has(cellKey({ x: c.x - 1, y: c.y, z: c.z })) ||
      keys.has(cellKey({ x: c.x, y: c.y + 1, z: c.z })) ||
      keys.has(cellKey({ x: c.x, y: c.y - 1, z: c.z })) ||
      keys.has(cellKey({ x: c.x, y: c.y, z: c.z + 1 })) ||
      keys.has(cellKey({ x: c.x, y: c.y, z: c.z - 1 }))
    );
  });
}

/** 全部积木必须从底盘锚点经面相邻连通。 */
export function allConnected(bricks: BrickPlacement[]): boolean {
  if (bricks.length === 0) return true;
  const visited = new Set<number>();
  const queue: number[] = [];
  bricks.forEach((b, i) => {
    if (isGroundedBrick(b)) {
      visited.add(i);
      queue.push(i);
    }
  });
  while (queue.length > 0) {
    const i = queue.shift() as number;
    const current = bricks[i] as BrickPlacement;
    bricks.forEach((other, j) => {
      if (!visited.has(j) && bricksAdjacent(current, other)) {
        visited.add(j);
        queue.push(j);
      }
    });
  }
  return visited.size === bricks.length;
}

export function validateBlueprint(bp: VehicleBlueprint): ValidationResult {
  if (bp.schemaVersion !== 1) return { ok: false, reason: "missing-core" };
  if (bp.bricks.length > MAX_BRICKS) return { ok: false, reason: "too-many-bricks" };

  const occupied = new Set<string>();
  for (const brick of bp.bricks) {
    if (!brick.instanceId || brick.instanceId.length > MAX_INSTANCE_ID_LENGTH) {
      return { ok: false, reason: "unknown-brick" };
    }
    if (!findBrickType(brick.brickTypeId)) return { ok: false, reason: "unknown-brick" };
    if (!findColor(brick.colorId)) return { ok: false, reason: "unknown-color" };
    for (const cell of cellsOf(brick)) {
      if (!inBounds(cell)) return { ok: false, reason: "out-of-bounds" };
      if (RESERVED.has(cellKey(cell))) return { ok: false, reason: "reserved-zone" };
      const key = cellKey(cell);
      if (occupied.has(key)) return { ok: false, reason: "overlap" };
      occupied.add(key);
    }
  }

  const engine = findPart(bp.slots.engineId);
  const wheelSet = findPart(bp.slots.wheelSetId);
  if (!engine || engine.kind !== "engine") return { ok: false, reason: "missing-core" };
  if (!wheelSet || wheelSet.kind !== "wheelSet") return { ok: false, reason: "missing-core" };
  if (bp.slots.aeroId !== undefined) {
    const aero = findPart(bp.slots.aeroId);
    if (!aero || aero.kind !== "aero") return { ok: false, reason: "unknown-part" };
  }
  if (bp.slots.bumperId !== undefined) {
    const bumper = findPart(bp.slots.bumperId);
    if (!bumper || bumper.kind !== "bumper") return { ok: false, reason: "unknown-part" };
  }

  if (!allConnected(bp.bricks)) return { ok: false, reason: "floating" };
  return { ok: true };
}

/** 单元格是否已被占据（供 UI 吸附预览）。 */
export function occupancyOf(bricks: BrickPlacement[]): Set<string> {
  const occupied = new Set<string>();
  for (const brick of bricks) {
    for (const cell of cellsOf(brick)) occupied.add(cellKey(cell));
  }
  return occupied;
}

export function gridPosition(x: number, y: number, z: number): GridPosition {
  return { x, y, z };
}
