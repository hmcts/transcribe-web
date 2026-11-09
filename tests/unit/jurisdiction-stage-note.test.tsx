import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChooseJurisdiction from "@/components/jurisdiction/choose-jurisdiction";
import { stageNote } from "@/lib/jurisdiction-api";

// DIAAT-345: admins see a draft jurisdiction and testers one in test before it is
// live for everyone; the choice says so, so nobody takes it for the real thing.

describe("a jurisdiction not live yet", () => {
  it("is marked Draft or Test; a live one, or one from an API before stages, is not", () => {
    expect(stageNote("draft")).toBe("Draft");
    expect(stageNote("test")).toBe("Test");
    expect(stageNote("live")).toBeNull();
    expect(stageNote(undefined)).toBeNull();
  });

  it("is marked where the judge chooses a jurisdiction", () => {
    render(
      <ChooseJurisdiction
        jurisdictions={[
          {
            code: "IAC",
            name: "Immigration and Asylum Chamber",
            role: "judge",
            stage: "live",
          },
          {
            code: "ET",
            name: "Employment Tribunals (ET)",
            role: "judge",
            stage: "test",
          },
        ]}
        onChoose={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Immigration and Asylum Chamber" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Employment Tribunals (ET) (Test: not live yet)",
      })
    ).toBeTruthy();
  });
});
