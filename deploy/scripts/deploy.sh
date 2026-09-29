#!/usr/bin/env bash
# Pull, migrate, and (re)start the production stack. Run on the host:
#
#   PULL=1 IMAGE_PREFIX=ghcr.io/<owner>/hrms IMAGE_TAG=<sha> bash deploy/scripts/deploy.sh
#   SKIP_MIGRATE=1 ... bash deploy/scripts/deploy.sh      # code-only release
#
# GitHub Actions runs this over SSH on every push to main (images are built on GitHub;
# this host never builds). The first time, run scripts/init-letsencrypt.sh BEFORE this.
#
# Order: preflight -> pull images -> migrate (one-off, `prisma migrate deploy` only)
#        -> up -d -> wait for health -> record release -> prune old images.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_dir="$(cd "$here/.." && pwd)"
cd "$deploy_dir"

compose=(docker compose -f docker-compose.prod.yml)

# --- preflight -----------------------------------------------------------------
if [ ! -f .env ]; then
  echo "deploy: $deploy_dir/.env is missing — cp .env.example .env and fill it in" >&2
  exit 1
fi
if grep -nE '^[A-Z_]+=.*(replace-me|REPLACE_PASSWORD|example\.com|xxxxxxxx)' .env; then
  echo "deploy: the lines above still hold template placeholders — fill them in first" >&2
  exit 1
fi
if ! grep -qE '^DATABASE_URL=.*[?&]schema=hrms(&|$)' .env; then
  echo "deploy: DATABASE_URL must include ?schema=hrms — the app must not touch the shared database's other schemas" >&2
  exit 1
fi
if grep -qE '^DATABASE_URL=postgres(ql)?://postgres[:@]' .env; then
  echo "deploy: DATABASE_URL uses the admin user — the app must connect as hrms_app" >&2
  exit 1
fi
bash "$here/check-migrations.sh" "$deploy_dir/../backend/prisma/migrations"
"${compose[@]}" config -q

# Caller-provided values win; otherwise reuse what .env recorded for the last release.
env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2-; }
export IMAGE_PREFIX="${IMAGE_PREFIX:-$(env_get IMAGE_PREFIX)}"
export IMAGE_TAG="${IMAGE_TAG:-$(env_get IMAGE_TAG)}"
echo "==> Release ${IMAGE_PREFIX}-{api,web}:${IMAGE_TAG}"

# --- images --------------------------------------------------------------------
if [ "${PULL:-0}" = "1" ]; then
  echo "==> Pulling images"
  "${compose[@]}" pull api web
else
  for img in api web; do
    docker image inspect "${IMAGE_PREFIX}-$img:${IMAGE_TAG}" >/dev/null 2>&1 || {
      echo "deploy: ${IMAGE_PREFIX}-$img:${IMAGE_TAG} is not on this host (use PULL=1)" >&2
      exit 1
    }
  done
fi

# --- migrate -------------------------------------------------------------------
if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  echo "==> Applying migrations (prisma migrate deploy) to schema hrms"
  "${compose[@]}" --profile migrate run --rm migrate
else
  echo "==> SKIP_MIGRATE=1 — not running migrations"
fi

# --- roll out --------------------------------------------------------------------
echo "==> Starting services"
"${compose[@]}" up -d --remove-orphans api web nginx certbot

echo "==> Waiting for api and web to report healthy"
for _ in $(seq 1 36); do
  api_status="$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q api)" 2>/dev/null || echo unknown)"
  web_status="$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q web)" 2>/dev/null || echo unknown)"
  if [ "$api_status" = healthy ] && [ "$web_status" = healthy ]; then break; fi
  sleep 5
done
"${compose[@]}" ps
if [ "$api_status" != healthy ] || [ "$web_status" != healthy ]; then
  echo "deploy: api is '$api_status', web is '$web_status' — check: docker compose -f docker-compose.prod.yml logs --tail=100 api web" >&2
  exit 1
fi

# Record what is running, so a manual `docker compose ... up -d` later on this host
# starts the same release.
for kv in "IMAGE_TAG=${IMAGE_TAG}" "IMAGE_PREFIX=${IMAGE_PREFIX}"; do
  key="${kv%%=*}"
  if grep -qE "^$key=" .env; then sed -i "s|^$key=.*|$kv|" .env; else echo "$kv" >> .env; fi
done

# --- tidy ----------------------------------------------------------------------
# Only dangling layers; tagged images of recent releases stay for quick rollbacks.
docker image prune -f >/dev/null
echo "==> Deployed ${IMAGE_TAG} — https://$(env_get DOMAIN)"
