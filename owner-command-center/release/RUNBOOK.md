# DriveMetrik release & rollback runbook

**Production:** Vercel project `mygarageappai-deploy-13` (`prj_BIwkwPALPyDIMy2DEjzLUJMluZyN`), domain `www.drivemetrik.com` (the apex redirects to www).
**Source of truth for what is live:** `production-manifest.json`, which lists every source file of the live deployment by SHA1. GitHub `main` is an older snapshot and is NOT what production runs.

## Redeploy the recorded release (e.g. after changing an environment variable)
Environment variables only take effect on a new build.
1. `node owner-command-center/tools/deploy-request.mjs preview > req.json` builds the request; it checks the inline files' SHA1s first.
2. Create the deployment with that body (Vercel connector `create_deployment`, or `POST /v13/deployments`). Build logs must show `build ok`, `owner ok`, `command-center ok` and the command-center tests.
3. Check the preview, then repeat with `production`.

## Roll back
In Vercel → Deployments, **Promote** the previous production deployment. This is instant and doesn't rebuild.
- Before the Command Center: `dpl_7iiDpuTrUswM2dJBPAH2RWGQGFyE`
- Current: `dpl_HEozbGrfqd7zpK3212SarRXRXWTj`

Database objects added by `20261122_owner_live_presence` can stay when rolling back the site; the rollback SQL is in `supabase/`.

## Make a change safely
Every build step verifies the files it edits by hash and aborts on any mismatch. Add a new `scripts/*.mjs` step (see `scripts/command-center.mjs`), never hand-edit `public/index.html`, then update this manifest from the new deployment's file list.

## Required production environment variables
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, **`SUPABASE_SERVICE_ROLE_KEY`** (webhook → database; without it no paid shop is ever activated), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (for `we_1UUQXlEPcevq976K13sC8RTI` → `https://www.drivemetrik.com/api/stripe-webhook`), `STRIPE_PRICE_STARTER/PRO/BUSINESS`, `STRIPE_COUPON_FIRST_MONTH_50`.
