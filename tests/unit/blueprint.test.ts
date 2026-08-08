import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/domain/blueprint/commands";
import { deriveStats } from "../../src/domain/blueprint/stats";
import { allConnected, validateBlueprint } from "../../src/domain/blueprint/validation";
import type { BrickPlacement, VehicleBlueprint } from "../../src/domain/blueprint/types";
import { DEFAULT_BLUEPRINT } from "../../src/content/defaultBlueprint";
import { MAX_BRICKS } from "../../src/content/catalog";

let counter = 0;
function brick(over: Partial<BrickPlacement>): BrickPlacement {
  counter += 1;
  return {
    instanceId: `t-${counter}`,
    brickTypeId: "brick-1x1",
    colorId: "red",
    position: { x: 0, y: 1, z: 0 },
    rotation: 0,
    ...over,
  };
}

function emptyBp(): VehicleBlueprint {
  return { schemaVersion: 1, bricks: [], slots: { engineId: "engine-basic", wheelSetId: "wheels-basic" } };
}

describe("validateBlueprint", () => {
  it("accepts the default blueprint and requires core parts", () => {
    expect(validateBlueprint(DEFAULT_BLUEPRINT).ok).toBe(true);
    const noEngine = { ...DEFAULT_BLUEPRINT, slots: { ...DEFAULT_BLUEPRINT.slots, engineId: "nope" } };
    expect(validateBlueprint(noEngine)).toEqual({ ok: false, reason: "missing-core" });
  });

  it("rejects overlap, out-of-bounds, reserved zone and unknown ids", () => {
    const base = emptyBp();
    const a = brick({ position: { x: 0, y: 1, z: 0 } });
    const withA = { ...base, bricks: [a] };
    expect(validateBlueprint(withA).ok).toBe(true);

    const overlap = { ...base, bricks: [a, brick({ position: { x: 0, y: 1, z: 0 } })] };
    expect(validateBlueprint(overlap)).toEqual({ ok: false, reason: "overlap" });

    const oob = { ...base, bricks: [brick({ position: { x: 99, y: 1, z: 0 } })] };
    expect(validateBlueprint(oob)).toEqual({ ok: false, reason: "out-of-bounds" });

    const reserved = { ...base, bricks: [brick({ position: { x: 3, y: 1, z: 2 } })] };
    expect(validateBlueprint(reserved)).toEqual({ ok: false, reason: "reserved-zone" });

    const unknownBrick = { ...base, bricks: [brick({ brickTypeId: "nope" })] };
    expect(validateBlueprint(unknownBrick)).toEqual({ ok: false, reason: "unknown-brick" });

    const unknownColor = { ...base, bricks: [brick({ colorId: "nope" })] };
    expect(validateBlueprint(unknownColor)).toEqual({ ok: false, reason: "unknown-color" });

    const badAero = { ...base, bricks: [a], slots: { ...base.slots, aeroId: "engine-sport" } };
    expect(validateBlueprint(badAero)).toEqual({ ok: false, reason: "unknown-part" });
  });

  it("rejects floating bricks and enforces the brick cap", () => {
    const base = emptyBp();
    const floating = {
      ...base,
      bricks: [
        brick({ position: { x: 0, y: 1, z: 0 } }),
        brick({ position: { x: 0, y: 3, z: 0 } }),
      ],
    };
    // 两块各自不连通：y=3 的块与 y=1 的块之间隔着 y=2
    expect(validateBlueprint(floating)).toEqual({ ok: false, reason: "floating" });

    const many: BrickPlacement[] = [];
    for (let i = 0; i < MAX_BRICKS + 1; i += 1) {
      many.push(brick({ position: { x: 0, y: 1, z: 0 } }));
    }
    expect(validateBlueprint({ ...base, bricks: many })).toEqual({
      ok: false,
      reason: "too-many-bricks",
    });
  });

  it("treats rotated footprints correctly for overlap", () => {
    const base = emptyBp();
    const long = brick({ brickTypeId: "brick-2x1", position: { x: 0, y: 1, z: 0 }, rotation: 1 });
    // 旋转 1 后占据 (0,1,0) 与 (0,1,1)
    const clash = brick({ position: { x: 0, y: 1, z: 1 } });
    expect(validateBlueprint({ ...base, bricks: [long, clash] })).toEqual({
      ok: false,
      reason: "overlap",
    });
  });
});

