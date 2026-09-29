#!/bin/sh
set -e
# Apply pending database migrations before starting (safe with several tasks: Prisma takes a lock).
if [ "$RUN_MIGRATIONS" = "true" ]; then
  npx prisma migrate deploy
fi
exec node dist/index.js
