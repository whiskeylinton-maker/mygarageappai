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

## Production record: 2026-11-22
- Migration file SHA-256 `2f400d5c…` = reviewed commit `f9aadaf`.
- Production dry run (`tests/production_dryrun.sql`, one transaction, rolled back): **16/16 PASS**. Checks: nothing overwritten, function bodies match the reviewed fingerprints, RLS on with no policies, no anon/app table access, anon can't execute, SECURITY DEFINER with an empty search_path, THE GARAGE owner and the internal shop_owner refused owner data, cross-shop session write refused, green/yellow/red correct, existing data and owner functions unchanged.
- Applied as migration `20261122134002 owner_live_presence`. After applying, the live objects match the reviewed fingerprints; anon has no access; shops=3, employees=3 unchanged.
- Post-apply test on the live objects (rolled back): **5/5 PASS**. Both non-owner accounts refused, cross-shop write refused, owner sees per-shop green/yellow, sign-out turns red immediately. No test rows remain.
- Rollback, if ever needed: `supabase/rollback_20261122_owner_live_presence.sql`.

## Production release: 2026-11-22
- Released as `dpl_HEozbGrfqd7zpK3212SarRXRXWTj` (same files as staging `dpl_6mg1Qpv…`, pinned commit `f9aadaf`, built with the Production environment variables). The previous production build `dpl_7iiDpuTrUswM2dJBPAH2RWGQGFyE` stays available for rollback.
- The build passed every existing step plus the Command Center tests. Its output is byte-identical to staging: page 4,594,612 bytes, `watchtower.js` sha1 `1f25bf3b…`, `owner.js` sha1 `d1655fa4…`.
- Live checks: the heartbeat route accepts POST only; Watchtower's duplicate Overview tab is removed; the served page contains no Stripe or service-role keys; no runtime errors in the first hour.
- First real heartbeat: the platform-owner account on desktop, Owner Analytics screen, status active (green).
- Rollback, if needed: promote `dpl_7iiDpuTrUswM2dJBPAH2RWGQGFyE` in Vercel. The database objects can stay; the old page simply stops sending heartbeats.
