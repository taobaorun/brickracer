import * as THREE from "three";
import { ResourceRegistry } from "./resources";

export interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  ttlMs: number;
}

const POOL_SIZE = 48;
const FRAGMENT_TTL_MS = 2600;

/**
 * 碰撞碎片池（R8、I4）：纯视觉、有界、短生命周期；
 * 不创建权威刚体、不进碰撞组、不进存档；核心/功能件永不做碎片。
 * 隐藏的是装饰积木的渲染实例，权威质量/碰撞体不变。
 */
export class FragmentPool {
  private readonly registry = new ResourceRegistry();
  private readonly pool: Fragment[] = [];
  private readonly geometry: THREE.BoxGeometry;
  private readonly materials: THREE.MeshLambertMaterial[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.geometry = this.registry.track(new THREE.BoxGeometry(0.22, 0.22, 0.22));
    for (const hex of ["#d23c2e", "#2e6fd2", "#e8c12a", "#3aa655", "#f2f2f2"]) {
      this.materials.push(this.registry.track(new THREE.MeshLambertMaterial({ color: hex })));
    }
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[i % this.materials.length]!);
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        ttlMs: 0,
      });
    }
  }

  /** 在指定世界位置爆出最多 count 个碎片。 */
  burst(at: { x: number; y: number; z: number }, count: number, seed: number): void {
    let spawned = 0;
    for (const frag of this.pool) {
      if (spawned >= count) break;
      if (frag.ttlMs > 0) continue;
      const a = (seed + spawned * 2.39996) % (Math.PI * 2);
      frag.mesh.position.set(at.x, at.y, at.z);
      frag.velocity.set(Math.cos(a) * 3.5, 3 + ((seed + spawned) % 3), Math.sin(a) * 3.5);
      frag.spin.set((seed % 3) + 1, ((seed + 1) % 5) + 1, ((seed + 2) % 4) + 1);
      frag.ttlMs = FRAGMENT_TTL_MS;
      frag.mesh.visible = true;
      spawned += 1;
    }
  }

  update(dtMs: number): void {
    for (const frag of this.pool) {
      if (frag.ttlMs <= 0) continue;
      frag.ttlMs -= dtMs;
      if (frag.ttlMs <= 0) {
        frag.mesh.visible = false;
        continue;
      }
      frag.velocity.y -= 9.81 * (dtMs / 1000);
      frag.mesh.position.addScaledVector(frag.velocity, dtMs / 1000);
      if (frag.mesh.position.y < 0.11) {
        frag.mesh.position.y = 0.11;
        frag.velocity.y *= -0.3;
        frag.velocity.x *= 0.7;
        frag.velocity.z *= 0.7;
      }
      frag.mesh.rotation.x += frag.spin.x * (dtMs / 1000);
      frag.mesh.rotation.y += frag.spin.y * (dtMs / 1000);
      frag.mesh.rotation.z += frag.spin.z * (dtMs / 1000);
    }
  }

  /** 比赛停止时清空池（不携带任何状态离开比赛）。 */
  clear(): void {
    for (const frag of this.pool) {
      frag.ttlMs = 0;
      frag.mesh.visible = false;
    }
  }

  activeCount(): number {
    return this.pool.filter((f) => f.ttlMs > 0).length;
  }

  dispose(): void {
    this.clear();
    this.registry.dispose();
  }
}
