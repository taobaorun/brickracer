import * as THREE from "three";
import { CELL_SIZE, compileVehicle, type RenderInstance } from "../vehicle/compiler";
import { findColor } from "../../content/catalog";
import type { GridPosition, VehicleBlueprint } from "../../domain/blueprint/types";
import { ResourceRegistry } from "./resources";

export type BuilderPickResult =
  | { kind: "brick"; instanceId: string; faceTarget: GridPosition }
  | { kind: "cell"; position: GridPosition }
  | { kind: "none" };

const STUD_RADIUS = 0.09;
const STUD_HEIGHT = 0.06;

/**
 * 搭建场景：底盘 + 积木实例（含凸点）+ 车轮 + raycast 面拾取 + 轨道相机。
 * 渲染不持有领域状态；蓝图变更时整体重建实例（规模 ≤120，成本可忽略）。
 * 积木凸点与底盘凸点阵列呈现真实积木的咬合关系；面拾取返回面相邻格位，
 * 使向上堆叠与侧面扩展遵循真实积木连接规则。
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

  // 轨道相机状态（方位角/极角/半径）
  private orbitAzimuth = Math.PI / 4;
  private orbitPolar = 1.05;
  private orbitRadius = 7.2;
  private readonly orbitTarget = new THREE.Vector3(0, 0.5, 0);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color("#b8d8f0");
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 8, 3);
    this.scene.add(ambient, sun);

    const floor = new THREE.Mesh(
      this.registry.track(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 48)),
      this.registry.track(new THREE.MeshLambertMaterial({ color: "#8a8f98" })),
    );
    floor.position.y = -0.06;
    this.scene.add(floor);
    this.scene.add(this.carGroup);
    this.applyOrbit();
    this.rebuildStatic();
  }

  /** 拖拽环绕（弧度增量）。 */
  orbit(deltaAzimuth: number, deltaPolar: number): void {
    this.orbitAzimuth += deltaAzimuth;
    this.orbitPolar = Math.min(1.45, Math.max(0.25, this.orbitPolar + deltaPolar));
    this.applyOrbit();
  }

  /** 缩放（比例系数，<1 拉近）。 */
  zoom(factor: number): void {
    this.orbitRadius = Math.min(13, Math.max(3.2, this.orbitRadius * factor));
    this.applyOrbit();
  }

  /** 诊断：当前相机位置（e2e 断言环绕生效）。 */
  cameraPosition(): { x: number; y: number; z: number } {
    return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  }

  private applyOrbit(): void {
    const { orbitAzimuth: az, orbitPolar: pol, orbitRadius: r } = this;
    this.camera.position.set(
      this.orbitTarget.x + r * Math.sin(pol) * Math.sin(az),
      this.orbitTarget.y + r * Math.cos(pol),
      this.orbitTarget.z + r * Math.sin(pol) * Math.cos(az),
    );
    this.camera.lookAt(this.orbitTarget);
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
    chassis.userData.isChassis = true;
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
    this.rebuildStuds();
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

  /** 凸点：底盘顶面 5×7 阵列 + 每块积木顶面 studs（按旋转后尺寸）。 */
  private rebuildStuds(): void {
    const studGeo = this.carRegistry.track(new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12));
    const studPositions: Array<{ x: number; y: number; z: number; colorId: string }> = [];

    // 底盘凸点（顶面 y=0.5，格心）
    for (let gx = -2; gx <= 2; gx += 1) {
      for (let gz = -3; gz <= 3; gz += 1) {
        studPositions.push({ x: (gx + 0.5) * CELL_SIZE, y: CELL_SIZE + STUD_HEIGHT / 2, z: (gz + 0.5) * CELL_SIZE, colorId: "black" });
      }
    }
    // 积木凸点（顶面，按各自颜色）
    if (this.blueprint) {
      const compiled = compileVehicle(this.blueprint);
      for (const inst of compiled.renderInstances) {
        const topY = inst.offset.y + (inst.size.h * CELL_SIZE) / 2;
        for (let dx = 0; dx < inst.size.w; dx += 1) {
          for (let dz = 0; dz < inst.size.d; dz += 1) {
            studPositions.push({
              x: inst.offset.x - (inst.size.w * CELL_SIZE) / 2 + (dx + 0.5) * CELL_SIZE,
              y: topY + STUD_HEIGHT / 2,
              z: inst.offset.z - (inst.size.d * CELL_SIZE) / 2 + (dz + 0.5) * CELL_SIZE,
              colorId: inst.colorId,
            });
          }
        }
      }
    }

    // 按颜色分组的 InstancedMesh
    const byColor = new Map<string, typeof studPositions>();
    for (const s of studPositions) {
      const list = byColor.get(s.colorId) ?? [];
      list.push(s);
      byColor.set(s.colorId, list);
    }
    const dummy = new THREE.Object3D();
    for (const [colorId, list] of byColor) {
      const mat = this.carRegistry.track(
        new THREE.MeshLambertMaterial({ color: findColor(colorId)?.hex ?? "#888888" }),
      );
      const instMesh = new THREE.InstancedMesh(studGeo, mat, list.length);
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);
      });
      instMesh.instanceMatrix.needsUpdate = true;
      this.carGroup.add(instMesh);
    }
  }

  showBlueprint(bp: VehicleBlueprint): void {
    this.blueprint = bp;
    this.rebuildStatic();
  }

  select(instanceId: string | null): void {
    this.selectedId = instanceId;
    this.rebuildStatic();
  }

  /**
   * 画布坐标（0..1 归一化）→ 领域拾取结果。
   * 命中积木时返回面相邻格位（faceTarget）：顶面 → 上方格位；侧面 → 外侧格位。
   */
  pick(nx: number, ny: number): BuilderPickResult {
    this.raycaster.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const hits = this.raycaster.intersectObjects(this.carGroup.children, true);
    for (const hit of hits) {
      if (!hit.face) continue;
      const obj = hit.object;
      const instanceId = obj.userData.instanceId as string | undefined;
      // 世界空间法线（积木仅绕 y 四分之一圈旋转，法线对齐网格轴）
      const worldNormal = hit.face.normal.clone().transformDirection(obj.matrixWorld);
      // 命中点沿法线外移半格余后取格位 = 该面外侧的相邻格
      const p = hit.point.clone().add(worldNormal.clone().multiplyScalar(CELL_SIZE * 0.55));
      const target: GridPosition = {
        x: Math.floor(p.x / CELL_SIZE),
        y: Math.max(1, Math.floor(p.y / CELL_SIZE)),
        z: Math.floor(p.z / CELL_SIZE),
      };
      if (instanceId) {
        return { kind: "brick", instanceId, faceTarget: target };
      }
      // 底盘/车轮：转换为顶面格位
      return { kind: "cell", position: target };
    }
    return { kind: "none" };
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
