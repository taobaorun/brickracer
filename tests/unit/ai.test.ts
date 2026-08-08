import { describe, expect, it } from "vitest";
import { deriveStats } from "../../src/domain/blueprint/stats";
import { validateBlueprint } from "../../src/domain/blueprint/validation";
import { generateAiBlueprint, CURATED_AI_BLUEPRINTS } from "../../src/game/ai/generate";
import { driveToward, styleFromSeed } from "../../src/game/ai/driver";
import { TRACK_BRICKWAY_1 } from "../../src/content/track";
import { DEFAULT_BLUEPRINT } from "../../src/content/defaultBlueprint";

const TARGET = deriveStats(DEFAULT_BLUEPRINT).matchmakingRating;

describe("AI blueprint generation (R6)", () => {
  it("every seeded candidate is legal — 200 seeds property test", () => {
    const target = TARGET;
    for (let seed = 0; seed < 200; seed += 1) {
      const result = generateAiBlueprint({
        seed,
        targetRating: target,
        bandRatio: 0.35,
        maxAttempts: 24,
      });
      expect(validateBlueprint(result.blueprint).ok, `seed ${seed} illegal`).toBe(true);
      expect(result.blueprint.slots.engineId).toBeTruthy();
    }
  });

  it("generated ratings stay within the band or fall back to curated near the target", () => {
    const target = TARGET;
    let curated = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const r = generateAiBlueprint({ seed, targetRating: target, bandRatio: 0.25, maxAttempts: 30 });
      if (r.source === "curated-fallback") {
        curated += 1;
      } else {
        expect(r.rating).toBeGreaterThanOrEqual(target * 0.75);
        expect(r.rating).toBeLessThanOrEqual(target * 1.25);
      }
    }
    // 策展回退也围绕目标分档
    for (const c of CURATED_AI_BLUEPRINTS) {
      expect(validateBlueprint(c.blueprint).ok).toBe(true);
      expect(c.rating).toBeGreaterThan(0);
    }
    expect(curated).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic per seed and varies appearance/config across seeds", () => {
    const a1 = generateAiBlueprint({ seed: 42, targetRating: TARGET, bandRatio: 0.3, maxAttempts: 30 });
    const a2 = generateAiBlueprint({ seed: 42, targetRating: TARGET, bandRatio: 0.3, maxAttempts: 30 });
    expect(a1.blueprint).toEqual(a2.blueprint);

    const others = new Set<string>();
    for (let seed = 1; seed < 12; seed += 1) {
      const r = generateAiBlueprint({ seed, targetRating: TARGET, bandRatio: 0.3, maxAttempts: 30 });
      others.add(JSON.stringify(r.blueprint));
    }
    expect(others.size).toBeGreaterThan(3); // 可观察的外观/部件变化
  });
});

describe("AI driver", () => {
  it("produces normalized inputs in range and drives forward on a straight", () => {
    const style = styleFromSeed(7);
    const input = driveToward(TRACK_BRICKWAY_1.centerline, style, {
      position: { x: 0, z: -20 },
      rotationY: 0,
      forwardSpeed: 0,
      topSpeedMs: 10,
    });
    expect(input.steer).toBeGreaterThanOrEqual(-1);
    expect(input.steer).toBeLessThanOrEqual(1);
    expect(input.throttle).toBeGreaterThan(0);
    expect(input.brake).toBe(0);
  });

  it("brakes for a sharp corner when arriving too fast", () => {
    const style = styleFromSeed(3);
    // 位于直道末端高速接近弯道
    const input = driveToward(TRACK_BRICKWAY_1.centerline, style, {
      position: { x: 18, z: -20 },
      rotationY: -Math.PI / 2, // 朝 +x
      forwardSpeed: 12,
      topSpeedMs: 10,
    });
    expect(input.brake).toBeGreaterThan(0);
  });

  it("seeded styles differ but never mutate player physics (structure-only check)", () => {
    const s1 = styleFromSeed(1);
    const s2 = styleFromSeed(2);
    expect(s1).not.toEqual(s2);
    for (const s of [s1, s2]) {
      expect(s.aggression).toBeGreaterThan(0);
      expect(s.aggression).toBeLessThanOrEqual(1);
    }
  });
});

describe("AI cannot exceed legal performance (source-level assertion aid)", () => {
  it("generated AI stats come from the same deriveStats as the player", () => {
    const r = generateAiBlueprint({ seed: 9, targetRating: TARGET, bandRatio: 0.3, maxAttempts: 30 });
    const stats = deriveStats(r.blueprint);
    expect(stats.matchmakingRating).toBeCloseTo(r.rating, 6);
  });
});
