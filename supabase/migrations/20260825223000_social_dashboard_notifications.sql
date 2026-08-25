-- DadoFit V11.2 - Social dashboard + in-app notifications
-- Adds a secure dashboard summary RPC and allows users to mark only their own notifications as read.

-- Users may update only the read_at column of their own notifications.
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists notifications_update_read_own on public.notifications;
create policy notifications_update_read_own
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.get_dadofit_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_xp bigint := 0;
  v_level integer := 1;
  v_challenges_completed integer := 0;
  v_coins bigint := 0;
  v_squad_contribution_points bigint := 0;
  v_direct_pending integer := 0;
  v_squad_pending integer := 0;
  v_unread_notifications integer := 0;
  v_active_squads integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select coalesce(up.xp, 0), coalesce(up.level, 1), coalesce(up.challenges_completed, 0)
    into v_xp, v_level, v_challenges_completed
  from public.user_progress up
  where up.user_id = v_actor;

  select coalesce(w.balance, 0)
    into v_coins
  from public.wallets w
  where w.user_id = v_actor;

  select coalesce(sum(se.team_points), 0)
    into v_squad_contribution_points
  from public.score_events se
  join public.challenge_participants cp on cp.id = se.participant_id
  where cp.user_id = v_actor;

  select count(*)::integer
    into v_direct_pending
  from public.challenge_participants cp
  join public.challenges c on c.id = cp.challenge_id
  where cp.user_id = v_actor
    and c.challenge_type = 'direct'
    and c.status = 'active'
    and cp.status in ('invited', 'accepted', 'submitted', 'rejected');

  select count(distinct gb.id)::integer
    into v_squad_pending
  from public.group_battles gb
  join public.group_members gm
    on gm.group_id in (gb.challenger_group_id, gb.challenged_group_id)
  where gm.user_id = v_actor
    and gm.status = 'active'
    and gb.status in ('pending', 'active');

  select count(*)::integer
    into v_unread_notifications
  from public.notifications n
  where n.user_id = v_actor
    and n.read_at is null;

  select count(*)::integer
    into v_active_squads
  from public.group_members gm
  where gm.user_id = v_actor
    and gm.status = 'active';

  return jsonb_build_object(
    'xp', v_xp,
    'level', v_level,
    'coins', v_coins,
    'challenges_completed', v_challenges_completed,
    'squad_contribution_points', v_squad_contribution_points,
    'direct_pending', v_direct_pending,
    'squad_pending', v_squad_pending,
    'unread_notifications', v_unread_notifications,
    'active_squads', v_active_squads
  );
end;
$$;

revoke all on function public.get_dadofit_dashboard_summary() from public;
revoke all on function public.get_dadofit_dashboard_summary() from anon;
grant execute on function public.get_dadofit_dashboard_summary() to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v11.2-social-dashboard-notifications',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
