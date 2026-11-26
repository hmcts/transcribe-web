// A hearing day's date (DIAAT-428): a calendar date, YYYY-MM-DD, with no time
// or zone. No "server-only": the pages and the route handlers both use it.

const HEARING_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isHearingDate(value: string): boolean {
  const match = HEARING_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Today in London, the API's default for a day with no date given. */
export function todayInLondon(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date());
}

/** "2 November 2026". Formatted in UTC: the date was parsed as UTC midnight. */
export function formatHearingDate(value: string): string {
  if (!isHearingDate(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
