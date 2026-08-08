import type { QuarterTurn } from "../domain/blueprint/types";

/** 积木类型：以底盘锚点格为基准的占据尺寸（单位：格）。 */
export interface BrickType {
  id: string;
  /** 未旋转时的宽(x)、高(y)、深(z)。 */
  size: { w: number; h: number; d: number };
  mass: number;
}

export interface ColorDef {
  id: string;
  hex: string;
}

export interface EnginePart {
  kind: "engine";
  id: string;
  name: string;
  price: number;
  engineForce: number;
  topSpeed: number;
}

export interface WheelSetPart {
  kind: "wheelSet";
  id: string;
  name: string;
  price: number;
  grip: number;
  braking: number;
}

export interface AeroPart {
  kind: "aero";
  id: string;
  name: string;
  price: number;
  stabilityBonus: number;
  topSpeedBonus: number;
}

export interface BumperPart {
  kind: "bumper";
  id: string;
  name: string;
  price: number;
  massBonus: number;
  stabilityBonus: number;
}

export type FunctionalPart = EnginePart | WheelSetPart | AeroPart | BumperPart;

export const BRICK_TYPES: readonly BrickType[] = [
  { id: "brick-1x1", size: { w: 1, h: 1, d: 1 }, mass: 1 },
  { id: "brick-2x1", size: { w: 2, h: 1, d: 1 }, mass: 2 },
  { id: "brick-2x2", size: { w: 2, h: 1, d: 2 }, mass: 4 },
  { id: "brick-1x1-round", size: { w: 1, h: 1, d: 1 }, mass: 1 },
  { id: "brick-2x1-slope", size: { w: 2, h: 1, d: 1 }, mass: 2 },
] as const;

export const COLORS: readonly ColorDef[] = [
  { id: "red", hex: "#d23c2e" },
  { id: "blue", hex: "#2e6fd2" },
  { id: "yellow", hex: "#e8c12a" },
  { id: "green", hex: "#3aa655" },
  { id: "white", hex: "#f2f2f2" },
  { id: "black", hex: "#26262a" },
] as const;

export const ENGINES: readonly EnginePart[] = [
  { kind: "engine", id: "engine-basic", name: "基础发动机", price: 0, engineForce: 10, topSpeed: 24 },
  { kind: "engine", id: "engine-sport", name: "运动发动机", price: 120, engineForce: 14, topSpeed: 30 },
  { kind: "engine", id: "engine-turbo", name: "涡轮发动机", price: 260, engineForce: 18, topSpeed: 36 },
] as const;

export const WHEEL_SETS: readonly WheelSetPart[] = [
  { kind: "wheelSet", id: "wheels-basic", name: "基础轮胎", price: 0, grip: 1.0, braking: 1.0 },
  { kind: "wheelSet", id: "wheels-grip", name: "抓地轮胎", price: 100, grip: 1.3, braking: 1.15 },
  { kind: "wheelSet", id: "wheels-drift", name: "漂移轮胎", price: 100, grip: 0.8, braking: 0.9 },
] as const;

export const AERO_PARTS: readonly AeroPart[] = [
  { kind: "aero", id: "aero-spoiler", name: "尾翼", price: 80, stabilityBonus: 0.15, topSpeedBonus: 1 },
] as const;

export const BUMPER_PARTS: readonly BumperPart[] = [
  { kind: "bumper", id: "bumper-guard", name: "防撞杠", price: 50, massBonus: 8, stabilityBonus: 0.1 },
] as const;

export const ALL_PARTS: readonly FunctionalPart[] = [
  ...ENGINES,
  ...WHEEL_SETS,
  ...AERO_PARTS,
  ...BUMPER_PARTS,
] as const;

export function findBrickType(id: string): BrickType | undefined {
  return BRICK_TYPES.find((b) => b.id === id);
}

export function findColor(id: string): ColorDef | undefined {
  return COLORS.find((c) => c.id === id);
}

export function findPart(id: string): FunctionalPart | undefined {
  return ALL_PARTS.find((p) => p.id === id);
}

/** 旋转后的占据尺寸（绕 y 轴四分之一圈）。 */
export function rotatedSize(size: BrickType["size"], rotation: QuarterTurn): BrickType["size"] {
  return rotation % 2 === 0 ? size : { w: size.d, h: size.h, d: size.w };
}

/** 搭建边界（含）。底盘占据 y=0 的 x∈[-2,2]、z∈[-3,3]。 */
export const BUILD_BOUNDS = {
  minX: -3,
  maxX: 3,
  minY: 1,
  maxY: 5,
  minZ: -4,
  maxZ: 4,
} as const;

export const CHASSIS_LAYER_Y = 0;
export const CHASSIS_CELLS: ReadonlyArray<{ x: number; z: number }> = (() => {
  const cells: Array<{ x: number; z: number }> = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      cells.push({ x, z });
    }
  }
  return cells;
})();

export const MAX_BRICKS = 120;
export const MAX_INSTANCE_ID_LENGTH = 64;
export const CHASSIS_BASE_MASS = 40;

/** 车轮等保留区域：车轮舱格位不允许普通积木占据。 */
export const RESERVED_WHEEL_CELLS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -3, y: 1, z: -2 },
  { x: 3, y: 1, z: -2 },
  { x: -3, y: 1, z: 2 },
  { x: 3, y: 1, z: 2 },
] as const;
