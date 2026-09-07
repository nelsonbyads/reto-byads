-- DadoFit V15.7.12 - Brand campaign + Branded Challenge editing
-- Business rules:
-- 1) Draft/active/paused campaigns may be corrected by Brand Owner/Admin.
-- 2) Campaign reward edits affect future challenges only. Published challenges keep their reward snapshot.
-- 3) An active Branded Challenge with zero participants is fully editable (activity, goal, expiry, capacity).
-- 4) Once any participant joins, activity/goal/rewards are frozen. Capacity may not drop below joined users
--    and the deadline may only stay equal or be extended.
-- 5) Closed/completed/cancelled/expired challenges are immutable.

create or replace function public.update_sponsor_campaign(
  p_campaign_id uuid,
  p_name text,
  p_description text default null,
  p_default_reward_coins integer default 25,
  p_default_reward_xp integer default 50,
  p_default_reward_sp integer default 50,
  p_max_participants integer default 500
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.sponsor_campaigns%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_campaign
  from public.sponsor_campaigns
  where id=p_campaign_id
  for update;

  if not found then raise exception 'campaign not found'; end if;
  if not public.is_brand_manager(v_campaign.organization_id) then raise exception 'only Brand Owners or Admins can edit campaigns'; end if;
  if v_campaign.status not in ('draft','active','paused') then raise exception 'a completed or cancelled campaign cannot be edited'; end if;

  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(p_name))>100 then raise exception 'campaign name must have between 3 and 100 characters'; end if;
  if p_default_reward_coins<0 or p_default_reward_coins>50 then raise exception 'sponsored DadoCoins reward must be between 0 and 50'; end if;
  if p_default_reward_xp<0 or p_default_reward_xp>100 then raise exception 'sponsored XP reward must be between 0 and 100'; end if;
  if p_default_reward_sp<0 or p_default_reward_sp>500 then raise exception 'Sponsor Points reward must be between 0 and 500'; end if;
  if p_max_participants<1 or p_max_participants>5000 then raise exception 'campaign max participants must be between 1 and 5000'; end if;

  update public.sponsor_campaigns
  set name=left(btrim(p_name),100),
      description=nullif(left(btrim(coalesce(p_description,'')),700),''),
      default_reward_coins=p_default_reward_coins,
      default_reward_xp=p_default_reward_xp,
      default_reward_sp=p_default_reward_sp,
      max_participants=p_max_participants,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'last_edited_by_user_id',auth.uid(),
        'last_edited_at',now(),
        'reward_edit_policy','future_challenges_only'
      ),
      updated_at=now()
  where id=p_campaign_id;

  return true;
end;
$$;

revoke all on function public.update_sponsor_campaign(uuid,text,text,integer,integer,integer,integer) from public, anon;
grant execute on function public.update_sponsor_campaign(uuid,text,text,integer,integer,integer,integer) to authenticated;

