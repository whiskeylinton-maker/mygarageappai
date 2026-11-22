#!/bin/sh
# Production build chain (unchanged order) + the Owner Command Center step. Any failing step aborts the build.
set -e
node scripts/build.mjs
node scripts/tablet.mjs
node scripts/jobs.mjs
node scripts/aigate.mjs
node scripts/offers.mjs
node scripts/security.mjs
node scripts/owner.mjs
node scripts/coupons.mjs
node scripts/feedback.mjs
node scripts/command-center.mjs
