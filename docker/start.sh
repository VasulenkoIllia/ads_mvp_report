#!/bin/sh
set -eu

if [ "${PRISMA_MIGRATE_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Applying Prisma migrations..."
  npx prisma migrate deploy
elif [ "${PRISMA_DB_PUSH_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] PRISMA_DB_PUSH_ON_START is deprecated; applying db push fallback..."
  npx prisma db push --skip-generate
else
  echo "[entrypoint] Skipping Prisma schema apply (PRISMA_MIGRATE_ON_START=false)"
fi

echo "[entrypoint] Starting API..."
exec node dist/main.js
