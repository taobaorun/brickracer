import { findPart } from "../../content/catalog";
import type { SaveGameV1 } from "../save/types";

export interface RaceResultFacts {
  raceId: string;
  place: number;
  totalRacers: number;
  finishTimeMs: number;
  bestLapMs: number;
}

export const BASE_FINISH_POINTS = 60;
export const PLACE_BONUS: Readonly<Record<number, number>> = { 1: 60, 2: 35, 3: 20 };

/**
 * 无负循环经济（R9）：完赛必有基础分，名次带来额外奖励，永不为负。
 */
export function rewardFor(facts: Pick<RaceResultFacts, "place">): number {
  const bonus = PLACE_BONUS[facts.place] ?? 0;
  return Math.max(0, BASE_FINISH_POINTS + bonus);
}

export type ApplyResultOutcome =
  | { ok: true; save: Omit<SaveGameV1, "revision">; awarded: number }
  | { ok: false; reason: "duplicate-race" };

/**
 * 结算幂等（I5）：同一 raceId 最多结算一次。
 * 输入为当前存档内容（不含 revision，由 SaveStore 管理）。
 */
export function applyRaceResult(
  save: Omit<SaveGameV1, "revision">,
  facts: RaceResultFacts,
): ApplyResultOutcome {
  if (save.lastAppliedRaceId === facts.raceId) {
    return { ok: false, reason: "duplicate-race" };
  }
  const awarded = rewardFor(facts);
  return {
    ok: true,
    awarded,
    save: {
      ...save,
      points: save.points + awarded,
      lastAppliedRaceId: facts.raceId,
    },
  };
}

export type PurchaseOutcome =
  | { ok: true; save: Omit<SaveGameV1, "revision"> }
  | { ok: false; reason: "unknown-part" | "already-owned" | "insufficient-points" };

/** 永久解锁、无限复用；购买不减少已拥有部件。 */
export function purchasePart(
  save: Omit<SaveGameV1, "revision">,
  partId: string,
): PurchaseOutcome {
  const part = findPart(partId);
  if (!part) return { ok: false, reason: "unknown-part" };
  if (save.unlockedPartIds.includes(partId)) return { ok: false, reason: "already-owned" };
  if (save.points < part.price) return { ok: false, reason: "insufficient-points" };
  return {
    ok: true,
    save: {
      ...save,
      points: save.points - part.price,
      unlockedPartIds: [...save.unlockedPartIds, partId],
    },
  };
}

/** 玩家可装备的部件 = 已解锁。 */
export function canEquip(save: Pick<SaveGameV1, "unlockedPartIds">, partId: string): boolean {
  return save.unlockedPartIds.includes(partId);
}
