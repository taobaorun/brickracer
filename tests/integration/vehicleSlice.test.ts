import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BLUEPRINT } from "../../src/content/defaultBlueprint";
import { compileVehicle } from "../../src/game/vehicle/compiler";
import { VehiclePhysics } from "../../src/game/vehicle/vehiclePhysics";
import { FIXED_DT, FixedStepAccumulator } from "../../src/game/runtime/fixedLoop";
import { initRapier, type RapierModule } from "../../src/game/physics/rapier";
import { NEUTRAL_INPUT, type NormalizedInput } from "../../src/input/normalized";

let RAPIER: RapierModule;
beforeAll(async () => {
  RAPIER = await initRapier();
}, 60_000);

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const ground = RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(1);
  world.createCollider(ground);
  return world;
}

function spawnVehicle(world: InstanceType<RapierModule["World"]>) {
  const compiled = compileVehicle(DEFAULT_BLUEPRINT);
  return VehiclePhysics.create(RAPIER, world, compiled.physics, {
    position: { x: 0, y: 1.5, z: 0 },
    rotationY: 0,
  });
}

function drive(
  world: InstanceType<RapierModule["World"]>,
  car: VehiclePhysics,
  input: NormalizedInput,
  seconds: number,
) {
  car.setInput(input);
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    world.timestep = FIXED_DT;
    world.step();
    car.step(FIXED_DT);
  }
}

describe("U4 minimal vertical vehicle slice (headless Rapier seam)", () => {
  it("compiles the default blueprint into one aggregate body with four wheels", () => {
    const compiled = compileVehicle(DEFAULT_BLUEPRINT);
    expect(compiled.renderInstances.length).toBe(DEFAULT_BLUEPRINT.bricks.length);
    expect(compiled.physics.mass).toBeGreaterThan(0);
    expect(compiled.physics.wheelPositions).toHaveLength(4);
    expect(compiled.matchmakingRating).toBeGreaterThan(0);
  });

  it("accelerates deterministically: same seed inputs → same outcome", () => {
    const run = () => {
      const world = makeWorld();
      const car = spawnVehicle(world);
      drive(world, car, { ...NEUTRAL_INPUT, throttle: 1 }, 3);
      const t = car.telemetry();
      world.free();
      return t;
    };
    const a = run();
    const b = run();
    expect(a.forwardSpeed).toBeGreaterThan(3); // 真的动起来了
    expect(a.forwardSpeed).toBeCloseTo(b.forwardSpeed, 6);
    expect(a.position.z).toBeCloseTo(b.position.z, 6);
  });

  it("respects the top-speed ceiling and brakes to a stop", () => {
    const world = makeWorld();
    const car = spawnVehicle(world);
    const compiled = compileVehicle(DEFAULT_BLUEPRINT);
    drive(world, car, { ...NEUTRAL_INPUT, throttle: 1 }, 10);
    const topMs = compiled.physics.topSpeed / 3.6;
    expect(car.telemetry().forwardSpeed).toBeLessThanOrEqual(topMs + 0.5);

    drive(world, car, { ...NEUTRAL_INPUT, brake: 1 }, 4);
    expect(Math.abs(car.telemetry().forwardSpeed)).toBeLessThan(2);
    world.free();
  });

  it("steering changes heading; reset clears velocity to a known pose", () => {
    const world = makeWorld();
    const car = spawnVehicle(world);
    drive(world, car, { ...NEUTRAL_INPUT, throttle: 1 }, 2);
    const before = car.telemetry();
    drive(world, car, { ...NEUTRAL_INPUT, throttle: 1, steer: 1 }, 1.5);
    const after = car.telemetry();
    expect(Math.abs(after.rotationY - before.rotationY)).toBeGreaterThan(0.05);

    car.resetTo({ position: { x: 5, y: 1.5, z: 5 }, rotationY: Math.PI / 2 });
    const t = car.telemetry();
    expect(t.speed).toBeLessThan(0.01);
    expect(t.position.x).toBeCloseTo(5, 3);
    expect(t.rotationY).toBeCloseTo(Math.PI / 2, 3);
    world.free();
  });

  it("fixed-step accumulator caps backlog after a long suspension (I8)", () => {
    const acc = new FixedStepAccumulator();
    expect(acc.advance(10)).toBeLessThanOrEqual(Math.ceil(0.25 / FIXED_DT));
    acc.reset();
    expect(acc.advance(FIXED_DT * 3)).toBe(3);
  });

  it("dispose releases physics resources (I9)", () => {
    const world = makeWorld();
    const a = spawnVehicle(world);
    const b = spawnVehicle(world);
    expect(world.bodies.len()).toBe(2);
    a.dispose(world);
    expect(world.bodies.len()).toBe(1);
    b.dispose(world);
    expect(world.bodies.len()).toBe(0);
    world.free();
  });
});
