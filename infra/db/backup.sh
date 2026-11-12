#!/bin/sh
# Database + file storage backups (M11).
#
#   dadofit-backup           one backup now
#   dadofit-backup --loop    one backup every BACKUP_INTERVAL_SECONDS (service mode)
#
# Writes to /backups (a host directory that must be synced off-site):
#   /backups/db/dadofit-<UTC timestamp>.dump        pg_dump custom format
#   /backups/storage/storage-<UTC timestamp>.tar.gz  evidence files
#   *.sha256                                         integrity checksums
# Files older than BACKUP_RETENTION_DAYS are removed.
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

backup_once() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p /backups/db /backups/storage

  db_file="/backups/db/dadofit-${stamp}.dump"
  pg_dump --format=custom --compress=6 --no-owner --file="${db_file}.part"
  mv "${db_file}.part" "$db_file"
  sha256sum "$db_file" > "${db_file}.sha256"

  if [ -d /data/storage ]; then
    st_file="/backups/storage/storage-${stamp}.tar.gz"
    tar -czf "${st_file}.part" -C /data storage
    mv "${st_file}.part" "$st_file"
    sha256sum "$st_file" > "${st_file}.sha256"
  fi

  find /backups/db /backups/storage -type f -mtime "+${RETENTION_DAYS}" -delete
  echo "backup: ${stamp} ok ($(du -h "$db_file" | cut -f1) database)"
}

if [ "${1:-}" = "--loop" ]; then
  while true; do
    backup_once || echo "backup: FAILED at $(date -u +%FT%TZ)" >&2
    sleep "$INTERVAL"
  done
else
  backup_once
fi
