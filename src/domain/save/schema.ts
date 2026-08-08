import { findPart } from "../../content/catalog";
import { DEFAULT_BLUEPRINT } from "../../content/defaultBlueprint";
import { validateBlueprint } from "../blueprint/validation";
import type { SaveGameV1 } from "./types";

const MAX_POINTS = 1_000_000;
const MAX_UNLOCKED = 500;
const MAX_ONBOARDING_STEPS = 50;
const MAX_ID_LENGTH = 64;
const MAX_RACE_ID_LENGTH = 128;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validIdList(v: unknown, max: number): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= max &&
    v.every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_ID_LENGTH)
  );
}

/**
 * 存档是不可信输入（I6）。任何字段越界、未知部件 ID、非法蓝图、
 * 未知更新 schema 都 fail-closed 返回 null，由调用方回退备份或默认值。
 */
export function parseSave(raw: string): SaveGameV1 | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.schemaVersion !== 1) return null; // 未知/更新版本：不部分解释
  if (!Number.isInteger(data.revision) || (data.revision as number) < 0) return null;
  if (typeof data.points !== "number" || !Number.isFinite(data.points)) return null;
  if (data.points < 0 || data.points > MAX_POINTS) return null;
  if (!validIdList(data.unlockedPartIds, MAX_UNLOCKED)) return null;
  if (!(data.unlockedPartIds as string[]).every((id) => findPart(id))) return null;

  if (!isRecord(data.settings)) return null;
  const s = data.settings;
  if (typeof s.masterVolume !== "number" || s.masterVolume < 0 || s.masterVolume > 1) return null;
  if (typeof s.muted !== "boolean") return null;
  if (s.quality !== "auto" && s.quality !== "low" && s.quality !== "high") return null;

  if (!isRecord(data.onboarding) || !validIdList(data.onboarding.completedSteps, MAX_ONBOARDING_STEPS)) {
    return null;
  }

  if (data.lastAppliedRaceId !== undefined) {
    if (typeof data.lastAppliedRaceId !== "string" || data.lastAppliedRaceId.length > MAX_RACE_ID_LENGTH) {
      return null;
    }
  }

  const bp = data.activeBlueprint;
  if (!isRecord(bp)) return null;
  // validateBlueprint 之前先收窄结构，避免运行时异常
  if (bp.schemaVersion !== 1 || !Array.isArray(bp.bricks) || !isRecord(bp.slots)) return null;
  if (typeof bp.slots.engineId !== "string" || typeof bp.slots.wheelSetId !== "string") return null;
  const bricksOk = (bp.bricks as unknown[]).every((b) => {
    if (!isRecord(b)) return false;
    const p = b.position;
    return (
      typeof b.instanceId === "string" &&
      typeof b.brickTypeId === "string" &&
      typeof b.colorId === "string" &&
      isRecord(p) &&
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      Number.isInteger(p.z) &&
      (b.rotation === 0 || b.rotation === 1 || b.rotation === 2 || b.rotation === 3)
    );
  });
  if (!bricksOk) return null;
  const blueprint = bp as unknown as SaveGameV1["activeBlueprint"];
  if (!validateBlueprint(blueprint).ok) return null;

  return {
    schemaVersion: 1,
    revision: data.revision as number,
    points: data.points,
    unlockedPartIds: [...(data.unlockedPartIds as string[])],
    activeBlueprint: blueprint,
    settings: {
      masterVolume: s.masterVolume,
      muted: s.muted,
      quality: s.quality,
    },
    onboarding: { completedSteps: [...(data.onboarding.completedSteps as string[])] },
    ...(typeof data.lastAppliedRaceId === "string"
      ? { lastAppliedRaceId: data.lastAppliedRaceId }
      : {}),
  };
}

export function serializeSave(save: SaveGameV1): string {
  return JSON.stringify(save);
}

export function defaultSave(): SaveGameV1 {
  return {
    schemaVersion: 1,
    revision: 0,
    points: 0,
    unlockedPartIds: ["engine-basic", "wheels-basic"],
    activeBlueprint: structuredClone(DEFAULT_BLUEPRINT),
    settings: { masterVolume: 0.8, muted: false, quality: "auto" },
    onboarding: { completedSteps: [] },
  };
}
