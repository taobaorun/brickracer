/**
 * Rapier 唯一接缝（facade）：Rapier 类型与 handle 不得泄漏到领域、UI、
 * 存档或内容层。异步加载 WASM；失败由调用方转为可恢复错误界面。
 */
export type RapierModule = typeof import("@dimforge/rapier3d-compat");

let instance: RapierModule | null = null;

export async function initRapier(): Promise<RapierModule> {
  if (instance) return instance;
  const mod = await import("@dimforge/rapier3d-compat");
  await mod.init();
  instance = mod;
  return mod;
}

/** 仅测试用：重置单例，避免跨用例状态污染。 */
export function __resetRapierForTests(): void {
  instance = null;
}
