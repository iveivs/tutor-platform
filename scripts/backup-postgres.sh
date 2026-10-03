#!/bin/sh
set -eu

require() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Required environment variable $1 is missing" >&2
    exit 78
  fi
}

for variable in PGHOST PGUSER PGPASSWORD PGDATABASE RESTIC_REPOSITORY RESTIC_PASSWORD; do require "$variable"; done

run_backup() {
  export PGPASSWORD
  pg_dump --host="$PGHOST" --port="${PGPORT:-5432}" --username="$PGUSER" --dbname="$PGDATABASE" \
    --format=custom --compress=6 --no-owner --no-privileges \
    | restic backup --stdin --stdin-filename tutor-platform.dump --tag postgres --host "${BACKUP_HOST_TAG:-tutor-platform}"
  restic forget --tag postgres --keep-daily "${BACKUP_KEEP_DAILY:-7}" --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}" --prune
  touch /tmp/tutor-last-backup
}

trap 'exit 0' INT TERM
while :; do
  run_backup
  interval="${BACKUP_INTERVAL_SECONDS:-86400}"
  case "$interval" in *[!0-9]*|'') echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 78;; esac
  [ "$interval" -ge 3600 ] || { echo "BACKUP_INTERVAL_SECONDS must be at least 3600" >&2; exit 78; }
  sleep "$interval" & wait $!
done
