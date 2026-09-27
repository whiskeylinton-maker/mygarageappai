-- No-op in production: 003_drivemetrik_ui_columns already added these. Kept to mirror the Supabase migration history.
-- Vehicle fields the existing DriveMetrik UI already captures (Garage + Bay check-in).
alter table public.vehicles add column if not exists color text, add column if not exists engine text;
