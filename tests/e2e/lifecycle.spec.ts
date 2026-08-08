import { expect, test } from "@playwright/test";

/** 资源生命周期（I9）：反复进出比赛，物理身体数量必须稳定。 */
test("repeated race enter/exit keeps body/resource counts stable", async ({ page }) => {
  await page.setViewportSize({ width: 926, height: 428 }); // 横屏比赛
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });

  const bodyCountDuring: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId("start-race").click();
    await expect(page.getByTestId("race-hud")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("countdown")).toBeHidden({ timeout: 8000 });
    const count = await page.evaluate(() => {
      const w = window as unknown as {
        __brickracer: { controller: { runtime: { bodyCount(): number } } };
      };
      return w.__brickracer.controller.runtime.bodyCount();
    });
    bodyCountDuring.push(count);
    await page.getByTestId("pause-race").click();
    await page.getByTestId("exit-to-builder").click();
    await expect(page.getByTestId("builder-panel")).toBeVisible();
  }
  // 每次进入比赛的身体数一致（4 车 = 4 bodies），退出后归零（通过再次进入仍一致间接证明）
  expect(new Set(bodyCountDuring).size).toBe(1);
  expect(bodyCountDuring[0]).toBeGreaterThan(0);
  const afterExit = await page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { runtime: { bodyCount(): number } } };
    };
    return w.__brickracer.controller.runtime.bodyCount();
  });
  expect(afterExit).toBe(0);
});
