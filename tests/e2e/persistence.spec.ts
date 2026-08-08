import { expect, test } from "@playwright/test";

test.describe("persistence (R10)", () => {
  test("reload restores progress; corrupt main falls back safely", async ({ page }) => {
    await page.goto("/?diagnostics=1");
    await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(700); // 防抖保存

    // 注入损坏主存档 + 有效备份
    await page.evaluate(() => {
      const valid = window.localStorage.getItem("brickracer.save.v1");
      window.localStorage.setItem("brickracer.save.backup.v1", valid ?? "");
      window.localStorage.setItem("brickracer.save.v1", "{corrupt");
    });
    await page.reload();
    await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });

    // 全损坏 → 安全默认值
    await page.evaluate(() => {
      window.localStorage.setItem("brickracer.save.v1", "{corrupt");
      window.localStorage.setItem("brickracer.save.backup.v1", "also corrupt");
    });
    await page.reload();
    await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("points")).toContainText("0");
  });

  test("two tabs: stale writer is rejected with a friendly notice", async ({ context }) => {
    const a = await context.newPage();
    await a.goto("/?diagnostics=1");
    await expect(a.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
    await a.waitForTimeout(700);

    const b = await context.newPage();
    await b.goto("/?diagnostics=1");
    await expect(b.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });

    // A 放置积木（提交新 revision）→ B 的事务基准过期
    await a.evaluate(() => {
      const w = window as unknown as {
        __brickracer: {
          controller: {
            builderCommand(c: unknown): unknown;
            flushSave(): void;
          };
        };
      };
      w.__brickracer.controller.builderCommand({
        type: "placeBrick",
        brick: {
          instanceId: "tab-a-brick",
          brickTypeId: "brick-1x1",
          colorId: "red",
          position: { x: 1, y: 1, z: 1 },
          rotation: 0,
        },
      });
      w.__brickracer.controller.flushSave();
    });
    await a.waitForTimeout(300); // storage 事件传播

    // B 尝试提交 → stale 拒绝并提示
    const status = await b.evaluate(() => {
      const w = window as unknown as {
        __brickracer: {
          controller: {
            builderCommand(c: unknown): unknown;
            flushSave(): void;
            snapshot: { saveStatus: string; save: { activeBlueprint: { bricks: unknown[] } } };
          };
        };
      };
      const c = w.__brickracer.controller;
      c.builderCommand({
        type: "placeBrick",
        brick: {
          instanceId: "tab-b-brick",
          brickTypeId: "brick-1x1",
          colorId: "blue",
          position: { x: -1, y: 1, z: 1 },
          rotation: 0,
        },
      });
      c.flushSave();
      return { status: c.snapshot.saveStatus, bricks: c.snapshot.save.activeBlueprint.bricks.length };
    });
    expect(status.status).toBe("stale-external");
    expect(status.bricks).toBe(5); // 回载了 A 的最新进度而非覆盖
    await expect(b.getByTestId("save-stale")).toBeVisible();
  });
});
