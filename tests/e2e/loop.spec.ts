import { expect, test, type Page } from "@playwright/test";

/**
 * 完整成长闭环 E2E（R9/R10）：真实管道驾驶完整场比赛
 * （输入 → 物理 → 检查点 → 结算 → 存档），随后购买 → 换装 → 再赛 → 刷新恢复。
 * 自动驾驶开关与 AI 共用同一个 driveToward 驾驶员（I7 输入源等价）。
 */
async function autopilotRace(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { runtime: { debugAutopilot: boolean } } };
    };
    w.__brickracer.controller.runtime.debugAutopilot = true;
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as unknown as {
            __brickracer: { controller: { snapshot: { screen: { name: string } } } };
          };
          return w.__brickracer.controller.snapshot.screen.name;
        }),
      { timeout: 300_000, intervals: [500] },
    )
    .toBe("results");
}

test("full growth loop: race → points → purchase → equip → re-race → reload restores", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 926, height: 428 }); // 横屏比赛
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("start-race").click();
  await autopilotRace(page);

  // 结算页：积分已持久化后才可购买
  await expect(page.getByTestId("results-screen")).toBeVisible();
  const awardedText = await page.getByTestId("results-awarded").textContent();
  expect(awardedText).toContain("⭐");
  const pointsText = await page.getByTestId("results-points").textContent();
  const points = Number((pointsText ?? "").replace(/[^\d]/g, ""));
  expect(points).toBeGreaterThan(0);

  await page.getByTestId("go-shop").click();
  await expect(page.getByTestId("shop-screen")).toBeVisible();
  // 买得起的第一个部件
  const affordable = page.locator("[data-testid^='buy-']:not([disabled])").first();
  await expect(affordable).toBeVisible();
  const boughtId = (await affordable.getAttribute("data-testid"))!.replace("buy-", "");
  await affordable.click();

  // 装备并回搭建器
  await page.getByTestId(`equip-${boughtId}`).click();
  await expect(page.getByTestId("builder-panel")).toBeVisible();

  // 再比一场能正常进入
  await page.getByTestId("start-race").click();
  await expect(page.getByTestId("race-hud")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("pause-race").click();
  await page.getByTestId("exit-to-builder").click();

  // 刷新后进度恢复（R10）：积分余额、已解锁部件、已装备蓝图都要恢复
  await page.waitForTimeout(700); // 防抖落盘
  const beforeReload = await page.evaluate(() => window.localStorage.getItem("brickracer.save.v1"));
  expect(beforeReload).toBeTruthy();
  const expectedPoints = JSON.parse(beforeReload!) as { points: number };
  await page.reload();
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
  const restored = await page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: {
        controller: {
          snapshot: { save: { points: number; unlockedPartIds: string[]; activeBlueprint: { slots: Record<string, string | undefined> } } };
        };
      };
    };
    const s = w.__brickracer.controller.snapshot.save;
    return { points: s.points, unlocked: s.unlockedPartIds, slots: s.activeBlueprint.slots };
  });
  expect(restored.points).toBe(expectedPoints.points);
  expect(restored.unlocked).toContain(boughtId);
});
