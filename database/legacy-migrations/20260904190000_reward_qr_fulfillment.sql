-- DadoFit V15.2 - QR / presencial reward fulfillment
-- Adds verifiable redemption tokens, provider validation flows and fulfillment audit.

alter table public.reward_redemptions
  add column if not exists validation_token uuid not null default gen_random_uuid(),
  add column if not exists fulfilled_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfillment_notes text;

create unique index if not exists reward_redemptions_validation_token_uidx
  on public.reward_redemptions(validation_token);

create index if not exists reward_redemptions_status_created_idx
  on public.reward_redemptions(status, created_at desc);

create table if not exists public.reward_redemption_events (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.reward_redemptions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reward_redemption_events_redemption_idx
  on public.reward_redemption_events(redemption_id, created_at desc);
create index if not exists reward_redemption_events_org_idx
  on public.reward_redemption_events(organization_id, created_at desc);

alter table public.reward_redemption_events enable row level security;
revoke all privileges on table public.reward_redemption_events from anon, authenticated;
grant select on table public.reward_redemption_events to authenticated;

drop policy if exists reward_redemption_events_read_related_v152 on public.reward_redemption_events;
create policy reward_redemption_events_read_related_v152
on public.reward_redemption_events for select
to authenticated
using (
  exists (
    select 1
    from public.reward_redemptions rr
    where rr.id = reward_redemption_events.redemption_id
      and (
        rr.user_id = auth.uid()
        or public.can_manage_rewards_for_org(reward_redemption_events.organization_id, auth.uid())
      )
  )
);

create or replace function public.log_reward_redemption_issue_v152()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org
  from public.rewards r
  where r.id = new.reward_id;

  if v_org is not null then
    insert into public.reward_redemption_events(
      redemption_id, organization_id, actor_user_id, action, metadata
    ) values (
      new.id,
      v_org,
      new.user_id,
      'reward_redemption.issued',
      jsonb_build_object(
        'reward_id', new.reward_id,
        'coin_cost', new.coin_cost,
        'reference', new.redemption_reference
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_reward_redemption_issue_v152() from public, anon, authenticated;

drop trigger if exists reward_redemption_issue_event_v152 on public.reward_redemptions;
create trigger reward_redemption_issue_event_v152
after insert on public.reward_redemptions
for each row execute function public.log_reward_redemption_issue_v152();

-- User history now exposes only the user's own verification token through this RPC.
create or replace function public.get_my_reward_redemptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rr.id,
    'reward_id', rr.reward_id,
    'title', coalesce(rr.reward_title_snapshot, r.title),
    'provider_name', coalesce(rr.provider_name_snapshot, o.name),
    'image_url', coalesce(rr.reward_image_snapshot, r.image_url),
    'coin_cost', rr.coin_cost,
    'status', rr.status,
    'redemption_reference', coalesce(rr.redemption_reference, case when rr.redemption_code like 'DF-%' then rr.redemption_code else null end),
    'redemption_code', rr.redemption_code,
    'redemption_url', rr.redemption_url_snapshot,
    'validation_token', rr.validation_token,
    'fulfillment_type', coalesce(rr.fulfillment_type, r.fulfillment_type),
    'fulfillment_mode', r.fulfillment_mode,
    'fulfillment_instructions', coalesce(rr.fulfillment_instructions, r.fulfillment_instructions),
    'fulfillment_notes', rr.fulfillment_notes,
    'fulfilled_at', rr.fulfilled_at,
    'terms', coalesce(rr.terms_snapshot, r.terms),
    'created_at', rr.created_at,
    'issued_at', rr.issued_at,
    'redeemed_at', rr.redeemed_at,
    'expires_at', rr.expires_at
  ) order by rr.created_at desc), '[]'::jsonb)
  into v_result
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  left join public.organizations o on o.id = r.organization_id
  where rr.user_id = v_actor;

  return v_result;
end;
$$;

revoke all on function public.get_my_reward_redemptions() from public;
grant execute on function public.get_my_reward_redemptions() to authenticated;

create or replace function public.provider_list_reward_redemptions(
  p_organization_id uuid,
  p_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not public.can_manage_rewards_for_org(p_organization_id, v_actor) then
    raise exception 'only Owner/Admin can inspect reward redemptions for this organization';
  end if;
  if p_status not in ('all','issued','redeemed','cancelled') then
    raise exception 'invalid redemption status filter';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rr.id,
    'reward_id', rr.reward_id,
    'title', coalesce(rr.reward_title_snapshot, r.title),
    'user_id', rr.user_id,
    'user_name', coalesce(nullif(p.display_name,''), p.username, 'Gymbro'),
    'username', p.username,
    'coin_cost', rr.coin_cost,
    'status', rr.status,
    'redemption_reference', rr.redemption_reference,
    'validation_token', rr.validation_token,
    'fulfillment_type', coalesce(rr.fulfillment_type, r.fulfillment_type),
    'created_at', rr.created_at,
    'issued_at', rr.issued_at,
    'expires_at', rr.expires_at,
    'fulfilled_at', rr.fulfilled_at,
    'fulfillment_notes', rr.fulfillment_notes
  ) order by rr.created_at desc), '[]'::jsonb)
  into v_result
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  left join public.profiles p on p.id = rr.user_id
  where r.organization_id = p_organization_id
    and (p_status = 'all' or rr.status = p_status);

  return v_result;
end;
$$;

revoke all on function public.provider_list_reward_redemptions(uuid,text) from public;
grant execute on function public.provider_list_reward_redemptions(uuid,text) to authenticated;

