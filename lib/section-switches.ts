/**
 * DIAAT-417: switching dictation sections while recording. Speech closes an utterance
 * only after a pause, so one utterance can hold speech from before and after the judge
 * changed section. Each word Speech recognised has its time, so an utterance is split
 * where the judge switched: what was said before goes to the section it was said in,
 * what was said after to the new one. Nothing is repeated or lost.
 */

/** A word as Speech recognised it, with when it was said (epoch ms). */
export interface TimedWord {
  word: string;
  startMs: number;
  endMs: number;
}

/** When an utterance was said (epoch ms) and, where Speech gave them, its words. */
export interface SegmentTiming {
  startMs: number;
  endMs: number;
  words: TimedWord[];
}

/** The judge chose ``section`` at ``at`` (epoch ms). */
export interface SectionSwitch {
  at: number;
  section: string;
}

/** Part of an utterance, and the section it goes to. */
export interface SectionPart {
  section: string;
  text: string;
}

/** Speech's offsets and durations are in 100-nanosecond ticks. */
const TICKS_PER_MS = 10_000;

/** The most of Speech's words one written token stands for ("1,234,567" and the like). */
const MAX_WORDS_PER_TOKEN = 12;

/** Beyond this, the written text is placed among the words by position alone. */
const MAX_ALIGNMENT_CELLS = 250_000;

/** The section chosen at ``time``: the last switch by then, or ``first``. */
export function sectionAt(
  time: number,
  first: string,
  switches: readonly SectionSwitch[]
): string {
  let section = first;
  for (const change of switches) {
    if (change.at <= time) section = change.section;
  }
  return section;
}

/** When the audio a result covers ended (epoch ms), counting from ``origin``. */
export function heardUntil(
  origin: number,
  offsetTicks: number | undefined,
  durationTicks: number | undefined
): number | undefined {
  if (typeof offsetTicks !== "number" || !Number.isFinite(offsetTicks))
    return undefined;
  return origin + (offsetTicks + (durationTicks ?? 0)) / TICKS_PER_MS;
}

/** Speech's audio time (ms from when it began) as epoch ms. */
export type ToEpochMs = (audioMs: number) => number;

/**
 * Speech's audio time as epoch ms: from when capture began (``start``), which its
 * offsets count from. A result that arrives later than its audio and any recognition
 * delay allow (``allowanceMs``, more for a result sent only after a pause) can only
 * mean the audio stalled: the audio heard after the last result is then dated later,
 * and what was heard before keeps its time.
 */
export function audioClock(start: number) {
  const steps = [{ fromMs: 0, origin: start }];
  let heardSoFar = 0;
  const at: ToEpochMs = (audioMs) => {
    let origin = start;
    for (const step of steps) if (step.fromMs <= audioMs) origin = step.origin;
    return origin + audioMs;
  };
  /** A result received at ``receivedAt`` covers the audio up to ``heardMs``. */
  const heard = (heardMs: number, receivedAt: number, allowanceMs: number) => {
    const needed = receivedAt - heardMs - allowanceMs;
    const last = steps[steps.length - 1];
    if (needed > last.origin)
      steps.push({ fromMs: heardSoFar, origin: needed });
    heardSoFar = Math.max(heardSoFar, heardMs);
  };
  return { at, heard };
}

/**
 * An utterance's timing from Speech's detailed result, its offsets dated by ``toEpoch``.
 * Undefined when the result has no offset (then the utterance is not split).
 */
export function segmentTiming(
  toEpoch: ToEpochMs,
  offsetTicks: number | undefined,
  durationTicks: number | undefined,
  json: string | undefined
): SegmentTiming | undefined {
  const heardMs = heardUntil(0, offsetTicks, durationTicks);
  if (heardMs === undefined || offsetTicks === undefined) return undefined;
  const startMs = toEpoch(offsetTicks / TICKS_PER_MS);
  const endMs = toEpoch(heardMs);
  let words: TimedWord[] = [];
  try {
    const best = JSON.parse(json ?? "")?.NBest?.[0];
    if (Array.isArray(best?.Words)) {
      words = best.Words.flatMap(
        (w: { Word?: unknown; Offset?: unknown; Duration?: unknown }) =>
          typeof w.Word === "string" && typeof w.Offset === "number"
            ? [
                {
                  word: w.Word,
                  startMs: toEpoch(w.Offset / TICKS_PER_MS),
                  endMs: toEpoch(
                    (w.Offset +
                      (typeof w.Duration === "number" ? w.Duration : 0)) /
                      TICKS_PER_MS
                  ),
                },
              ]
            : []
      );
    }
  } catch {
    // No detailed result: the utterance's own times are used.
  }
  return { startMs, endMs, words };
}

const normalised = (token: string) =>
  token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** The number spoken words say ("one hundred and five": 105), or null. */
function spokenNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const word of words) {
    if (word === "and") continue;
    if (word in UNITS) current += UNITS[word];
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word in SCALES) {
      total += (current || 1) * SCALES[word];
      current = 0;
    } else return null;
    any = true;
  }
  return any ? total + current : null;
}

/** Whether a written token is the number spoken ``words`` say ("105"). */
function saysNumber(token: string, words: string[]): boolean {
  if (!/^\d+$/.test(token)) return false;
  const value = Number(token);
  return spokenNumber(words) === value || saysYear(value, words);
}

