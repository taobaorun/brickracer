import { describe, expect, it } from "vitest";
import { RaceState, type CheckpointDef } from "../../src/domain/race/raceState";

const CPS: CheckpointDef[] = [
  { x: 0, z: 0, radius: 5 }, // 起点线
  { x: 50, z: 0, radius: 5 },
  { x: 50, z: 50, radius: 5 },
  { x: 0, z: 50, radius: 5 },
];

function makeRace(laps = 2, racers = ["player", "ai-1"]) {
  return new RaceState("race-t", laps, CPS, racers);
}

/** 沿 CP1→CP2→CP3→CP0 走一圈。 */
function driveLap(race: RaceState, id: string, t: { now: number }, stepMs = 1000) {
  for (const cp of [CPS[1]!, CPS[2]!, CPS[3]!, CPS[0]!]) {
    t.now += stepMs;
    race.observe(id, { x: cp.x, z: cp.z }, t.now);
  }
}

describe("RaceState ordered checkpoints (R6)", () => {
  it("only counts laps through ordered checkpoint passage", () => {
    const race = makeRace();
    const t = { now: 0 };
    // 停在起点线附近转圈：不推进
    for (let i = 0; i < 20; i += 1) {
      t.now += 500;
      race.observe("player", { x: 1, z: 1 }, t.now);
    }
    expect(race.lapOf("player")).toBe(0);
    expect(race.isFinished("player")).toBe(false);

    // 跳过中间检查点直接到终点线也不算
    race.observe("player", { x: 0, z: 0 }, (t.now += 500));
    expect(race.lapOf("player")).toBe(0);
  });

  it("completes laps in order, tracks best lap and finishes exactly at laps", () => {
    const race = makeRace(2);
    const t = { now: 0 };
    driveLap(race, "player", t);
    expect(race.lapOf("player")).toBe(1);
    expect(race.isFinished("player")).toBe(false);
    driveLap(race, "player", t);
    expect(race.lapOf("player")).toBe(2);
    expect(race.isFinished("player")).toBe(true);
  });

  it("ranks by lap → checkpoint → distance; finishers keep order", () => {
    const race = makeRace(1, ["player", "ai-1"]);
    const t = { now: 0 };
    // ai-1 先过 CP1
    race.observe("ai-1", CPS[1]!, (t.now += 1000));
    race.observe("player", { x: 40, z: 0 }, (t.now += 10));
    expect(race.placeOf("ai-1")).toBe(1);
    expect(race.placeOf("player")).toBe(2);
    // player 先完赛
    driveLap(race, "player", t);
    driveLap(race, "ai-1", t);
    expect(race.placeOf("player")).toBe(1);
    expect(race.placeOf("ai-1")).toBe(2);
    // 结算令牌单次有效（只针对被结算者）
    const rp = race.takeResult("player");
    expect(rp?.place).toBe(1);
    expect(race.takeResult("ai-1")).toBeNull();
  });

  it("result token is single-use (I5)", () => {
    const race = makeRace(1, ["player"]);
    const t = { now: 0 };
    driveLap(race, "player", t);
    const first = race.takeResult("player");
    expect(first).not.toBeNull();
    expect(first?.raceId).toBe("race-t");
    expect(race.takeResult("player")).toBeNull();
  });
});
