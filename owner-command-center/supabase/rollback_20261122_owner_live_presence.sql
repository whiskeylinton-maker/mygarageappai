-- ROLLBACK for 20261122_owner_live_presence.sql. Removes ONLY what that migration added; nothing else depends on it.
-- Effect: live activity data (presence rows) is deleted; Owner Analytics keeps working and shows
-- "Live activity is not switched on yet"; heartbeats get 503 and back off for 10 minutes.
drop function if exists public.owner_presence_prune();
drop function if exists public.owner_presence();
drop function if exists public.presence_heartbeat(uuid, text, boolean, text, boolean);
drop table if exists public.user_presence;
