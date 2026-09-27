-- Columns the existing DriveMetrik UI already uses but the Floot-derived schema lacked.
alter table public.vehicles add column engine text, add column drivetrain text, add column color text;
alter table public.shops add column owner_name text;
grant update (owner_name) on public.shops to authenticated;
