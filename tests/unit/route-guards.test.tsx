import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout";
import RecordLayout from "@/app/record/layout";
import RecordingLayout from "@/app/recording/layout";
import UploadLayout from "@/app/upload/layout";
import RequestAccessLayout from "@/app/request-access/layout";
import SpeechDemoLayout from "@/app/speech-demo/layout";
import { isPathAllowed, landingAfterSwitch } from "@/lib/access/routes";
import type { MeResponse } from "@/lib/access/types";
import { accessValueFor } from "@/lib/access/permissions";
import { ME } from "../access-helpers";

// DIAAT-384: a page at its address shows "not available in your role" unless
// the active context holds the permission its area needs.

let mockPersona: MeResponse = ME.judge;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC")
);
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  mockPersona = ME.judge;
});

type Layout = (props: { children: React.ReactNode }) => React.ReactNode;

const AREAS: [string, Layout, string][] = [
  ["/record", RecordLayout as Layout, "dictation"],
  ["/upload", UploadLayout as Layout, "dictation"],
  ["/speech-demo", SpeechDemoLayout as Layout, "dictation"],
  ["/recording", RecordingLayout as Layout, "recordings"],
  ["/admin", AdminLayout as Layout, "admin"],
  ["/request-access", RequestAccessLayout as Layout, "request access"],
];

// Which areas each persona may open, as the permissions the API gave them say.
const OPENS: [string, MeResponse, string[]][] = [
  ["a judge", ME.judge, ["/record", "/upload", "/speech-demo", "/recording", "/request-access"]],
  ["a legal text manager", ME.legalTextManager, ["/admin", "/request-access"]],
  ["a jurisdiction administrator", ME.jurisdictionAdministrator, ["/admin", "/request-access"]],
  [
    "a jurisdiction super administrator",
    ME.jurisdictionSuperAdministrator,
    ["/admin", "/request-access"],
  ],
  ["a system administrator with no jurisdiction", ME.sysadminOnly, ["/admin"]],
];

describe("areas of the app by permission", () => {
  describe.each(OPENS)("for %s", (_name, persona, opens) => {
    it.each(AREAS)("%s", (path, Layout) => {
      mockPersona = persona;
      render(Layout({ children: <p>Area content</p> }));

      if (opens.includes(path)) {
        expect(screen.getByText("Area content")).toBeTruthy();
        expect(screen.queryByText(/not available in your role/)).toBeNull();
      } else {
        expect(screen.queryByText("Area content")).toBeNull();
        expect(
          screen.getByRole("heading", { name: /not available in your role/ })
        ).toBeTruthy();
      }
    });
  });

  it("says which role the user is working as, and offers the home page", () => {
    mockPersona = ME.legalTextManager;
    render(RecordLayout({ children: <p>Area content</p> }));

    expect(screen.getByText(/Immigration and Asylum Chamber as legal text manager/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/");
  });

  it("agrees with isPathAllowed, which the switch uses", () => {
    for (const [, persona, opens] of OPENS) {
      const { can } = accessValueFor(persona);
      for (const [path] of AREAS) {
        expect(isPathAllowed(path, can)).toBe(opens.includes(path));
      }
    }
    // Open to anyone who can see the app.
    expect(isPathAllowed("/", accessValueFor(ME.judge).can)).toBe(true);
    expect(isPathAllowed("/help", accessValueFor(ME.legalTextManager).can)).toBe(true);
  });
});

describe("where a tab lands after a switch", () => {
  const judge = accessValueFor(ME.judge).can;
  const administrator = accessValueFor(ME.jurisdictionAdministrator).can;

  it("stays on a list-level page the new context may use", () => {
    expect(landingAfterSwitch("/admin", administrator)).toBe("/admin");
    expect(landingAfterSwitch("/recording", judge)).toBe("/recording");
  });

  it("keeps the page's query with a page that stays (an email's approval link), and with nothing else", () => {
    expect(landingAfterSwitch("/admin", administrator, "?tab=approvals&request=r1")).toBe(
      "/admin?tab=approvals&request=r1"
    );
    expect(landingAfterSwitch("/admin", judge, "?tab=approvals")).toBe("/");
    expect(landingAfterSwitch("/recording/jobs/abc", judge, "?x=1")).toBe("/");
  });

  it("leaves a page the new context may not use, for the home page", () => {
    expect(landingAfterSwitch("/record", administrator)).toBe("/");
    expect(landingAfterSwitch("/admin", judge)).toBe("/");
  });

  it("never carries a page about one item to the new context", () => {
    expect(landingAfterSwitch("/recording/jobs/abc", judge)).toBe("/");
    expect(landingAfterSwitch("/", judge)).toBe("/");
  });
});
