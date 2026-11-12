#!/bin/sh
# One-shot data import from a Supabase Postgres (Cloud or the local CLI stack)
# into the self-hosted stack database. Runs inside the postgres image:
#
#   docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools \
#     run --rm -e SOURCE_DATABASE_URL='postgres://…' -e CONFIRM_REPLACE_TARGET_DATA=yes import-data
#
# What it does (target = the stack database configured by PG* variables):
#   1. Checks both databases and lists the migrations each one has applied.
#   2. Empties the target's public tables, auth.users and storage metadata
#      (only with CONFIRM_REPLACE_TARGET_DATA=yes).
#   3. Copies auth.users (only the columns the new auth service uses; bcrypt
#      password hashes keep working), public data and storage metadata, with
#      triggers disabled so bootstrap triggers do not create duplicates.
#   4. Prints row counts and economy totals for source and target.
# File bytes are copied afterwards by server/scripts/import-storage-files.mjs.
#
# The source is only read (pg_dump / COPY TO). Nothing is written there.
set -eu

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
if [ "${CONFIRM_REPLACE_TARGET_DATA:-}" != "yes" ]; then
  echo "import: refusing to run. This REPLACES all application data in the target database ($PGHOST/$PGDATABASE)." >&2
  echo "import: set CONFIRM_REPLACE_TARGET_DATA=yes to continue." >&2
  exit 1
fi

WORK=/tmp/dadofit-import
mkdir -p "$WORK"
src() { psql -X -v ON_ERROR_STOP=1 -q "$SOURCE_DATABASE_URL" "$@"; }
dst() { psql -X -v ON_ERROR_STOP=1 -q "$@"; }

echo "import: checking connections"
src -tA -c "select 'source: ' || current_database() || ' / ' || version()"
dst -tA -c "select 'target: ' || current_database() || ' / ' || version()"

echo "import: source migrations (last 5)"
src -tA -c "select version from supabase_migrations.schema_migrations order by version desc limit 5" 2>/dev/null || echo "  (no supabase_migrations table)"

echo "import: dumping source data (public schema, data only)"
pg_dump "$SOURCE_DATABASE_URL" --data-only --schema=public --no-owner --no-privileges \
  --exclude-table=public.schema_migrations > "$WORK/public.sql"

src -c "\\copy (select id, coalesce(aud,'authenticated'), coalesce(role,'authenticated'), email, encrypted_password, email_confirmed_at, coalesce(raw_app_meta_data,'{}'::jsonb), coalesce(raw_user_meta_data,'{}'::jsonb), banned_until, last_sign_in_at, created_at, coalesce(updated_at, created_at) from auth.users where deleted_at is null) to '$WORK/auth_users.csv' with csv"
src -c "\\copy (select id, name, public, file_size_limit, allowed_mime_types, created_at, coalesce(updated_at, created_at) from storage.buckets) to '$WORK/buckets.csv' with csv"
src -c "\\copy (select id, bucket_id, name, owner, coalesce(metadata,'{}'::jsonb), created_at, coalesce(updated_at, created_at) from storage.objects) to '$WORK/objects.csv' with csv"

echo "import: replacing target data"
{
  echo "begin;"
  echo "set session_replication_role = replica;"
  # Every application table in public, plus identities and storage metadata.
  echo "do \$\$ declare r record; begin
    for r in select tablename from pg_tables where schemaname = 'public' loop
      execute format('truncate table public.%I cascade', r.tablename);
    end loop;
  end \$\$;"
  echo "truncate table storage.objects, storage.buckets cascade;"
  echo "delete from auth.refresh_tokens; delete from auth.one_time_tokens; delete from auth.login_attempts;"
  echo "truncate table auth.users cascade;"
  echo "\\copy auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, banned_until, last_sign_in_at, created_at, updated_at) from '$WORK/auth_users.csv' with csv"
  cat "$WORK/public.sql"
  echo "\\copy storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at) from '$WORK/buckets.csv' with csv"
  echo "\\copy storage.objects (id, bucket_id, name, owner, metadata, created_at, updated_at) from '$WORK/objects.csv' with csv"
  echo "set session_replication_role = origin;"
  # Suspended profiles must also be banned in the new auth service.
  echo "update auth.users u set banned_until = 'infinity' from public.profiles p where p.id = u.id and p.platform_status = 'suspended';"
  echo "commit;"
} > "$WORK/load.sql"
dst -f "$WORK/load.sql"

echo "import: verification (source | target)"
CHECK="select 'users', count(*)::text from auth.users
 union all select 'profiles', count(*)::text from public.profiles
 union all select 'wallets_sum_dc', coalesce(sum(balance),0)::text from public.wallets
 union all select 'wallet_transactions', count(*)::text from public.wallet_transactions
 union all select 'challenges', count(*)::text from public.challenges
 union all select 'challenge_evidence', count(*)::text from public.challenge_evidence
 union all select 'organizations', count(*)::text from public.organizations
 union all select 'rewards', count(*)::text from public.rewards
 union all select 'reward_redemptions', count(*)::text from public.reward_redemptions
 union all select 'gym_point_sum', coalesce((select sum(balance) from public.gym_point_wallets),0)::text
 union all select 'sponsor_point_sum', coalesce((select sum(balance) from public.sponsor_point_wallets),0)::text
 union all select 'storage_objects', count(*)::text from storage.objects"
src -tA -F ' ' -c "$CHECK" > "$WORK/source.txt"
dst -tA -F ' ' -c "$CHECK" > "$WORK/target.txt"
paste -d ' ' "$WORK/source.txt" "$WORK/target.txt" | awk '{ status = ($2 == $4) ? "OK" : "DIFF"; printf "  %-22s %12s | %-12s %s\n", $1, $2, $4, status; if (status == "DIFF") bad = 1 } END { exit bad }' \
  && echo "import: all checks match" \
  || { echo "import: MISMATCH between source and target" >&2; exit 2; }

rm -rf "$WORK"
