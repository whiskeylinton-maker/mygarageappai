# Owner Command Center (staging)

Adds to the existing **Owner Analytics** screen; it does not create a second dashboard:

- **Command center**: registered shops, active paying shops, users online now, MRR, collected this month, due in 7 days, failed/overdue, new subscriptions, cancellations, open complaints.
- **Who is online now**: live heartbeat presence per tab/device.
  - Green: heartbeat within 2.5 min and input within 5 min.
  - Yellow: idle (browser open, no input for 5+ min).
  - Red: offline (no heartbeat for 2.5+ min, or signed out).
- **Subscriber payment monitor**: green, yellow, red or gray from live Stripe data, with the exact Stripe status, last payment, next billing, days due, outstanding balance and cancellation date. A shop is never shown green without live Stripe data.
- **Shop drill-down**: membership, billing, activity and support history. The complaint status controls work from here too.

## How it ships
The production build is a chain of verified patch steps (`scripts/*.mjs` on the Vercel deployment). This adds ONE step, `scripts/command-center.mjs`, run last (see `scripts/build-chain.sh`). It:
1. refuses to run unless `api/watchtower.js`, `api/_lib/owner.js` and `api/_lib/supabase.js` hash to the reviewed versions, and its own files match `command-center.pins.json`;
2. applies exact-match edits (each must match exactly once);
3. runs the existing owner billing tests plus the new tests (`scripts/cc-tests.mjs`). Any failure aborts the deployment.

Security: Owner data stays behind the existing `is_platform_owner()` check, which requires the pinned owner user id and an active `platform_owner` role. This is enforced in the API and again in every database function. The only new pre-owner route is the heartbeat (`POST /api/watchtower?view=presence`), which needs a valid login and can only write the caller's own presence row. No keys reach the browser.

## Needs approval
- `supabase/20261122_owner_live_presence.sql`: additive (1 table with RLS and no client policies, 3 functions). Until it is applied, live activity shows "not switched on yet" and nothing is shown as online.
- Stripe on previews: `STRIPE_SECRET_KEY` is set for Production only, so staging shows every billing status as gray "Billing data unavailable" (by design).

## Tests
- `tests/presence_test.sql`: 21 database checks on a throwaway local Postgres (access control, transitions, throttling, retention).
- `tests/ui-harness.mjs` + `tests/ui-test.cjs`: 36 browser checks at desktop, tablet and phone widths, using clearly labelled fixtures. Nothing in these tests touches production.
