import { defaultSave, parseSave, serializeSave } from "../domain/save/schema";
import { SAVE_BACKUP_KEY, SAVE_MAIN_KEY, type SaveGameV1 } from "../domain/save/types";

/** 可注入的 KV 抽象：浏览器为 localStorage，测试为内存实现。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadResult = {
  save: SaveGameV1;
  source: "main" | "backup" | "default";
};

export type CommitResult =
  | { status: "ok"; save: SaveGameV1 }
  | { status: "stale"; save: SaveGameV1 }
  | { status: "unsaved"; save: SaveGameV1 };

/**
 * 主/备份持久化（R10、I5/I6）：
 * - 写入前把当前有效主键复制到备份键；
 * - 每个持久事务在写入前重读当前主键 revision，基准不符则拒绝并回载最新值（stale）；
 * - quota/安全异常降级为 unsaved，内存中的游戏继续，绝不产生负余额。
 */
export class SaveStore {
  private externallyStale = false;

  constructor(private readonly storage: KeyValueStorage) {}

  /** 另一个标签页写入了主键：标记内存存档为 stale（冲突预防，不是同步）。 */
  notifyExternalWrite(key: string): void {
    if (key === SAVE_MAIN_KEY) this.externallyStale = true;
  }

  private readValid(key: string): SaveGameV1 | null {
    const raw = this.storage.getItem(key);
    if (raw === null) return null;
    return parseSave(raw);
  }

  load(): LoadResult {
    const main = this.readValid(SAVE_MAIN_KEY);
    if (main) {
      this.externallyStale = false;
      return { save: main, source: "main" };
    }
    const backup = this.readValid(SAVE_BACKUP_KEY);
    if (backup) {
      this.externallyStale = false;
      return { save: backup, source: "backup" };
    }
    return { save: defaultSave(), source: "default" };
  }

  /**
   * 以 baseRevision 为基准提交新存档。成功时 revision 递增为 baseRevision+1。
   * 若当前有效主键 revision 与基准不符（含外部标签页写入），拒绝并返回最新值。
   */
  commit(candidate: Omit<SaveGameV1, "revision">, baseRevision: number): CommitResult {
    const current = this.readValid(SAVE_MAIN_KEY);
    // 主键缺失时以有效备份为权威；两者都缺失（全新设备）时接受调用方基准
    const currentRevision =
      current?.revision ?? this.readValid(SAVE_BACKUP_KEY)?.revision ?? baseRevision;
    if (this.externallyStale || currentRevision !== baseRevision) {
      const { save } = this.load();
      return { status: "stale", save };
    }
    const next: SaveGameV1 = { ...candidate, revision: baseRevision + 1 };
    try {
      if (current) this.storage.setItem(SAVE_BACKUP_KEY, serializeSave(current));
      this.storage.setItem(SAVE_MAIN_KEY, serializeSave(next));
    } catch {
      return { status: "unsaved", save: next };
    }
    this.externallyStale = false;
    return { status: "ok", save: next };
  }
}

/** 浏览器接线：storage 事件 → notifyExternalWrite。 */
export function wireStorageEvents(store: SaveStore, target: Window): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === SAVE_MAIN_KEY) store.notifyExternalWrite(e.key);
  };
  target.addEventListener("storage", listener);
  return () => target.removeEventListener("storage", listener);
}
