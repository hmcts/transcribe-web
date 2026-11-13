import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingHistory } from "@/components/admin/setting-history";
import { AdminApiError } from "@/lib/admin-api";
import { type HistoryVersion, settingName, valueText } from "@/lib/history-api";
import { TemplateRefusedError } from "@/lib/templates-api";

// DIAAT-348: the product team sees who changed which setting, when, and what it was
// before, and goes back to an earlier version so a bad change is put right quickly.

const version = (
  number: number,
  change: Partial<HistoryVersion> = {}
): HistoryVersion => ({
  number,
  saved_at: "2026-11-12T14:05:00Z",
  saved_by: { id: "u1", email: "lead@example.test", name: "A Lead" },
  restored_from: null,
  first: false,
  content_as_now: false,
  changes: [],
  ...change,
});

const HISTORY: HistoryVersion[] = [
  version(3, {
    content_as_now: true,
    changes: [
      {
        setting: "settings.wording.help.subtitle",
        before: "Asylum appeals",
        after: "A mistake",
      },
    ],
  }),
  version(2, {
    saved_by: null,
    changes: [{ setting: "enabled", before: true, after: false }],
  }),
  version(1, { first: true }),
];

function show(props: Partial<Parameters<typeof SettingHistory>[0]> = {}) {
  const load = vi.fn().mockResolvedValue(HISTORY);
  const onRestore = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <SettingHistory
      id="history"
      load={load}
      version="v3"
      wordingKeys={{ "help.subtitle": "Subtitle of the help page" }}
      locked={false}
      unsaved={false}
      onRestore={onRestore}
      {...props}
    />
  );
  return { load, onRestore, view };
}

describe("SettingHistory", () => {
  it("says who changed each setting, when, and what it was before", async () => {
    const user = userEvent.setup();
    const { load } = show();
    expect(load).not.toHaveBeenCalled(); // only when asked for

    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );

    const versions = await screen.findByRole("list", { name: "Versions" });
    const [newest, outside, first] = Array.from(
      versions.children
    ) as HTMLElement[];
    expect(newest.textContent).toContain("Version 3: 12 November 2026");
    expect(newest.textContent).toContain("by A Lead");
    expect(newest.textContent).toContain(
      "Screen text: Subtitle of the help page: was Asylum appeals, now A mistake"
    );
    expect(outside.textContent).toContain(
      "by not recorded (changed outside the admin area)"
    );
    expect(outside.textContent).toContain("Enabled: was Yes, now No");
    expect(first.textContent).toContain("The history starts here");
    // Going back to what is there now would change nothing.
    expect(
      within(newest).queryByRole("button", { name: /Go back/ })
    ).toBeNull();
  });

  it("goes back to a version only once confirmed", async () => {
    const user = userEvent.setup();
    const { onRestore } = show();
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );

    await user.click(
      await screen.findByRole("button", { name: "Go back to version 2" })
    );
    expect(onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", { name: "Go back to version 2" })
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm: go back to version 2" })
    );

    expect(onRestore).toHaveBeenCalledWith(2);
  });

  it("does not go back over unsaved edits, and says why", async () => {
    const user = userEvent.setup();
    show({ unsaved: true });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );

    expect(
      await screen.findByText(
        "Save or discard your changes before going back to an earlier version."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Go back to version 2" })
    ).toHaveProperty("disabled", true);
  });

  it("says what stopped going back, naming each box", async () => {
    const user = userEvent.setup();
    const onRestore = vi
      .fn()
      .mockRejectedValue(
        new TemplateRefusedError("The template cannot be saved yet.", [
          "Costs has no field.",
        ])
      );
    show({ onRestore });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Go back to version 2" })
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm: go back to version 2" })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The template cannot be saved yet.");
    expect(alert.textContent).toContain("Costs has no field.");
  });

  it("names each problem of a jurisdiction's refusal too", async () => {
    const user = userEvent.setup();
    const onRestore = vi
      .fn()
      .mockRejectedValue(
        new AdminApiError("It cannot go back yet.", 400, "not_ready", [
          "It has no administrator.",
        ])
      );
    show({ onRestore });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Go back to version 2" })
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm: go back to version 2" })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("It cannot go back yet.");
    expect(alert.textContent).toContain("It has no administrator.");
  });

  it("offers nothing from the old history while the new version's loads", async () => {
    const user = userEvent.setup();
    const load = vi
      .fn()
      .mockResolvedValueOnce(HISTORY)
      .mockReturnValueOnce(new Promise<HistoryVersion[]>(() => undefined));
    const { view } = show({ load });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Go back to version 2" })
    );
    expect(
      screen.getByRole("button", { name: "Confirm: go back to version 2" })
    ).toBeTruthy();

    view.rerender(
      <SettingHistory
        id="history"
        load={load}
        version="v4"
        locked={false}
        unsaved={false}
        onRestore={vi.fn()}
      />
    );

    expect(await screen.findByText("Loading the history")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /go back/i })).toBeNull();
  });

  it("loads again for a new version, and ignores an answer that comes late", async () => {
    const user = userEvent.setup();
    let answerOld: (v: HistoryVersion[]) => void = () => undefined;
    const load = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<HistoryVersion[]>((resolve) => {
          answerOld = resolve;
        })
      )
      .mockResolvedValueOnce([version(4, { content_as_now: true })]);
    const { view } = show({ load });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );

    view.rerender(
      <SettingHistory
        id="history"
        load={load}
        version="v4"
        locked={false}
        unsaved={false}
        onRestore={vi.fn()}
      />
    );
    await screen.findByText(/Version 4:/);
    answerOld(HISTORY);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/Version 3:/)).toBeNull();
  });
});

describe("an API without the history", () => {
  it("says it needs the latest API", async () => {
    const user = userEvent.setup();
    show({
      load: vi
        .fn()
        .mockRejectedValue(new TemplateRefusedError("Not Found", [], 404)),
    });
    await user.click(
      screen.getByRole("button", { name: "Show who changed what" })
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The history needs the latest version of the API."
    );
  });
});

describe("the history's words", () => {
  it("names settings and values plainly", () => {
    expect(settingName("fields.Party1.label")).toBe("Field Party1: question");
    expect(settingName("settings.wording.home.intro")).toBe(
      "Screen text: home.intro"
    );
    expect(settingName("stage")).toBe("Who sees it");
    expect(valueText(null)).toBe("(none)");
    expect(valueText(["Claimant", "Respondent"])).toBe("Claimant, Respondent");
    expect(valueText(false)).toBe("No");
  });
});
