import { expect, type Page, test } from "@playwright/test";

// Renames speakers against a running backend, like segment-accept.spec.ts, so
// it's opt-in: set E2E_RENAME_JOB_ID to a COMPLETED job whose four segments
// are spoken by "Speaker 0", "Speaker 1", "Speaker 0", "Speaker 1" (the
// needs_review job from transcribe-api's scripts-seed-demo-data.py). It
// persists the new names, so re-seed the job before re-running.
const JOB_ID = process.env.E2E_RENAME_JOB_ID;

async function rename(
  page: Page,
  section: number,
  from: string,
  to: string,
  choice: "Replace one" | "Replace all"
) {
  await page
    .getByRole("button", { name: `Rename speaker ${from}` })
    .nth(section)
    .click();
  await page.getByLabel(`New name for ${from}`).fill(to);
  await page.getByRole("button", { name: choice, exact: true }).click();
  await expect(page.getByLabel(`New name for ${from}`)).toHaveCount(0);
}

async function speakers(page: Page) {
  return page
    .getByRole("button", { name: /^Rename speaker / })
    .evaluateAll((buttons) =>
      buttons.map((b) =>
        b.getAttribute("aria-label")?.replace("Rename speaker ", "")
      )
    );
}

test.describe("Speaker rename", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_RENAME_JOB_ID to a seeded two-speaker job id to run this test"
  );

  test("replace one renames a section, replace all renames the speaker everywhere", async ({
    page,
  }) => {
    await page.goto(`/recording/jobs/${JOB_ID}`);
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    await rename(page, 0, "Speaker 0", "Judge Patel", "Replace one");
    await page.reload();
    await expect
      .poll(() => speakers(page))
      .toEqual(["Judge Patel", "Speaker 1", "Speaker 0", "Speaker 1"]);

    await rename(page, 1, "Speaker 1", "Appellant", "Replace all");
    await page.reload();
    await expect
      .poll(() => speakers(page))
      .toEqual(["Judge Patel", "Appellant", "Speaker 0", "Appellant"]);
  });
});
