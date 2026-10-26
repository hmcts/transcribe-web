import { expect, test } from "@playwright/test";

/**
 * DIAAT-296 acceptance criteria, in a real browser:
 *  - "With the network blocked mid-recording, the record page shows a clear,
 *    persistent warning that the transcript is not being saved, and the warning
 *    clears automatically when connectivity returns."
 *  - "With `/.auth/refresh` failing, the user is prompted to re-authenticate
 *    instead of the page continuing to appear to work."
 *  - "A restore lookup that fails for network or auth reasons is reported to
 *    the user as a failure, not as an absence of a draft."
 *
 * Requires a running server with a real backend behind it (docker-compose, or
 * `pnpm dev` + the transcription_svc API). Run with: pnpm run test:e2e
 *
 * Set PLAYWRIGHT_BASE_URL to target a deployed environment.
 */

const LIVE_DRAFT = "**/api/live-draft";

test.use({ permissions: ["microphone"] });

/**
 * Get a transcript onto the page so autosave has something to write.
 *
 * The autosave content gating is deliberate â€” the page only writes once a
 * transcript section is non-empty â€” so a test that never produces speech would
 * see no saves at all and prove nothing.
 */
async function dictateSomething(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("save-status-label")).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("Record page with live-draft saving broken", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["microphone"]);
  });

  test("warns persistently when saves start failing, then clears on recovery", async ({
    page,
  }) => {
    await page.goto("/record?mode=mic");
    await dictateSomething(page);

    // Confirm saving was working before we break it, so the warning below is
    // attributable to the break and not to a page that never saved.
    await expect(page.getByTestId("save-status-label")).toHaveText(/^Saved /, {
      timeout: 30_000,
    });

    await page.route(LIVE_DRAFT, (route) => route.abort("connectionfailed"));

    const banner = page.getByTestId("record-alert-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute("data-kind", "autosave-failing");
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toHaveAttribute("aria-live", "assertive");
    await expect(
      page.getByText(/Your transcript is not being saved/i)
    ).toBeVisible();
    await expect(page.getByTestId("save-status-label")).toHaveText("Not saved");

    // Work being lost right now must not be dismissable.
    await expect(
      page.getByRole("button", { name: /dismiss this message/i })
    ).toHaveCount(0);

    // Connectivity returns; the retry backoff should clear this without the
    // user doing anything.
    await page.unroute(LIVE_DRAFT);
    await expect(banner).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("save-status-label")).toHaveText(/^Saved /);
  });

  test("prompts re-authentication when the backend rejects our identity", async ({
    page,
  }) => {
    await page.route("**/.auth/refresh", (route) =>
      route.fulfill({ status: 401, body: "" })
    );
    await page.goto("/record?mode=mic");
    await dictateSomething(page);

    await page.route(LIVE_DRAFT, (route) =>
      route.fulfill({ status: 401, body: "" })
    );

    const banner = page.getByTestId("record-alert-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute("data-kind", "auth-expired");
    await expect(page.getByText(/sign in again/i)).toBeVisible();
  });
});

test.describe("Record page when the restore lookup fails", () => {
  test("reports a failed lookup as a failure, not as an absent draft", async ({
    page,
  }) => {
    await page.route(LIVE_DRAFT, (route) =>
      route.request().method() === "GET"
        ? route.abort("connectionfailed")
        : route.continue()
    );

    await page.goto("/record?mode=mic");

    const banner = page.getByTestId("record-alert-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute("data-kind", "draft-restore-failed");
    await expect(
      page.getByText(/could not check for an unsaved transcript/i)
    ).toBeVisible();
  });

  test("stays silent when the user genuinely has no draft", async ({
    page,
  }) => {
    await page.route(LIVE_DRAFT, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 404, body: "" })
        : route.continue()
    );

    await page.goto("/record?mode=mic");
    await expect(
      page.getByRole("button", { name: "Start recording" })
    ).toBeVisible();

    // A 404 is the one genuine miss. It must not produce an alarm.
    await expect(page.getByTestId("record-alert-banner")).toHaveCount(0);
  });
});
