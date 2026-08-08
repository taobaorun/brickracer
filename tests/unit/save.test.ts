import { describe, expect, it } from "vitest";
import { defaultSave, parseSave, serializeSave } from "../../src/domain/save/schema";
import { SAVE_BACKUP_KEY, SAVE_MAIN_KEY } from "../../src/domain/save/types";
import { SaveStore, type KeyValueStorage } from "../../src/infrastructure/saveStore";

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
}

function bump(save = defaultSave()) {
  return { ...save, points: save.points + 10 };
}

describe("parseSave (untrusted input, I6)", () => {
  it("round-trips a valid save and rejects garbage", () => {
    const save = defaultSave();
    expect(parseSave(serializeSave(save))).toEqual(save);
    expect(parseSave("not json")).toBeNull();
    expect(parseSave("{}")).toBeNull();
    expect(parseSave("[]")).toBeNull();
  });

  it("fails closed on newer schema, bad ranges and unknown part ids", () => {
    const save = defaultSave();
    expect(parseSave(JSON.stringify({ ...save, schemaVersion: 2 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, points: -1 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, points: Infinity }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, unlockedPartIds: ["fake-part"] }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, revision: 1.5 }))).toBeNull();
    expect(
      parseSave(JSON.stringify({ ...save, settings: { ...save.settings, masterVolume: 2 } })),
    ).toBeNull();
    expect(
      parseSave(JSON.stringify({ ...save, settings: { ...save.settings, quality: "ultra" } })),
    ).toBeNull();
  });

  it("rejects saves whose blueprint fails domain validation", () => {
    const save = defaultSave();
    const bad = structuredClone(save);
    bad.activeBlueprint.slots.engineId = "does-not-exist";
    expect(parseSave(JSON.stringify(bad))).toBeNull();
  });
});

describe("SaveStore", () => {
  it("loads main, falls back to backup, then default", () => {
    const storage = new MemStorage();
    const store = new SaveStore(storage);
    expect(store.load().source).toBe("default");

    const ok = store.commit(bump(), 0);
    expect(ok.status).toBe("ok");
    expect(store.load()).toMatchObject({ source: "main" });
    // 第二次提交后备份键才有内容（写入前先复制旧主键）
    store.commit(bump(defaultSave()), 1);

    storage.map.set(SAVE_MAIN_KEY, "corrupt{");
    const res = store.load();
    expect(res.source).toBe("backup");
    expect(res.save.revision).toBe(1);
  });

  it("copies previous main to backup before replacing it", () => {
    const storage = new MemStorage();
    const store = new SaveStore(storage);
    store.commit(bump(), 0); // rev 1, points 10
    const second = store.commit({ ...bump(), points: 99 }, 1); // rev 2
    expect(second.status).toBe("ok");
    const backup = parseSave(storage.map.get(SAVE_BACKUP_KEY)!);
    expect(backup?.points).toBe(10);
    expect(parseSave(storage.map.get(SAVE_MAIN_KEY)!)?.points).toBe(99);
  });

  it("rejects stale-revision commits and returns the newest save", () => {
    const storage = new MemStorage();
    const store = new SaveStore(storage);
    store.commit(bump(), 0); // rev 1
    const stale = store.commit({ ...defaultSave(), points: 500 }, 0); // 基准过期
    expect(stale.status).toBe("stale");
    expect(stale.save.revision).toBe(1);
    expect(parseSave(storage.map.get(SAVE_MAIN_KEY)!)?.points).toBe(10);
  });

  it("rejects writes after an external tab update until reloaded", () => {
    const storage = new MemStorage();
    const a = new SaveStore(storage);
    const b = new SaveStore(storage);
    a.commit(bump(), 0); // rev 1
    b.notifyExternalWrite(SAVE_MAIN_KEY); // 模拟 storage 事件
    const res = b.commit({ ...defaultSave(), points: 777 }, 1);
    expect(res.status).toBe("stale");
    expect(res.save.points).toBe(10);
  });

  it("degrades to unsaved on quota errors without losing in-memory state", () => {
    const storage = new MemStorage();
    const store = new SaveStore(storage);
    store.commit(bump(), 0);
    storage.failWrites = true;
    const res = store.commit({ ...defaultSave(), points: 50 }, 1);
    expect(res.status).toBe("unsaved");
    expect(res.save.points).toBe(50); // 内存值仍然可用
    storage.failWrites = false;
    expect(store.load().save.points).toBe(10); // 磁盘未被破坏
  });
});