create or replace function public.update_sponsored_challenge(
  p_challenge_id uuid,
  p_exercise_name text,
  p_goal_type text,
  p_goal_value numeric,
  p_goal_unit text,
  p_expires_at timestamptz,
  p_max_participants integer,
  p_exercise_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges%rowtype;
  v_participant_count integer := 0;
  v_current_goal_type text;
  v_current_goal_value numeric;
  v_current_goal_unit text;
  v_new_exercise_id text;
  v_legacy_reps integer;
  v_mode text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_challenge
  from public.challenges
  where id=p_challenge_id
  for update;

  if not found or v_challenge.challenge_type<>'sponsored' then raise exception 'Branded Challenge not found'; end if;
  if not public.is_brand_manager(v_challenge.creator_organization_id) then raise exception 'only Brand Owners or Admins can edit sponsored challenges'; end if;
  if v_challenge.status<>'active' or coalesce(v_challenge.expires_at,now())<=now() then raise exception 'only an active Branded Challenge can be edited'; end if;

  select count(*)::integer into v_participant_count
  from public.challenge_participants
  where challenge_id=p_challenge_id;

  if p_expires_at is null or p_expires_at<=now() then raise exception 'challenge end date must be in the future'; end if;
  if p_max_participants<1 or p_max_participants>5000 then raise exception 'challenge capacity must be between 1 and 5000'; end if;
  if p_max_participants<v_participant_count then raise exception 'challenge capacity cannot be lower than the number of joined participants'; end if;

  v_current_goal_type := coalesce(v_challenge.metadata->>'goal_type','repetitions');
  v_current_goal_value := coalesce(nullif(v_challenge.metadata->>'goal_value','')::numeric,v_challenge.reps::numeric);
  v_current_goal_unit := coalesce(v_challenge.metadata->>'goal_unit','reps');

  if v_participant_count>0 then
    v_mode := 'limited';
    if btrim(coalesce(p_exercise_name,''))<>v_challenge.exercise_name
       or p_goal_type<>v_current_goal_type
       or p_goal_value<>v_current_goal_value
       or p_goal_unit<>v_current_goal_unit then
      raise exception 'activity and goal are frozen after the first participant joins';
    end if;
    if v_challenge.expires_at is not null and p_expires_at<v_challenge.expires_at then
      raise exception 'the deadline cannot be shortened after participants have joined';
    end if;
  else
    v_mode := 'full';
    if length(btrim(coalesce(p_exercise_name,'')))<2 or length(btrim(p_exercise_name))>160 then raise exception 'exercise/activity name must have between 2 and 160 characters'; end if;
    if p_goal_type not in ('repetitions','time','distance','quantity') then raise exception 'invalid goal type'; end if;
    if p_goal_value is null or p_goal_value<=0 or p_goal_value>1000000 then raise exception 'invalid goal value'; end if;
    if (p_goal_type='repetitions' and p_goal_unit<>'reps')
       or (p_goal_type='time' and p_goal_unit not in ('minutes','hours'))
       or (p_goal_type='distance' and p_goal_unit not in ('km','m'))
       or (p_goal_type='quantity' and p_goal_unit not in ('steps','times','units')) then raise exception 'invalid goal unit'; end if;
    if p_exercise_id is not null and length(btrim(p_exercise_id))>160 then raise exception 'exercise id is too long'; end if;
  end if;

  v_new_exercise_id := case
    when v_participant_count>0 then v_challenge.exercise_id
    when nullif(btrim(coalesce(p_exercise_id,'')),'') is not null then btrim(p_exercise_id)
    else v_challenge.exercise_id
  end;
  v_legacy_reps := case when p_goal_type='repetitions' then greatest(1,least(1000,round(p_goal_value)::integer)) else 1 end;

  update public.challenges
  set exercise_id=v_new_exercise_id,
      exercise_name=case when v_participant_count>0 then exercise_name else left(btrim(p_exercise_name),160) end,
      reps=case when v_participant_count>0 then reps else v_legacy_reps end,
      expires_at=p_expires_at,
      max_participants=p_max_participants,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'goal_type',case when v_participant_count>0 then v_current_goal_type else p_goal_type end,
        'goal_value',case when v_participant_count>0 then v_current_goal_value else p_goal_value end,
        'goal_unit',case when v_participant_count>0 then v_current_goal_unit else p_goal_unit end,
        'last_edited_by_user_id',auth.uid(),
        'last_edited_at',now(),
        'edit_mode',v_mode,
        'reward_snapshot_locked',true
      ),
      updated_at=now()
  where id=p_challenge_id;

  return jsonb_build_object(
    'challenge_id',p_challenge_id,
    'edit_mode',v_mode,
    'participant_count',v_participant_count,
    'reward_coins',v_challenge.reward_coins,
    'reward_xp',v_challenge.reward_xp,
    'sponsor_reward_points',v_challenge.sponsor_reward_points
  );
end;
$$;

revoke all on function public.update_sponsored_challenge(uuid,text,text,numeric,text,timestamptz,integer,text) from public, anon;
grant execute on function public.update_sponsored_challenge(uuid,text,text,numeric,text,timestamptz,integer,text) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable security definer set search_path=public
as $$ select 'v15.7.12-brand-campaign-challenge-editing'::text $$;
revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon,authenticated;

notify pgrst,'reload schema';
