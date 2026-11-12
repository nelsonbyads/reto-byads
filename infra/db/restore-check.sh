#!/bin/sh
# Restore drill (M11): restores a database backup into a scratch database on the
# same server, compares key counts with the live database and drops the scratch
# database. Never touches the live database.
#
#   dadofit-restore-check /backups/db/dadofit-<stamp>.dump
set -eu

DUMP="${1:?usage: restore-check <file.dump>}"
SCRATCH="dadofit_restore_check_$(date -u +%Y%m%d%H%M%S)"

if [ -f "${DUMP}.sha256" ]; then
  sha256sum -c "${DUMP}.sha256"
fi

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "create database \"${SCRATCH}\""
trap 'psql -X -q -d postgres -c "drop database if exists \"${SCRATCH}\""' EXIT

pg_restore --no-owner --exit-on-error -d "$SCRATCH" "$DUMP"

CHECK="select 'users', count(*) from auth.users
 union all select 'profiles', count(*) from public.profiles
 union all select 'wallets_sum_dc', coalesce(sum(balance),0) from public.wallets
 union all select 'challenges', count(*) from public.challenges
 union all select 'reward_redemptions', count(*) from public.reward_redemptions
 union all select 'migrations', count(*) from dadofit_meta.schema_migrations"
live="$(psql -X -tA -F ' ' -c "$CHECK")"
restored="$(psql -X -tA -F ' ' -d "$SCRATCH" -c "$CHECK")"
echo "restore-check: live vs restored"
echo "$live" > /tmp/live.txt
echo "$restored" > /tmp/restored.txt
paste -d ' ' /tmp/live.txt /tmp/restored.txt | awk '{ s = ($2 == $4) ? "OK" : "DIFF (live changed since the backup?)"; printf "  %-20s %10s | %-10s %s\n", $1, $2, $4, s }'
echo "restore-check: backup restored successfully into a scratch database (dropped on exit)"
