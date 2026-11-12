-- DadoFit V9.0 - Row Level Security
-- Default posture: deny writes unless explicitly allowed.

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;
alter table public.progress_transactions enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.seasons enable row level security;
alter table public.sponsor_campaigns enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_evidence enable row level security;
alter table public.challenge_reviews enable row level security;
alter table public.group_scores enable row level security;
alter table public.organization_scores enable row level security;
alter table public.score_events enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.notifications enable row level security;

-- Explicit privileges. RLS still decides which rows are visible.
revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.user_progress from anon, authenticated;
revoke all privileges on table public.progress_transactions from anon, authenticated;
revoke all privileges on table public.wallets from anon, authenticated;
revoke all privileges on table public.wallet_transactions from anon, authenticated;
revoke all privileges on table public.friendships from anon, authenticated;
revoke all privileges on table public.groups from anon, authenticated;
revoke all privileges on table public.group_members from anon, authenticated;
revoke all privileges on table public.organizations from anon, authenticated;
revoke all privileges on table public.organization_members from anon, authenticated;
revoke all privileges on table public.seasons from anon, authenticated;
revoke all privileges on table public.sponsor_campaigns from anon, authenticated;
revoke all privileges on table public.challenges from anon, authenticated;
revoke all privileges on table public.challenge_participants from anon, authenticated;
revoke all privileges on table public.challenge_evidence from anon, authenticated;
revoke all privileges on table public.challenge_reviews from anon, authenticated;
revoke all privileges on table public.group_scores from anon, authenticated;
revoke all privileges on table public.organization_scores from anon, authenticated;
revoke all privileges on table public.score_events from anon, authenticated;
revoke all privileges on table public.rewards from anon, authenticated;
revoke all privileges on table public.reward_redemptions from anon, authenticated;
revoke all privileges on table public.notifications from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select on table public.user_progress to authenticated;
grant select on table public.progress_transactions to authenticated;
grant select on table public.wallets to authenticated;
grant select on table public.wallet_transactions to authenticated;
grant select, insert, delete on table public.friendships to authenticated;
grant select, insert, update, delete on table public.groups to authenticated;
grant select on table public.group_members to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.seasons to authenticated;
grant select on table public.sponsor_campaigns to authenticated;
grant select, insert, update, delete on table public.challenges to authenticated;
grant select, insert on table public.challenge_participants to authenticated;
grant select, insert, delete on table public.challenge_evidence to authenticated;
grant select on table public.challenge_reviews to authenticated;
grant select on table public.group_scores to authenticated;
grant select on table public.organization_scores to authenticated;
grant select on table public.score_events to authenticated;
grant select on table public.rewards to authenticated;
grant select on table public.reward_redemptions to authenticated;
grant select on table public.notifications to authenticated;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
  );
$$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.is_challenge_creator(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenges c
    where c.id = p_challenge_id
      and (
        c.creator_user_id = auth.uid()
        or exists (
          select 1
          from public.group_members gm
          where gm.group_id = c.creator_group_id
            and gm.user_id = auth.uid()
            and gm.status = 'active'
            and gm.role in ('owner', 'admin')
        )
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = c.creator_organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and om.role in ('owner', 'admin', 'coach')
        )
      )
  );
$$;

create or replace function public.is_challenge_participant(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.user_id = auth.uid()
  );
$$;

create or replace function public.owns_challenge_participant(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    where cp.id = p_participant_id
      and cp.user_id = auth.uid()
  );
$$;

