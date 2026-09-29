#!/usr/bin/env bash
# Refuses migrations that would reach outside the `hrms` schema of the shared Aurora
# database: a hardcoded "public" schema, CREATE EXTENSION, search_path changes,
# role/database-level DDL, or dropping schemas. deploy.sh runs this before every
# `migrate deploy`.
#
#   bash deploy/scripts/check-migrations.sh [path/to/migrations]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${1:-$here/../../backend/prisma/migrations}"

if [ ! -d "$dir" ]; then
  echo "check-migrations: no migrations directory at $dir" >&2
  exit 1
fi

pattern='"public"\.|\bpublic\.|"helpdesk"|\bhelpdesk\.|CREATE[[:space:]]+EXTENSION|search_path|ALTER[[:space:]]+(DATABASE|ROLE|SYSTEM|SCHEMA)|CREATE[[:space:]]+(ROLE|USER|DATABASE|SCHEMA)|DROP[[:space:]]+(SCHEMA|DATABASE|ROLE|OWNED)|GRANT[[:space:]]|REVOKE[[:space:]]'

if matches="$(grep -rniE "$pattern" --include='*.sql' "$dir")"; then
  echo "check-migrations: FAILED — these statements would touch objects outside schema hrms:" >&2
  echo "$matches" >&2
  echo "Fix the migration (Prisma qualifies nothing by default; ?schema=hrms scopes it)." >&2
  exit 1
fi

count="$(find "$dir" -name migration.sql | wc -l | tr -d ' ')"
echo "check-migrations: OK ($count migrations, nothing outside the target schema)"
