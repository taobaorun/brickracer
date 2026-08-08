import type {
  BrickPlacement,
  GridPosition,
  InvalidReason,
  QuarterTurn,
  VehicleBlueprint,
} from "./types";
import { validateBlueprint } from "./validation";

export type BlueprintCommand =
  | { type: "placeBrick"; brick: BrickPlacement }
  | { type: "removeBrick"; instanceId: string }
  | { type: "rotateBrick"; instanceId: string; rotation: QuarterTurn }
  | { type: "moveBrick"; instanceId: string; position: GridPosition }
  | { type: "equipPart"; slot: "engineId" | "wheelSetId" | "aeroId" | "bumperId"; partId: string | undefined };

export type CommandResult =
  | { ok: true; blueprint: VehicleBlueprint }
  | { ok: false; reason: InvalidReason };

function apply(bp: VehicleBlueprint, cmd: BlueprintCommand): VehicleBlueprint {
  switch (cmd.type) {
    case "placeBrick":
      return { ...bp, bricks: [...bp.bricks, cmd.brick] };
    case "removeBrick":
      return { ...bp, bricks: bp.bricks.filter((b) => b.instanceId !== cmd.instanceId) };
    case "rotateBrick":
      return {
        ...bp,
        bricks: bp.bricks.map((b) =>
          b.instanceId === cmd.instanceId ? { ...b, rotation: cmd.rotation } : b,
        ),
      };
    case "moveBrick":
      return {
        ...bp,
        bricks: bp.bricks.map((b) =>
          b.instanceId === cmd.instanceId ? { ...b, position: cmd.position } : b,
        ),
      };
    case "equipPart": {
      const slots = { ...bp.slots };
      if (cmd.partId === undefined && (cmd.slot === "aeroId" || cmd.slot === "bumperId")) {
        delete slots[cmd.slot];
      } else if (cmd.partId !== undefined) {
        slots[cmd.slot] = cmd.partId;
      }
      return { ...bp, slots };
    }
  }
}

/**
 * 应用一条搭建命令。非法命令返回原因码且权威蓝图保持不变。
 * removeBrick 对不存在的 id 返回 not-found，不移除后也做连通性校验（防拆断）。
 */
export function applyCommand(bp: VehicleBlueprint, cmd: BlueprintCommand): CommandResult {
  if (cmd.type !== "placeBrick") {
    const id = "instanceId" in cmd ? cmd.instanceId : undefined;
    if (id !== undefined && !bp.bricks.some((b) => b.instanceId === id)) {
      return { ok: false, reason: "not-found" };
    }
  }
  const next = apply(bp, cmd);
  const verdict = validateBlueprint(next);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, blueprint: next };
}