create or replace function public.can_access_challenge_participant(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    where cp.id = p_participant_id
      and (
        cp.user_id = auth.uid()
        or public.is_challenge_creator(cp.challenge_id)
      )
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.is_challenge_creator(uuid) from public;
revoke all on function public.is_challenge_participant(uuid) from public;
revoke all on function public.owns_challenge_participant(uuid) from public;
revoke all on function public.can_access_challenge_participant(uuid) from public;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_challenge_creator(uuid) to authenticated;
grant execute on function public.is_challenge_participant(uuid) to authenticated;
grant execute on function public.owns_challenge_participant(uuid) to authenticated;
grant execute on function public.can_access_challenge_participant(uuid) to authenticated;

-- Profiles
create policy profiles_read_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Progress and wallet are server-owned state. Users can only read their own data.
create policy user_progress_read_own
on public.user_progress for select
to authenticated
using (user_id = auth.uid());

create policy progress_transactions_read_own
on public.progress_transactions for select
to authenticated
using (user_id = auth.uid());

create policy wallets_read_own
on public.wallets for select
to authenticated
using (user_id = auth.uid());

create policy wallet_transactions_read_own
on public.wallet_transactions for select
to authenticated
using (
  exists (
    select 1 from public.wallets w
    where w.id = wallet_transactions.wallet_id
      and w.user_id = auth.uid()
  )
);

-- Gymbros
create policy friendships_read_involved
on public.friendships for select
to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friendships_create_request
on public.friendships for insert
to authenticated
with check (
  requester_id = auth.uid()
  and addressee_id <> auth.uid()
  and status = 'pending'
);

create policy friendships_delete_involved
on public.friendships for delete
to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Groups
create policy groups_read_visible
on public.groups for select
to authenticated
using (
  visibility = 'public'
  or owner_user_id = auth.uid()
  or public.is_group_member(id)
);

create policy groups_create_own
on public.groups for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy groups_update_owner
on public.groups for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy groups_delete_owner
on public.groups for delete
to authenticated
using (owner_user_id = auth.uid());

create policy group_members_read_related
on public.group_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_group_member(group_id)
  or exists (
    select 1 from public.groups g
    where g.id = group_members.group_id
      and g.owner_user_id = auth.uid()
  )
);

-- Organizations are discoverable to authenticated users; membership details are scoped.
create policy organizations_read_authenticated
on public.organizations for select
to authenticated
using (true);

create policy organization_members_read_related
on public.organization_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_member(organization_id)
  or exists (
    select 1 from public.organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = auth.uid()
  )
);

-- Seasons, sponsor campaigns, rankings and rewards are readable inside the app.
create policy seasons_read_authenticated
on public.seasons for select
to authenticated
using (true);

create policy sponsor_campaigns_read_authenticated
on public.sponsor_campaigns for select
to authenticated
using (true);

create policy group_scores_read_authenticated
on public.group_scores for select
to authenticated
using (true);

create policy organization_scores_read_authenticated
on public.organization_scores for select
to authenticated
using (true);

create policy score_events_read_authenticated
on public.score_events for select
to authenticated
using (true);

create policy rewards_read_authenticated
on public.rewards for select
to authenticated
using (true);

-- Challenges
create policy challenges_read_visible
on public.challenges for select
to authenticated
using (
  public.is_challenge_creator(id)
  or public.is_challenge_participant(id)
  or challenge_type in ('public', 'sponsored')
);

create policy challenges_create_user
on public.challenges for insert
to authenticated
with check (
  creator_kind = 'user'
  and creator_user_id = auth.uid()
  and creator_group_id is null
  and creator_organization_id is null
);

create policy challenges_update_creator
on public.challenges for update
to authenticated
using (public.is_challenge_creator(id))
with check (public.is_challenge_creator(id));

create policy challenges_delete_creator
on public.challenges for delete
to authenticated
using (public.is_challenge_creator(id));

create policy challenge_participants_read_related
on public.challenge_participants for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_challenge_creator(challenge_id)
);

create policy challenge_participants_create_by_creator
on public.challenge_participants for insert
to authenticated
with check (public.is_challenge_creator(challenge_id));

create policy challenge_evidence_read_related
on public.challenge_evidence for select
to authenticated
using (public.can_access_challenge_participant(participant_id));

create policy challenge_evidence_create_own
on public.challenge_evidence for insert
to authenticated
with check (public.owns_challenge_participant(participant_id));

create policy challenge_evidence_delete_own
on public.challenge_evidence for delete
to authenticated
using (public.owns_challenge_participant(participant_id));

create policy challenge_reviews_read_related
on public.challenge_reviews for select
to authenticated
using (public.can_access_challenge_participant(participant_id));

-- Reward redemptions are server-created so coin deductions stay atomic.
create policy reward_redemptions_read_own
on public.reward_redemptions for select
to authenticated
using (user_id = auth.uid());

-- Notifications are server-created.
create policy notifications_read_own
on public.notifications for select
to authenticated
using (user_id = auth.uid());
