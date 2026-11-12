-- DadoFit V13.3.1 - UX / Notifications Hotfix
-- 1) Gymbro requests and responses now generate notifications.
-- 2) Organization role changes notify the affected member.
-- 3) Health metadata exposes the hotfix version.

create or replace function public.notify_friendship_events_v1331()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_name text;
  v_addressee_name text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(nullif(display_name, ''), username, 'Un Gymbro')
      into v_requester_name
    from public.profiles
    where id = new.requester_id;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.addressee_id,
      'friend_request_received',
      'Nueva solicitud de Gymbro',
      format('%s quiere ser tu Gymbro.', coalesce(v_requester_name, 'Un Gymbro')),
      jsonb_build_object(
        'friendship_id', new.id,
        'requester_id', new.requester_id,
        'addressee_id', new.addressee_id
      )
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'accepted' then
      select coalesce(nullif(display_name, ''), username, 'Tu Gymbro')
        into v_addressee_name
      from public.profiles
      where id = new.addressee_id;

      insert into public.notifications (user_id, notification_type, title, body, data)
      values (
        new.requester_id,
        'friend_request_accepted',
        'Solicitud de Gymbro aceptada',
        format('%s ahora es tu Gymbro.', coalesce(v_addressee_name, 'Tu Gymbro')),
        jsonb_build_object(
          'friendship_id', new.id,
          'requester_id', new.requester_id,
          'addressee_id', new.addressee_id
        )
      );
    elsif new.status = 'rejected' then
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (
        new.requester_id,
        'friend_request_rejected',
        'Solicitud de Gymbro no aceptada',
        'La solicitud de Gymbro fue rechazada.',
        jsonb_build_object(
          'friendship_id', new.id,
          'requester_id', new.requester_id,
          'addressee_id', new.addressee_id
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_friendship_events_v1331() from public, anon, authenticated;

drop trigger if exists friendships_notifications_v1331 on public.friendships;
create trigger friendships_notifications_v1331
after insert or update of status on public.friendships
for each row execute function public.notify_friendship_events_v1331();

create or replace function public.notify_organization_role_change_v1331()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_name text;
  v_role_label text;
begin
  if old.role is not distinct from new.role or new.status <> 'active' then
    return new;
  end if;

  select name into v_organization_name
  from public.organizations
  where id = new.organization_id;

  v_role_label := case new.role
    when 'owner' then 'Owner'
    when 'admin' then 'Admin'
    when 'coach' then 'Coach'
    else 'Miembro'
  end;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    new.user_id,
    'organization_role_changed',
    'Tu rol en la organización cambió',
    format('Ahora eres %s en %s.', v_role_label, coalesce(v_organization_name, 'la organización')),
    jsonb_build_object(
      'organization_id', new.organization_id,
      'role', new.role
    )
  );

  return new;
end;
$$;

revoke all on function public.notify_organization_role_change_v1331() from public, anon, authenticated;

drop trigger if exists organization_role_notifications_v1331 on public.organization_members;
create trigger organization_role_notifications_v1331
after update of role on public.organization_members
for each row execute function public.notify_organization_role_change_v1331();

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v13.3.1-ux-notifications-hotfix',
    'workspace_model', 'personal+organization',
    'sponsored_catalog_exercises', true,
    'sponsored_goal_types', jsonb_build_array('repetitions', 'time', 'distance', 'quantity'),
    'sponsored_review_history', true,
    'brand_double_validation', true,
    'brand_audit_trail', true,
    'gymbro_notifications', true,
    'organization_role_notifications', true,
    'organization_navigation', true,
    'brand_policy_lock_guidance', true,
    'sponsored_daily_limit', 3,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