/** Whether ``words`` say ``year`` as years are said: in two halves ("twenty fourteen",
 * "nineteen ninety nine", "twenty oh five"). */
function saysYear(year: number, words: string[]): boolean {
  if (year < 1000 || year > 2999) return false;
  for (let half = 1; half < words.length; half++) {
    const century = spokenNumber(words.slice(0, half));
    const second = words.slice(half);
    // "oh five": the 0 of 05.
    const rest = spokenNumber(second[0] === "oh" ? second.slice(1) : second);
    if (
      century !== null &&
      rest !== null &&
      century >= 10 &&
      century < 100 &&
      rest < 100 &&
      century * 100 + rest === year
    )
      return true;
  }
  return false;
}

/**
 * For each written token, the index of the first of Speech's words it stands for, or
 * null for punctuation alone. Written and spoken differ ("2014" for "twenty fourteen",
 * "£2.50" for "two pounds fifty"), so first the most tokens are matched to words that
 * are the same, or say the same number or year; each token in between is then placed
 * among the words between those matches by position.
 */
function tokenWords(tokens: string[], words: string[]): (number | null)[] {
  const t = tokens.length;
  const w = words.length;
  // Token index -> the first of its words, and how many it stands for.
  const matched = new Map<number, { word: number; count: number }>();
  if ((t + 1) * (w + 1) <= MAX_ALIGNMENT_CELLS) {
    // best[i][j]: the most tokens of tokens[i:] matched with words of words[j:].
    const best = Array.from({ length: t + 1 }, () =>
      new Array<number>(w + 1).fill(0)
    );
    const span = Array.from({ length: t + 1 }, () =>
      new Array<number>(w + 1).fill(0)
    );
    for (let i = t - 1; i >= 0; i--) {
      for (let j = w - 1; j >= 0; j--) {
        best[i][j] = Math.max(best[i + 1][j], best[i][j + 1]);
        if (!tokens[i]) continue;
        for (let m = 1; m <= MAX_WORDS_PER_TOKEN && j + m <= w; m++) {
          const matches =
            (m === 1 && tokens[i] === words[j]) ||
            saysNumber(tokens[i], words.slice(j, j + m));
          if (matches && 1 + best[i + 1][j + m] > best[i][j]) {
            best[i][j] = 1 + best[i + 1][j + m];
            span[i][j] = m;
          }
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < t && j < w) {
      if (span[i][j] > 0) {
        matched.set(i, { word: j, count: span[i][j] });
        j += span[i][j];
        i++;
      } else if (best[i][j] === best[i + 1][j]) i++;
      else j++;
    }
  }

  const first: (number | null)[] = tokens.map(() => null);
  // The tokens between matches, spread over the words between them; with no word
  // between, they go with the word before.
  let tokensFrom = 0;
  let wordsFrom = 0;
  const place = (tokensTo: number, wordsTo: number) => {
    const gap: number[] = [];
    for (let k = tokensFrom; k < tokensTo; k++) if (tokens[k]) gap.push(k);
    const room = wordsTo - wordsFrom;
    gap.forEach((k, n) => {
      first[k] =
        room > 0
          ? wordsFrom + Math.floor((n * room) / gap.length)
          : Math.max(0, Math.min(w - 1, wordsFrom - 1));
    });
  };
  for (const [i, { word, count }] of matched) {
    place(i, word);
    first[i] = word;
    tokensFrom = i + 1;
    wordsFrom = word + count;
  }
  place(t, w);
  return first;
}

const capitalised = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The utterance ``text`` in parts by the section each was said in: one part, the text
 * as it is, unless the judge switched while saying it. Its words go to the section
 * chosen when each began, and the written text (punctuation, numbers) is split to
 * match. Without words or timing, it all stays where it started, as before.
 */
export function splitBySection(
  text: string,
  timing: SegmentTiming | undefined,
  first: string,
  switches: readonly SectionSwitch[]
): SectionPart[] {
  if (!timing) return [{ section: first, text }];
  if (timing.words.length === 0) {
    return [{ section: sectionAt(timing.startMs, first, switches), text }];
  }
  const sections = timing.words.map((w) =>
    sectionAt(w.startMs, first, switches)
  );
  if (sections.every((section) => section === sections[0])) {
    return [{ section: sections[0], text }];
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  const plainTokens = tokens.map(normalised);
  const plainWords = timing.words.map((w) => normalised(w.word));
  const firstWords = tokenWords(plainTokens, plainWords);

  const pieces: { section: string; tokens: string[] }[] = [];
  tokens.forEach((token, i) => {
    const word = firstWords[i];
    // Punctuation alone stays with what it follows.
    const section =
      word === null ? (pieces.at(-1)?.section ?? sections[0]) : sections[word];
    const last = pieces.at(-1);
    if (last?.section === section) last.tokens.push(token);
    else pieces.push({ section, tokens: [token] });
  });
  // A later part starts a sentence of its own.
  return pieces.map((piece, i) => {
    const joined = piece.tokens.join(" ");
    return {
      section: piece.section,
      text: i === 0 ? joined : capitalised(joined),
    };
  });
}
