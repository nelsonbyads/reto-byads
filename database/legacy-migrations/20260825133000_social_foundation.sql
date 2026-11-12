-- DadoFit V9.0 - Social Foundation
-- Core domain model for profiles, gymbros, groups, organizations,
-- challenges, evidence, DadoCoins, progression, sponsors and rewards.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  avatar_url text,
  bio text,
  country_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[a-z0-9_.]{3,30}$'
  )
);

create table public.user_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  challenges_completed integer not null default 0 check (challenges_completed >= 0),
  updated_at timestamptz not null default now()
);

create table public.progress_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  xp_amount bigint not null check (xp_amount <> 0),
  source_type text not null,
  source_id uuid,
  description text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  source_type text not null,
  source_id uuid,
  description text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_different_users check (requester_id <> addressee_id)
);

create unique index friendships_unique_pair_idx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  avatar_url text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('invited', 'active', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  slug text not null unique,
  organization_type text not null check (organization_type in ('gym', 'brand', 'sponsor', 'company', 'other')),
  description text,
  logo_url text,
  website_url text,
  country_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'coach', 'member')),
  status text not null default 'active' check (status in ('invited', 'active', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'upcoming' check (status in ('upcoming', 'active', 'completed', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint seasons_valid_range check (ends_at > starts_at)
);

create table public.sponsor_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  default_reward_coins bigint not null default 0 check (default_reward_coins >= 0),
  default_reward_xp bigint not null default 0 check (default_reward_xp >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsor_campaigns_valid_range check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_kind text not null check (creator_kind in ('user', 'group', 'organization', 'system')),
  creator_user_id uuid references public.profiles(id) on delete set null,
  creator_group_id uuid references public.groups(id) on delete set null,
  creator_organization_id uuid references public.organizations(id) on delete set null,
  challenge_type text not null check (challenge_type in ('direct', 'group', 'organization', 'sponsored', 'public')),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled', 'expired')),
  title text,
  description text,
  exercise_id text not null,
  exercise_name text not null,
  reps integer not null check (reps > 0),
  dice_level text not null check (dice_level in ('amateur', 'beginner', 'intermediate', 'advanced')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  evidence_required boolean not null default true,
  reward_coins bigint not null default 0 check (reward_coins >= 0),
  reward_xp bigint not null default 0 check (reward_xp >= 0),
  team_points integer not null default 0 check (team_points >= 0),
  sponsor_points integer not null default 0 check (sponsor_points >= 0),
  sponsor_campaign_id uuid references public.sponsor_campaigns(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  max_participants integer check (max_participants is null or max_participants > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_valid_range check (expires_at is null or expires_at > starts_at),
  constraint challenges_creator_matches_kind check (
    (creator_kind = 'user' and creator_user_id is not null and creator_group_id is null and creator_organization_id is null)
    or (creator_kind = 'group' and creator_user_id is null and creator_group_id is not null and creator_organization_id is null)
    or (creator_kind = 'organization' and creator_user_id is null and creator_group_id is null and creator_organization_id is not null)
    or (creator_kind = 'system' and creator_user_id is null and creator_group_id is null and creator_organization_id is null)
  )
);

create table public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  status text not null default 'invited' check (
    status in ('invited', 'accepted', 'declined', 'submitted', 'approved', 'rejected', 'expired')
  ),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create table public.challenge_evidence (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.challenge_participants(id) on delete cascade,
  evidence_kind text not null check (evidence_kind in ('image', 'video')),
  storage_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text,
  created_at timestamptz not null default now()
);

create table public.challenge_reviews (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.challenge_participants(id) on delete cascade,
  reviewer_user_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.group_scores (
  season_id uuid not null references public.seasons(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  team_points bigint not null default 0 check (team_points >= 0),
  completed_challenges bigint not null default 0 check (completed_challenges >= 0),
  updated_at timestamptz not null default now(),
  primary key (season_id, group_id)
);

create table public.organization_scores (
  season_id uuid not null references public.seasons(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sponsor_points bigint not null default 0 check (sponsor_points >= 0),
  completed_challenges bigint not null default 0 check (completed_challenges >= 0),
  participation_count bigint not null default 0 check (participation_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (season_id, organization_id)
);

create table public.score_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  participant_id uuid not null references public.challenge_participants(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  team_points integer not null default 0 check (team_points >= 0),
  sponsor_points integer not null default 0 check (sponsor_points >= 0),
  created_at timestamptz not null default now(),
  unique (participant_id)
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  title text not null,
  description text,
  reward_type text not null check (reward_type in ('discount', 'product', 'gym_pass', 'subscription', 'experience', 'other')),
  coin_cost bigint not null check (coin_cost >= 0),
  inventory integer check (inventory is null or inventory >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rewards_valid_range check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  coin_cost bigint not null check (coin_cost >= 0),
  status text not null default 'pending' check (status in ('pending', 'issued', 'redeemed', 'cancelled')),
  redemption_code text,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index profiles_username_idx on public.profiles (username);
create index friendships_requester_idx on public.friendships (requester_id, status);
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index group_members_user_idx on public.group_members (user_id, status);
create index organization_members_user_idx on public.organization_members (user_id, status);
create index challenges_creator_user_idx on public.challenges (creator_user_id, created_at desc);
create index challenges_creator_group_idx on public.challenges (creator_group_id, created_at desc);
create index challenges_creator_org_idx on public.challenges (creator_organization_id, created_at desc);
create index challenges_status_idx on public.challenges (status, starts_at desc);
create index challenge_participants_user_idx on public.challenge_participants (user_id, status, updated_at desc);
create index challenge_evidence_participant_idx on public.challenge_evidence (participant_id, created_at desc);
create index wallet_transactions_wallet_idx on public.wallet_transactions (wallet_id, created_at desc);
create index progress_transactions_user_idx on public.progress_transactions (user_id, created_at desc);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create index rewards_status_idx on public.rewards (status, coin_cost);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger user_progress_set_updated_at
before update on public.user_progress
for each row execute function public.set_updated_at();

create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

create trigger friendships_set_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

create trigger groups_set_updated_at
before update on public.groups
for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger sponsor_campaigns_set_updated_at
before update on public.sponsor_campaigns
for each row execute function public.set_updated_at();

create trigger challenges_set_updated_at
before update on public.challenges
for each row execute function public.set_updated_at();

create trigger challenge_participants_set_updated_at
before update on public.challenge_participants
for each row execute function public.set_updated_at();

create trigger rewards_set_updated_at
before update on public.rewards
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Gymbro'
  );

  insert into public.profiles (id, display_name)
  values (new.id, initial_name)
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v9.0-social-foundation',
    'server_time', now()
  );
$$;

create or replace function public.grant_wallet_coins(
  p_user_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(transaction_id uuid, new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_transaction_id uuid;
  v_balance bigint;
begin
  if p_amount <= 0 then
    raise exception 'p_amount must be greater than zero';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'p_idempotency_key is required';
  end if;

  select id, balance
    into v_wallet_id, v_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_wallet_id is null then
    raise exception 'wallet not found for user %', p_user_id;
  end if;

  insert into public.wallet_transactions (
    wallet_id,
    amount,
    source_type,
    source_id,
    description,
    idempotency_key
  ) values (
    v_wallet_id,
    p_amount,
    p_source_type,
    p_source_id,
    p_description,
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id into v_transaction_id
    from public.wallet_transactions
    where idempotency_key = p_idempotency_key;

    select balance into v_balance
    from public.wallets
    where id = v_wallet_id;

    return query select v_transaction_id, v_balance;
    return;
  end if;

  update public.wallets
  set balance = balance + p_amount
  where id = v_wallet_id
  returning balance into v_balance;

  return query select v_transaction_id, v_balance;
end;
$$;

revoke all on function public.grant_wallet_coins(uuid, bigint, text, uuid, text, text) from public;
revoke all on function public.grant_wallet_coins(uuid, bigint, text, uuid, text, text) from anon;
revoke all on function public.grant_wallet_coins(uuid, bigint, text, uuid, text, text) from authenticated;
grant execute on function public.grant_wallet_coins(uuid, bigint, text, uuid, text, text) to service_role;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
