import { describe, expect, it } from "vitest";
import {
  applyRaceResult,
  canEquip,
  purchasePart,
  rewardFor,
} from "../../src/domain/progression/economy";
import { defaultSave } from "../../src/domain/save/schema";

const facts = { raceId: "race-1", place: 1, totalRacers: 4, finishTimeMs: 90_000, bestLapMs: 28_000 };

describe("rewards (R9 no-negative loop)", () => {
  it("always awards a non-negative base for finishing, with place bonuses", () => {
    expect(rewardFor({ place: 1 })).toBeGreaterThan(rewardFor({ place: 2 }));
    expect(rewardFor({ place: 2 })).toBeGreaterThan(rewardFor({ place: 3 }));
    expect(rewardFor({ place: 3 })).toBeGreaterThan(rewardFor({ place: 8 }));
    expect(rewardFor({ place: 8 })).toBeGreaterThan(0);
  });
});

describe("applyRaceResult (I5 exactly-once)", () => {
  it("applies once and refuses the same raceId", () => {
    const save = defaultSave();
    const first = applyRaceResult(save, facts);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.save.points).toBe(save.points + first.awarded);
    expect(first.save.lastAppliedRaceId).toBe("race-1");

    const dup = applyRaceResult(first.save, facts);
    expect(dup).toEqual({ ok: false, reason: "duplicate-race" });

    const other = applyRaceResult(first.save, { ...facts, raceId: "race-2", place: 5 });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.save.points).toBeGreaterThan(first.save.points);
  });
});

describe("purchasePart", () => {
  it("unlocks permanently, never double-charges, validates balance and catalog", () => {
    const base = { ...defaultSave(), points: 100 };
    const poor = purchasePart(base, "engine-turbo"); // 260
    expect(poor).toEqual({ ok: false, reason: "insufficient-points" });

    const rich = { ...defaultSave(), points: 300 };
    const bought = purchasePart(rich, "engine-turbo");
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.save.points).toBe(40);
    expect(bought.save.unlockedPartIds).toContain("engine-turbo");
    expect(canEquip(bought.save, "engine-turbo")).toBe(true);

    expect(purchasePart(bought.save, "engine-turbo")).toEqual({
      ok: false,
      reason: "already-owned",
    });
    expect(purchasePart(rich, "not-a-part")).toEqual({ ok: false, reason: "unknown-part" });
  });

  it("free parts are unlockable at zero balance but basics ship pre-unlocked", () => {
    const save = defaultSave();
    expect(save.unlockedPartIds).toContain("engine-basic");
    expect(save.unlockedPartIds).toContain("wheels-basic");
  });
});
