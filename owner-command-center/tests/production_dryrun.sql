-- Production DRY RUN: everything below runs in ONE implicit transaction and ends by raising an exception,
-- so Postgres rolls ALL of it back. Nothing persists. The exception message carries the results.
create temp table _r (n serial, check_name text, pass boolean, detail text);
-- @@MIGRATION@@
insert into _r(check_name, pass, detail) select 'functions match reviewed bodies', bool_and(md5(prosrc) = case proname when 'owner_presence' then '165ba4e792582fe0fd488ee4ee1936ab' when 'owner_presence_prune' then 'ba9c9f60248330c2c3ea4732cfd6aff2' when 'presence_heartbeat' then '6b5e15152d953938124dafad73316736' end), string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('presence_heartbeat','owner_presence','owner_presence_prune');
insert into _r(check_name, pass, detail) select 'rls enabled, no policies', relrowsecurity and not exists (select 1 from pg_policy where polrelid = c.oid), '' from pg_class c where c.oid = 'public.user_presence'::regclass;
insert into _r(check_name, pass, detail) select 'anon/authenticated: no table privileges', not (has_table_privilege('anon','public.user_presence','select,insert,update,delete') or has_table_privilege('authenticated','public.user_presence','select,insert,update,delete')), '';
insert into _r(check_name, pass, detail) select 'anon cannot execute any new function', not (has_function_privilege('anon','public.presence_heartbeat(uuid,text,boolean,text,boolean)','execute') or has_function_privilege('anon','public.owner_presence()','execute') or has_function_privilege('anon','public.owner_presence_prune()','execute')), '';
insert into _r(check_name, pass, detail) select 'authenticated can execute the three functions', has_function_privilege('authenticated','public.presence_heartbeat(uuid,text,boolean,text,boolean)','execute') and has_function_privilege('authenticated','public.owner_presence()','execute'), '';
insert into _r(check_name, pass, detail) select 'functions are security definer with empty search_path', bool_and(prosecdef and proconfig = array['search_path=""']), string_agg(proname||':'||coalesce(array_to_string(proconfig,';'),'-'), ' ') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('presence_heartbeat','owner_presence','owner_presence_prune');
grant insert on _r to authenticated, anon; grant usage on sequence _r_n_seq to authenticated, anon;
-- real shop customer (THE GARAGE owner)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bffc1a13-07c4-47f9-869a-d38b8fec0ee4","role":"authenticated"}', true);
do $$ begin perform public.owner_presence(); insert into _r(check_name,pass,detail) values ('THE GARAGE owner reads platform presence', false, 'NOT REFUSED');
  exception when insufficient_privilege then insert into _r(check_name,pass,detail) values ('THE GARAGE owner cannot read platform presence', true, sqlstate); end $$;
do $$ begin perform 1 from public.user_presence; insert into _r(check_name,pass,detail) values ('THE GARAGE owner direct table read', false, 'NOT REFUSED');
  exception when insufficient_privilege then insert into _r(check_name,pass,detail) values ('THE GARAGE owner cannot read the table directly', true, sqlstate); end $$;
do $$ begin perform public.owner_presence_prune(); insert into _r(check_name,pass,detail) values ('THE GARAGE owner prune', false, 'NOT REFUSED');
  exception when insufficient_privilege then insert into _r(check_name,pass,detail) values ('THE GARAGE owner cannot prune', true, sqlstate); end $$;
select public.presence_heartbeat('d7000000-0000-4000-8000-000000000001', 'dashboard', true, 'desktop');
select public.presence_heartbeat('d7000000-0000-4000-8000-000000000002', 'invoices', false, 'mobile');
-- internal shop_owner at DRIVEMETRIK OWNER (not the platform owner)
select set_config('request.jwt.claims', '{"sub":"55820c5a-f48b-4f82-9999-c3f202b09a05","role":"authenticated"}', true);
do $$ begin perform public.owner_presence(); insert into _r(check_name,pass,detail) values ('internal shop_owner reads platform presence', false, 'NOT REFUSED');
  exception when insufficient_privilege then insert into _r(check_name,pass,detail) values ('internal shop_owner (not the pinned owner) cannot read presence', true, sqlstate); end $$;
do $$ begin perform public.presence_heartbeat('d7000000-0000-4000-8000-000000000001', 'x', true, 'desktop'); insert into _r(check_name,pass,detail) values ('hijack', false, 'NOT REFUSED');
  exception when sqlstate '22023' then insert into _r(check_name,pass,detail) values ('cannot write another shop''s session (isolation)', true, sqlstate); end $$;
-- anon
reset role; set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin perform public.presence_heartbeat('d7000000-0000-4000-8000-000000000009', 'x', true, 'desktop'); insert into _r(check_name,pass,detail) values ('anon heartbeat', false, 'NOT REFUSED');
  exception when insufficient_privilege then insert into _r(check_name,pass,detail) values ('anonymous visitor cannot call the heartbeat', true, sqlstate); end $$;
-- platform owner
reset role; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3c368530-e2b6-41f8-a71b-4b928453649e","role":"authenticated"}', true);
insert into _r(check_name, pass, detail) select 'owner sees THE GARAGE sessions: desktop ACTIVE (green), mobile IDLE (yellow)',
  (select count(*) from jsonb_array_elements(p->'sessions') s where s->>'shopName' = 'THE GARAGE') = 2
  and exists (select 1 from jsonb_array_elements(p->'sessions') s where s->>'device' = 'desktop' and s->>'status' = 'active' and s->>'shopName' = 'THE GARAGE')
  and exists (select 1 from jsonb_array_elements(p->'sessions') s where s->>'device' = 'mobile' and s->>'status' = 'idle'), (p->'thresholds')::text
  from (select public.owner_presence() p) x;
reset role;
update public.user_presence set last_seen_at = now() - interval '3 minutes' where session_id = 'd7000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into _r(check_name, pass, detail) select 'no heartbeat for 3 min -> OFFLINE (red)', (select s->>'status' from jsonb_array_elements(public.owner_presence()->'sessions') s where s->>'sessionId' = 'd7000000-0000-4000-8000-000000000001') = 'offline', '';
reset role;
-- rollback procedure
-- @@ROLLBACK@@
insert into _r(check_name, pass, detail) select 'rollback removes every object', not exists (select 1 from pg_class where relname = 'user_presence' and relnamespace = 'public'::regnamespace) and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('presence_heartbeat','owner_presence','owner_presence_prune')), '';
insert into _r(check_name, pass, detail) select 'existing owner functions untouched', exists (select 1 from pg_proc where proname = 'owner_dashboard') and exists (select 1 from pg_proc where proname = 'is_platform_owner'), '';
do $$ declare m text; begin select string_agg(n||'. '||case when pass then 'PASS' else 'FAIL' end||' | '||check_name||coalesce(' | '||nullif(detail,''),''), E'\n' order by n) into m from _r;
  raise exception 'DRYRUN_COMPLETE (all rolled back)%', E'\n'||m; end $$;
