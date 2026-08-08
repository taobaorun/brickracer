import * as THREE from "three";

/**
 * 资源注册表（I9）：所有共享几何体/材质/渲染器统一登记与释放。
 */
export class ResourceRegistry {
  private readonly disposables: Array<{ dispose(): void }> = [];

  track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        // 释放失败不阻断其余资源清理
      }
    }
  }

  get size(): number {
    return this.disposables.length;
  }
}

export interface QualitySettings {
  pixelRatioCap: number;
  shadows: boolean;
  antialias: boolean;
}

export function qualityFor(level: "low" | "high", deviceMemoryGb?: number): QualitySettings {
  if (level === "low" || (deviceMemoryGb !== undefined && deviceMemoryGb <= 4)) {
    return { pixelRatioCap: 1.5, shadows: false, antialias: false };
  }
  return { pixelRatioCap: 2, shadows: true, antialias: true };
}

export function makeBrickGeometry(registry: ResourceRegistry, w: number, h: number, d: number, cell: number): THREE.BoxGeometry {
  return registry.track(new THREE.BoxGeometry(w * cell, h * cell, d * cell));
}

export function makeLambert(registry: ResourceRegistry, hex: string): THREE.MeshLambertMaterial {
  return registry.track(new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }));
}
