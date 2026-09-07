-- DadoFit ECO-1 - Sponsor Points separation and personal wallets
-- IMPORTANT: legacy score_events.sponsor_points / challenges.sponsor_points remain the
-- internal compatibility storage for Gym Points (GP). They MUST NOT be interpreted as SP.
-- Real Sponsor Points are brand-scoped and live in sponsor_point_wallets + sponsor_point_ledger.

alter table public.sponsor_campaigns
  add column if not exists default_reward_sp integer not null default 0 check (default_reward_sp >= 0);

alter table public.challenges
  add column if not exists sponsor_reward_points integer not null default 0 check (sponsor_reward_points >= 0);

alter table public.challenge_participants
  add column if not exists sponsor_reward_points_granted integer not null default 0 check (sponsor_reward_points_granted >= 0);

create table if not exists public.sponsor_point_wallets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  sponsor_organization_id uuid not null references public.organizations(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  lifetime_spent bigint not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, sponsor_organization_id)
);

create table if not exists public.sponsor_point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sponsor_organization_id uuid not null references public.organizations(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  entry_type text not null check (entry_type in ('grant','redeem','refund','adjustment')),
  source_type text not null,
  source_id uuid,
  description text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sponsor_point_ledger_user_brand_idx
  on public.sponsor_point_ledger(user_id, sponsor_organization_id, created_at desc);

alter table public.sponsor_point_wallets enable row level security;
alter table public.sponsor_point_ledger enable row level security;

revoke all on table public.sponsor_point_wallets from anon, authenticated;
revoke all on table public.sponsor_point_ledger from anon, authenticated;
grant select on table public.sponsor_point_wallets to authenticated;
grant select on table public.sponsor_point_ledger to authenticated;

drop policy if exists sponsor_point_wallets_read_own_eco1 on public.sponsor_point_wallets;
create policy sponsor_point_wallets_read_own_eco1
on public.sponsor_point_wallets for select
to authenticated
using (user_id = auth.uid());

drop policy if exists sponsor_point_ledger_read_own_eco1 on public.sponsor_point_ledger;
create policy sponsor_point_ledger_read_own_eco1
on public.sponsor_point_ledger for select
to authenticated
using (user_id = auth.uid());

-- Internal-only mint function. A client cannot call this directly.
create or replace function public.grant_sponsor_points(
  p_user_id uuid,
  p_sponsor_organization_id uuid,
  p_amount bigint,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text
)
returns table(new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Sponsor Points grant must be greater than zero'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'idempotency key is required'; end if;
  if not public.is_brand_organization(p_sponsor_organization_id) then raise exception 'Sponsor Points can only be issued by a Brand/Sponsor organization'; end if;
  if not exists (select 1 from public.profiles where id=p_user_id) then raise exception 'user not found'; end if;

  if exists (select 1 from public.sponsor_point_ledger where idempotency_key=p_idempotency_key) then
    select spw.balance into v_balance
    from public.sponsor_point_wallets spw
    where spw.user_id=p_user_id and spw.sponsor_organization_id=p_sponsor_organization_id;
    return query select coalesce(v_balance,0);
    return;
  end if;

  insert into public.sponsor_point_wallets(user_id,sponsor_organization_id,balance,lifetime_earned,lifetime_spent)
  values(p_user_id,p_sponsor_organization_id,p_amount,p_amount,0)
  on conflict (user_id,sponsor_organization_id) do update
  set balance=public.sponsor_point_wallets.balance + excluded.balance,
      lifetime_earned=public.sponsor_point_wallets.lifetime_earned + excluded.lifetime_earned,
      updated_at=now()
  returning balance into v_balance;

  insert into public.sponsor_point_ledger(
    user_id,sponsor_organization_id,amount,balance_after,entry_type,source_type,source_id,description,idempotency_key
  ) values(
    p_user_id,p_sponsor_organization_id,p_amount,v_balance,'grant',left(coalesce(p_source_type,'unknown'),80),p_source_id,
    nullif(left(btrim(coalesce(p_description,'')),300),''),p_idempotency_key
  );

  return query select v_balance;
end;
$$;

revoke all on function public.grant_sponsor_points(uuid,uuid,bigint,text,uuid,text,text) from public, anon, authenticated;

create or replace function public.get_my_sponsor_point_balances()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sponsor_organization_id',w.sponsor_organization_id,
      'sponsor_name',o.name,
      'logo_url',o.logo_url,
      'balance',w.balance,
      'lifetime_earned',w.lifetime_earned,
      'lifetime_spent',w.lifetime_spent
    ) order by w.balance desc,o.name)
    from public.sponsor_point_wallets w
    join public.organizations o on o.id=w.sponsor_organization_id
    where w.user_id=auth.uid()
      and (w.balance>0 or w.lifetime_earned>0 or w.lifetime_spent>0)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_my_sponsor_point_balances() from public, anon;
