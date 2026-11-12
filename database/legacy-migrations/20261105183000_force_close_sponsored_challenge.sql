-- DadoFit - Force-close sponsored challenges
-- Brand Owners/Admins may explicitly close an active challenge even when
-- evidence is awaiting primary review or a second audit. Approved rewards are
-- immutable; every non-terminal participation is expired and retained for
-- operational history.

create or replace function public.close_sponsored_challenge(p_challenge_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_challenge public.challenges%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;

  if not found then raise exception 'challenge not found'; end if;
  if v_challenge.challenge_type <> 'sponsored' then raise exception 'not a sponsored challenge'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then
    raise exception 'only Brand Owners or Admins can close this challenge';
  end if;
  if v_challenge.status <> 'active' then
    raise exception 'only active sponsored challenges can be closed';
  end if;

  insert into public.notifications(user_id, notification_type, title, body, data)
  select
    cp.user_id,
    'sponsored_challenge_closed',
    'Branded Challenge cerrado',
    'La Marca cerró el reto. Las evidencias pendientes no serán revisadas ni generarán recompensas.',
    jsonb_build_object(
      'organization_id', v_challenge.creator_organization_id,
      'campaign_id', v_challenge.sponsor_campaign_id,
      'challenge_id', v_challenge.id,
      'participant_id', cp.id
    )
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id
    and cp.status in ('invited', 'accepted', 'rejected', 'submitted', 'pending_audit');

  update public.challenge_participants
  set status = 'expired',
      audit_status = case when audit_status = 'pending' then 'not_required' else audit_status end,
      auditor_user_id = case when audit_status = 'pending' then null else auditor_user_id end,
      audited_at = case when audit_status = 'pending' then null else audited_at end,
      updated_at = now()
  where challenge_id = p_challenge_id
    and status in ('invited', 'accepted', 'rejected', 'submitted', 'pending_audit');

  update public.challenges
  set status = 'completed'
  where id = p_challenge_id;

  return 'completed';
end;
$$;

revoke all on function public.close_sponsored_challenge(uuid) from public;
grant execute on function public.close_sponsored_challenge(uuid) to authenticated;
