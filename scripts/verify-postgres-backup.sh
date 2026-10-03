#!/bin/sh
set -eu

require() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then echo "Required environment variable $1 is missing" >&2; exit 78; fi
}
for variable in PGHOST PGUSER PGPASSWORD RESTIC_REPOSITORY RESTIC_PASSWORD; do require "$variable"; done

export PGPASSWORD
suffix="$(date +%Y%m%d%H%M%S)-$$"
database="tutor_restore_check_${suffix}"
dump="/tmp/${database}.dump"
case "$database" in tutor_restore_check_[0-9-]*) ;; *) echo "Unsafe verification database name" >&2; exit 70;; esac

cleanup() {
  rm -f "$dump"
  dropdb --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --if-exists "$database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

restic check
restic dump "${BACKUP_SNAPSHOT:-latest}" tutor-platform.dump > "$dump"
createdb --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --template=template0 "$database"
pg_restore --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$database" \
  --exit-on-error --no-owner --no-privileges "$dump"
psql --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$database" \
  --file=/opt/tutor/verify-restored-database.sql
echo "Backup restore verification succeeded"
