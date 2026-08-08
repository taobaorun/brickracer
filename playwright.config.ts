import { defineConfig, devices } from "@playwright/test";

// loop（真实时全场 racing 闭环）与 performance 为长时资源敏感测试：
// 从并行矩阵排除，通过 --project='loop-*' / --project=performance --workers=1 串行运行。
const MATRIX_IGNORE = [/performance\.spec\.ts/, /loop\.spec\.ts/];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: MATRIX_IGNORE,
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: MATRIX_IGNORE,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: MATRIX_IGNORE,
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"] },
      testIgnore: MATRIX_IGNORE,
    },
    {
      name: "desktop-firefox-smoke",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            // 本地回环不经代理（Playwright Firefox 在本机代理环境下会误走代理）
            "network.proxy.allow_hijacking_localhost": true,
            "network.proxy.testing_localhost_is_secure_when_hijacked": true,
            "network.proxy.type": 0,
          },
        },
      },
      testMatch: /smoke\.spec\.ts/,
    },
    { name: "loop-desktop-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /loop\.spec\.ts/ },
    { name: "loop-desktop-webkit", use: { ...devices["Desktop Safari"] }, testMatch: /loop\.spec\.ts/ },
    { name: "loop-mobile-chromium", use: { ...devices["Pixel 7"] }, testMatch: /loop\.spec\.ts/ },
    { name: "loop-mobile-webkit", use: { ...devices["iPhone 14"] }, testMatch: /loop\.spec\.ts/ },
    {
      name: "performance",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /performance\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
