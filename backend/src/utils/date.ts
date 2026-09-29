import { HttpError } from "./HttpError";

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Today's calendar date (in the server's timezone) as UTC midnight, the form `@db.Date`
// columns store. Using local midnight instead stores the previous day on servers east of UTC.
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// Inclusive day count between two dates (ignores time-of-day).
export function daysBetweenInclusive(start: Date, end: Date): number {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

// Validates a `?month=YYYY-MM` query param and returns the [start, end) date range.
// Throws 400 on malformed input instead of letting an Invalid Date reach Prisma.
export function monthRange(month: string): { date: { gte: Date; lt: Date } } {
  if (typeof month !== "string" || !MONTH_PARAM.test(month)) {
    throw new HttpError(400, "month must be in YYYY-MM format");
  }
  const [year, m] = month.split("-").map(Number);
  // UTC boundaries to match how `@db.Date` columns are stored.
  return { date: { gte: new Date(Date.UTC(year, m - 1, 1)), lt: new Date(Date.UTC(year, m, 1)) } };
}

// Calendar-date normalization for values stored in `@db.Date` columns. Prisma
// persists the UTC date part, so normalize in UTC (not server-local time, which
// would shift the stored day on servers east of UTC).
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Latest calendar date that is "today" somewhere on earth (UTC+14), used to reject
// future-dated entries without penalizing clients ahead of the server's timezone.
export function latestCurrentDate(): Date {
  return startOfUtcDay(new Date(Date.now() + 14 * 60 * 60 * 1000));
}
