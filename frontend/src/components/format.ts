/** Shared display formatters so dates and money look the same on every page. */

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** "12 Mar 2026" — returns an em dash for empty values. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, DATE_FORMAT);
}

/** For calendar dates stored without a time (e.g. date of birth): read in UTC so no timezone shifts the day. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { ...DATE_FORMAT, timeZone: "UTC" });
}

/** "2026-03-12" for an <input type="date">, or "" when empty. */
export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

/** "12 Mar 2026, 09:30" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { ...DATE_FORMAT, hour: "2-digit", minute: "2-digit" });
}

/** "09:30" */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "12 Mar – 14 Mar 2026" style range. */
export function formatDateRange(start: string | Date, end: string | Date): string {
  const a = formatDate(start);
  const b = formatDate(end);
  return a === b ? a : `${a} – ${b}`;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Formats money; defaults to INR with Indian digit grouping. */
export function formatMoney(value: number | string | null | undefined, currency = "INR"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  let fmt = moneyFormatters.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 });
    } catch {
      fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, fmt);
  }
  return fmt.format(n);
}

/** Today's date as YYYY-MM-DD in the user's own timezone (toISOString would give the UTC date). */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