grant execute on function public.get_my_sponsor_point_balances() to authenticated;

-- Campaign creation now defines three independent reward channels:
-- universal DC, system XP, and brand-scoped SP.
drop function if exists public.create_sponsor_campaign(uuid,text,text,integer,integer,integer);
create or replace function public.create_sponsor_campaign(
  p_organization_id uuid,
  p_name text,
  p_description text default null,
  p_default_reward_coins integer default 25,
  p_default_reward_xp integer default 50,
  p_default_reward_sp integer default 50,
  p_max_participants integer default 500
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign_id uuid;
  v_verification text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_brand_manager(p_organization_id) then raise exception 'only Brand Owners or Admins can create campaigns'; end if;
  select verification_status into v_verification from public.organizations where id=p_organization_id;
  if v_verification in ('rejected','suspended') then raise exception 'Brand workspace is not eligible to create campaigns'; end if;
  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(p_name))>100 then raise exception 'campaign name must have between 3 and 100 characters'; end if;
  if p_default_reward_coins<0 or p_default_reward_coins>50 then raise exception 'sponsored DadoCoins reward must be between 0 and 50'; end if;
  if p_default_reward_xp<0 or p_default_reward_xp>100 then raise exception 'sponsored XP reward must be between 0 and 100'; end if;
  if p_default_reward_sp<0 or p_default_reward_sp>500 then raise exception 'Sponsor Points reward must be between 0 and 500'; end if;
  if p_max_participants<1 or p_max_participants>5000 then raise exception 'campaign max participants must be between 1 and 5000'; end if;

  insert into public.sponsor_campaigns(
    organization_id,created_by_user_id,name,description,status,default_reward_coins,default_reward_xp,default_reward_sp,max_participants,metadata
  ) values(
    p_organization_id,v_actor,left(btrim(p_name),100),nullif(left(btrim(coalesce(p_description,'')),700),''),'draft',
    p_default_reward_coins,p_default_reward_xp,p_default_reward_sp,p_max_participants,
    jsonb_build_object('audience','public','version','eco1','sp_scope','sponsor')
  ) returning id into v_campaign_id;
  return v_campaign_id;
end;
$$;

revoke all on function public.create_sponsor_campaign(uuid,text,text,integer,integer,integer,integer) from public;
grant execute on function public.create_sponsor_campaign(uuid,text,text,integer,integer,integer,integer) to authenticated;

