-- FINAL production migration (pending owner approval): internal shops are permanently complimentary and never billed.
-- ADDITIVE: one flag update on exactly one shop, one function, one trigger. No rows are deleted; no other data changes.
--
-- 1) THE GARAGE is the owner's own test shop: mark it internal (like the two "DRIVEMETRIK OWNER" shops).
--    Its access does not change: it stays trialing with no trial end date and no Stripe IDs, which shop_access_state()
--    already treats as full, non-expiring access; the hourly trial-expiry job only touches shops WITH an end date.
--    Owner Analytics will label it "Internal" instead of "Complimentary"; it was already excluded from revenue.
update public.shops set internal_account = true
 where id = '09094c80-6eaf-46a5-ba85-ce8226098c67' and name = 'THE GARAGE' and stripe_subscription_id is null;

-- 2) Internal shops can never start a LIVE Stripe checkout.
--    api/create-subscription-checkout.js records the plan consent BEFORE it creates the Stripe Checkout Session and
--    stops with no session if that insert fails, so refusing the consent blocks checkout before Stripe is ever called.
--    Internal only: is_test_data can be set by a signup request, so it must never block a real customer.
create or replace function public.trg_block_billing_for_internal_shops()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare s public.shops;
begin
  select * into s from public.shops where id = new.shop_id;
  if found and coalesce(s.internal_account, false) then
    raise exception 'This is an internal DriveMetrik account with permanent complimentary access; it is never billed.'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger block_billing_for_internal_shops
  before insert on public.plan_consents
  for each row execute function public.trg_block_billing_for_internal_shops();

revoke all on function public.trg_block_billing_for_internal_shops() from public, anon, authenticated;
