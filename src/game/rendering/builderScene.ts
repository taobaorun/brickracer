import * as THREE from "three";
import { CELL_SIZE, compileVehicle, type RenderInstance } from "../vehicle/compiler";
import { findColor } from "../../content/catalog";
import type { VehicleBlueprint } from "../../domain/blueprint/types";
import { ResourceRegistry } from "./resources";

export type BuilderPickResult =
  | { kind: "brick"; instanceId: string }
  | { kind: "cell"; position: { x: number; y: number; z: number } }
  | { kind: "none" };

/**
 * 搭建场景：底盘 + 积木实例 + 车轮/发动机示意 + raycast 拾取。
 * 渲染不持有领域状态；蓝图变更时整体重建实例（规模 ≤120，成本可忽略）。
 */
export class BuilderScene {
  private readonly registry = new ResourceRegistry();
  private carRegistry = new ResourceRegistry();
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private carGroup = new THREE.Group();
  private blueprint: VehicleBlueprint | null = null;
  private selectedId: string | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color("#b8d8f0");
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(4.2, 3.4, 4.2);
    this.camera.lookAt(0, 0.4, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 8, 3);
    this.scene.add(ambient, sun);

    const floor = new THREE.Mesh(
      this.registry.track(new THREE.CylinderGeometry(3.4, 3.4, 0.1, 48)),
      this.registry.track(new THREE.MeshLambertMaterial({ color: "#8a8f98" })),
    );
    floor.position.y = -0.06;
    this.scene.add(floor);
    this.scene.add(this.carGroup);
    this.rebuildStatic();
  }

  private rebuildStatic(): void {
    this.scene.remove(this.carGroup);
    this.carRegistry.dispose();
    this.carRegistry = new ResourceRegistry();
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);

    // 底盘
    const chassis = new THREE.Mesh(
      this.carRegistry.track(new THREE.BoxGeometry(5 * CELL_SIZE, CELL_SIZE, 7 * CELL_SIZE)),
      this.carRegistry.track(new THREE.MeshLambertMaterial({ color: "#3c3f45" })),
    );
    chassis.position.set(0, CELL_SIZE / 2, 0);
    this.carGroup.add(chassis);

    // 车轮（视觉）
    const wheelGeo = this.carRegistry.track(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 20));
    const wheelMat = this.carRegistry.track(new THREE.MeshLambertMaterial({ color: "#1c1c20" }));
    const positions: ReadonlyArray<readonly [number, number]> = [
      [-1.6, -1.05],
      [1.6, -1.05],
      [-1.6, 1.05],
      [1.6, 1.05],
    ];
    for (const [x, z] of positions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, z);
      this.carGroup.add(wheel);
    }

    if (this.blueprint) this.rebuildBricks();
  }

  private rebuildBricks(): void {
    if (!this.blueprint) return;
    const compiled = compileVehicle(this.blueprint);
    for (const inst of compiled.renderInstances) {
      const mesh = this.makeBrickMesh(inst);
      this.carGroup.add(mesh);
    }
  }

  private makeBrickMesh(inst: RenderInstance): THREE.Mesh {
    const geo = this.carRegistry.track(
      new THREE.BoxGeometry(inst.size.w * CELL_SIZE, inst.size.h * CELL_SIZE, inst.size.d * CELL_SIZE),
    );
    const color = findColor(inst.colorId)?.hex ?? "#999999";
    const mat = this.carRegistry.track(new THREE.MeshLambertMaterial({ color }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(inst.offset.x, inst.offset.y, inst.offset.z);
    mesh.rotation.y = inst.rotationY;
    mesh.userData.instanceId = inst.instanceId;
    if (inst.instanceId === this.selectedId) {
      (mesh.material as THREE.MeshLambertMaterial).emissive = new THREE.Color("#3355ff");
    }
    return mesh;
  }

  showBlueprint(bp: VehicleBlueprint): void {
    this.blueprint = bp;
    this.rebuildStatic();
  }

  select(instanceId: string | null): void {
    this.selectedId = instanceId;
    this.rebuildStatic();
  }

  /** 画布坐标（0..1 归一化）→ 领域拾取结果。 */
  pick(nx: number, ny: number): BuilderPickResult {
    this.raycaster.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const hits = this.raycaster.intersectObjects(this.carGroup.children, true);
    for (const hit of hits) {
      const instanceId = hit.object.userData.instanceId as string | undefined;
      if (instanceId) return { kind: "brick", instanceId };
      if (hit.face) {
        // 命中底盘/车轮：转换为顶面格位
        const p = hit.point;
        const gx = Math.floor(p.x / CELL_SIZE);
        const gz = Math.floor(p.z / CELL_SIZE);
        return { kind: "cell", position: { x: gx, y: 1, z: gz } };
      }
    }
    return { kind: "none" };
  }

  /** 供 E2E 确定性拾取：返回指定格位在画布上的归一化坐标。 */
  projectCell(x: number, y: number, z: number): { nx: number; ny: number } | null {
    const v = new THREE.Vector3((x + 0.5) * CELL_SIZE, y * CELL_SIZE + CELL_SIZE, (z + 0.5) * CELL_SIZE);
    v.project(this.camera);
    if (v.z > 1) return null;
    return { nx: (v.x + 1) / 2, ny: (1 - v.y) / 2 };
  }

  render(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.carRegistry.dispose();
    this.registry.dispose();
  }
}
