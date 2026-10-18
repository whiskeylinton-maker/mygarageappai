import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivemetrik-billing-check-'));
try {
  const files = [
    'api/create-subscription-checkout.js',
    'api/create-billing-portal.js',
    'api/stripe-webhook.js',
    'api/shop.js',
    'api/_lib/billing-plans.js',
  ];
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const tempFile = path.join(tempDir, relativePath.replaceAll('/', '__') + '.mjs');
    fs.writeFileSync(tempFile, source, 'utf8');
    execFileSync(process.execPath, ['--check', tempFile], { stdio: 'inherit' });
  }

  const helperCopy = path.join(tempDir, 'billing-plans-test.mjs');
  fs.copyFileSync(path.join(root, 'api/_lib/billing-plans.js'), helperCopy);
  const plans = await import(pathToFileURL(helperCopy).href);

  assert.equal(plans.BILLING_PLANS.starter.priceId, 'price_1UQV74EPcevq976Kbmk9TueO');
  assert.equal(plans.BILLING_PLANS.starter.priceCents, 9900);
  assert.equal(plans.BILLING_PLANS.pro.priceId, 'price_1UQVCBEPcevq976KfyJ3FcFB');
  assert.equal(plans.BILLING_PLANS.pro.priceCents, 19900);
  assert.equal(plans.BILLING_PLANS.pro.commitmentMonths, 6);
  assert.equal(plans.BILLING_PLANS.business.priceId, 'price_1UQVAiEPcevq976K4IhqKQHZ');
  assert.equal(plans.BILLING_PLANS.business.priceCents, 24900);
  assert.equal(plans.normalizePlanKey('start'), 'starter');
  assert.equal(plans.normalizePlanKey('unknown'), null);
  assert.equal(plans.inferPlanKey({
    metadata: { planKey: 'starter' },
    items: { data: [{ price: { id: 'price_1UQVAiEPcevq976K4IhqKQHZ' } }] },
  }), 'business', 'Actual Stripe price must override inconsistent metadata');
  assert.equal(plans.inferPlanKey({
    metadata: { planKey: 'business' },
    items: { data: [{ price: { id: 'price_unknown' } }] },
  }), null, 'Unknown prices must never grant a known plan');
  assert.equal(plans.isSubscriptionAccessStatus('active'), true);
  assert.equal(plans.isSubscriptionAccessStatus('past_due'), true);
  assert.equal(plans.isSubscriptionAccessStatus('canceled'), false);

  const checkout = fs.readFileSync(path.join(root, 'api/create-subscription-checkout.js'), 'utf8');
  assert.ok(checkout.includes("requireUser(req)"), 'Checkout must authenticate the caller');
  assert.ok(checkout.includes("termsAccepted !== true"), 'Checkout must require explicit consent');
  assert.ok(checkout.includes("from('plan_consents')"), 'Checkout must store terms consent');
  assert.ok(checkout.includes("from('employees')"), 'Checkout must check shop role');
  assert.ok(!checkout.includes('price_1UAItNEPcevq976KlWhoWkbt'));
  assert.ok(!checkout.includes('price_1UAIvtEPcevq976KdBSF985M'));

  const webhook = fs.readFileSync(path.join(root, 'api/stripe-webhook.js'), 'utf8');
  assert.ok(webhook.includes('constructEvent'), 'Webhook must verify the Stripe signature');
  assert.ok(webhook.includes("from('stripe_events').insert"), 'Webhook must deduplicate events');
  assert.ok(webhook.includes("from('shops').update(values)"), 'Webhook must persist subscription state');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const getPlanStart = html.indexOf('function shopGetPlan(){');
  const getPlanEnd = html.indexOf('function shopCanAccess(key){', getPlanStart);
  const getPlanCode = html.slice(getPlanStart, getPlanEnd);
  assert.ok(getPlanStart >= 0 && getPlanEnd > getPlanStart);
  assert.ok(getPlanCode.includes('subscriptionStatus'));
  assert.ok(!getPlanCode.includes("return 'business';"), 'Paid Business must not be hardcoded');
  assert.ok(html.includes('/api/create-subscription-checkout'));
  assert.ok(html.includes('/api/create-billing-portal'));
  console.log('DriveMetrik billing checks passed: 5 backend modules syntax-checked; live plan mapping, consent, webhook, and entitlement assertions passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
