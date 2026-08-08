import { expect, test } from "@playwright/test";

/** R7 音频控制：手势门控解锁、静音持久化、降级不阻断。 */
test("audio unlocks after gesture; mute persists across reload", async ({ page }) => {
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });

  // 未交互前 AudioContext 未创建
  const before = await page.evaluate(() => {
    const w = window as unknown as { __brickracer: { controller: { audio: { getStatus(): string } } } };
    return w.__brickracer.controller.audio.getStatus();
  });
  expect(before).toBe("locked");

  // 首次手势后解锁（状态 ready；无音频设备环境降级为 degraded 也可接受——游戏不阻断）
  await page.mouse.click(10, 10);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const w = window as unknown as { __brickracer: { controller: { audio: { getStatus(): string } } } };
        return w.__brickracer.controller.audio.getStatus();
      }),
    )
    .not.toBe("locked");

  // 静音并等待防抖落盘
  await page.getByTestId("open-settings").click();
  await page.getByTestId("mute").check();
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("mute")).toBeChecked();
});
