#!/bin/sh
# DadoFit SQL migration runner (replaces the Supabase CLI).
#
# Applies every *.sql file of each directory in MIGRATION_DIRS (colon
# separated, processed in the given order, files sorted by name). Each file runs
# in its own transaction together with its bookkeeping row, so a failing file
# leaves no partial state and is retried on the next run.
#
# Already applied files are skipped. If an applied file changed on disk the run
# stops, unless ALLOW_CHECKSUM_DRIFT=1.
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
# PGDATABASE).

set -eu

MIGRATION_DIRS="${MIGRATION_DIRS:?MIGRATION_DIRS is required}"
ALLOW_CHECKSUM_DRIFT="${ALLOW_CHECKSUM_DRIFT:-0}"

psql_q() {
  psql -X -v ON_ERROR_STOP=1 -q "$@"
}

psql_q -c "
create schema if not exists dadofit_meta;
revoke all on schema dadofit_meta from public;
create table if not exists dadofit_meta.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);"

applied=0
skipped=0

old_ifs="$IFS"
IFS=':'
for dir in $MIGRATION_DIRS; do
  IFS="$old_ifs"
  if [ ! -d "$dir" ]; then
    echo "migrate: directory not found: $dir" >&2
    exit 1
  fi

  for file in $(find "$dir" -maxdepth 1 -type f -name '*.sql' | sort); do
    name="$(basename "$file")"
    case "$name" in
      *[!A-Za-z0-9_.-]*)
        echo "migrate: unsupported file name: $name" >&2
        exit 1
        ;;
    esac

    checksum="$(sha256sum "$file" | cut -d' ' -f1)"
    recorded="$(psql_q -tA -c "select checksum from dadofit_meta.schema_migrations where name = '$name'")"

    if [ -n "$recorded" ]; then
      if [ "$recorded" != "$checksum" ]; then
        if [ "$ALLOW_CHECKSUM_DRIFT" = "1" ]; then
          echo "migrate: WARNING $name changed after being applied (drift allowed)"
        else
          echo "migrate: $name changed after being applied (set ALLOW_CHECKSUM_DRIFT=1 to accept)" >&2
          exit 1
        fi
      fi
      skipped=$((skipped + 1))
      continue
    fi

    echo "migrate: applying $name"
    psql_q --single-transaction \
      -f "$file" \
      -c "insert into dadofit_meta.schema_migrations (name, checksum) values ('$name', '$checksum')"
    applied=$((applied + 1))
  done
  IFS=':'
done
IFS="$old_ifs"

echo "migrate: done (applied=$applied, already applied=$skipped)"

# Login password of the API role (created by db/migrations). Passed as a psql
# variable so psql quotes it (no SQL injection) and it is not echoed to logs.
if [ -n "${DADOFIT_API_DB_PASSWORD:-}" ]; then
  if psql_q -tA -c "select 1 from pg_roles where rolname = 'dadofit_api'" | grep -q 1; then
    printf '%s\n' "alter role dadofit_api with login password :'api_password';" \
      | psql_q -v api_password="$DADOFIT_API_DB_PASSWORD"
    echo "migrate: dadofit_api password set"
  fi
fi
