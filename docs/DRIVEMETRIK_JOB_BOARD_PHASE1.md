# DriveMetrik Job Board — Claude Integration Contract

This branch is isolated from production. Do not deploy, merge, or modify production database.

## Source verification gate
Before integrating anything, compare GitHub branch source against the actual Vercel production deployment. GitHub may not contain the complete deployed source. If mismatch, stop and report missing files; never reconstruct production files from guesses.

## Job board v1
- Four columns: Estimates, In Progress, Waiting on Parts, Completed.
- Cards: RO identifier, customer, vehicle, concern, technician, amount when available, status, age.
- Filters: customer/vehicle/RO, employee, status.
- Responsive design with horizontal column scrolling on mobile.
- Existing shop sidebar retained; no changes to Stripe, auth, subscription or AI agents.
- Use existing jobs, customers, vehicles, employees, estimates and invoices; do not create parallel copies.
- No fake real-time status: use Supabase Realtime with scoped subscriptions and safe refetch, or clearly mark polling.
- All queries and mutations restricted to authorized shop_id; enforce server-side roles and RLS.
- Use optimistic concurrency or explicit conflict handling for simultaneous edits.
- Explicit status-transition map; authorization required before moving approval-dependent work into progress.
- Use exact DB columns after inspecting schema; current jobs columns: id,shop_id,customer_id,vehicle_id,technician_user_id,concern,status,created_at.
- Avoid schema changes until reviewed as a separate backward-compatible migration.
- Keep test/demo data out of real customer shops.

## Required deliverables
1. Exact source files and deployment SHA provenance.
2. Implementation diff on this branch only.
3. Screenshot of preview job board.
4. Tests for shop isolation, statuses, empty state, concurrent edits, mobile.
5. Preview URL, no production domain alias.
6. Rollback plan.

## Coordination
Claude: source reconciliation, component implementation, automated tests.
ChatGPT: database schema and permission review, acceptance criteria, independent deployment review.
Neither should overwrite the other's work. Commit in small increments.
