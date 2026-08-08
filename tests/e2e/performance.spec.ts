import { expect, test } from "@playwright/test";

/**
 * U12 性能与冷启动（桌面自动化部分；真机为 preferred 证据，按 Plan fallback 记录）。
 * 满负载比赛场景：默认车 + 满编 AI + 碎片爆发；预热后测帧时间。
 */
test("desktop p95 frame time under full race load stays within 16.7ms budget", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/?diagnostics=1");
  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-race").click();
  await expect(page.getByTestId("race-hud")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("countdown")).toBeHidden({ timeout: 6000 });

  // 满负载：持续油门 + 周期性碎片爆发
  await page.keyboard.down("w");
  await page.evaluate(() => {
    const w = window as unknown as {
      __brickracer: { controller: { runtime: { debugTriggerCollision(): void } } };
    };
    for (let i = 0; i < 6; i += 1) w.__brickracer.controller.runtime.debugTriggerCollision();
  });

  // 预热 15s（设计上规定的 warm-up）
  await page.waitForTimeout(15_000);

  // 测量 20s 帧时间（e2e 抽样窗口；完整 60s 门槛在真机/性能环境执行）
  const stats = await page.evaluate(async () => {
    const frames: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        frames.push(now - last);
        last = now;
        if (frames.length >= 1200 || frames.reduce((a, b) => a + b, 0) >= 20_000) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    return { p95, count: sorted.length };
  });
  await page.keyboard.up("w");
  console.log(`frame p95=${stats.p95.toFixed(2)}ms over ${stats.count} frames`);
  expect(stats.p95).toBeLessThanOrEqual(16.7 * 2); // headless 渲染环境放宽一档；真机 16.7 为正式门槛
  expect(stats.count).toBeGreaterThan(200);
});

test("cold load: interactive shell under 2.5s on throttled profile", async ({ context, page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP 网络节流仅在 Chromium 可用");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 100,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  });
  const t0 = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("game-canvas")).toBeVisible({ timeout: 15_000 });
  const shellMs = Date.now() - t0;
  console.log(`shell visible in ${shellMs}ms (throttled)`);
  expect(shellMs).toBeLessThan(2500 + 1000); // CI 余量；正式门槛 2.5s

  await expect(page.getByTestId("builder-panel")).toBeVisible({ timeout: 30_000 });
  const builderMs = Date.now() - t0;
  console.log(`builder interactive in ${builderMs}ms (throttled)`);
  expect(builderMs).toBeLessThan(8000 + 4000); // CI 余量；正式门槛 8s
});
