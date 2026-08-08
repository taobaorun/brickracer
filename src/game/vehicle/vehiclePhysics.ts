import type { NormalizedInput } from "../../input/normalized";
import { collisionGroups, GROUP_CAR, GROUP_TRACK } from "../physics/groups";
import type { RapierModule } from "../physics/rapier";
import type { VehiclePhysicsSpec } from "./compiler";

export interface SpawnTransform {
  position: { x: number; y: number; z: number };
  /** 绕 y 轴朝向（弧度）。0 = 车头朝 -z。 */
  rotationY: number;
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  position: { x: number; y: number; z: number };
  rotationY: number;
  upY: number;
}

const FRONT_WHEELS = [0, 1] as const;
const REAR_WHEELS = [2, 3] as const;
const MAX_STEER = 0.55;
const SUSPENSION_REST = 0.35;

/**
 * 聚合车辆物理（I3）：一个动态底盘刚体 + DynamicRayCastVehicleController。
 * 街机容错：速度上限由发动机力归零实现；刹车可倒车（低速反向给油）。
 */
export class VehiclePhysics {
  private input: NormalizedInput = {
    steer: 0,
    throttle: 0,
    brake: 0,
    resetPressed: false,
    pausePressed: false,
  };

  private constructor(
    private readonly body: InstanceType<RapierModule["RigidBody"]>,
    private readonly controller: InstanceType<RapierModule["DynamicRayCastVehicleController"]>,
    private readonly spec: VehiclePhysicsSpec,
  ) {}

  static create(
    RAPIER: RapierModule,
    world: InstanceType<RapierModule["World"]>,
    spec: VehiclePhysicsSpec,
    spawn: SpawnTransform,
  ): VehiclePhysics {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation(quatFromYaw(spawn.rotationY))
      .setAdditionalMassProperties(
        spec.mass,
        { x: spec.comOffset.x, y: spec.comOffset.y, z: spec.comOffset.z },
        { x: spec.mass / 6, y: spec.mass / 4, z: spec.mass / 6 },
        { x: 0, y: 0, z: 0, w: 1 },
      )
      .setLinearDamping(0.05)
      .setAngularDamping(1.2);
    const body = world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(
      spec.halfExtents.x,
      spec.halfExtents.y,
      spec.halfExtents.z,
    )
      .setTranslation(spec.colliderCenter.x, spec.colliderCenter.y, spec.colliderCenter.z)
      .setFriction(0.6)
      .setRestitution(0.1)
      .setCollisionGroups(collisionGroups(GROUP_CAR, GROUP_TRACK));
    world.createCollider(collider, body);

    const controller = world.createVehicleController(body);
    const axle = { x: -1, y: 0, z: 0 };
    const direction = { x: 0, y: -1, z: 0 };
    for (const pos of spec.wheelPositions) {
      controller.addWheel(pos, direction, axle, SUSPENSION_REST, spec.wheelRadius);
    }
    spec.wheelPositions.forEach((_, i) => {
      controller.setWheelSuspensionStiffness(i, 24);
      controller.setWheelSuspensionCompression(i, 0.3);
      controller.setWheelSuspensionRelaxation(i, 0.4);
      controller.setWheelMaxSuspensionTravel(i, 0.4);
      controller.setWheelFrictionSlip(i, Math.max(0.6, spec.grip * 1.6));
      controller.setWheelSideFrictionStiffness(i, Math.max(0.5, spec.stability * 1.2));
    });
    return new VehiclePhysics(body, controller, spec);
  }

  setInput(input: NormalizedInput): void {
    this.input = input;
  }

  /** 固定步长内推进；由运行时以 60Hz 调用（I8）。 */
  step(dt: number): void {
    const t = this.telemetry();
    const topSpeed = this.spec.topSpeed / 3.6; // km/h → m/s
    const steering = -this.input.steer * MAX_STEER * (1 - Math.min(0.7, Math.abs(t.forwardSpeed) / (topSpeed * 1.5)));
    for (const i of FRONT_WHEELS) this.controller.setWheelSteering(i, steering);

    const reversing = this.input.brake > 0 && Math.abs(t.forwardSpeed) < 1.5;
    let engineForce = 0;
    if (this.input.throttle > 0 && t.forwardSpeed < topSpeed) {
      engineForce = this.input.throttle * this.spec.engineForce;
    } else if (reversing) {
      engineForce = -this.input.brake * this.spec.engineForce * 0.4;
    }
    for (const i of REAR_WHEELS) this.controller.setWheelEngineForce(i, engineForce / 2);

    const brake = reversing ? 0 : this.input.brake * 30 * this.spec.braking;
    for (const i of [...FRONT_WHEELS, ...REAR_WHEELS]) this.controller.setWheelBrake(i, brake);

    this.controller.updateVehicle(dt);
  }

  telemetry(): VehicleTelemetry {
    const v = this.body.linvel();
    const r = this.body.rotation();
    const forward = rotateYawInverse(r, { x: 0, y: 0, z: 1 }); // Rapier 车辆本地 +z 为前进方向
    const up = rotateYawInverse(r, { x: 0, y: 1, z: 0 });
    const forwardSpeed = v.x * forward.x + v.y * forward.y + v.z * forward.z;
    return {
      speed: Math.hypot(v.x, v.y, v.z),
      forwardSpeed,
      position: this.body.translation(),
      rotationY: yawFromQuat(r),
      upY: up.y,
    };
  }

  /** 手动复位：回到最近安全点、清除危险速度（R5 容错）。 */
  resetTo(spawn: SpawnTransform): void {
    this.body.setTranslation(spawn.position, true);
    this.body.setRotation(quatFromYaw(spawn.rotationY), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** 低速翻车时自动回正（仅当 upY 长期低于阈值时由运行时触发）。 */
  isUpsideDown(): boolean {
    return this.telemetry().upY < 0.2;
  }

  upright(): void {
    const t = this.telemetry();
    this.resetTo({
      position: { x: t.position.x, y: t.position.y + 1.2, z: t.position.z },
      rotationY: t.rotationY,
    });
  }

  chassisBody(): InstanceType<RapierModule["RigidBody"]> {
    return this.body;
  }

  /** 从世界移除本车刚体（控制器随刚体移除）。 */
  dispose(world: InstanceType<RapierModule["World"]>): void {
    world.removeRigidBody(this.body);
  }
}

function quatFromYaw(yaw: number) {
  const half = yaw / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

function rotateYawInverse(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  // v' = q * v * q⁻¹（标准四元数旋转向量）
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  const siny = 2 * (q.w * q.y + q.x * q.z);
  const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
  return Math.atan2(siny, cosy);
}
