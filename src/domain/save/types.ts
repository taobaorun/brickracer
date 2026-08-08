import type { VehicleBlueprint } from "../blueprint/types";

export interface SaveGameV1 {
  schemaVersion: 1;
  revision: number;
  points: number;
  unlockedPartIds: string[];
  activeBlueprint: VehicleBlueprint;
  settings: { masterVolume: number; muted: boolean; quality: "auto" | "low" | "high" };
  onboarding: { completedSteps: string[] };
  lastAppliedRaceId?: string;
}

export const SAVE_MAIN_KEY = "brickracer.save.v1";
export const SAVE_BACKUP_KEY = "brickracer.save.backup.v1";