-- Keep the established public signature. The challenge inherits the campaign SP reward.
create or replace function public.publish_sponsored_challenge(
  p_campaign_id uuid,
  p_exercise_name text,
  p_goal_type text,
  p_goal_value numeric,
  p_goal_unit text,
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
  v_legacy_reps integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_campaign from public.sponsor_campaigns where id=p_campaign_id;
  if not found then raise exception 'campaign not found'; end if;
  if not public.is_brand_manager(v_campaign.organization_id) then raise exception 'only Brand Owners or Admins can publish sponsored challenges'; end if;
  select * into v_organization from public.organizations where id=v_campaign.organization_id;
  if v_organization.verification_status<>'verified' then raise exception 'Brand must be verified before publishing sponsored challenges'; end if;
  if v_campaign.status<>'active' then raise exception 'campaign must be active before publishing a challenge'; end if;
  if length(btrim(coalesce(p_exercise_name,'')))<2 or length(btrim(p_exercise_name))>160 then raise exception 'exercise/activity name must have between 2 and 160 characters'; end if;
  if p_goal_type not in ('repetitions','time','distance','quantity') then raise exception 'invalid goal type'; end if;
  if p_goal_value is null or p_goal_value<=0 or p_goal_value>1000000 then raise exception 'invalid goal value'; end if;
  if (p_goal_type='repetitions' and p_goal_unit<>'reps')
     or (p_goal_type='time' and p_goal_unit not in ('minutes','hours'))
     or (p_goal_type='distance' and p_goal_unit not in ('km','m'))
     or (p_goal_type='quantity' and p_goal_unit not in ('steps','times','units')) then raise exception 'invalid goal unit'; end if;
  if p_duration_hours<1 or p_duration_hours>336 then raise exception 'duration must be between 1 and 336 hours'; end if;
  if p_max_participants<1 or p_max_participants>coalesce(v_campaign.max_participants,5000) then raise exception 'challenge capacity exceeds campaign capacity'; end if;
  if p_exercise_id is not null and length(btrim(p_exercise_id))>160 then raise exception 'exercise id is too long'; end if;

  v_exercise_id := coalesce(nullif(btrim(p_exercise_id),''),'sponsored-custom-'||replace(gen_random_uuid()::text,'-',''));
  v_legacy_reps := case when p_goal_type='repetitions' then greatest(1,least(1000,round(p_goal_value)::integer)) else 1 end;

  insert into public.challenges(
    creator_kind,creator_organization_id,challenge_type,status,title,description,exercise_id,exercise_name,reps,dice_level,
    starts_at,expires_at,evidence_required,reward_coins,reward_xp,team_points,sponsor_points,sponsor_reward_points,
    sponsor_campaign_id,max_participants,metadata
  ) values(
    'organization',v_campaign.organization_id,'sponsored','active',left(v_campaign.name,160),v_campaign.description,
    v_exercise_id,left(btrim(p_exercise_name),160),v_legacy_reps,'amateur',now(),now()+make_interval(hours=>p_duration_hours),true,
    least(v_campaign.default_reward_coins,50),least(v_campaign.default_reward_xp,100),0,0,least(v_campaign.default_reward_sp,500),
    v_campaign.id,p_max_participants,
    jsonb_build_object('reward_policy','v13-sponsored','economy_policy','eco1','audience','public','brand_organization_id',v_campaign.organization_id,
      'published_by_user_id',v_actor,'exercise_source',case when p_exercise_id is null or btrim(p_exercise_id)='' then 'custom' else 'catalog' end,
      'goal_type',p_goal_type,'goal_value',p_goal_value,'goal_unit',p_goal_unit)
  ) returning id into v_challenge_id;
  return v_challenge_id;
end;
$$;

revoke all on function public.publish_sponsored_challenge(uuid,text,text,numeric,text,integer,integer,text) from public;
grant execute on function public.publish_sponsored_challenge(uuid,text,text,numeric,text,integer,integer,text) to authenticated;

-- Reward finalizer: sponsored challenges grant SP to a sponsor-specific wallet.
create or replace function public.complete_sponsored_approval_v133(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.challenge_participants%rowtype;
  v_challenge public.challenges%rowtype;
  v_campaign_name text;
  v_sponsor_name text;
  v_daily_rewards integer := 0;
  v_daily_limit constant integer := 3;
  v_coins bigint := 0;
  v_reward_xp bigint := 0;
  v_reward_sp bigint := 0;
  v_balance bigint := 0;
  v_sp_balance bigint := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_reward_block_reason text := null;
begin
  select * into v_participant from public.challenge_participants where id=p_participant_id for update;
  if not found then raise exception 'participant not found'; end if;
  select * into v_challenge from public.challenges where id=v_participant.challenge_id;
  if not found or v_challenge.challenge_type<>'sponsored' or v_challenge.metadata->>'reward_policy'<>'v13-sponsored' then
    raise exception 'participant does not belong to a sponsored challenge';
  end if;

  if v_participant.rewarded_at is not null then
    return jsonb_build_object('status','approved','already_rewarded',true,'reward_blocked',false,
      'coins_granted',v_participant.reward_coins_granted,'xp_granted',v_participant.reward_xp_granted,
      'sp_granted',v_participant.sponsor_reward_points_granted);
  end if;

  select sc.name,o.name into v_campaign_name,v_sponsor_name
  from public.sponsor_campaigns sc join public.organizations o on o.id=sc.organization_id
  where sc.id=v_challenge.sponsor_campaign_id;

  perform pg_advisory_xact_lock(hashtextextended('dadofit:sponsored-reward:user:'||v_participant.user_id::text,0));

  select count(*)::integer into v_daily_rewards
  from public.challenge_participants cp
  join public.challenges c on c.id=cp.challenge_id
  where cp.user_id=v_participant.user_id and cp.id<>p_participant_id and cp.status='approved' and cp.rewarded_at is not null
    and (cp.reward_coins_granted>0 or cp.reward_xp_granted>0 or cp.sponsor_reward_points_granted>0)
    and c.challenge_type='sponsored' and c.metadata->>'reward_policy'='v13-sponsored'
    and cp.rewarded_at>now()-interval '24 hours';

  if v_daily_rewards>=v_daily_limit then v_reward_block_reason:='sponsored_daily_limit'; end if;

  if v_reward_block_reason is not null then
    update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
    update public.challenge_participants
    set status='approved',completed_at=now(),rewarded_at=null,reward_coins_granted=0,reward_xp_granted=0,
        sponsor_reward_points_granted=0,reward_block_reason=v_reward_block_reason,updated_at=now()
    where id=p_participant_id;
    insert into public.notifications(user_id,notification_type,title,body,data)
    values(v_participant.user_id,'sponsored_approved_no_reward','¡Branded Challenge aprobado!',
      'Reto completado. Alcanzaste el límite de 3 recompensas patrocinadas en una ventana de 24 horas.',
      jsonb_build_object('campaign_id',v_challenge.sponsor_campaign_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
        'reward_blocked',true,'reward_block_reason',v_reward_block_reason,'coins',0,'xp',0,'sp',0));
    return jsonb_build_object('status','approved','reward_blocked',true,'reward_block_reason',v_reward_block_reason,
      'coins_granted',0,'xp_granted',0,'sp_granted',0,'daily_reward_limit',v_daily_limit);
  end if;

  v_coins := least(v_challenge.reward_coins,50);
  v_reward_xp := least(v_challenge.reward_xp,100);
  v_reward_sp := least(v_challenge.sponsor_reward_points,500);

  if v_coins>0 then
    select new_balance into v_balance from public.grant_wallet_coins(v_participant.user_id,v_coins,'sponsored_challenge_reward',v_challenge.id,
      format('Branded Challenge completado: %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:coins',p_participant_id));
  else
    select coalesce(w.balance,0) into v_balance from public.wallets w where w.user_id=v_participant.user_id;
  end if;

  if v_reward_xp>0 then
    select new_xp,new_level into v_xp,v_level from public.grant_user_xp(v_participant.user_id,v_reward_xp,'sponsored_challenge_reward',v_challenge.id,
      format('Branded Challenge completado: %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:xp',p_participant_id));
  else
    select coalesce(up.xp,0),coalesce(up.level,1) into v_xp,v_level from public.user_progress up where up.user_id=v_participant.user_id;
  end if;

  if v_reward_sp>0 then
    select new_balance into v_sp_balance from public.grant_sponsor_points(v_participant.user_id,v_challenge.creator_organization_id,v_reward_sp,
      'sponsored_challenge_reward',v_challenge.id,
      format('Sponsor Points por %s',coalesce(v_campaign_name,v_challenge.exercise_name)),format('sponsored-challenge:%s:sp',p_participant_id));
  else
    select coalesce(w.balance,0) into v_sp_balance from public.sponsor_point_wallets w
    where w.user_id=v_participant.user_id and w.sponsor_organization_id=v_challenge.creator_organization_id;
  end if;

  update public.user_progress set challenges_completed=challenges_completed+1 where user_id=v_participant.user_id;
  update public.challenge_participants
  set status='approved',completed_at=now(),rewarded_at=now(),reward_coins_granted=v_coins,reward_xp_granted=v_reward_xp,
      sponsor_reward_points_granted=v_reward_sp,reward_block_reason=null,updated_at=now()
  where id=p_participant_id;

  insert into public.notifications(user_id,notification_type,title,body,data)
  values(v_participant.user_id,'sponsored_approved','¡Branded Challenge aprobado!',
    format('+%s DadoCoins · +%s XP · +%s SP %s',v_coins,v_reward_xp,v_reward_sp,coalesce(v_sponsor_name,'Sponsor')),
    jsonb_build_object('campaign_id',v_challenge.sponsor_campaign_id,'challenge_id',v_challenge.id,'participant_id',p_participant_id,
      'coins',v_coins,'xp',v_reward_xp,'sp',v_reward_sp,'sponsor_organization_id',v_challenge.creator_organization_id,
      'sponsor_name',v_sponsor_name,'balance',v_balance,'sp_balance',v_sp_balance,'level',v_level,'reward_blocked',false));

  return jsonb_build_object('status','approved','reward_blocked',false,'coins_granted',v_coins,'xp_granted',v_reward_xp,
    'sp_granted',v_reward_sp,'sponsor_name',v_sponsor_name,'balance',v_balance,'sp_balance',v_sp_balance,'xp',v_xp,'level',v_level,
    'daily_reward_limit',v_daily_limit);
end;
$$;

revoke all on function public.complete_sponsored_approval_v133(uuid) from public, anon, authenticated;

-- Dashboard summary exposes SP as scoped balances, not as one fungible wallet.
create or replace function public.get_dadofit_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_xp bigint := 0; v_level integer := 1; v_challenges_completed integer := 0; v_coins bigint := 0;
  v_squad_contribution_points bigint := 0; v_organization_contribution_points bigint := 0;
  v_direct_pending integer := 0; v_squad_pending integer := 0; v_organization_pending integer := 0; v_gym_battle_pending integer := 0;
  v_unread_notifications integer := 0; v_active_squads integer := 0; v_active_organizations integer := 0;
  v_sp_balances jsonb := '[]'::jsonb; v_sp_sponsor_count integer := 0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select coalesce(up.xp,0),coalesce(up.level,1),coalesce(up.challenges_completed,0) into v_xp,v_level,v_challenges_completed from public.user_progress up where up.user_id=v_actor;
  select coalesce(w.balance,0) into v_coins from public.wallets w where w.user_id=v_actor;
  select coalesce(sum(se.team_points),0) into v_squad_contribution_points from public.score_events se join public.challenge_participants cp on cp.id=se.participant_id where cp.user_id=v_actor;
  -- Legacy sponsor_points is GP compatibility storage.
  select coalesce(sum(se.sponsor_points),0) into v_organization_contribution_points from public.score_events se join public.challenge_participants cp on cp.id=se.participant_id where cp.user_id=v_actor;
  select count(*)::integer into v_direct_pending from public.challenge_participants cp join public.challenges c on c.id=cp.challenge_id where cp.user_id=v_actor and c.challenge_type='direct' and c.status='active' and cp.status in ('invited','accepted','submitted','rejected');
  select count(distinct gb.id)::integer into v_squad_pending from public.group_battles gb join public.group_members gm on gm.group_id in (gb.challenger_group_id,gb.challenged_group_id) where gm.user_id=v_actor and gm.status='active' and gb.status in ('pending','active');
  select count(*)::integer into v_organization_pending from public.challenge_participants cp join public.challenges c on c.id=cp.challenge_id where cp.user_id=v_actor and c.challenge_type='organization' and c.status='active' and c.metadata->>'reward_policy'='v12-organization-member' and cp.status in ('invited','accepted','submitted','rejected');
  select count(distinct ob.id)::integer into v_gym_battle_pending from public.organization_battles ob join public.organization_members om on om.organization_id in (ob.challenger_organization_id,ob.challenged_organization_id) where om.user_id=v_actor and om.status='active' and ob.status in ('pending','active');
  select count(*)::integer into v_unread_notifications from public.notifications n where n.user_id=v_actor and n.read_at is null;
  select count(*)::integer into v_active_squads from public.group_members gm where gm.user_id=v_actor and gm.status='active';
  select count(*)::integer into v_active_organizations from public.organization_members om where om.user_id=v_actor and om.status='active';

  select coalesce(jsonb_agg(jsonb_build_object('sponsor_organization_id',w.sponsor_organization_id,'sponsor_name',o.name,'balance',w.balance) order by w.balance desc,o.name),'[]'::jsonb),count(*)::integer
    into v_sp_balances,v_sp_sponsor_count
  from public.sponsor_point_wallets w join public.organizations o on o.id=w.sponsor_organization_id
  where w.user_id=v_actor and w.balance>0;

  return jsonb_build_object('xp',v_xp,'level',v_level,'coins',v_coins,'challenges_completed',v_challenges_completed,
    'squad_contribution_points',v_squad_contribution_points,'organization_contribution_points',v_organization_contribution_points,
    'sponsor_point_balances',v_sp_balances,'sponsor_point_sponsor_count',v_sp_sponsor_count,
    'direct_pending',v_direct_pending,'squad_pending',v_squad_pending,'organization_pending',v_organization_pending,'gym_battle_pending',v_gym_battle_pending,
    'unread_notifications',v_unread_notifications,'active_squads',v_active_squads,'active_organizations',v_active_organizations);
end;
$$;

revoke all on function public.get_dadofit_dashboard_summary() from public, anon;
grant execute on function public.get_dadofit_dashboard_summary() to authenticated;

create or replace function public.get_brand_dashboard_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid:=auth.uid(); v_members integer:=0; v_campaigns integer:=0; v_active_campaigns integer:=0;
  v_sponsored_challenges integer:=0; v_active_challenges integer:=0; v_participants integer:=0; v_pending_review integer:=0; v_approved integer:=0;
  v_coins bigint:=0; v_xp bigint:=0; v_sp bigint:=0;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.is_organization_member(p_organization_id) or not public.is_brand_organization(p_organization_id) then raise exception 'Brand workspace access required'; end if;
  select count(*)::integer into v_members from public.organization_members where organization_id=p_organization_id and status='active';
  select count(*)::integer,count(*) filter(where status='active')::integer into v_campaigns,v_active_campaigns from public.sponsor_campaigns where organization_id=p_organization_id;
  select count(*)::integer,count(*) filter(where status='active')::integer into v_sponsored_challenges,v_active_challenges from public.challenges where creator_organization_id=p_organization_id and challenge_type='sponsored';
  select count(cp.id)::integer,count(cp.id) filter(where cp.status='submitted')::integer,count(cp.id) filter(where cp.status='approved')::integer,
    coalesce(sum(cp.reward_coins_granted),0),coalesce(sum(cp.reward_xp_granted),0),coalesce(sum(cp.sponsor_reward_points_granted),0)
  into v_participants,v_pending_review,v_approved,v_coins,v_xp,v_sp
  from public.challenge_participants cp join public.challenges c on c.id=cp.challenge_id
  where c.creator_organization_id=p_organization_id and c.challenge_type='sponsored';
  return jsonb_build_object('members',v_members,'campaigns',v_campaigns,'active_campaigns',v_active_campaigns,'sponsored_challenges',v_sponsored_challenges,
    'active_challenges',v_active_challenges,'participants',v_participants,'pending_review',v_pending_review,'approved',v_approved,
    'coins_granted',v_coins,'xp_granted',v_xp,'sp_granted',v_sp);
end;
$$;

revoke all on function public.get_brand_dashboard_summary(uuid) from public, anon;
grant execute on function public.get_brand_dashboard_summary(uuid) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text language sql stable security definer set search_path=public
as $$ select 'v15.7.11-eco1-sponsor-points'::text $$;
revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon,authenticated;

notify pgrst,'reload schema';
