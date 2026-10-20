# DriveMetrik Owner Dashboard & Promotion Controls

Status: implementation specification / not yet deployed
Owner login email: drivemetrik@gmail.com

## Product boundary
Create a private platform-owner area inside the existing DriveMetrik application. It is not a shop-management account and must not require the owner to select a vehicle or operate a shop workflow. Shop users continue using their existing shop experience.

## Owner navigation
- Overview: MRR, collected revenue, active/trialing/past-due/canceled subscriptions, new members, churn, refunds, failed payments, and goal progress.
- Members & Subscriptions: search/filter member shops, contact details, plan, Stripe customer/subscription IDs, status, start/renewal dates, current price, promo attribution, and a link to the Stripe record.
- Sales & Revenue: daily/weekly/monthly/yearly totals; gross collected, refunds, net collected, recurring run-rate, plan mix, and period comparison.
- Promotions: create/edit/pause/expire promo offers and view redemption history.
- Complimentary Access: owner-authorized comp/trial grants with start/end, plan, reason, approver, and explicit post-period billing behavior.
- Audit Log: immutable record of sensitive owner actions.
- Platform Health: webhook health, billing sync failures, auth/configuration issues, and recent application errors.
- Owner Settings: profile, security, notification preferences.

## Roles and authentication
- Use Supabase Auth for owner sign-in.
- Provision drivemetrik@gmail.com through a verified invitation/admin process; never hard-code a password or expose a service-role key in the browser.
- Enforce platform-owner authorization server-side and in database RLS. UI hiding alone is not authorization.
- Do not let users update their own role. Owner role changes require trusted server-side administration and audit logging.
- Require MFA if available for owner access; use short-lived sessions and reauthentication for high-impact actions.
- Owner reports may aggregate platform-wide business data, but shop users must remain isolated to their own tenant.
- Audit sensitive actions with actor, timestamp, target, before/after state, reason, and request/correlation ID.

## Promotion model
Support three offer types:
1. Trial: trial duration in days; specify whether a payment method is required and what happens at trial end.
2. Discount: percentage or fixed amount; one-time or repeating duration; eligible plans; optional promotion code; redemption cap; per-customer limit; start/end dates.
3. Complimentary access: grant a selected shop/plan free access until a designated end date, with an internal reason and explicit end-of-comp policy.

Common controls:
- Unique code, display name, status (draft/active/paused/expired), eligible plans, start/end, max redemptions, max redemptions per customer, first-time-customer restriction, and internal notes.
- Preview exact customer-facing terms and regular price before activation.
- Validate all redemptions server-side; prevent replay, cap races, duplicate use, and client-side entitlement manipulation.
- Pausing a code prevents new redemptions; it must not silently alter already agreed subscriptions.
- A comp must not silently convert into a paid subscription. If billing will begin after the comp, disclose price and date and obtain required customer consent before scheduling/starting billing.
- Log creation, edits, activation, pause, redemption, grant, revocation, and expiration.

## Stripe and database integration
- Use Stripe Coupons/Promotion Codes for supported discounts and Stripe Subscription trial fields for trials where appropriate.
- Keep owner-authorized comps and grant records in the backend, linked to Stripe customer/subscription where applicable.
- Handle Stripe webhooks with signature verification and idempotency. Reconcile subscription state from trusted Stripe events/API, not localStorage.
- Store the minimum needed records: promotion definitions, redemptions, comp grants, and owner audit events. Use unique constraints for codes and redemption caps.
- Use transactions/locking or an equivalent atomic reservation pattern to enforce redemption limits.
- Never put Stripe secret keys or Supabase service-role keys in client code, logs, or Git.

## Dashboard definitions
- Collected revenue: successful payment amounts in the selected period less refunds, clearly labeling whether tax is included.
- MRR: normalized active recurring subscription value; exclude trials, canceled subscriptions, and one-time charges; define treatment of discounts consistently.
- ARR: MRR multiplied by 12, labeled as a run-rate estimate rather than cash collected.
- Complimentary/discounted value: report separately from cash revenue.
- Reconcile Stripe totals against local records and show last successful sync time; label data stale if sync fails.
- Keep goals/forecasts separate from actual results.

## Acceptance tests
- Owner can sign in with drivemetrik@gmail.com only after account invitation/verification and role assignment.
- Non-owner cannot access owner routes or platform-wide data by direct API calls.
- Shop user cannot grant themselves comp access or change plan entitlements.
- Owner can draft, preview, activate, pause, and expire an offer.
- A valid promo can be redeemed within its limits; invalid, expired, paused, wrong-plan, over-cap, and duplicate codes are rejected server-side.
- Comp grants have an end date, reason, audit record, and explicit billing-after-comp behavior.
- Stripe webhook duplicates do not double-count revenue or redemptions.
- Revenue totals match Stripe for the same date range and currency; refunds are shown separately.
- No secrets or passwords are committed; no feature is advertised as live until verified in production.

## Delivery sequence
1. Inspect current app routing, Supabase auth/RLS, Stripe checkout/webhook functions, and deployment environment.
2. Add owner route and server-side role guard.
3. Add owner data queries and dashboard views.
4. Add promotion/comp tables, constraints, RLS, and audit trail through a reviewed migration.
5. Connect Stripe promotion codes, trial behavior, webhook reconciliation, and portal links.
6. Test locally/staging with Stripe test mode and non-owner accounts.
7. Deploy only after acceptance tests pass and production secrets/configuration are verified.

Do not claim this specification itself implements, provisions, or deploys any of the above.
