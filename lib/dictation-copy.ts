import { htmlToText } from "html-to-text";
import type {
  SectionedTranscript,
  TranscriptSection,
} from "@/components/audio/dictation/types";

const SECTION_ORDER: TranscriptSection[] = ["background", "evidence", "facts"];

/** The text of the judge's notes ("" if they are blank): paragraphs, line breaks,
 * bullets and list numbers kept; headings as written; empty items dropped. */
export function notesText(notesHtml: string): string {
  return htmlToText(notesHtml, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
    ],
  })
    .split("\n")
    .map((line) => line.trimEnd())
    // An empty bullet or numbered item is not text.
    .filter((line) => !/^\s*(\*|\d+\.)$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What a judge copies out of a dictation to use in their own document
 * (DIAAT-333): what they dictated, one line per utterance, then their notes.
 */
export function dictationText(
  transcript: SectionedTranscript,
  notesHtml: string
): string {
  const dictated = SECTION_ORDER.flatMap((section) =>
    transcript[section].map((entry) => entry.text.trim())
  )
    .filter(Boolean)
    .join("\n");
  const notes = notesText(notesHtml);
  return [dictated, notes].filter(Boolean).join("\n\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape first, then turn line breaks into <br>: inside a <p>, raw line
 * breaks collapse to spaces when pasted, so the judge's edits would be lost. */
function escapeHtmlKeepingLineBreaks(text: string): string {
  return escapeHtml(text).replace(/\r\n|\n|\r/g, "<br>");
}

/** The same, formatted, for pasting into a word processor: a paragraph per
 * utterance, then the notes as written (headings, lists, emphasis). */
export function dictationHtml(
  transcript: SectionedTranscript,
  notesHtml: string
): string {
  const dictated = SECTION_ORDER.flatMap((section) =>
    transcript[section].map((entry) => entry.text.trim())
  )
    .filter(Boolean)
    .map((text) => `<p>${escapeHtmlKeepingLineBreaks(text)}</p>`)
    .join("");
  return notesText(notesHtml) ? `${dictated}${notesHtml}` : dictated;
}

/** Copy, formatted where the browser allows it, else as plain text. */
export async function copyToClipboard(text: string, html: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}