describe("allConnected", () => {
  it("accepts stacks rooted on the chassis and rejects islands", () => {
    const stack = [
      brick({ position: { x: 0, y: 1, z: 0 } }),
      brick({ position: { x: 0, y: 2, z: 0 } }),
      brick({ position: { x: 0, y: 3, z: 0 } }),
    ];
    expect(allConnected(stack)).toBe(true);
    expect(allConnected([...stack, brick({ position: { x: 2, y: 4, z: 2 } })])).toBe(false);
  });
});

describe("applyCommand", () => {
  it("keeps the authoritative blueprint unchanged on invalid commands", () => {
    const before = DEFAULT_BLUEPRINT;
    const dup = DEFAULT_BLUEPRINT.bricks[0]!;
    const result = applyCommand(before, { type: "placeBrick", brick: dup });
    expect(result.ok).toBe(false);
    expect(before.bricks).toHaveLength(4);
  });

  it("removes bricks but rejects removal that orphans others", () => {
    const stem = brick({ position: { x: 1, y: 1, z: 1 } });
    const top = brick({ position: { x: 1, y: 2, z: 1 } });
    const placed1 = applyCommand(DEFAULT_BLUEPRINT, { type: "placeBrick", brick: stem });
    expect(placed1.ok).toBe(true);
    if (!placed1.ok) return;
    const placed2 = applyCommand(placed1.blueprint, { type: "placeBrick", brick: top });
    expect(placed2.ok).toBe(true);
    if (!placed2.ok) return;

    const orphaning = applyCommand(placed2.blueprint, { type: "removeBrick", instanceId: stem.instanceId });
    expect(orphaning).toEqual({ ok: false, reason: "floating" });

    const fine = applyCommand(placed2.blueprint, { type: "removeBrick", instanceId: top.instanceId });
    expect(fine.ok).toBe(true);

    expect(
      applyCommand(placed2.blueprint, { type: "removeBrick", instanceId: "missing" }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("equips and unequips optional slots", () => {
    const equipped = applyCommand(DEFAULT_BLUEPRINT, {
      type: "equipPart",
      slot: "aeroId",
      partId: "aero-spoiler",
    });
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    expect(equipped.blueprint.slots.aeroId).toBe("aero-spoiler");

    const removed = applyCommand(equipped.blueprint, {
      type: "equipPart",
      slot: "aeroId",
      partId: undefined,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.blueprint.slots.aeroId).toBeUndefined();

    const wrongKind = applyCommand(DEFAULT_BLUEPRINT, {
      type: "equipPart",
      slot: "engineId",
      partId: "wheels-grip",
    });
    expect(wrongKind).toEqual({ ok: false, reason: "missing-core" });
  });
});

describe("deriveStats", () => {
  it("is deterministic and functional-part dominated", () => {
    const s1 = deriveStats(DEFAULT_BLUEPRINT);
    const s2 = deriveStats(DEFAULT_BLUEPRINT);
    expect(s1).toEqual(s2);

    const sporty: VehicleBlueprint = {
      ...DEFAULT_BLUEPRINT,
      slots: { ...DEFAULT_BLUEPRINT.slots, engineId: "engine-turbo", wheelSetId: "wheels-grip" },
    };
    const s3 = deriveStats(sporty);
    expect(s3.topSpeed).toBeGreaterThan(s1.topSpeed);
    expect(s3.acceleration).toBeGreaterThan(s1.acceleration);
    expect(s3.grip).toBeGreaterThan(s1.grip);
    expect(s3.matchmakingRating).toBeGreaterThan(s1.matchmakingRating);
  });

  it("lets added bricks shift mass and balance within clamps, never undriveable", () => {
    const heavy: VehicleBlueprint = {
      ...DEFAULT_BLUEPRINT,
      bricks: [
        ...DEFAULT_BLUEPRINT.bricks,
        brick({ brickTypeId: "brick-1x1", position: { x: 0, y: 3, z: -1 } }),
        brick({ brickTypeId: "brick-1x1", position: { x: -1, y: 3, z: -1 } }),
        brick({ brickTypeId: "brick-1x1", position: { x: 0, y: 4, z: -1 } }),
        brick({ brickTypeId: "brick-1x1", position: { x: -1, y: 4, z: -1 } }),
      ],
    };
    expect(validateBlueprint(heavy).ok).toBe(true);
    const light = deriveStats(DEFAULT_BLUEPRINT);
    const loaded = deriveStats(heavy);
    expect(loaded.mass).toBeGreaterThan(light.mass);
    expect(loaded.acceleration).toBeLessThan(light.acceleration);
    expect(loaded.acceleration).toBeGreaterThanOrEqual(2);
    expect(loaded.stability).toBeGreaterThanOrEqual(0.2);
  });
});
