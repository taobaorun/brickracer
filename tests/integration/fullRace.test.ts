import { beforeAll, describe, expect, it } from "vitest";
import { TRACK_BRICKWAY_1 } from "../../src/content/track";
import { DEFAULT_BLUEPRINT } from "../../src/content/defaultBlueprint";
import { RaceState } from "../../src/domain/race/raceState";
import { applyRaceResult } from "../../src/domain/progression/economy";
import { defaultSave } from "../../src/domain/save/schema";
import { compileVehicle } from "../../src/game/vehicle/compiler";
import { VehiclePhysics } from "../../src/game/vehicle/vehiclePhysics";
import { initRapier, type RapierModule } from "../../src/game/physics/rapier";
import { generateAiBlueprint } from "../../src/game/ai/generate";
import { driveToward, styleFromSeed } from "../../src/game/ai/driver";
import { buildTrackColliders } from "../../src/game/physics/trackColliders";
import { recoveryTransform, StuckDetector } from "../../src/game/race/recovery";
import { FIXED_DT } from "../../src/game/runtime/fixedLoop";
import { NEUTRAL_INPUT } from "../../src/input/normalized";

let RAPIER: RapierModule;
beforeAll(async () => {
  RAPIER = await initRapier();
}, 60_000);

/**
 * 完整比赛的 headless 权威链路：固定步长 + 有序检查点 + AI 驾驶 + 结算幂等。
 * 玩家车由同一 driveToward 输入源驱动（I7：输入设备无关）。
 */
describe("full race pipeline (R5/R6/R9 integration)", () => {
  it("runs a complete 2-lap race, ranks finishers, settles exactly once", { timeout: 120_000 }, () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    buildTrackColliders(RAPIER, world, TRACK_BRICKWAY_1);

    const seed = 20260808;
    const playerCompiled = compileVehicle(DEFAULT_BLUEPRINT);
    const racers: Array<{
      id: string;
      vehicle: VehiclePhysics;
      style: ReturnType<typeof styleFromSeed>;
      topSpeedMs: number;
      upsideDownSteps?: number;
      stuck: StuckDetector;
    }> = [];

    const mk = (id: string, bp: typeof DEFAULT_BLUEPRINT, gridIdx: number, styleSeed: number) => {
      const compiled = compileVehicle(bp);
      const g = TRACK_BRICKWAY_1.startGrid[gridIdx % TRACK_BRICKWAY_1.startGrid.length]!;
      racers.push({
        id,
        vehicle: VehiclePhysics.create(RAPIER, world, compiled.physics, {
          position: { x: g.x, y: g.y, z: g.z },
          rotationY: g.rotationY,
        }),
        style: styleFromSeed(styleSeed),
        topSpeedMs: compiled.physics.topSpeed / 3.6,
        stuck: new StuckDetector(),
      });
    };
    mk("player", DEFAULT_BLUEPRINT, 0, seed);
    for (let i = 0; i < TRACK_BRICKWAY_1.aiCount; i += 1) {
      const gen = generateAiBlueprint({
        seed: seed + i * 7919,
        targetRating: playerCompiled.matchmakingRating,
        bandRatio: 0.3,
        maxAttempts: 30,
      });
      mk(`ai-${i}`, gen.blueprint, i + 1, seed + i * 104729);
    }

    const race = new RaceState(
      "race-it",
      TRACK_BRICKWAY_1.laps,
      TRACK_BRICKWAY_1.checkpoints.map((c) => ({ x: c.x, z: c.z, radius: c.radius })),
      racers.map((r) => r.id),
    );

    let clock = 0;
    const maxSteps = Math.round(240 / FIXED_DT); // 4 分钟模拟上限
    let steps = 0;
    while (!race.allFinished() && steps < maxSteps) {
      clock += FIXED_DT * 1000;
      for (const r of racers) {
        const t = r.vehicle.telemetry();
        // 与运行时一致的容错：低速翻车持续后自动回正（R5）
        if (r.vehicle.isUpsideDown() && t.speed < 1) {
          r.upsideDownSteps = (r.upsideDownSteps ?? 0) + 1;
          if (r.upsideDownSteps > 90) {
            r.vehicle.upright();
            r.upsideDownSteps = 0;
          }
        } else {
          r.upsideDownSteps = 0;
        }
        // 与运行时一致的卡死自救：全油门近静止超时 → 回最近检查点
        if (!race.isFinished(r.id) && r.stuck.update(t.speed, 1, clock)) {
          r.vehicle.resetTo(recoveryTransform(TRACK_BRICKWAY_1, { x: t.position.x, z: t.position.z }));
          r.stuck.reset();
        }
        const input = race.isFinished(r.id)
          ? NEUTRAL_INPUT
          : driveToward(TRACK_BRICKWAY_1.centerline, r.style, {
              position: { x: t.position.x, z: t.position.z },
              rotationY: t.rotationY,
              forwardSpeed: t.forwardSpeed,
              topSpeedMs: r.topSpeedMs,
            });
        r.vehicle.setInput(input);
        r.vehicle.step(FIXED_DT);
        const after = r.vehicle.telemetry();
        race.observe(r.id, { x: after.position.x, z: after.position.z }, clock);
      }
      world.timestep = FIXED_DT;
      world.step();
      steps += 1;
    }

    expect(race.isFinished("player"), "player did not finish within 240s simulated").toBe(true);
    const facts = race.takeResult("player");
    expect(facts).not.toBeNull();
    expect(race.takeResult("player")).toBeNull(); // 单次令牌

    const save = defaultSave();
    const first = applyRaceResult(save, facts!);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.save.points).toBeGreaterThan(save.points);
      const dup = applyRaceResult(first.save, facts!);
      expect(dup.ok).toBe(false); // 重复结算被拒绝
    }

    // 至少一辆 AI 也能完赛（实力匹配，非必败局）
    const aiFinished = racers.filter((r) => r.id !== "player" && race.isFinished(r.id)).length;
    expect(aiFinished).toBeGreaterThanOrEqual(1);
    world.free();
  });
});
