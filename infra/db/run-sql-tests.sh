#!/bin/sh
# Starts a throwaway Postgres, applies every migration from scratch and runs the
# pgTAP suites. Exit code 0 only if all migrations apply and every test passes.
set -eu

export POSTGRES_PASSWORD="sqltest-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export POSTGRES_DB=dadofit
export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE=dadofit

docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 >/tmp/postgres.log 2>&1 &
for _ in $(seq 1 60); do
  pg_isready -q && psql -X -q -tA -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

MIGRATION_DIRS="${MIGRATION_DIRS:-/migrations/compat:/migrations/app:/migrations/own}" sh /usr/local/bin/dadofit-migrate

status=0
for suite in /tests/*.sql; do
  [ -f "$suite" ] || continue
  echo "sqltest: running $(basename "$suite")"
  output="$(psql -X -v ON_ERROR_STOP=1 -tA -f "$suite" 2>&1)" || status=1
  echo "$output" | grep -E '^(ok|not ok|1\.\.|#)' || true
  if echo "$output" | grep -q '^not ok'; then status=1; fi
  if echo "$output" | grep -qE 'ERROR|Looks like you (failed|planned)'; then
    echo "$output" | grep -E 'ERROR|Looks like' >&2
    status=1
  fi
done

[ "$status" -eq 0 ] && echo "sqltest: all suites passed" || echo "sqltest: FAILED" >&2
exit "$status"
