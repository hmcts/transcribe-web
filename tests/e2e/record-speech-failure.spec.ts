import { expect, test } from "@playwright/test";

/**
 * DIAAT-297 acceptance criterion, in a real browser:
 * "With the speech WebSocket path blocked or failing, the record page shows a
 * persistent error state and does not present as recording normally."
 *
 * Requires a running server with a real backend behind it (docker-compose, or
 * `pnpm dev` + the transcription_svc API), because the record page needs
 * `GET /api/get-speech-token` to succeed â€” the point of the test is that the
 * token call works and the *socket* does not, which is exactly what happened in
 * production. Run with: pnpm run test:e2e
 *
 * Set PLAYWRIGHT_BASE_URL to target a deployed environment.
 */

// Caddy proxies these to $AZURE_SPEECH_ENDPOINT, bypassing Next.js entirely.
const SPEECH_SOCKET_PATTERNS = [
  "**/cognitiveservices/**",
  "**/speech/**",
  "**/stt/**",
];

// The chromium project in playwright.config.ts supplies a fake microphone, so
// getUserMedia succeeds and the page goes on to open the speech socket.

test.describe("Record page with a broken speech WebSocket path", () => {
  /** Speech connections the page attempted and we blocked. */
  let blockedSpeechConnections = 0;

  test.beforeEach(async ({ page }) => {
    blockedSpeechConnections = 0;

    // Kill the speech socket while leaving every /api/* call healthy.
    for (const pattern of SPEECH_SOCKET_PATTERNS) {
      await page.routeWebSocket(pattern, (ws) => {
        blockedSpeechConnections += 1;
        ws.close();
      });
      await page.route(pattern, (route) => {
        blockedSpeechConnections += 1;
        return route.abort("connectionfailed");
      });
    }

    await page.goto("/record?mode=mic");
  });

  test.afterEach(async () => {
    // Without this, a page that failed earlier (no microphone, no token) would
    // show the same banners and pass without exercising the blocked socket.
    await expect
      .poll(() => blockedSpeechConnections, { timeout: 30_000 })
      .toBeGreaterThan(0);
  });

  test("shows a persistent error banner and stops claiming to record", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Start recording" }).click();

    const banner = page.getByTestId("record-alert-banner");
    // Allow for the reconnect backoff before the collapse threshold is crossed.
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute("data-severity", "error");
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");

    // The indicator must not present a healthy recording state.
    await expect(page.getByTestId("speech-status-label")).toHaveText(
      /not recording/i
    );
    await expect(
      page.getByRole("img", { name: /microphone not recording/i })
    ).toBeVisible();
  });

  test("does not let the user dismiss the warning while speech is being lost", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByTestId("record-alert-banner")).toBeVisible({
      timeout: 30_000,
    });

    await expect(
      page.getByRole("button", { name: /dismiss this message/i })
    ).toHaveCount(0);
  });

  test("keeps warning after the user pauses", async ({ page }) => {
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByTestId("record-alert-banner")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Pause recording" }).click();

    // The live warning clears with the session, but the judge still needs to be
    // told their transcript may be incomplete before they submit.
    await expect(
      page.getByText(/Recording failed during this session/i)
    ).toBeVisible();
  });
});
