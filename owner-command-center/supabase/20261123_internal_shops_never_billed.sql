-- Internal (owner) shops can never start a LIVE Stripe checkout.
-- ADDITIVE: one function + one trigger. No data is changed.
--
-- Why here: api/create-subscription-checkout.js records the customer's plan consent BEFORE it creates the Stripe
-- Checkout Session, and stops with no session if that insert fails ("no consent record, no checkout"). Refusing the
-- consent for internal shops therefore blocks the checkout before Stripe is ever called, with no code change.
-- Owner access is unaffected: internal shops keep permanent complimentary access (trialing, no trial end date).
create or replace function public.trg_block_billing_for_internal_shops()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare s public.shops;
begin
  select * into s from public.shops where id = new.shop_id;
  if found and coalesce(s.internal_account, false) then   -- internal only: is_test_data can be set at signup, so it must never block a real customer
    raise exception 'This is an internal DriveMetrik account with permanent complimentary access; it is never billed.'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger block_billing_for_internal_shops
  before insert on public.plan_consents
  for each row execute function public.trg_block_billing_for_internal_shops();

revoke all on function public.trg_block_billing_for_internal_shops() from public, anon, authenticated;
