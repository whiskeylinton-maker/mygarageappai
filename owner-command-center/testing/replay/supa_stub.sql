-- Minimal stand-in for what Supabase provides, for a LOCAL throwaway rehearsal only.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, created_at timestamptz default now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
