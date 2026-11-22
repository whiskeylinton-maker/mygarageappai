-- DriveMetrik Owner Command Center: live user presence (who is online / idle / offline).
-- ADDITIVE ONLY: one new table, three new functions. Nothing existing is altered or dropped.
--
-- How it works
--   * Every signed-in browser tab sends a heartbeat through /api/watchtower?view=presence every 30 s while visible
--     (60 s while hidden). p_active=true only when there was real keyboard / mouse / touch input since the last beat.
--   * Each tab/device is its own row (session_id is random per tab), so one person on two devices shows two sessions.
--   * The OWNER view computes status on the database clock (never the browser's):
--        ACTIVE  (green)  heartbeat within 150 s AND real input within 300 s
--        IDLE    (yellow) heartbeat within 150 s, but no input for 300 s or more (tab open, nobody working)
--        OFFLINE (red)    no heartbeat for 150 s or more, or the tab signed out / closed (ended_at set)
--     A valid login token alone never counts as "online": only a live heartbeat does.
--
-- Security
--   * RLS is ON and there are NO policies: no client can read or write the table directly.
--   * presence_heartbeat() only ever writes the caller's own rows (auth.uid()); a session id belonging to
--     another user can't be hijacked (the upsert's WHERE refuses it).
--   * owner_presence() / owner_presence_prune() raise 42501 unless public.is_platform_owner()
--     (the pinned owner user id AND an active platform_owner role).

create table if not exists public.user_presence (
  session_id     uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  shop_id        uuid references public.shops(id) on delete set null,
  role           text,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_active_at timestamptz,
  page           text,
  device         text,
  ended_at       timestamptz
);
create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at desc);
create index if not exists user_presence_user_idx on public.user_presence (user_id, last_seen_at desc);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;

create or replace function public.presence_heartbeat(p_session uuid, p_page text, p_active boolean, p_device text, p_end boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_page text := left(regexp_replace(lower(coalesce(p_page, '')), '[^a-z0-9 _-]', '', 'g'), 40);
  v_dev  text := case when p_device in ('desktop', 'tablet', 'mobile') then p_device else 'unknown' end;
  v_prev public.user_presence;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_session is null then raise exception 'Invalid session' using errcode = '22023'; end if;

  select * into v_prev from public.user_presence where session_id = p_session;
  if found and v_prev.user_id <> v_uid then raise exception 'Invalid session' using errcode = '22023'; end if;

  -- throttle: at most one write per session every 10 s, unless this beat ends the session or carries new activity
  if found and not coalesce(p_end, false) and v_prev.ended_at is null and v_prev.last_seen_at > now() - interval '10 seconds'
     and not (coalesce(p_active, false) and (v_prev.last_active_at is null or v_prev.last_active_at < now() - interval '10 seconds')) then
    return jsonb_build_object('ok', true, 'throttled', true);
  end if;

  insert into public.user_presence as up (session_id, user_id, shop_id, role, started_at, last_seen_at, last_active_at, page, device, ended_at)
  values (p_session, v_uid, public.current_shop_id(), public.current_shop_role()::text, now(), now(),
          case when coalesce(p_active, false) then now() end, nullif(v_page, ''), v_dev,
          case when coalesce(p_end, false) then now() end)
  on conflict (session_id) do update set
    shop_id        = excluded.shop_id,
    role           = excluded.role,
    last_seen_at   = now(),
    last_active_at = case when coalesce(p_active, false) then now() else up.last_active_at end,
    page           = coalesce(excluded.page, up.page),
    device         = excluded.device,
    -- a beat after an "end" (e.g. the same tab signs back in) re-opens the session
    started_at     = case when up.ended_at is not null and not coalesce(p_end, false) then now() else up.started_at end,
    ended_at       = case when coalesce(p_end, false) then now() else null end
  where up.user_id = v_uid;

  -- keep each user's footprint small: drop their sessions not seen for 30 days, and cap at 20 recent sessions
  delete from public.user_presence where user_id = v_uid and last_seen_at < now() - interval '30 days';
  delete from public.user_presence where session_id in (
    select session_id from public.user_presence where user_id = v_uid order by last_seen_at desc offset 20);

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.owner_presence()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  c_heartbeat constant integer := 150;   -- seconds without a heartbeat before a session is OFFLINE
  c_idle      constant integer := 300;   -- seconds without real input before a live session is IDLE
begin
  if not public.is_platform_owner() then raise exception 'Not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'serverNow', now(),
    'thresholds', jsonb_build_object('offlineAfterSeconds', c_heartbeat, 'idleAfterSeconds', c_idle,
                                     'heartbeatEverySeconds', 30, 'hiddenTabHeartbeatEverySeconds', 60),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'sessionId', p.session_id, 'userId', p.user_id, 'email', u.email,
        'name', coalesce(nullif(pr.display_name, ''), nullif(split_part(u.email, '@', 1), '')),
        'role', coalesce(p.role, e.role::text), 'shopId', coalesce(p.shop_id, e.shop_id), 'shopName', s.name,
        'shopInternal', coalesce(s.internal_account, false), 'shopTest', coalesce(s.is_test_data, false),
        'lastSignInAt', u.last_sign_in_at, 'startedAt', p.started_at, 'lastSeenAt', p.last_seen_at,
        'lastActiveAt', p.last_active_at, 'page', p.page, 'device', p.device, 'endedAt', p.ended_at,
        'secondsSinceSeen', floor(extract(epoch from now() - p.last_seen_at)),
        'secondsSinceActive', case when p.last_active_at is null then null else floor(extract(epoch from now() - p.last_active_at)) end,
        'status', case
            when p.ended_at is not null or p.last_seen_at < now() - make_interval(secs => c_heartbeat) then 'offline'
            when p.last_active_at is not null and p.last_active_at >= now() - make_interval(secs => c_idle) then 'active'
            else 'idle' end
      ) order by p.last_seen_at desc)
      from public.user_presence p
      join auth.users u on u.id = p.user_id
      left join public.profiles pr on pr.id = p.user_id
      left join public.employees e on e.user_id = p.user_id and e.active
      left join public.shops s on s.id = coalesce(p.shop_id, e.shop_id)
      where p.last_seen_at > now() - interval '24 hours'), '[]'::jsonb));
end $$;

create or replace function public.owner_presence_prune()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare n integer;
begin
  if not public.is_platform_owner() then raise exception 'Not authorized' using errcode = '42501'; end if;
  delete from public.user_presence where last_seen_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.presence_heartbeat(uuid, text, boolean, text, boolean) from public, anon;
revoke all on function public.owner_presence() from public, anon;
revoke all on function public.owner_presence_prune() from public, anon;
grant execute on function public.presence_heartbeat(uuid, text, boolean, text, boolean) to authenticated;
grant execute on function public.owner_presence() to authenticated;
grant execute on function public.owner_presence_prune() to authenticated;
