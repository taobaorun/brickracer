import { expect, test, type Page } from "@playwright/test";

async function freshPage(page: Page) {
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
}

/** 依次尝试候选格位，点击第一个可命中的（适配不同视口遮挡）。 */
async function clickAnyCell(page: Page, cells: ReadonlyArray<readonly [number, number, number]>) {
  for (const [x, y, z] of cells) {
    const ok = await page.evaluate(
      ([cx, cy, cz]) => {
        const w = window as unknown as {
          __brickracer: {
            controller: {
              runtime: {
                builderPick(a: number, b: number): { kind: string; position?: { x: number; y: number; z: number } };
              };
            };
          };
        };
        const rt = w.__brickracer.controller.runtime;
        const layerEl = document.querySelector("[data-testid='canvas-tap-layer']")!;
        const rect = layerEl.getBoundingClientRect();
        for (let ny = 0.05; ny < 0.95; ny += 0.004) {
          for (let nx = 0.05; nx < 0.95; nx += 0.004) {
            const r = rt.builderPick(nx, ny);
            const isTarget = (p: { kind: string; position?: { x: number; y: number; z: number } }) =>
              p.kind === "cell" && p.position && p.position.x === cx && p.position.y === cy && p.position.z === cz;
            // 稳定性余量：相邻 4 个亚像素偏移也必须拾取同一格位（浏览器取整差异）
            if (
              isTarget(r) &&
              isTarget(rt.builderPick(nx + 0.003, ny)) &&
              isTarget(rt.builderPick(nx - 0.003, ny)) &&
              isTarget(rt.builderPick(nx, ny + 0.003)) &&
              isTarget(rt.builderPick(nx, ny - 0.003))
            ) {
              const el = document.elementFromPoint(rect.left + nx * rect.width, rect.top + ny * rect.height);
              if (el === layerEl) return { nx, ny };
            }
          }
        }
        return null;
      },
      [x, y, z] as const,
    );
    if (ok) {
      const layer = page.getByTestId("canvas-tap-layer");
      const box = await layer.boundingBox();
      await page.mouse.click(box!.x + ok.nx * box!.width, box!.y + ok.ny * box!.height);
      return [x, y, z] as const;
    }
  }
  throw new Error("no candidate cell clickable");
}

/** 找到命中当前新放积木的像素并点击（用于选中）。 */
async function clickBrick(page: Page, instanceId: string) {
  const layer = page.getByTestId("canvas-tap-layer");
  const box = await layer.boundingBox();
  const pt = await page.evaluate(
    (id) => {
      const w = window as unknown as {
        __brickracer: {
          controller: {
            runtime: {
              builderPick(a: number, b: number): { kind: string; instanceId?: string };
            };
          };
        };
      };
      const rt = w.__brickracer.controller.runtime;
      const layerEl = document.querySelector("[data-testid='canvas-tap-layer']")!;
      const rect = layerEl.getBoundingClientRect();
      for (let ny = 0.05; ny < 0.95; ny += 0.005) {
        for (let nx = 0.05; nx < 0.95; nx += 0.005) {
          const r = rt.builderPick(nx, ny);
          const isTarget = (p: { kind: string; instanceId?: string }) => p.kind === "brick" && p.instanceId === id;
          if (
            isTarget(r) &&
            isTarget(rt.builderPick(nx + 0.003, ny)) &&
            isTarget(rt.builderPick(nx - 0.003, ny)) &&
            isTarget(rt.builderPick(nx, ny + 0.003)) &&
            isTarget(rt.builderPick(nx, ny - 0.003))
          ) {
            const el = document.elementFromPoint(rect.left + nx * rect.width, rect.top + ny * rect.height);
            if (el === layerEl) return { nx, ny };
          }
        }
      }
      return null;
    },
    instanceId,
  );
  expect(pt, `no pixel hits brick ${instanceId}`).not.toBeNull();
  await page.mouse.click(box!.x + pt!.nx * box!.width, box!.y + pt!.ny * box!.height);
}

function brickCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { snapshot: { save: { activeBlueprint: { bricks: unknown[] } } } } };
    };
    return w.__brickracer.controller.snapshot.save.activeBlueprint.bricks.length;
  });
}

test.describe("builder interactions (R2/R3)", () => {
  test("default car is present and start button available", async ({ page }) => {
    await freshPage(page);
    await expect(page.getByTestId("start-race")).toBeVisible();
    await expect(page.getByTestId("meter-速度")).toBeVisible();
  });

  test("place, select, rotate and remove a brick", async ({ page }) => {
    await freshPage(page);
    await page.getByTestId("brick-brick-2x1").click();
    await page.getByTestId("color-blue").click();
    await clickAnyCell(page, [
      [1, 1, 0],
      [0, 1, 3],
      [-1, 1, 3],
      [1, 1, 2],
      [-2, 1, 3],
    ]);
    expect(await brickCount(page)).toBe(5);

    // 放置后自动选中 → 旋转 → 移除
    await expect(page.getByTestId("selection-actions")).toBeVisible();
    await page.getByTestId("rotate-brick").click();
    expect(await brickCount(page)).toBe(5);
    await page.getByTestId("remove-brick").click();
    expect(await brickCount(page)).toBe(4);

    // 点选已有积木也能选中
    await clickBrick(page, "b-cab-1");
    await expect(page.getByTestId("selection-actions")).toBeVisible();
  });

  test("equip locked part is impossible; unlocked selection persists debounce save", async ({ page }) => {
    await freshPage(page);
    const options = page.getByTestId("slot-engine").locator("option");
    await expect(options).toHaveCount(1); // 只有基础发动机已解锁
    // 等待防抖保存落盘
    await page.waitForTimeout(800);
    const raw = await page.evaluate(() => window.localStorage.getItem("brickracer.save.v1"));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { activeBlueprint: { bricks: unknown[] } };
    expect(parsed.activeBlueprint.bricks.length).toBe(4);
  });
});
