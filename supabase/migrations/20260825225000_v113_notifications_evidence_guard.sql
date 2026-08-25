-- DadoFit V11.3 - Complete notifications + evidence guard milestone
-- Notification "mark all" is server-side and affects every unread notification for the authenticated user,
-- not only the rows currently loaded in the popover.

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = v_actor
    and read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
revoke all on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v11.3-notifications-evidence-guard',
    'direct_pair_cooldown_hours', 24,
    'direct_daily_limit', 5,
    'squad_pair_cooldown_hours', 24,
    'squad_daily_limit', 5,
    'notification_mark_all', true,
    'personal_evidence_required', true,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
