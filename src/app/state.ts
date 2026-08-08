import type { SaveGameV1 } from "../domain/save/types";

/** 低频应用状态机：AppController 是唯一有权切换这些状态的主体。 */
export type AppScreen =
  | { name: "boot" }
  | { name: "unsupported"; reason: string }
  | { name: "builder" }
  | { name: "race-loading" }
  | { name: "racing"; paused: boolean }
  | { name: "results"; place: number; awarded: number; points: number }
  | { name: "shop" }
  | { name: "settings" };

export interface AppSnapshot {
  screen: AppScreen;
  save: SaveGameV1;
  saveStatus: "clean" | "unsaved" | "stale-external";
}
