-- Local PostgreSQL test of 20261122_owner_live_presence.sql (run against a throwaway database, never production).
-- Stubs only what Supabase provides (auth schema, roles) plus the production definitions of the helpers it calls.
\set ON_ERROR_STOP on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create type public.shop_role as enum ('platform_owner','shop_owner','manager','service_advisor','cashier','greeter','technician','shop_foreman','fleet_manager','accountant','customer');
create table public.shops (id uuid primary key, name text, internal_account boolean default false, is_test_data boolean default false);
create table public.employees (user_id uuid primary key, shop_id uuid, role public.shop_role, active boolean default true);
create table public.profiles (id uuid primary key, display_name text);
-- production definitions (copied verbatim from the live database)
create function public.current_shop_id() returns uuid language sql stable security definer set search_path to '' as $$
  select e.shop_id from public.employees e where e.user_id = auth.uid() and e.active and e.shop_id is not null $$;
create function public.current_shop_role() returns public.shop_role language sql stable security definer set search_path to '' as $$
  select e.role from public.employees e where e.user_id = auth.uid() and e.active and e.shop_id is not null $$;
create function public.is_platform_owner() returns boolean language sql stable security definer set search_path to '' as $$
  select auth.uid() = '3c368530-e2b6-41f8-a71b-4b928453649e'::uuid
     and exists (select 1 from public.employees e where e.user_id = auth.uid() and e.role = 'platform_owner' and e.active) $$;

-- fixtures: owner, two shops with employees
insert into auth.users (id, email, last_sign_in_at) values
  ('3c368530-e2b6-41f8-a71b-4b928453649e', 'owner@example.test', now() - interval '1 hour'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ann@shopa.test', now() - interval '2 hours'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'tom@shopa.test', now() - interval '3 hours'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bea@shopb.test', now() - interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'imposter@shopb.test', now());
insert into public.shops values ('11111111-0000-4000-8000-000000000000', 'Owner HQ', true, false),
  ('aaaaaaaa-1111-4000-8000-000000000000', 'Shop A', false, false), ('bbbbbbbb-1111-4000-8000-000000000000', 'Shop B', false, false);
insert into public.employees values
  ('3c368530-e2b6-41f8-a71b-4b928453649e', '11111111-0000-4000-8000-000000000000', 'platform_owner', true),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000000', 'shop_owner', true),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-1111-4000-8000-000000000000', 'technician', true),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-000000000000', 'manager', true),
  -- a shop_owner who sets their own role to platform_owner is still NOT the owner (pinned user id)
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-1111-4000-8000-000000000000', 'platform_owner', true);
insert into public.profiles values ('aaaaaaaa-0000-4000-8000-000000000001', 'Ann Alvarez');

\i owner-command-center/supabase/20261122_owner_live_presence.sql

create function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'TEST FAILED: %', msg; end if; raise notice 'ok: %', msg; end $$;
create function pg_temp.status_of(p_sess uuid) returns text language sql as $$
  select s->>'status' from jsonb_array_elements(public.owner_presence()->'sessions') s where (s->>'sessionId')::uuid = p_sess $$;

-- 1) anonymous and non-owner callers are refused
set role authenticated;
do $$ begin perform public.presence_heartbeat('c0000000-0000-4000-8000-000000000001', 'x', true, 'desktop');
  raise exception 'TEST FAILED: anonymous heartbeat accepted'; exception when sqlstate '28000' then raise notice 'ok: anonymous heartbeat refused'; end $$;
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
do $$ begin perform public.owner_presence(); raise exception 'TEST FAILED: shop owner read presence';
  exception when sqlstate '42501' then raise notice 'ok: shop owner cannot read platform presence'; end $$;
do $$ begin perform 1 from public.user_presence; raise exception 'TEST FAILED: direct table read allowed';
  exception when insufficient_privilege then raise notice 'ok: no direct table access for app users'; end $$;
select set_config('test.uid', 'bbbbbbbb-0000-4000-8000-000000000002', false);
do $$ begin perform public.owner_presence(); raise exception 'TEST FAILED: self-promoted platform_owner read presence';
  exception when sqlstate '42501' then raise notice 'ok: self-promoted platform_owner role is still refused (pinned user id)'; end $$;

-- 2) heartbeats from several employees at different shops, Ann on two devices
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select public.presence_heartbeat('a1000000-0000-4000-8000-000000000001', 'Jobs Board!<script>', true, 'desktop');
select public.presence_heartbeat('a1000000-0000-4000-8000-000000000002', 'invoices', false, 'tablet');
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000002', false);
select public.presence_heartbeat('a2000000-0000-4000-8000-000000000001', 'bay station', true, 'mobile');
select set_config('test.uid', 'bbbbbbbb-0000-4000-8000-000000000001', false);
select public.presence_heartbeat('b1000000-0000-4000-8000-000000000001', 'dashboard', true, 'weird-device');
-- Bea cannot hijack Ann's session id
do $$ begin perform public.presence_heartbeat('a1000000-0000-4000-8000-000000000001', 'x', true, 'desktop');
  raise exception 'TEST FAILED: hijacked another user session'; exception when sqlstate '22023' then raise notice 'ok: cannot write another user''s session'; end $$;

