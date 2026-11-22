# Free, isolated subscription testing

Nothing here uses real money, live Stripe or production data.

## The isolated test environment
| | Production (drivemetrik.com) | Test |
|---|---|---|
| Stripe | live keys | **test-mode** keys (`sk_test_…`) |
| Database | Supabase `DriveMetrik` | Supabase `drivemetrik-test` (schema copied from production's migration history; no customer data) |
| Site | Vercel Production | Vercel Preview env vars pointing at the two test services |
| Cards | real | Stripe test cards only (4242 4242 4242 4242) |

## One-time setup (secrets never pass through chat)
1. **Stripe, test mode** (toggle "Test mode" in the dashboard), Developers → API keys:
   - Copy the **test** secret key.
   - Add a webhook endpoint for the test site's `/api/stripe-webhook` with the same 7 events as production, and copy its signing secret.
2. **Vercel**, project `mygarageappai-deploy-13` → Environment Variables. Set these for **Preview only**:
   - `STRIPE_SECRET_KEY` = test key
   - `STRIPE_WEBHOOK_SECRET` = test signing secret (first change the existing one to **Production only**)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` = the **test** project's values
   - `STRIPE_PRICE_*` / `STRIPE_COUPON_FIRST_MONTH_50` = the IDs printed by `node dm-test.mjs setup`
3. Run the test tool from a computer with Node 20+: `npm i stripe @supabase/supabase-js`, set `STRIPE_TEST_SECRET_KEY`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY` and `TEST_SITE_URL`, then use the commands below.

## Scenarios
| What | Command |
|---|---|
| Disposable shop | `node dm-test.mjs shop "Joe's Garage"` |
| Starter, 14-day trial ($0 today) | `checkout <shopId> starter` → pay with 4242… → `status` shows **trialing** |
| Pro / Business, 50% off month 1 | `checkout <shopId> pro` → $99.50 / $124.50 shown, test card → **active** |
| Trial ends / renewal | `advance <shopId> 15` or `advance <shopId> 30` → invoice paid → stays **active** |
| Failed payment | `fail <shopId>` → **past_due** (red in Owner Analytics) |
| Cancellation | `cancel <shopId>` → **canceled** (gray) |
| Webhook delivery | `status` lists every webhook and its outcome |
| Clean slate | `reset` deletes only `[TEST]` shops and test clocks |

## Safety locks (enforced in code, tested in `dm-test.test.mjs`)
- Live Stripe keys are refused; the production database is refused.
- Every Stripe object is labelled `dm_test=true`; every shop is `is_test_data=true` and named `[TEST] …`.
- Owner Analytics already excludes test shops from revenue and subscriber counts.
- `reset` can only delete `is_test_data` shops.
- No coupon codes or bypasses are added to the customer-facing site.

## Owner account
The platform-owner shop "DRIVEMETRIK OWNER" has permanent complimentary access: trialing with no end date and no Stripe IDs, so the hourly expiry job never touches it. Migration `20261123_internal_shops_never_billed.sql` (pending approval) makes it impossible for **any** internal or test shop to start a live checkout. It was verified on production in a rolled-back dry run (4/4 checks).
