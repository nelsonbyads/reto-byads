-- DadoFit V15.7.9 - Sponsored Gym Competition editing
-- Upcoming: Brand Owner/Admin can edit name, description, dates and Gyms.
-- Active: only name/description can change; scoring window and competitors are locked.
-- Completed/cancelled competitions are immutable.

create or replace function public.brand_update_sponsored_gym_competition(
  p_organization_id uuid,
  p_season_id uuid,
  p_name text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_gym_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_brand public.organizations%rowtype;
  v_season public.seasons%rowtype;
  v_effective_status text;
  v_gym uuid;
  v_gym_name text;
  v_existing_status text;
  v_selected_count integer;
  v_current_count integer;
  v_manager record;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if not public.is_organization_admin(p_organization_id) then
    raise exception 'owner or admin required';
  end if;

  select * into v_brand
  from public.organizations
  where id = p_organization_id;

  if not found or v_brand.organization_type not in ('brand','sponsor','company') then
    raise exception 'Brand workspace required';
  end if;

  if v_brand.verification_status <> 'verified' then
    raise exception 'Brand must be verified';
  end if;

  select * into v_season
  from public.seasons s
  where s.id = p_season_id
    and s.season_type = 'sponsored_gym'
    and s.sponsor_organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'competition not found';
  end if;

  v_effective_status := case
    when v_season.status in ('completed','cancelled') then v_season.status
    when now() >= v_season.ends_at then 'completed'
    when now() >= v_season.starts_at then 'active'
    else 'upcoming'
  end;

  if v_effective_status in ('completed','cancelled') then
    raise exception 'completed or cancelled competitions cannot be edited';
  end if;

  if nullif(btrim(p_name),'') is null then
    raise exception 'competition name is required';
  end if;

  select count(distinct g.id)::integer
    into v_selected_count
  from unnest(coalesce(p_gym_ids, array[]::uuid[])) as g(id);

  if coalesce(v_selected_count,0) < 2 then
    raise exception 'select at least two Gyms';
  end if;

  if exists (
    select 1
    from unnest(p_gym_ids) g(id)
    left join public.organizations o on o.id = g.id
    where o.id is null
       or o.organization_type <> 'gym'
       or o.verification_status <> 'verified'
  ) then
    raise exception 'all competitors must be verified Gyms';
  end if;

  if v_effective_status = 'active' then
    -- Once GP scoring has started, dates and competitors are immutable.
    if p_starts_at is distinct from v_season.starts_at
       or p_ends_at is distinct from v_season.ends_at then
      raise exception 'active competition dates cannot be changed';
    end if;

    select count(*)::integer into v_current_count
    from public.season_organization_entries e
    where e.season_id = p_season_id
      and e.status <> 'removed';

    if v_current_count <> v_selected_count
       or exists (
         select 1
         from public.season_organization_entries e
         where e.season_id = p_season_id
           and e.status <> 'removed'
           and not (e.organization_id = any(p_gym_ids))
       ) then
      raise exception 'active competition Gyms cannot be changed';
    end if;

    update public.seasons
    set name = left(btrim(p_name),120),
        description = nullif(left(btrim(coalesce(p_description,'')),1000),''),
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'last_edited_by_user_id',v_actor,
          'last_edited_at',now()
        )
    where id = p_season_id;

    for v_gym in
      select e.organization_id
      from public.season_organization_entries e
      where e.season_id = p_season_id
        and e.status <> 'removed'
    loop
      for v_manager in
        select om.user_id
        from public.organization_members om
        where om.organization_id = v_gym
          and om.status = 'active'
          and om.role in ('owner','admin')
      loop
        insert into public.notifications(user_id,notification_type,title,body,data)
        values(
          v_manager.user_id,
          'sponsored_gym_competition_updated',
          'Competencia patrocinada actualizada',
          format('%s actualizó la información de “%s”.',v_brand.name,left(btrim(p_name),120)),
          jsonb_build_object('season_id',p_season_id,'organization_id',v_gym,'sponsor_organization_id',p_organization_id,'route','/seasons')
        );
      end loop;
    end loop;

    return true;
  end if;

  -- Upcoming competition: full correction is allowed.
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid competition dates';
  end if;

  if p_starts_at <= now() then
    raise exception 'competition start must remain in the future';
  end if;

  update public.seasons
  set name = left(btrim(p_name),120),
      description = nullif(left(btrim(coalesce(p_description,'')),1000),''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      status = 'upcoming',
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'last_edited_by_user_id',v_actor,
        'last_edited_at',now()
      )
  where id = p_season_id;

  -- Gyms removed from the selection are retained as audit history but stop participating.
  for v_gym in
    select e.organization_id
    from public.season_organization_entries e
    where e.season_id = p_season_id
      and e.status <> 'removed'
      and not (e.organization_id = any(p_gym_ids))
  loop
    update public.season_organization_entries
    set status = 'removed'
    where season_id = p_season_id
      and organization_id = v_gym;

    select name into v_gym_name from public.organizations where id = v_gym;
    for v_manager in
      select om.user_id
      from public.organization_members om
      where om.organization_id = v_gym
        and om.status = 'active'
        and om.role in ('owner','admin')
    loop
      insert into public.notifications(user_id,notification_type,title,body,data)
      values(
        v_manager.user_id,
        'sponsored_gym_competition_removed',
        'Invitación a competencia retirada',
        format('%s retiró a %s de “%s”.',v_brand.name,coalesce(v_gym_name,'tu Gym'),left(btrim(p_name),120)),
        jsonb_build_object('season_id',p_season_id,'organization_id',v_gym,'sponsor_organization_id',p_organization_id,'route','/seasons')
      );
    end loop;
  end loop;

  -- New Gyms receive a fresh invitation. Existing responses remain unchanged.
  for v_gym in select distinct unnest(p_gym_ids)
  loop
    select e.status into v_existing_status
    from public.season_organization_entries e
    where e.season_id = p_season_id
      and e.organization_id = v_gym;

    if not found then
      insert into public.season_organization_entries(season_id,organization_id,status,invited_by_organization_id)
      values(p_season_id,v_gym,'invited',p_organization_id);
      v_existing_status := null;
    elsif v_existing_status = 'removed' then
      update public.season_organization_entries
      set status = 'invited',
          invited_by_organization_id = p_organization_id,
          responded_by_user_id = null,
          responded_at = null,
          invited_at = now()
      where season_id = p_season_id
        and organization_id = v_gym;
      v_existing_status := null;
    end if;

    for v_manager in
      select om.user_id
      from public.organization_members om
      where om.organization_id = v_gym
        and om.status = 'active'
        and om.role in ('owner','admin')
    loop
      if v_existing_status is null then
        insert into public.notifications(user_id,notification_type,title,body,data)
        values(
          v_manager.user_id,
          'sponsored_gym_competition_invited',
          'Invitación a competencia patrocinada',
          format('%s te invita a “%s”. Compite con GP del %s al %s.',v_brand.name,left(btrim(p_name),120),to_char(p_starts_at,'DD/MM/YYYY'),to_char(p_ends_at,'DD/MM/YYYY')),
          jsonb_build_object('season_id',p_season_id,'organization_id',v_gym,'sponsor_organization_id',p_organization_id,'route','/seasons')
        );
      else
        insert into public.notifications(user_id,notification_type,title,body,data)
        values(
          v_manager.user_id,
          'sponsored_gym_competition_updated',
          'Competencia patrocinada actualizada',
          format('%s actualizó “%s”. Nueva ventana: %s al %s.',v_brand.name,left(btrim(p_name),120),to_char(p_starts_at,'DD/MM/YYYY'),to_char(p_ends_at,'DD/MM/YYYY')),
          jsonb_build_object('season_id',p_season_id,'organization_id',v_gym,'sponsor_organization_id',p_organization_id,'route','/seasons')
        );
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

revoke all on function public.brand_update_sponsored_gym_competition(uuid,uuid,text,text,timestamptz,timestamptz,uuid[]) from public;
grant execute on function public.brand_update_sponsored_gym_competition(uuid,uuid,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
as $$
  select 'v15.7.9-sponsored-gym-competition-editing';
$$;

grant execute on function public.get_dadofit_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';