select set_config('test.uid', '3c368530-e2b6-41f8-a71b-4b928453649e', false);
select pg_temp.check(jsonb_array_length(public.owner_presence()->'sessions') = 4, 'owner sees all 4 sessions across 2 shops');
select pg_temp.check(pg_temp.status_of('a1000000-0000-4000-8000-000000000001') = 'active', 'fresh beat + input = ACTIVE (green)');
select pg_temp.check(pg_temp.status_of('a1000000-0000-4000-8000-000000000002') = 'idle', 'fresh beat, never any input = IDLE (yellow), not active');
select pg_temp.check((select s->>'page' from jsonb_array_elements(public.owner_presence()->'sessions') s where s->>'sessionId' = 'a1000000-0000-4000-8000-000000000001') = 'jobs boardscript', 'page name sanitized');
select pg_temp.check((select s->>'device' from jsonb_array_elements(public.owner_presence()->'sessions') s where s->>'sessionId' = 'b1000000-0000-4000-8000-000000000001') = 'unknown', 'device allow-listed');
select pg_temp.check((select s->>'shopName' from jsonb_array_elements(public.owner_presence()->'sessions') s where s->>'sessionId' = 'a2000000-0000-4000-8000-000000000001') = 'Shop A', 'session carries its shop');
select pg_temp.check((select s->>'name' from jsonb_array_elements(public.owner_presence()->'sessions') s where s->>'sessionId' = 'a1000000-0000-4000-8000-000000000001') = 'Ann Alvarez', 'display name shown');
select pg_temp.check((public.owner_presence()->'thresholds'->>'offlineAfterSeconds')::int = 150 and (public.owner_presence()->'thresholds'->>'idleAfterSeconds')::int = 300, 'thresholds published');

-- 3) transitions (simulate elapsed time by backdating rows as the table owner)
reset role;
update public.user_presence set last_active_at = now() - interval '6 minutes' where session_id = 'a1000000-0000-4000-8000-000000000001';
update public.user_presence set last_seen_at = now() - interval '3 minutes' where session_id = 'a2000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.check(pg_temp.status_of('a1000000-0000-4000-8000-000000000001') = 'idle', 'still beating but no input for 6 min = IDLE');
select pg_temp.check(pg_temp.status_of('a2000000-0000-4000-8000-000000000001') = 'offline', 'no heartbeat for 3 min (closed / disconnected browser) = OFFLINE (red)');
-- activity brings idle back to active (not throttled because it carries new activity)
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select public.presence_heartbeat('a1000000-0000-4000-8000-000000000001', 'jobs', true, 'desktop');
-- sign-out / tab close ends the session immediately
select set_config('test.uid', 'bbbbbbbb-0000-4000-8000-000000000001', false);
select public.presence_heartbeat('b1000000-0000-4000-8000-000000000001', 'dashboard', false, 'desktop', true);
select set_config('test.uid', '3c368530-e2b6-41f8-a71b-4b928453649e', false);
select pg_temp.check(pg_temp.status_of('a1000000-0000-4000-8000-000000000001') = 'active', 'new input moves IDLE back to ACTIVE');
select pg_temp.check(pg_temp.status_of('b1000000-0000-4000-8000-000000000001') = 'offline', 'signed-out session is OFFLINE immediately');
-- the same tab signing back in re-opens its session
select set_config('test.uid', 'bbbbbbbb-0000-4000-8000-000000000001', false);
select public.presence_heartbeat('b1000000-0000-4000-8000-000000000001', 'dashboard', true, 'desktop');
select set_config('test.uid', '3c368530-e2b6-41f8-a71b-4b928453649e', false);
select pg_temp.check(pg_temp.status_of('b1000000-0000-4000-8000-000000000001') = 'active', 'signing back in re-opens the session');

-- 4) throttle: a second beat within 10 s without new activity is not written
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select pg_temp.check((public.presence_heartbeat('a1000000-0000-4000-8000-000000000002', 'invoices', false, 'tablet')->>'throttled')::boolean, 'rapid repeat beats are throttled');

-- 5) retention: sessions older than 24 h drop out of the owner view; prune is owner-only
reset role;
update public.user_presence set last_seen_at = now() - interval '2 days' where session_id = 'a2000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('test.uid', '3c368530-e2b6-41f8-a71b-4b928453649e', false);
select pg_temp.check(pg_temp.status_of('a2000000-0000-4000-8000-000000000001') is null, 'sessions older than 24 h leave the live view');
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
do $$ begin perform public.owner_presence_prune(); raise exception 'TEST FAILED: non-owner pruned';
  exception when sqlstate '42501' then raise notice 'ok: prune is owner-only'; end $$;
\echo ALL PRESENCE SQL TESTS PASSED
