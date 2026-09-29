import { PrismaClient } from "@prisma/client";

// The shared database can be a long round trip away (Mumbai → Stockholm is ~150 ms),
// so multi-statement transactions easily exceed Prisma's 5 s default.
export const prisma = new PrismaClient({
  transactionOptions: {
    timeout: Number(process.env.DB_TRANSACTION_TIMEOUT_MS ?? 30_000),
    maxWait: Number(process.env.DB_TRANSACTION_MAX_WAIT_MS ?? 10_000),
  },
});
