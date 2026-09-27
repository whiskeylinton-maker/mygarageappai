-- RLS + tenant isolation. Tenant = public.current_shop_id(), resolved from the
-- caller's active employees row (auth.uid()), never from request input.

do $$
declare t text;
begin
  foreach t in array array['profiles','shops','employees','customers','vehicles',
    'vehicle_service_history','jobs','job_line_items','estimates','estimate_line_items',
    'invoices','invoice_line_items','payments','cash_transactions','daily_close',
    'timeclock_entries','coupons','inventory_items','migration_batches','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);  -- no anonymous access at all
  end loop;
end $$;

-- Standard shop-scoped tables: full CRUD within own shop only.
do $$
declare t text;
begin
  foreach t in array array['customers','vehicles','jobs','estimates','invoices','payments',
    'cash_transactions','daily_close','timeclock_entries','coupons','inventory_items',
    'migration_batches']
  loop
    execute format($p$create policy shop_isolation on public.%I for all to authenticated
      using (shop_id = (select public.current_shop_id()))
      with check (shop_id = (select public.current_shop_id()))$p$, t);
  end loop;
end $$;

-- Child tables without shop_id: isolated through their parent row.
create policy shop_isolation on public.vehicle_service_history for all to authenticated
  using (exists (select 1 from public.vehicles v where v.id = vehicle_id and v.shop_id = (select public.current_shop_id())))
  with check (exists (select 1 from public.vehicles v where v.id = vehicle_id and v.shop_id = (select public.current_shop_id())));
create policy shop_isolation on public.job_line_items for all to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.shop_id = (select public.current_shop_id())))
  with check (exists (select 1 from public.jobs j where j.id = job_id and j.shop_id = (select public.current_shop_id())));
create policy shop_isolation on public.estimate_line_items for all to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_id and e.shop_id = (select public.current_shop_id())))
  with check (exists (select 1 from public.estimates e where e.id = estimate_id and e.shop_id = (select public.current_shop_id())));
create policy shop_isolation on public.invoice_line_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.shop_id = (select public.current_shop_id())))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.shop_id = (select public.current_shop_id())));

-- shops: read own; owner/manager may edit profile fields only. Plan/subscription/
-- Stripe columns are NOT client-writable (closes the localStorage plan-bypass hole);
-- only the server (service role / Stripe webhook) may change them.
create policy shop_read on public.shops for select to authenticated
  using (id = (select public.current_shop_id()));
create policy shop_update on public.shops for update to authenticated
  using (id = (select public.current_shop_id()) and (select public.current_shop_role()) in ('shop_owner','manager'))
  with check (id = (select public.current_shop_id()));
revoke insert, update, delete on public.shops from authenticated;
grant update (name, address, phone, email, tax_rate_pct) on public.shops to authenticated;

-- employees: everyone in the shop can see the roster; only owner/manager can change it,
-- and nobody can grant platform_owner.
create policy emp_read on public.employees for select to authenticated
  using (shop_id = (select public.current_shop_id()) or user_id = (select auth.uid()));
create policy emp_write on public.employees for insert to authenticated
  with check (shop_id = (select public.current_shop_id())
              and (select public.current_shop_role()) in ('shop_owner','manager')
              and role <> 'platform_owner');
create policy emp_update on public.employees for update to authenticated
  using (shop_id = (select public.current_shop_id()) and (select public.current_shop_role()) in ('shop_owner','manager'))
  with check (shop_id = (select public.current_shop_id()) and role <> 'platform_owner');
create policy emp_delete on public.employees for delete to authenticated
  using (shop_id = (select public.current_shop_id()) and (select public.current_shop_role()) in ('shop_owner','manager'));

-- profiles: see self + coworkers; edit only own name/avatar (role is not self-writable).
create policy profile_read on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or exists (select 1 from public.employees e
                    where e.user_id = profiles.id and e.shop_id = (select public.current_shop_id())));
create policy profile_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- audit_log: append-only, own shop, actor must be the caller.
create policy audit_read on public.audit_log for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy audit_insert on public.audit_log for insert to authenticated
  with check (shop_id = (select public.current_shop_id()) and actor_user_id = (select auth.uid()));
revoke update, delete on public.audit_log from authenticated;

-- create_shop: atomic "create shop + become its owner", same rules as the Floot endpoint
-- (a user already linked to an active shop is refused).
create or replace function public.create_shop(p_name text, p_phone text default null,
  p_address text default null, p_tax_rate_pct numeric default 0, p_is_test_data boolean default false)
returns public.shops language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.shops;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Shop name is required'; end if;
  if exists (select 1 from public.employees where user_id = uid and active) then
    raise exception 'This account is already linked to a shop' using errcode = '23505';
  end if;
  insert into public.shops (name, phone, address, tax_rate_pct, is_test_data)
    values (trim(p_name), p_phone, p_address, coalesce(p_tax_rate_pct,0), p_is_test_data)
    returning * into s;
  insert into public.employees (user_id, shop_id, role, active) values (uid, s.id, 'shop_owner', true)
    on conflict (user_id) do update set shop_id = excluded.shop_id, role = 'shop_owner', active = true;
  insert into public.audit_log (shop_id, actor_user_id, action, detail)
    values (s.id, uid, 'shop_created', jsonb_build_object('shopName', s.name));
  return s;
end $$;

revoke execute on function public.create_shop(text,text,text,numeric,boolean) from public, anon;
grant execute on function public.create_shop(text,text,text,numeric,boolean) to authenticated;
revoke execute on function public.current_shop_id() from public, anon;
revoke execute on function public.current_shop_role() from public, anon;
grant execute on function public.current_shop_id() to authenticated;
grant execute on function public.current_shop_role() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
