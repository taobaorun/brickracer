export type QuarterTurn = 0 | 1 | 2 | 3;

export interface GridPosition {
  x: number;
  y: number;
  z: number;
}

export interface BrickPlacement {
  instanceId: string;
  brickTypeId: string;
  colorId: string;
  position: GridPosition;
  rotation: QuarterTurn;
}

export interface FunctionalSlots {
  engineId: string;
  wheelSetId: string;
  aeroId?: string;
  bumperId?: string;
}

export interface VehicleBlueprint {
  schemaVersion: 1;
  bricks: BrickPlacement[];
  slots: FunctionalSlots;
}

export interface VehicleStats {
  mass: number;
  centerOfMass: { x: number; y: number; z: number };
  acceleration: number;
  topSpeed: number;
  grip: number;
  braking: number;
  stability: number;
  matchmakingRating: number;
}

/** 儿童可理解的短原因码；UI 负责映射到图标与文案。 */
export type InvalidReason =
  | "overlap"
  | "out-of-bounds"
  | "floating"
  | "reserved-zone"
  | "unknown-brick"
  | "unknown-color"
  | "unknown-part"
  | "too-many-bricks"
  | "missing-core"
  | "not-found";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: InvalidReason };
