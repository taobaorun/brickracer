import type { VehicleBlueprint } from "../domain/blueprint/types";

/** 新玩家的默认合法赛车：基础底盘 + 基础发动机/轮胎 + 少量装饰积木。 */
export const DEFAULT_BLUEPRINT: VehicleBlueprint = {
  schemaVersion: 1,
  bricks: [
    { instanceId: "b-cab-1", brickTypeId: "brick-2x2", colorId: "red", position: { x: -1, y: 1, z: -1 }, rotation: 0 },
    { instanceId: "b-nose-1", brickTypeId: "brick-2x1", colorId: "yellow", position: { x: -1, y: 1, z: -3 }, rotation: 0 },
    { instanceId: "b-tail-1", brickTypeId: "brick-2x1", colorId: "blue", position: { x: -1, y: 1, z: 2 }, rotation: 0 },
    { instanceId: "b-cab-2", brickTypeId: "brick-2x1", colorId: "white", position: { x: -1, y: 2, z: -1 }, rotation: 0 },
  ],
  slots: {
    engineId: "engine-basic",
    wheelSetId: "wheels-basic",
  },
};
