-- Anonymous, device-scoped favorites for Community Builds.

alter table public.community_builds
  add column if not exists favorite_count integer not null default 0;

alter table public.community_builds
  drop constraint if exists community_builds_favorite_count;

alter table public.community_builds
  add constraint community_builds_favorite_count
    check (favorite_count >= 0);

grant select (favorite_count)
  on table public.community_builds to anon, authenticated;

create table if not exists public.community_build_favorites (
  build_id uuid not null
    references public.community_builds(id) on delete cascade,
  actor_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (build_id, actor_hash),

  constraint community_build_favorites_actor_hash
    check (actor_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.community_build_favorites is
  'Anonymous favorites keyed by a server-side HMAC of a random browser token.';

alter table public.community_build_favorites enable row level security;
revoke all on table public.community_build_favorites
  from public, anon, authenticated;
grant all on table public.community_build_favorites to service_role;

create or replace function public.community_set_build_favorite(
  p_build_id uuid,
  p_actor_hash text,
  p_favorite boolean
)
returns table (
  favorite_count integer,
  favorited boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_favorited boolean;
begin
  if p_actor_hash !~ '^[0-9a-f]{64}$' or p_favorite is null then
    raise exception 'invalid favorite parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('favorite:' || p_build_id::text, 0)
  );

  if not exists (
    select 1
    from public.community_builds
    where id = p_build_id and status = 'published'
  ) then
    return;
  end if;

  if p_favorite then
    insert into public.community_build_favorites (build_id, actor_hash)
    values (p_build_id, p_actor_hash)
    on conflict do nothing;
  else
    delete from public.community_build_favorites
    where build_id = p_build_id and actor_hash = p_actor_hash;
  end if;

  select count(*)::integer
    into v_count
  from public.community_build_favorites
  where build_id = p_build_id;

  select exists (
    select 1
    from public.community_build_favorites
    where build_id = p_build_id and actor_hash = p_actor_hash
  ) into v_favorited;

  update public.community_builds
  set favorite_count = v_count
  where id = p_build_id;

  return query select v_count, v_favorited;
end;
$$;

revoke all on function public.community_set_build_favorite(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.community_set_build_favorite(uuid, text, boolean)
  to service_role;

alter table public.community_rate_limit_events
  drop constraint if exists community_rate_limit_action;

alter table public.community_rate_limit_events
  add constraint community_rate_limit_action
    check (action in ('challenge', 'publish', 'favorite'));

create or replace function public.community_consume_rate_limit(
  p_action text,
  p_actor_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  event_id bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_oldest timestamptz;
  v_event_id bigint;
  v_retry integer;
begin
  if p_action not in ('challenge', 'publish', 'favorite')
     or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 200
     or p_window_seconds not between 60 and 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_action || ':' || p_actor_hash, 0)
  );

  delete from public.community_rate_limit_events
  where created_at < v_now - interval '7 days';

  select count(*)::integer, min(created_at)
    into v_count, v_oldest
  from public.community_rate_limit_events
  where action = p_action
    and actor_hash = p_actor_hash
    and created_at > v_now - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (
        v_oldest + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    );
    return query select false, null::bigint, v_retry;
    return;
  end if;

  insert into public.community_rate_limit_events (action, actor_hash)
  values (p_action, p_actor_hash)
  returning id into v_event_id;

  return query select true, v_event_id, 0;
end;
$$;

revoke all on function public.community_consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.community_consume_rate_limit(text, text, integer, integer)
  to service_role;
