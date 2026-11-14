import { prisma } from "../config/prisma";
import { startOfUtcDay } from "./date";
import {
  dateKey,
  evaluateDay,
  getWorkSchedule,
  isWorkingDay,
  minutesNowInOrgTimezone,
  todayInOrgTimezone,
  type DayStatus,
} from "./workSchedule";

/**
 * Organization-wide attendance figures for the dashboards. Every function reads
 * in a fixed number of bulk queries, never one per employee or per day: the
 * database is a long round trip away in production.
 */

export type DayCounts = Record<DayStatus, number>;

const emptyCounts = (): DayCounts => ({
  HOLIDAY: 0,
  WEEKLY_OFF: 0,
  ON_LEAVE: 0,
  PRESENT: 0,
  NOT_CHECKED_IN: 0,
  ABSENT: 0,
});

const DAY_MS = 86_400_000;

/** Eligible on a day: joined by then, and not yet past their exit date. */
function eligibleOn(e: { dateOfJoining: Date | null; exitDate: Date | null }, day: Date): boolean {
  if (e.dateOfJoining && startOfUtcDay(e.dateOfJoining) > day) return false;
  if (e.exitDate && startOfUtcDay(e.exitDate) < day) return false;
  return true;
}

/**
 * Per-day attendance across a date range, inclusive. `rate` is present (or on
 * approved leave) as a share of eligible employees, and is null on days that
 * are not working days, so a weekend is never drawn as a bad day.
 */
export async function attendanceTrend(organizationId: string, from: Date, to: Date) {
  from = startOfUtcDay(from);
  to = startOfUtcDay(to);

  const [schedule, employees, records, leaves] = await Promise.all([
    getWorkSchedule(organizationId, { from, to }),
    prisma.employee.findMany({
      where: {
        organizationId,
        OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: to } }],
        AND: [{ OR: [{ exitDate: null }, { exitDate: { gte: from } }] }],
      },
      select: { id: true, dateOfJoining: true, exitDate: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, date: { gte: from, lte: to }, checkInAt: { not: null } },
      select: { employeeId: true, date: true },
    }),
    prisma.leaveRequest.findMany({
      where: { organizationId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const present = new Set(records.map((r) => `${r.employeeId}|${dateKey(r.date)}`));
  const onLeave = new Set<string>();
  for (const l of leaves) {
    for (let d = startOfUtcDay(l.startDate); d <= startOfUtcDay(l.endDate); d = new Date(d.getTime() + DAY_MS)) {
      onLeave.add(`${l.employeeId}|${dateKey(d)}`);
    }
  }

  const today = todayInOrgTimezone(schedule);
  const nowMinutes = minutesNowInOrgTimezone(schedule);
  const days: {
    date: string;
    isWorkingDay: boolean;
    holiday: string | null;
    eligible: number;
    counts: DayCounts;
    rate: number | null;
  }[] = [];

  for (let d = from; d <= to; d = new Date(d.getTime() + DAY_MS)) {
    const key = dateKey(d);
    const counts = emptyCounts();
    let eligible = 0;
    for (const e of employees) {
      if (!eligibleOn(e, d)) continue;
      eligible += 1;
      counts[
        evaluateDay({
          date: d,
          schedule,
          hasCheckIn: present.has(`${e.id}|${key}`),
          onApprovedLeave: onLeave.has(`${e.id}|${key}`),
          today,
          nowMinutes,
        })
      ] += 1;
    }
    const working = isWorkingDay(d, schedule);
    days.push({
      date: key,
      isWorkingDay: working,
      holiday: schedule.holidays.get(key) ?? null,
      eligible,
      counts,
      // Present counts as attended; approved leave is excused, not absent.
      rate: working && eligible > 0 && d <= today ? Math.round((counts.PRESENT / eligible) * 1000) / 10 : null,
    });
  }

  return { timezone: schedule.timezone, today: dateKey(today), days };
}
