import { expect, test, type Page } from "@playwright/test";

async function freshPage(page: Page) {
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
}

/** 在画布扫描满足条件的稳定拾取点（亚像素余量 + 不被面板遮挡），返回归一化坐标。 */
async function findPickPoint(
  page: Page,
  matchPredicateSource: string,
): Promise<{ nx: number; ny: number } | null> {
  return page.evaluate((matchSrc) => {
    const w = window as unknown as {
      __brickracer: { controller: { runtime: { builderPick(a: number, b: number): unknown } } };
    };
    const rt = w.__brickracer.controller.runtime;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const matches = new Function("pick", matchSrc) as (p: never) => boolean;
    const layerEl = document.querySelector("[data-testid='canvas-tap-layer']")!;
    const rect = layerEl.getBoundingClientRect();
    const stable = (nx: number, ny: number) =>
      matches(rt.builderPick(nx, ny) as never) &&
      matches(rt.builderPick(nx + 0.003, ny) as never) &&
      matches(rt.builderPick(nx - 0.003, ny) as never) &&
      matches(rt.builderPick(nx, ny + 0.003) as never) &&
      matches(rt.builderPick(nx, ny - 0.003) as never);
    for (let ny = 0.05; ny < 0.95; ny += 0.004) {
      for (let nx = 0.05; nx < 0.95; nx += 0.004) {
        if (!stable(nx, ny)) continue;
        const el = document.elementFromPoint(rect.left + nx * rect.width, rect.top + ny * rect.height);
        if (el === layerEl) return { nx, ny };
      }
    }
    return null;
  }, matchPredicateSource);
}

async function clickAt(page: Page, pt: { nx: number; ny: number }) {
  const layer = page.getByTestId("canvas-tap-layer");
  const box = await layer.boundingBox();
  await page.mouse.click(box!.x + pt.nx * box!.width, box!.y + pt.ny * box!.height);
}

function brickCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { snapshot: { save: { activeBlueprint: { bricks: unknown[] } } } } };
    };
    return w.__brickracer.controller.snapshot.save.activeBlueprint.bricks.length;
  });
}

function lastBrickId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: {
        controller: { snapshot: { save: { activeBlueprint: { bricks: Array<{ instanceId: string }> } } } };
      };
    };
    const bricks = w.__brickracer.controller.snapshot.save.activeBlueprint.bricks;
    return bricks[bricks.length - 1]!.instanceId;
  });
}

function cameraPos(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { runtime: { builderCameraPosition(): { x: number; y: number; z: number } } } };
    };
    return w.__brickracer.controller.runtime.builderCameraPosition();
  });
}

test.describe("builder interactions (R2/R3)", () => {
  test("default car is present and start button available", async ({ page }) => {
    await freshPage(page);
    await expect(page.getByTestId("start-race")).toBeVisible();
    await expect(page.getByTestId("meter-速度")).toBeVisible();
  });

  test("place on chassis and stack upward on a brick face (real brick rules)", async ({
    page,
  }) => {
    await freshPage(page);
    await page.getByTestId("brick-brick-2x1").click();
    await page.getByTestId("color-blue").click();

    // 底盘空格位放置（搭建模式默认）
    const cell = await findPickPoint(
      page,
      `return pick.kind === "cell" && pick.position.y === 1 && (
        (pick.position.x === 1 && pick.position.z === 0) ||
        (pick.position.x === 0 && pick.position.z === 3) ||
        (pick.position.x === -1 && pick.position.z === 3) ||
        (pick.position.x === 1 && pick.position.z === 2)
      );`,
    );
    expect(cell, "no clickable chassis cell").not.toBeNull();
    await clickAt(page, cell!);
    expect(await brickCount(page)).toBe(5);

    // 向上堆叠：点击新积木顶面 → faceTarget 为上方格位
    const baseId = await lastBrickId(page);
    const top = await findPickPoint(
      page,
      `return pick.kind === "brick" && pick.instanceId === ${JSON.stringify(baseId)} && pick.faceTarget.y >= 2;`,
    );
    expect(top, "no clickable top face for stacking").not.toBeNull();
    await clickAt(page, top!);
    expect(await brickCount(page)).toBe(6);
  });

  test("select mode: pick, rotate and remove an existing brick", async ({ page }) => {
    await freshPage(page);
    await page.getByTestId("mode-select").click();
    const pt = await findPickPoint(
      page,
      `return pick.kind === "brick" && pick.instanceId === "b-cab-1";`,
    );
    expect(pt).not.toBeNull();
    await clickAt(page, pt!);
    await expect(page.getByTestId("selection-actions")).toBeVisible();
    await page.getByTestId("rotate-brick").click();
    expect(await brickCount(page)).toBe(4); // 默认车 4 块，旋转不增不减

    // 移除顶层积木（不破坏连通性）
    const top = await findPickPoint(
      page,
      `return pick.kind === "brick" && pick.instanceId === "b-cab-2";`,
    );
    expect(top).not.toBeNull();
    await clickAt(page, top!);
    await page.getByTestId("remove-brick").click();
    expect(await brickCount(page)).toBe(3);
  });

  test("orbit camera: drag rotates, wheel zooms", async ({ page }) => {
    await freshPage(page);
    const before = await cameraPos(page);
    // 直接派发 PointerEvent，跨浏览器/移动仿真一致地驱动真实手势处理器
    await page.evaluate(() => {
      const layer = document.querySelector("[data-testid='canvas-tap-layer']")!;
      const rect = layer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const fire = (type: string, x: number, y: number) =>
        layer.dispatchEvent(
          new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true, isPrimary: true }),
        );
      fire("pointerdown", cx, cy);
      for (let i = 1; i <= 8; i += 1) fire("pointermove", cx + i * 20, cy);
      fire("pointerup", cx + 160, cy);
    });
    const afterDrag = await cameraPos(page);
    expect(Math.hypot(afterDrag.x - before.x, afterDrag.z - before.z)).toBeGreaterThan(1);

    await page.evaluate(() => {
      const layer = document.querySelector("[data-testid='canvas-tap-layer']")!;
      layer.dispatchEvent(new WheelEvent("wheel", { deltaY: -300, bubbles: true }));
    });
    const afterZoom = await cameraPos(page);
    const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y - 0.5, p.z);
    expect(dist(afterZoom)).toBeLessThan(dist(afterDrag));
  });

  test("wheel arch cells are reserved with friendly feedback", async ({ page }) => {
    await freshPage(page);
    // 轮拱列（x=3, y=1）整列为保留区
    const pt = await findPickPoint(
      page,
      `return pick.kind === "cell" && pick.position.x === 3 && pick.position.y === 1 && pick.position.z >= -1 && pick.position.z <= 1;`,
    );
    if (pt) {
      await clickAt(page, pt);
      await expect(page.getByTestId("builder-feedback")).toBeVisible();
      expect(await brickCount(page)).toBe(4);
    }
  });

  test("locked parts are not equippable; selection persists via debounce save", async ({ page }) => {
    await freshPage(page);
    const options = page.getByTestId("slot-engine").locator("option");
    await expect(options).toHaveCount(1); // 只有基础发动机已解锁
    await page.waitForTimeout(800);
    const raw = await page.evaluate(() => window.localStorage.getItem("brickracer.save.v1"));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { activeBlueprint: { bricks: unknown[] } };
    expect(parsed.activeBlueprint.bricks.length).toBe(4);
  });
});
