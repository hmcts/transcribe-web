import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyToClipboard,
  dictationHtml,
  dictationText,
  notesText,
} from "@/lib/dictation-copy";

// DIAAT-333: what a judge copies out of a dictation into their own document.

const entry = (text: string) => ({ speaker: "Judge", text, timestamp: "00:00" });

describe("the text copied out of a dictation", () => {
  it("is what was dictated, one line each, in order", () => {
    expect(
      dictationText(
        { background: [entry("First."), entry(" Second. ")], evidence: [entry("Third.")], facts: [] },
        "<p></p>"
      )
    ).toBe("First.\nSecond.\nThird.");
  });

  it("is followed by the judge's notes, without their markup", () => {
    expect(
      dictationText(
        { background: [entry("Dictated.")], evidence: [], facts: [] },
        "<h3>Points</h3><p>Two &amp; three</p>"
      )
    ).toBe("Dictated.\n\nPoints\n\nTwo & three");
  });

  it("keeps the notes' line breaks and paragraph numbers", () => {
    const notes = notesText(
      "<p>Claimant: Mr A<br>Respondent: B Ltd</p><ol><li><p>The claim is dismissed.</p></li><li><p>No order for costs.</p></li></ol>"
    );
    expect(notes).toContain("Claimant: Mr A\nRespondent: B Ltd");
    expect(notes).toContain("1. The claim is dismissed.");
    expect(notes).toContain("2. No order for costs.");
  });

  it("is empty when nothing was dictated or noted", () => {
    expect(dictationText({ background: [], evidence: [], facts: [] }, "<p></p>")).toBe("");
    expect(
      notesText("<h3>Background</h3><ul><li><p></p></li></ul>".replace("Background", ""))
    ).toBe("");
  });
});

describe("the formatted copy, for a word processor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a paragraph per utterance, then the notes as written", () => {
    expect(
      dictationHtml(
        { background: [entry("A < B & C")], evidence: [], facts: [] },
        "<ol><li><p>Dismissed.</p></li></ol>"
      )
    ).toBe("<p>A &lt; B &amp; C</p><ol><li><p>Dismissed.</p></li></ol>");
    expect(dictationHtml({ background: [entry("Only.")], evidence: [], facts: [] }, "<p></p>")).toBe(
      "<p>Only.</p>"
    );
  });

  it.each([
    ["a single line break", "One\nTwo", "<p>One<br>Two</p>"],
    ["several line breaks", "One\nTwo\n\nThree", "<p>One<br>Two<br><br>Three</p>"],
    ["a CRLF as one break", "One\r\nTwo", "<p>One<br>Two</p>"],
    ["a lone CR", "One\rTwo", "<p>One<br>Two</p>"],
    ["mixed endings", "A\r\nB\nC\rD", "<p>A<br>B<br>C<br>D</p>"],
    [
      "a break beside characters that need escaping",
      "a < b &\n<script>x</script> & c",
      "<p>a &lt; b &amp;<br>&lt;script&gt;x&lt;/script&gt; &amp; c</p>",
    ],
    ["no break at the edges, which are trimmed", "\n One\nTwo \r\n", "<p>One<br>Two</p>"],
  ])("keeps %s inside an utterance as <br>", (_name, text, expected) => {
    expect(
      dictationHtml({ background: [entry(text)], evidence: [], facts: [] }, "<p></p>")
    ).toBe(expected);
  });

  it("leaves the plain-text copy's line breaks as they are", () => {
    expect(
      dictationText(
        { background: [entry("One\nTwo"), entry("Three\r\nFour")], evidence: [], facts: [] },
        "<p></p>"
      )
    ).toBe("One\nTwo\nThree\r\nFour");
  });

  it("goes on the clipboard as HTML and text where the browser allows it", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly items: Record<string, Blob>) {}
    });
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    await copyToClipboard("text", "<p>text</p>");

    expect(Object.keys(write.mock.calls[0][0][0].items)).toEqual(["text/plain", "text/html"]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyToClipboard("text", "<p>text</p>");
    expect(writeText).toHaveBeenCalledWith("text");
  });
});
