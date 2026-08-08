import * as THREE from "three";
import { TRACK_BRICKWAY_1, type TrackDefinition } from "../../content/track";
import { findColor } from "../../content/catalog";
import type { CompiledVehicle } from "../vehicle/compiler";
import { CELL_SIZE } from "../vehicle/compiler";
import type { RapierModule } from "../physics/rapier";
import { buildTrackColliders, railSegments } from "../physics/trackColliders";
import { ResourceRegistry } from "./resources";

export interface RacerVisual {
  group: THREE.Group;
  brickMeshes: Array<{ instanceId: string; mesh: THREE.Mesh; home: THREE.Vector3 }>;
  wheels: THREE.Mesh[];
}

/**
 * 比赛场景：由固定赛道定义生成视觉网格与静态碰撞体；
 * 每辆车的视觉实例与权威物理分离（I4 的前提）。
 */
export class RaceScene {
  readonly registry = new ResourceRegistry();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

  constructor(
    RAPIER: RapierModule,
    world: InstanceType<RapierModule["World"]>,
    private readonly track: TrackDefinition = TRACK_BRICKWAY_1,
  ) {
    this.scene.background = new THREE.Color("#a8d5a2");
    this.scene.fog = new THREE.Fog("#a8d5a2", 60, 160);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    this.buildGroundAndRoad();
    buildTrackColliders(RAPIER, world, track);
    this.buildRails();
    this.buildStartLine();
  }

  private buildGroundAndRoad(): void {
    // 大地面（物理地板由 buildTrackColliders 统一提供）
    const ground = new THREE.Mesh(
      this.registry.track(new THREE.PlaneGeometry(400, 400)),
      this.registry.track(new THREE.MeshLambertMaterial({ color: "#7fbf6e" })),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // 路面：沿中线段的盒体带
    const roadMat = this.registry.track(new THREE.MeshLambertMaterial({ color: "#4a4e57" }));
    const pts = this.track.centerline;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const cx = (a.x + b.x) / 2;
      const cz = (a.z + b.z) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.4;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const seg = new THREE.Mesh(
        this.registry.track(new THREE.BoxGeometry(this.track.halfWidth * 2, 0.08, len)),
        roadMat,
      );
      seg.position.set(cx, 0.02, cz);
      seg.rotation.y = yaw;
      this.scene.add(seg);
    }
  }

  private buildRails(): void {
    // 护轨视觉与碰撞体共用同一几何（railSegments）
    const railMat = this.registry.track(new THREE.MeshLambertMaterial({ color: "#e8564a" }));
    for (const seg of railSegments(this.track)) {
      const rail = new THREE.Mesh(this.registry.track(new THREE.BoxGeometry(0.35, 0.9, seg.len + 0.04)), railMat);
      rail.position.set(seg.cx, 0.45, seg.cz);
      rail.rotation.y = seg.yaw;
      this.scene.add(rail);
    }
  }

  private buildStartLine(): void {
    const cp0 = this.track.checkpoints[0]!;
    const line = new THREE.Mesh(
      this.registry.track(new THREE.PlaneGeometry(this.track.halfWidth * 2, 1.2)),
      this.registry.track(new THREE.MeshBasicMaterial({ color: "#ffffff" })),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(cp0.x, 0.07, cp0.z);
    this.scene.add(line);
  }

  /** 从编译产物构建一辆车的视觉组。 */
  buildCarVisual(compiled: CompiledVehicle): RacerVisual {
    const group = new THREE.Group();
    const brickMeshes: RacerVisual["brickMeshes"] = [];

    const chassis = new THREE.Mesh(
      this.registry.track(new THREE.BoxGeometry(5 * CELL_SIZE, CELL_SIZE, 7 * CELL_SIZE)),
      this.registry.track(new THREE.MeshLambertMaterial({ color: "#33363d" })),
    );
    chassis.position.set(0, CELL_SIZE / 2, 0);
    group.add(chassis);

    for (const inst of compiled.renderInstances) {
      const geo = this.registry.track(
        new THREE.BoxGeometry(inst.size.w * CELL_SIZE, inst.size.h * CELL_SIZE, inst.size.d * CELL_SIZE),
      );
      const mat = this.registry.track(
        new THREE.MeshLambertMaterial({ color: findColor(inst.colorId)?.hex ?? "#999999" }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      const home = new THREE.Vector3(inst.offset.x, inst.offset.y, inst.offset.z);
      mesh.position.copy(home);
      mesh.rotation.y = inst.rotationY;
      mesh.userData.instanceId = inst.instanceId;
      group.add(mesh);
      brickMeshes.push({ instanceId: inst.instanceId, mesh, home });
    }

    const wheelGeo = this.registry.track(
      new THREE.CylinderGeometry(compiled.physics.wheelRadius, compiled.physics.wheelRadius, 0.3, 16),
    );
    const wheelMat = this.registry.track(new THREE.MeshLambertMaterial({ color: "#17181c" }));
    const wheels: THREE.Mesh[] = [];
    for (const pos of compiled.physics.wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, pos.y + compiled.physics.wheelRadius, pos.z);
      group.add(wheel);
      wheels.push(wheel);
    }

    this.scene.add(group);
    return { group, brickMeshes, wheels };
  }

  removeCarVisual(visual: RacerVisual): void {
    this.scene.remove(visual.group);
  }

  dispose(): void {
    this.registry.dispose();
  }
}
