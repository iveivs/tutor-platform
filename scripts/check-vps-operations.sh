#!/bin/sh
set -eu

base_url="${PUBLIC_APP_URL:-}"
[ -n "$base_url" ] || { echo "PUBLIC_APP_URL is required" >&2; exit 78; }

curl --fail --silent --show-error --max-time 10 "$base_url/api/health/live" >/dev/null
curl --fail --silent --show-error --max-time 10 "$base_url/api/health/ready" >/dev/null

for service in postgres app worker caddy; do
  docker compose ps --services --status running | grep -qx "$service" || { echo "Service is not running: $service" >&2; exit 1; }
done

database_ready="$(docker compose exec -T postgres psql --username=tutor --dbname=tutor_platform --tuples-only --no-align --command="SELECT CASE WHEN count(*) >= 20 THEN 'ok' ELSE 'missing' END FROM information_schema.tables WHERE table_schema = 'public';")"
[ "$database_ready" = "ok" ] || { echo "PostgreSQL schema check failed" >&2; exit 1; }

worker_ready="$(docker compose exec -T postgres psql --username=tutor --dbname=tutor_platform --tuples-only --no-align --command="SELECT CASE WHEN EXISTS (SELECT 1 FROM job_runs WHERE job_name = 'lesson-maintenance' AND status = 'succeeded' AND finished_at > now() - interval '30 minutes') THEN 'ok' ELSE 'stale' END;")"
[ "$worker_ready" = "ok" ] || { echo "Background worker has no recent successful run" >&2; exit 1; }

if [ "${VERIFY_BACKUP_RESTORE:-false}" = "true" ]; then
  docker compose --profile operations run --rm --entrypoint verify-postgres-backup backup
fi

echo "Tutor Platform operational checks succeeded"
