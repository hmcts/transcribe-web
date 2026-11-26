/**
 * Dates a judge types (DIAAT-340): as DD/MM/YYYY, kept as YYYY-MM-DD.
 */

export const DATE_FORMAT_HINT = "DD/MM/YYYY, for example 27/03/2026";

/** A real day as YYYY-MM-DD, or undefined. */
function isoDay(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return date.toISOString().slice(0, 10);
}

/** Whether a value is a real day as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return (
    match !== null &&
    isoDay(Number(match[1]), Number(match[2]), Number(match[3])) === value
  );
}

/** What the judge typed as YYYY-MM-DD: day, month and a four-digit year, or as
 * YYYY-MM-DD itself (pasted); undefined when it is not a real day. */
export function parseTypedDate(text: string): string | undefined {
  const typed = text.trim();
  if (isIsoDate(typed)) return typed;
  const match = /^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})$/.exec(
    typed
  );
  return match
    ? isoDay(Number(match[3]), Number(match[2]), Number(match[1]))
    : undefined;
}
