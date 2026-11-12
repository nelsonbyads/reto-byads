-- DadoFit V15.3 - Gym Challenge Economy & Monetization
-- 1) Gym challenge rewards become configurable (DC / XP / GP alias over sponsor_points).
-- 2) Reward review supports zero-valued reward dimensions safely.
-- 3) Existing anti-farming remains unchanged: same Gym->member max 1 rewarded challenge / 24h,
--    plus max 5 rewarded organization challenges / user / 24h.
-- 4) Backfills missing notifications for already-active Gym reward offers.

-- Replace the original fixed-reward function with a backward-compatible signature.
drop function if exists public.create_organization_challenge(uuid,text,text,integer,text);

create function public.create_organization_challenge(
  p_organization_id uuid,
  p_exercise_id text,
  p_exercise_name text,
  p_reps integer,
  p_dice_level text,
  p_reward_coins integer default 25,
  p_reward_xp integer default 50,
  p_gym_points integer default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_challenge_id uuid;
  v_org_name text;
  v_participant_count integer;
  v_participant record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  if not public.is_organization_manager(p_organization_id) then
    raise exception 'only owners, admins or coaches can publish organization challenges';
  end if;

  if p_reps is null or p_reps < 1 or p_reps > 1000 then raise exception 'invalid repetitions'; end if;
  if p_dice_level not in ('amateur','beginner','intermediate','advanced') then raise exception 'invalid dice level'; end if;
  if nullif(btrim(p_exercise_id),'') is null or nullif(btrim(p_exercise_name),'') is null then raise exception 'exercise is required'; end if;

  if p_reward_coins is null or p_reward_coins < 0 or p_reward_coins > 25 then
    raise exception 'Gym challenge DadoCoins must be between 0 and 25';
  end if;
  if p_reward_xp is null or p_reward_xp < 0 or p_reward_xp > 50 then
    raise exception 'Gym challenge XP must be between 0 and 50';
  end if;
  if p_gym_points is null or p_gym_points < 0 or p_gym_points > 100 then
    raise exception 'Gym challenge GP must be between 0 and 100';
  end if;

  select name into v_org_name from public.organizations where id=p_organization_id;
  if not found then raise exception 'organization not found'; end if;

  select count(*)::integer into v_participant_count
  from public.organization_members om
  where om.organization_id=p_organization_id
    and om.status='active'
    and om.user_id<>v_actor;

  if v_participant_count=0 then raise exception 'organization needs at least one other active member'; end if;

  insert into public.challenges(
    creator_kind,creator_organization_id,challenge_type,status,title,description,
    exercise_id,exercise_name,reps,dice_level,starts_at,expires_at,evidence_required,
    reward_coins,reward_xp,team_points,sponsor_points,max_participants,metadata
  ) values(
    'organization',p_organization_id,'organization','active',left(btrim(p_exercise_name),160),
    format('Reto para miembros de %s',coalesce(v_org_name,'DadoFit Organization')),
    left(btrim(p_exercise_id),160),left(btrim(p_exercise_name),160),p_reps,p_dice_level,
    now(),now()+interval '72 hours',true,
    p_reward_coins,p_reward_xp,0,p_gym_points,v_participant_count,
    jsonb_build_object(
      'reward_policy','v12-organization-member',
      'reward_configuration','v15.3-configurable',
      'gym_points_alias','GP',
      'source','dice-roll',
      'published_by_user_id',v_actor
    )
  ) returning id into v_challenge_id;

  insert into public.challenge_participants(challenge_id,user_id,status)
  select v_challenge_id,om.user_id,'invited'
  from public.organization_members om
  where om.organization_id=p_organization_id
    and om.status='active'
    and om.user_id<>v_actor;

  for v_participant in
    select cp.id,cp.user_id from public.challenge_participants cp where cp.challenge_id=v_challenge_id
  loop
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(
      v_participant.user_id,
      'organization_challenge_invited',
      'Nuevo reto de tu Gym',
      format('%s: %s repeticiones de %s · Potencial %s DC / %s XP / %s GP',
        coalesce(v_org_name,'Tu Gym'),p_reps,left(btrim(p_exercise_name),160),p_reward_coins,p_reward_xp,p_gym_points),
      jsonb_build_object(
        'organization_id',p_organization_id,
        'challenge_id',v_challenge_id,
        'participant_id',v_participant.id,
        'reward_coins',p_reward_coins,
        'reward_xp',p_reward_xp,
        'gym_points',p_gym_points
      )
    );
  end loop;

  return v_challenge_id;
end;
$$;

revoke all on function public.create_organization_challenge(uuid,text,text,integer,text,integer,integer,integer) from public;
grant execute on function public.create_organization_challenge(uuid,text,text,integer,text,integer,integer,integer) to authenticated;

-- Rebuild review so each configured reward dimension may legally be zero.
create or replace function public.review_organization_challenge(
  p_participant_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_balance bigint := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_coins bigint := 0;
  v_reward_xp bigint := 0;
  v_gym_points integer := 0;
  v_has_reward boolean := false;
  v_reward_block_reason text := null;
  v_last_pair_reward timestamptz;
  v_user_rewards_last_24h integer := 0;
  v_pair_cooldown_hours constant integer := 24;
  v_daily_reward_limit constant integer := 5;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;

  select * into v_participant from public.challenge_participants where id=p_participant_id for update;
  if not found then raise exception 'organization challenge participant not found'; end if;

  select * into v_challenge from public.challenges where id=v_participant.challenge_id;
  if v_challenge.challenge_type<>'organization' or v_challenge.metadata->>'reward_policy'<>'v12-organization-member' then
    raise exception 'not a V12 organization challenge';
  end if;

  if not public.is_organization_manager(v_challenge.creator_organization_id) then
    raise exception 'only organization owners, admins or coaches can review evidence';
  end if;
  if v_participant.user_id=v_actor then raise exception 'you cannot review your own evidence'; end if;

  if v_participant.status='approved' then
    return jsonb_build_object(
      'status','approved','already_rewarded',v_participant.rewarded_at is not null,
      'reward_blocked',v_participant.reward_block_reason is not null,
      'reward_block_reason',v_participant.reward_block_reason,
      'coins_granted',v_participant.reward_coins_granted,
      'xp_granted',v_participant.reward_xp_granted,
      'sponsor_points',v_participant.sponsor_points_granted,
      'gym_points',v_participant.sponsor_points_granted,
      'rewarded_at',v_participant.rewarded_at
    );
  end if;

  if v_participant.status<>'submitted' then raise exception 'evidence can only be reviewed after submission'; end if;

  insert into public.challenge_reviews(participant_id,reviewer_user_id,decision,notes)
  values(p_participant_id,v_actor,p_decision,nullif(btrim(p_notes),''));

  if p_decision='rejected' then
    update public.challenge_participants set status='rejected' where id=p_participant_id;
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'organization_challenge_evidence_rejected','Tu evidencia necesita otro intento',
      coalesce(nullif(btrim(p_notes),''),'Sube una nueva evidencia y vuelve a enviarla.'),
      jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id));
    return jsonb_build_object('status','rejected','reward_blocked',false,'coins_granted',0,'xp_granted',0,'sponsor_points',0,'gym_points',0);
  end if;

  v_coins := least(greatest(v_challenge.reward_coins,0),25);
  v_reward_xp := least(greatest(v_challenge.reward_xp,0),50);
  v_gym_points := least(greatest(v_challenge.sponsor_points,0),100);
  v_has_reward := (v_coins>0 or v_reward_xp>0 or v_gym_points>0);

  if v_has_reward then
    perform pg_advisory_xact_lock(hashtextextended('dadofit:organization-reward:user:'||v_participant.user_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('dadofit:organization-reward:pair:'||v_challenge.creator_organization_id::text||':'||v_participant.user_id::text,0));

    select max(cp.rewarded_at) into v_last_pair_reward
    from public.challenge_participants cp
    join public.challenges c on c.id=cp.challenge_id
    where cp.user_id=v_participant.user_id
      and cp.id<>p_participant_id
      and cp.status='approved'
      and cp.rewarded_at is not null
      and cp.rewarded_at>now()-interval '24 hours'
      and c.challenge_type='organization'
      and c.creator_organization_id=v_challenge.creator_organization_id
      and c.metadata->>'reward_policy'='v12-organization-member'
      and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_points_granted>0);

    if v_last_pair_reward is not null then v_reward_block_reason:='organization_pair_cooldown'; end if;

    if v_reward_block_reason is null then
      select count(*)::integer into v_user_rewards_last_24h
      from public.challenge_participants cp
      join public.challenges c on c.id=cp.challenge_id
      where cp.user_id=v_participant.user_id
        and cp.id<>p_participant_id
        and cp.status='approved'
        and cp.rewarded_at is not null
        and cp.rewarded_at>now()-interval '24 hours'
        and c.challenge_type='organization'
        and c.metadata->>'reward_policy'='v12-organization-member'
        and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_points_granted>0);
      if v_user_rewards_last_24h>=v_daily_reward_limit then v_reward_block_reason:='organization_daily_limit'; end if;
    end if;
  end if;

  if v_reward_block_reason is not null then
    update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
    update public.challenge_participants
    set status='approved',completed_at=now(),rewarded_at=null,reward_coins_granted=0,reward_xp_granted=0,sponsor_points_granted=0,reward_block_reason=v_reward_block_reason
    where id=p_participant_id;

    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'organization_challenge_approved_no_reward','¡Reto de Gym aprobado!',
      case v_reward_block_reason
        when 'organization_pair_cooldown' then 'Reto completado. Este Gym ya te otorgó una recompensa durante las últimas 24 horas.'
        when 'organization_daily_limit' then 'Reto completado. Alcanzaste el límite de 5 recompensas de organizaciones en 24 horas.'
        else 'Reto completado sin recompensa adicional por política anti-farming.' end,
      jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,'reward_blocked',true,'reward_block_reason',v_reward_block_reason));

    perform public.maybe_complete_organization_challenge(v_challenge.id);
    return jsonb_build_object('status','approved','reward_blocked',true,'reward_block_reason',v_reward_block_reason,
      'coins_granted',0,'xp_granted',0,'sponsor_points',0,'gym_points',0,
      'pair_cooldown_hours',v_pair_cooldown_hours,'daily_reward_limit',v_daily_reward_limit);
  end if;

  -- Read current values first so zero-valued dimensions remain safe.
  select coalesce((select w.balance from public.wallets w where w.user_id=v_participant.user_id),0) into v_balance;
  select
    coalesce((select up.xp from public.user_progress up where up.user_id=v_participant.user_id),0),
    coalesce((select up.level from public.user_progress up where up.user_id=v_participant.user_id),1)
  into v_xp,v_level;

  if v_coins>0 then
    select new_balance into v_balance
    from public.grant_wallet_coins(v_participant.user_id,v_coins,'organization_challenge_reward',v_challenge.id,
      format('Reto de Gym completado: %s',v_challenge.exercise_name),format('organization-challenge:%s:coins',p_participant_id));
  end if;

  if v_reward_xp>0 then
    select new_xp,new_level into v_xp,v_level
    from public.grant_user_xp(v_participant.user_id,v_reward_xp,'organization_challenge_reward',v_challenge.id,
      format('Reto de Gym completado: %s',v_challenge.exercise_name),format('organization-challenge:%s:xp',p_participant_id));
  end if;

  update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;

  update public.challenge_participants
  set status='approved',completed_at=now(),rewarded_at=case when v_has_reward then now() else null end,
      reward_coins_granted=v_coins,reward_xp_granted=v_reward_xp,sponsor_points_granted=v_gym_points,reward_block_reason=null
  where id=p_participant_id;

  if v_gym_points>0 then
    insert into public.score_events(season_id,challenge_id,participant_id,group_id,organization_id,team_points,sponsor_points)
    values(v_challenge.season_id,v_challenge.id,p_participant_id,null,v_challenge.creator_organization_id,0,v_gym_points)
    on conflict(participant_id) do nothing;
  end if;

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_participant.user_id,'organization_challenge_approved','¡Reto de Gym aprobado!',
    format('Recompensa aplicada: +%s DC · +%s XP · +%s GP',v_coins,v_reward_xp,v_gym_points),
    jsonb_build_object('organization_id',v_challenge.creator_organization_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
      'coins',v_coins,'xp',v_reward_xp,'sponsor_points',v_gym_points,'gym_points',v_gym_points,'balance',v_balance,'level',v_level,'reward_blocked',false));

  perform public.maybe_complete_organization_challenge(v_challenge.id);

  return jsonb_build_object('status','approved','reward_blocked',false,'reward_block_reason',null,
    'coins_granted',v_coins,'xp_granted',v_reward_xp,'sponsor_points',v_gym_points,'gym_points',v_gym_points,
    'new_balance',v_balance,'new_xp',v_xp,'new_level',v_level,
    'pair_cooldown_hours',v_pair_cooldown_hours,'daily_reward_limit',v_daily_reward_limit);
end;
$$;

revoke all on function public.review_organization_challenge(uuid,text,text) from public;
grant execute on function public.review_organization_challenge(uuid,text,text) to authenticated;

-- Backfill missing notifications for active Gym rewards that were published before V15.2.2.
insert into public.notifications(user_id,notification_type,title,body,data)
select
  om.user_id,
  'gym_reward_published',
  'Nuevo premio en '||o.name,
  format('%s · %s DC',r.title,r.coin_cost),
  jsonb_build_object('organization_id',o.id,'reward_id',r.id,'route','/rewards','coin_cost',r.coin_cost)
from public.rewards r
join public.organizations o on o.id=r.organization_id
join public.organization_members om on om.organization_id=o.id and om.status='active'
where r.status='active'
  and o.organization_type='gym'
  and o.verification_status='verified'
  and (r.created_by_user_id is null or om.user_id<>r.created_by_user_id)
  and not exists(
    select 1 from public.notifications n
    where n.user_id=om.user_id
      and n.notification_type='gym_reward_published'
      and n.data->>'reward_id'=r.id::text
  );

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.3-gym-challenge-economy-monetization'::text; $$;
