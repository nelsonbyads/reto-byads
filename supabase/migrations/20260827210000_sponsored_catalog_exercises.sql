-- DadoFit V13.1 - Sponsored Challenge Exercise Catalog
-- Sponsored challenges can now retain the canonical DadoFit exercise id.

-- Replace the V13 function with an extended compatible signature.
drop function if exists public.publish_sponsored_challenge(uuid, text, integer, integer, integer);

create or replace function public.publish_sponsored_challenge(
  p_campaign_id uuid,
  p_exercise_name text,
  p_reps integer,
  p_duration_hours integer default 72,
  p_max_participants integer default 100,
  p_exercise_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign public.sponsor_campaigns%rowtype;
  v_organization public.organizations%rowtype;
  v_challenge_id uuid;
  v_exercise_id text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_campaign
  from public.sponsor_campaigns
  where id = p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;

  if not public.is_brand_manager(v_campaign.organization_id) then
    raise exception 'only Brand Owners or Admins can publish sponsored challenges';
  end if;

  select * into v_organization
  from public.organizations
  where id = v_campaign.organization_id;

  if v_organization.verification_status <> 'verified' then
    raise exception 'Brand must be verified before publishing sponsored challenges';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'campaign must be active before publishing a challenge';
  end if;
  if length(btrim(coalesce(p_exercise_name, ''))) < 2 or length(btrim(p_exercise_name)) > 160 then
    raise exception 'exercise/activity name must have between 2 and 160 characters';
  end if;
  if p_reps < 1 or p_reps > 1000 then raise exception 'invalid repetitions'; end if;
  if p_duration_hours < 1 or p_duration_hours > 336 then raise exception 'duration must be between 1 and 336 hours'; end if;
  if p_max_participants < 1 or p_max_participants > coalesce(v_campaign.max_participants, 5000) then
    raise exception 'challenge capacity exceeds campaign capacity';
  end if;
  if p_exercise_id is not null and length(btrim(p_exercise_id)) > 160 then
    raise exception 'exercise id is too long';
  end if;

  v_exercise_id := coalesce(nullif(btrim(p_exercise_id), ''), 'sponsored-custom-' || replace(gen_random_uuid()::text, '-', ''));

  insert into public.challenges (
    creator_kind,
    creator_organization_id,
    challenge_type,
    status,
    title,
    description,
    exercise_id,
    exercise_name,
    reps,
    dice_level,
    starts_at,
    expires_at,
    evidence_required,
    reward_coins,
    reward_xp,
    team_points,
    sponsor_points,
    sponsor_campaign_id,
    max_participants,
    metadata
  ) values (
    'organization',
    v_campaign.organization_id,
    'sponsored',
    'active',
    left(v_campaign.name, 160),
    v_campaign.description,
    v_exercise_id,
    left(btrim(p_exercise_name), 160),
    p_reps,
    'amateur',
    now(),
    now() + make_interval(hours => p_duration_hours),
    true,
    least(v_campaign.default_reward_coins, 50),
    least(v_campaign.default_reward_xp, 100),
    0,
    0,
    v_campaign.id,
    p_max_participants,
    jsonb_build_object(
      'reward_policy', 'v13-sponsored',
      'audience', 'public',
      'brand_organization_id', v_campaign.organization_id,
      'published_by_user_id', v_actor,
      'exercise_source', case when p_exercise_id is null or btrim(p_exercise_id) = '' then 'custom' else 'catalog' end
    )
  ) returning id into v_challenge_id;

  return v_challenge_id;
end;
$$;

revoke all on function public.publish_sponsored_challenge(uuid, text, integer, integer, integer, text) from public;
grant execute on function public.publish_sponsored_challenge(uuid, text, integer, integer, integer, text) to authenticated;

create or replace function public.dadofit_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', 'v13.1-sponsored-exercise-catalog',
    'workspace_model', 'personal+organization',
    'sponsored_catalog_exercises', true,
    'sponsored_daily_limit', 3,
    'server_time', now()
  );
$$;

revoke all on function public.dadofit_health() from public;
grant execute on function public.dadofit_health() to anon, authenticated;
