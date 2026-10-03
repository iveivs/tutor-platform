FROM postgres:17.7-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates restic \
  && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 scripts/backup-postgres.sh /usr/local/bin/backup-postgres
COPY --chmod=755 scripts/verify-postgres-backup.sh /usr/local/bin/verify-postgres-backup
COPY --chmod=755 scripts/restore-postgres-backup.sh /usr/local/bin/restore-postgres-backup
COPY ops/backup/verify-restored-database.sql /opt/tutor/verify-restored-database.sql

ENV RESTIC_CACHE_DIR=/tmp/restic-cache
USER postgres
ENTRYPOINT ["backup-postgres"]
