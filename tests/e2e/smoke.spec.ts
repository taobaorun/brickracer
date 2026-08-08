import { expect, test } from "@playwright/test";

test("app boots to builder", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
});
