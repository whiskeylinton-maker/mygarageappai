\set ON_ERROR_STOP on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create table public.shops (id uuid primary key, name text, internal_account boolean default false, is_test_data boolean default false);
create table public.plan_consents (id serial primary key, shop_id uuid, plan_key text);
insert into public.shops values ('4be54af5-8371-49aa-8035-f9e5bc255075','DRIVEMETRIK OWNER',true,false),('d5dec7c0-c9ab-42a8-9559-d8950e06606c','DRIVEMETRIK OWNER',true,false),('09094c80-6eaf-46a5-ba85-ce8226098c67','THE GARAGE',false,false),('aaaaaaaa-0000-4000-8000-000000000001','Test shop',false,true),('bbbbbbbb-0000-4000-8000-000000000001','Real customer',false,false);
\i owner-command-center/supabase/20261123_internal_shops_never_billed.sql
create function pg_temp.blocked(sid uuid) returns boolean language plpgsql as $$ begin insert into public.plan_consents(shop_id,plan_key) values (sid,'pro'); return false; exception when sqlstate '23514' then return true; end $$;
do $$ begin
  if not pg_temp.blocked('4be54af5-8371-49aa-8035-f9e5bc255075') then raise exception 'FAIL owner shop not blocked'; end if;
  if not pg_temp.blocked('d5dec7c0-c9ab-42a8-9559-d8950e06606c') then raise exception 'FAIL second internal shop not blocked'; end if;
  if not pg_temp.blocked('aaaaaaaa-0000-4000-8000-000000000001') then raise exception 'FAIL test shop not blocked'; end if;
  if pg_temp.blocked('bbbbbbbb-0000-4000-8000-000000000001') then raise exception 'FAIL real customer blocked'; end if;
  if pg_temp.blocked('09094c80-6eaf-46a5-ba85-ce8226098c67') then raise exception 'FAIL THE GARAGE (customer-type comp shop) blocked'; end if;
  raise notice 'ok: internal + test shops refused before Stripe; real customers and THE GARAGE unaffected';
end $$;
