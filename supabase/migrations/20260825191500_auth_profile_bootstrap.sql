-- DadoFit V9.1 - Real Auth & Profile bootstrap
-- Creates the public profile/progress/wallet foundation automatically
-- for every Supabase Auth user, including users that already exist.

create or replace function public.handle_new_dadofit_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_base text;
  generated_username text;
  generated_name text;
begin
  clean_base := lower(regexp_replace(split_part(coalesce(new.email, 'gymbro'), '@', 1), '[^a-z0-9_.]+', '', 'g'));
  if length(clean_base) < 3 then
    clean_base := 'gymbro';
  end if;

  generated_username := left(clean_base, 20) || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
  generated_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Gymbro'
  );

  insert into public.profiles (id, username, display_name)
  values (new.id, generated_username, generated_name)
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_dadofit_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_dadofit on auth.users;
create trigger on_auth_user_created_dadofit
after insert on auth.users
for each row execute function public.handle_new_dadofit_user();

-- Backfill any users created before this migration.
insert into public.profiles (id, username, display_name)
select
  u.id,
  left(
    case
      when length(lower(regexp_replace(split_part(coalesce(u.email, 'gymbro'), '@', 1), '[^a-z0-9_.]+', '', 'g'))) < 3
        then 'gymbro'
      else lower(regexp_replace(split_part(coalesce(u.email, 'gymbro'), '@', 1), '[^a-z0-9_.]+', '', 'g'))
    end,
    20
  ) || '_' || substr(replace(u.id::text, '-', ''), 1, 8),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Gymbro'
  )
from auth.users u
on conflict (id) do nothing;

insert into public.user_progress (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

insert into public.wallets (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;