create or replace function public.provider_lookup_reward_redemption(p_lookup text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_clean text := btrim(coalesce(p_lookup,''));
  v_result jsonb;
  v_org uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if v_clean = '' then raise exception 'redemption reference or token is required'; end if;

  select r.organization_id,
         jsonb_build_object(
           'id', rr.id,
           'reward_id', rr.reward_id,
           'title', coalesce(rr.reward_title_snapshot, r.title),
           'provider_name', coalesce(rr.provider_name_snapshot, o.name),
           'user_id', rr.user_id,
           'user_name', coalesce(nullif(p.display_name,''), p.username, 'Gymbro'),
           'username', p.username,
           'coin_cost', rr.coin_cost,
           'status', rr.status,
           'redemption_reference', rr.redemption_reference,
           'validation_token', rr.validation_token,
           'fulfillment_type', coalesce(rr.fulfillment_type, r.fulfillment_type),
           'fulfillment_instructions', coalesce(rr.fulfillment_instructions, r.fulfillment_instructions),
           'created_at', rr.created_at,
           'issued_at', rr.issued_at,
           'expires_at', rr.expires_at,
           'fulfilled_at', rr.fulfilled_at,
           'fulfillment_notes', rr.fulfillment_notes
         )
    into v_org, v_result
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  join public.organizations o on o.id = r.organization_id
  left join public.profiles p on p.id = rr.user_id
  where rr.validation_token::text = v_clean
     or upper(coalesce(rr.redemption_reference,'')) = upper(v_clean)
  order by rr.created_at desc
  limit 1;

  if v_result is null then raise exception 'redemption not found'; end if;
  if not public.can_manage_rewards_for_org(v_org, v_actor) then
    raise exception 'this redemption belongs to another provider';
  end if;

  return v_result;
end;
$$;

revoke all on function public.provider_lookup_reward_redemption(text) from public;
grant execute on function public.provider_lookup_reward_redemption(text) to authenticated;

create or replace function public.provider_fulfill_reward_redemption(
  p_redemption_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_redemption public.reward_redemptions%rowtype;
  v_reward public.rewards%rowtype;
  v_org public.organizations%rowtype;
  v_user_name text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_redemption
  from public.reward_redemptions
  where id = p_redemption_id
  for update;

  if not found then raise exception 'redemption not found'; end if;

  select * into v_reward from public.rewards where id = v_redemption.reward_id;
  select * into v_org from public.organizations where id = v_reward.organization_id;

  if not public.can_manage_rewards_for_org(v_reward.organization_id, v_actor) then
    raise exception 'only Owner/Admin can validate this redemption';
  end if;

  if coalesce(v_redemption.fulfillment_type, v_reward.fulfillment_type) not in ('in_person','physical_product') then
    raise exception 'this reward does not require presencial fulfillment validation';
  end if;

  if v_redemption.status = 'cancelled' then raise exception 'redemption is cancelled'; end if;

  if v_redemption.status = 'redeemed' then
    select coalesce(nullif(p.display_name,''), p.username, 'Gymbro') into v_user_name
    from public.profiles p where p.id = v_redemption.user_id;
    return jsonb_build_object(
      'id', v_redemption.id,
      'title', coalesce(v_redemption.reward_title_snapshot, v_reward.title),
      'user_name', v_user_name,
      'status', 'redeemed',
      'fulfilled_at', v_redemption.fulfilled_at,
      'already_fulfilled', true
    );
  end if;

  if v_redemption.status <> 'issued' then raise exception 'redemption cannot be fulfilled from status %', v_redemption.status; end if;
  if v_redemption.expires_at is not null and v_redemption.expires_at <= now() then raise exception 'redemption has expired'; end if;

  update public.reward_redemptions
  set
    status = 'redeemed',
    redeemed_at = coalesce(redeemed_at, now()),
    fulfilled_by_user_id = v_actor,
    fulfilled_at = now(),
    fulfillment_notes = nullif(left(btrim(coalesce(p_notes,'')), 1000), '')
  where id = p_redemption_id
  returning * into v_redemption;

  insert into public.reward_redemption_events(
    redemption_id, organization_id, actor_user_id, action, notes, metadata
  ) values (
    v_redemption.id,
    v_reward.organization_id,
    v_actor,
    'reward_redemption.fulfilled',
    v_redemption.fulfillment_notes,
    jsonb_build_object(
      'reward_id', v_reward.id,
      'reference', v_redemption.redemption_reference,
      'fulfillment_type', coalesce(v_redemption.fulfillment_type, v_reward.fulfillment_type)
    )
  );

  insert into public.notifications(user_id, notification_type, title, body, data)
  values(
    v_redemption.user_id,
    'reward_fulfilled',
    'Premio entregado',
    format('%s confirmó la entrega de %s', v_org.name, coalesce(v_redemption.reward_title_snapshot, v_reward.title)),
    jsonb_build_object('reward_id', v_reward.id, 'redemption_id', v_redemption.id)
  );

  select coalesce(nullif(p.display_name,''), p.username, 'Gymbro') into v_user_name
  from public.profiles p where p.id = v_redemption.user_id;

  return jsonb_build_object(
    'id', v_redemption.id,
    'title', coalesce(v_redemption.reward_title_snapshot, v_reward.title),
    'user_name', v_user_name,
    'status', v_redemption.status,
    'fulfilled_at', v_redemption.fulfilled_at,
    'already_fulfilled', false
  );
end;
$$;

revoke all on function public.provider_fulfill_reward_redemption(uuid,text) from public;
grant execute on function public.provider_fulfill_reward_redemption(uuid,text) to authenticated;

create or replace function public.get_dadofit_schema_version()
returns text
language sql
stable
security definer
set search_path = public
as $$ select 'v15.2-reward-qr-fulfillment'::text; $$;

revoke all on function public.get_dadofit_schema_version() from public;
grant execute on function public.get_dadofit_schema_version() to anon, authenticated;
