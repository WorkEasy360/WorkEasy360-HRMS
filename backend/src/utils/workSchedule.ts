import { prisma } from "../config/prisma";
import { startOfUtcDay } from "./date";

/**
 * The organization's single default work schedule (Attendance & Leave 3.3,
 * Settings 7.1.2). One schedule, no shift roster.
 */
export type WorkSchedule = {
  timezone: string;
  /** ISO weekday numbers: 1 = Monday .. 7 = Sunday. */
  workingDays: number[];
  workStartTime: string;
  workEndTime: string;
  fullDayHours: number;
  /** Holiday dates as `YYYY-MM-DD`, so lookups never go through Date equality. */
  holidays: Map<string, string>;
};

export function dateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/** ISO weekday of a `@db.Date` value, read in UTC to match how it is stored. */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

export async function getWorkSchedule(organizationId: string, range?: { from: Date; to: Date }): Promise<WorkSchedule> {
  const [org, holidays] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true, workingDays: true, workStartTime: true, workEndTime: true, fullDayHours: true },
    }),
    prisma.holiday.findMany({
      where: { organizationId, ...(range ? { date: { gte: startOfUtcDay(range.from), lte: startOfUtcDay(range.to) } } : {}) },
      select: { date: true, name: true },
    }),
  ]);

  return {
    timezone: org?.timezone ?? "Asia/Kolkata",
    workingDays: org?.workingDays?.length ? org.workingDays : [1, 2, 3, 4, 5],
    workStartTime: org?.workStartTime ?? "09:00",
    workEndTime: org?.workEndTime ?? "18:00",
    fullDayHours: org?.fullDayHours ?? 8,
    holidays: new Map(holidays.map((h) => [dateKey(h.date), h.name])),
  };
}

export function isWorkingDay(date: Date, schedule: WorkSchedule): boolean {
  if (schedule.holidays.has(dateKey(date))) return false;
  return schedule.workingDays.includes(isoWeekday(date));
}

/** Working days in an inclusive date range, holidays and weekends excluded. */
export function countWorkingDays(from: Date, to: Date, schedule: WorkSchedule): number {
  let count = 0;
  for (let d = startOfUtcDay(from); d <= startOfUtcDay(to); d = new Date(d.getTime() + 86_400_000)) {
    if (isWorkingDay(d, schedule)) count += 1;
  }
  return count;
}

/**
 * Current wall-clock time in the organization's timezone, as minutes past
 * midnight, so "has the working day finished yet" can be answered without
 * pulling in a date library.
 */
export function minutesNowInOrgTimezone(schedule: WorkSchedule): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: schedule.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Today's calendar date in the organization's timezone, as UTC midnight. */
export function todayInOrgTimezone(schedule: WorkSchedule): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: schedule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${parts}T00:00:00.000Z`);
}

export type DayStatus = "HOLIDAY" | "WEEKLY_OFF" | "ON_LEAVE" | "PRESENT" | "NOT_CHECKED_IN" | "ABSENT";

/**
 * Status of one employee on one day (Home 1.1.2).
 *
 * Rule 02: not checked in is **not** automatically Absent. A working day only
 * becomes Absent once the schedule for that day has finished — for today, that
 * means after the configured end time in the organization's timezone.
 */
export function evaluateDay(params: {
  date: Date;
  schedule: WorkSchedule;
  hasCheckIn: boolean;
  onApprovedLeave: boolean;
  /** Today in the organization's timezone; pass once for a whole register. */
  today: Date;
  /** Minutes past midnight now, in the organization's timezone. */
  nowMinutes: number;
}): DayStatus {
  const { date, schedule, hasCheckIn, onApprovedLeave, today, nowMinutes } = params;
  const key = dateKey(date);

  if (schedule.holidays.has(key)) return "HOLIDAY";
  if (!schedule.workingDays.includes(isoWeekday(date))) return "WEEKLY_OFF";
  if (hasCheckIn) return "PRESENT";
  if (onApprovedLeave) return "ON_LEAVE";

  const todayKey = dateKey(today);
  if (key > todayKey) return "NOT_CHECKED_IN";
  if (key === todayKey) {
    // The day has not been evaluated yet while it is still running.
    return nowMinutes < parseTimeToMinutes(schedule.workEndTime) ? "NOT_CHECKED_IN" : "ABSENT";
  }
  return "ABSENT";
}
