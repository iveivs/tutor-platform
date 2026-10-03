#!/bin/sh
set -eu

require() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then echo "Required environment variable $1 is missing" >&2; exit 78; fi
}
for variable in PGHOST PGUSER PGPASSWORD RESTIC_REPOSITORY RESTIC_PASSWORD RESTORE_TARGET_DATABASE RESTORE_CONFIRMATION; do require "$variable"; done

case "$RESTORE_TARGET_DATABASE" in postgres|template0|template1|'') echo "Protected database cannot be a restore target" >&2; exit 64;; esac
case "$RESTORE_TARGET_DATABASE" in *[!A-Za-z0-9_-]*) echo "Unsafe restore database name" >&2; exit 64;; esac
[ "$RESTORE_CONFIRMATION" = "RESTORE:$RESTORE_TARGET_DATABASE" ] || { echo "RESTORE_CONFIRMATION must equal RESTORE:$RESTORE_TARGET_DATABASE" >&2; exit 64; }

export PGPASSWORD
dump="/tmp/tutor-restore-$$.dump"
trap 'rm -f "$dump"' EXIT INT TERM
restic dump "${BACKUP_SNAPSHOT:-latest}" tutor-platform.dump > "$dump"
dropdb --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --if-exists "$RESTORE_TARGET_DATABASE"
createdb --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --template=template0 "$RESTORE_TARGET_DATABASE"
pg_restore --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$RESTORE_TARGET_DATABASE" \
  --exit-on-error --no-owner --no-privileges "$dump"
psql --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$RESTORE_TARGET_DATABASE" \
  --file=/opt/tutor/verify-restored-database.sql
echo "Restore completed and verified: $RESTORE_TARGET_DATABASE"
