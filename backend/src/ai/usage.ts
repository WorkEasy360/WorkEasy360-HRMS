import { prisma } from "../config/prisma";

/**
 * The daily allowance, one row per company per day.
 *
 * Taking a question is two statements so it is exact under concurrency: make
 * sure today's row exists, then increment it only while it is still under the
 * limit. The conditional update is what makes a burst of questions stop at the
 * limit instead of racing past it.
 */
export async function takeAssistantQuestion(organizationId: string, limit: number): Promise<boolean> {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  await prisma.aiUsageDay.upsert({
    where: { organizationId_day: { organizationId, day } },
    create: { organizationId, day, assistantMessages: 0 },
    update: {},
  });

  const { count } = await prisma.aiUsageDay.updateMany({
    where: { organizationId, day, assistantMessages: { lt: limit } },
    data: { assistantMessages: { increment: 1 } },
  });
  return count === 1;
}

/** How many questions this company has used today. */
export async function assistantUsageToday(organizationId: string): Promise<number> {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const row = await prisma.aiUsageDay.findUnique({ where: { organizationId_day: { organizationId, day } }, select: { assistantMessages: true } });
  return row?.assistantMessages ?? 0;
}
