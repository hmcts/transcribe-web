import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableOfContents } from "@/components/help/table-of-contents";

// Help's sections appear and disappear while it is open (dictation guidance follows the runtime flag), so the
// table of contents reads the headings again when the content changes, not only when it first renders.

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

let setShown: (value: boolean) => void;
function Page() {
  const [shown, set] = useState(true);
  setShown = set;
  return (
    <>
      <TableOfContents contentId="content" />
      <main id="content">
        <h2 id="privacy">Privacy</h2>
        {shown && <h3 id="live-transcription">Live Transcription</h3>}
      </main>
    </>
  );
}

const linkNames = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("#"))
    .map((link) => link.textContent)
    .sort();

describe("TableOfContents", () => {
  it("drops the links of sections that went away, and adds those that appeared", async () => {
    render(<Page />);
    await waitFor(() => expect(linkNames()).toEqual(["Live Transcription", "Privacy"]));

    act(() => setShown(false)); // dictation switched off: its headings are gone
    await waitFor(() => expect(linkNames()).toEqual(["Privacy"]));

    act(() => setShown(true)); // and on again
    await waitFor(() => expect(linkNames()).toEqual(["Live Transcription", "Privacy"]));
  });
});
