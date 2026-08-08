import { expect, test, type Page } from "@playwright/test";

async function startRace(page: Page) {
  // 比赛为横屏呈现目标（设计 D2）：测试统一横屏，竖屏暂停属预期行为
  await page.setViewportSize({ width: 926, height: 428 });
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-race").click();
  await expect(page.getByTestId("race-hud")).toBeVisible({ timeout: 30_000 });
}

test.describe("race runtime (R5/R6 UI seam)", () => {
  test("countdown shows, throttle accelerates the car, pause and reset work", async ({ page }) => {
    await startRace(page);
    await expect(page.getByTestId("countdown")).toBeVisible();
    // 等倒计时结束
    await expect(page.getByTestId("countdown")).toBeHidden({ timeout: 6000 });

    await page.keyboard.down("w");
    await expect
      .poll(async () => {
        const text = await page.getByTestId("hud-speed").textContent();
        return Number.parseInt(text ?? "0", 10);
      }, { timeout: 8000 })
      .toBeGreaterThan(10);
    await page.keyboard.up("w");

    // 暂停/继续
    await page.getByTestId("pause-race").click();
    await expect(page.getByTestId("pause-menu")).toBeVisible();
    await page.getByTestId("resume-race").click();
    await expect(page.getByTestId("pause-menu")).toBeHidden();

    // 复位
    await page.getByTestId("reset-car").click();

    // 退出回车库
    await page.getByTestId("pause-race").click();
    await page.getByTestId("exit-to-builder").click();
    await expect(page.getByTestId("builder-panel")).toBeVisible();
  });

  test("hard collision detaches decorative bricks visually and restores after race", async ({ page }) => {
    await startRace(page);
    await expect(page.getByTestId("countdown")).toBeHidden({ timeout: 6000 });
    const fragments = await page.evaluate(() => {
      const w = window as unknown as {
        __brickracer: { controller: { runtime: { debugTriggerCollision(): void; fragmentCount(): number } } };
      };
      w.__brickracer.controller.runtime.debugTriggerCollision();
      return w.__brickracer.controller.runtime.fragmentCount();
    });
    expect(fragments).toBeGreaterThan(0);
    // 回车库后下一场比赛碎片池清空（退出即恢复）
    await page.getByTestId("pause-race").click();
    await page.getByTestId("exit-to-builder").click();
    await expect(page.getByTestId("builder-panel")).toBeVisible();
    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __brickracer: { controller: { runtime: { fragmentCount(): number } } };
      };
      return w.__brickracer.controller.runtime.fragmentCount();
    });
    expect(after).toBe(0);
  });
});
