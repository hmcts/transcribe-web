import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { open: "never" }],
    // Machine-readable report consumed by scripts/e2e-summary.mjs to build the
    // GitHub Actions job summary (DIAAT-241). Lands inside playwright-report/
    // so it's also captured by the report artifact upload.
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // A synthetic microphone. Granting the permission alone does not create
        // a capture device, so on a runner without audio hardware getUserMedia
        // would fail before the record page reached the Speech service.
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
});
