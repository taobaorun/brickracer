import {
  AERO_PARTS,
  BRICK_TYPES,
  BUMPER_PARTS,
  COLORS,
  ENGINES,
  WHEEL_SETS,
} from "../../content/catalog";
import { DEFAULT_BLUEPRINT } from "../../content/defaultBlueprint";
import { deriveStats } from "../../domain/blueprint/stats";
import { validateBlueprint } from "../../domain/blueprint/validation";
import type { VehicleBlueprint } from "../../domain/blueprint/types";
import { mulberry32, pick } from "./rng";

export interface AiGenerationRequest {
  seed: number;
  /** 目标实力带：以玩家 matchmakingRating 为中心。 */
  targetRating: number;
  /** 允许带宽比例（±）。 */
  bandRatio: number;
  /** 有界重试次数。 */
  maxAttempts: number;
}

/** 策展回退蓝图：保证合法、覆盖低/中/高三档。 */
export const CURATED_AI_BLUEPRINTS: ReadonlyArray<{ rating: number; blueprint: VehicleBlueprint }> =
  (() => {
    const mk = (engineId: string, wheelSetId: string, extraBricks: number): VehicleBlueprint => {
      const bp = structuredClone(DEFAULT_BLUEPRINT);
      bp.slots.engineId = engineId;
      bp.slots.wheelSetId = wheelSetId;
      for (let i = 0; i < extraBricks; i += 1) {
        // 堆在默认车舱（b-cab-2 顶部 y=2→3）上，保证连通
        bp.bricks.push({
          instanceId: `ai-extra-${i}`,
          brickTypeId: "brick-1x1",
          colorId: "black",
          position: { x: 0, y: 3 + i, z: -1 },
          rotation: 0,
        });
      }
      return bp;
    };
    const list = [
      mk("engine-basic", "wheels-drift", 2),
      mk("engine-sport", "wheels-basic", 0),
      mk("engine-turbo", "wheels-grip", 0),
    ];
    return list.map((blueprint) => ({
      blueprint,
      rating: deriveStats(blueprint).matchmakingRating,
    }));
  })();

function randomCandidate(rng: () => number): VehicleBlueprint {
  const bp = structuredClone(DEFAULT_BLUEPRINT);
  bp.slots.engineId = pick(rng, ENGINES).id;
  bp.slots.wheelSetId = pick(rng, WHEEL_SETS).id;
  if (rng() < 0.4) bp.slots.aeroId = pick(rng, AERO_PARTS).id;
  if (rng() < 0.3) bp.slots.bumperId = pick(rng, BUMPER_PARTS).id;

  // 随机增删装饰积木：外观变化，不改变核心结构。
  // 候选位置避开默认车舱占用的 (-1..0, y2, z-1)。
  const additions = Math.floor(rng() * 5);
  const candidateCells = [
    { x: 0, y: 2, z: 0 },
    { x: 0, y: 2, z: 1 },
    { x: -1, y: 2, z: 1 },
    { x: 0, y: 3, z: 0 },
    { x: 1, y: 1, z: 1 },
  ];
  for (let i = 0; i < additions; i += 1) {
    const cell = candidateCells[i % candidateCells.length]!;
    bp.bricks.push({
      instanceId: `gen-${i}-${Math.floor(rng() * 1e6)}`,
      brickTypeId: pick(rng, BRICK_TYPES).id,
      colorId: pick(rng, COLORS).id,
      position: cell,
      rotation: (Math.floor(rng() * 4) as 0 | 1 | 2 | 3),
    });
  }
  bp.bricks = bp.bricks.map((b) => ({ ...b, colorId: pick(rng, COLORS).id }));
  return bp;
}

export interface AiGenerationResult {
  blueprint: VehicleBlueprint;
  rating: number;
  source: "generated" | "curated-fallback";
}

/**
 * 从同一默认核心出发，按目标 rating 带生成合法 AI 蓝图。
 * 每个候选都经过共享验证器；有界重试后回退到最近的策展蓝图（R6、I1）。
 */
export function generateAiBlueprint(req: AiGenerationRequest): AiGenerationResult {
  const lo = req.targetRating * (1 - req.bandRatio);
  const hi = req.targetRating * (1 + req.bandRatio);
  for (let attempt = 0; attempt < req.maxAttempts; attempt += 1) {
    const rng = mulberry32(req.seed + attempt * 0x9e3779b9);
    const candidate = randomCandidate(rng);
    if (!validateBlueprint(candidate).ok) continue;
    const rating = deriveStats(candidate).matchmakingRating;
    if (rating >= lo && rating <= hi) {
      return { blueprint: candidate, rating, source: "generated" };
    }
  }
  let best = CURATED_AI_BLUEPRINTS[0]!;
  for (const c of CURATED_AI_BLUEPRINTS) {
    if (Math.abs(c.rating - req.targetRating) < Math.abs(best.rating - req.targetRating)) best = c;
  }
  return {
    blueprint: structuredClone(best.blueprint),
    rating: best.rating,
    source: "curated-fallback",
  };
}
