#!/usr/bin/env node
// DriveMetrik owner test control: free, isolated subscription testing with Stripe TEST MODE.
// Nothing here can touch live money or production data:
//   * refuses any Stripe key that is not a TEST key (sk_test_ / rk_test_)
//   * refuses the production Supabase project (bghcxpjfkdhuyqvlrxgo)
//   * every Stripe object carries metadata dm_test=true, every shop is is_test_data=true and named "[TEST] …"
//   * reset deletes ONLY is_test_data shops and dm_test Stripe test clocks
// Time-dependent scenarios (trial end, renewal, failed payment) use Stripe Test Clocks, so nothing waits 14 or 30 days.
//
// Environment: STRIPE_TEST_SECRET_KEY, TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_SITE_URL (the test deployment)
// Usage:
//   node dm-test.mjs setup                         create the test catalogue (Starter $99 / Pro $199 / Business $249 + 50% first-month coupon)
//   node dm-test.mjs shop "Name"                    create a disposable [TEST] shop + owner login in the TEST database
//   node dm-test.mjs checkout <shopId> <plan>       test-clock customer + Checkout link; pay with test card 4242 4242 4242 4242 (free)
//   node dm-test.mjs advance <shopId> <days>        move that shop's test clock forward (trial end, renewal)
//   node dm-test.mjs fail <shopId>                  switch to a test card that is declined, then advance a month -> payment failed
//   node dm-test.mjs cancel <shopId>                cancel the test subscription now
//   node dm-test.mjs status [shopId]                test shops, their billing state and the webhook outcomes
//   node dm-test.mjs reset                          delete all [TEST] shops and test clocks
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const PRODUCTION_SUPABASE_REF = 'bghcxpjfkdhuyqvlrxgo';
export const PLANS = { starter: { cents: 9900, name: 'DriveMetrik Starter (TEST)' }, pro: { cents: 19900, name: 'DriveMetrik Pro (TEST)' }, business: { cents: 24900, name: 'DriveMetrik Business (TEST)' } };
const TAG = { dm_test: 'true' };

export function assertSafe(env) {
  const key = env.STRIPE_TEST_SECRET_KEY || '';
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('Refusing to run: STRIPE_TEST_SECRET_KEY must be a Stripe TEST key (sk_test_… or rk_test_…). Live keys are never used for testing.');
  const url = env.TEST_SUPABASE_URL || '';
  if (!url || url.includes(PRODUCTION_SUPABASE_REF)) throw new Error('Refusing to run: TEST_SUPABASE_URL must be the isolated TEST project, never production.');
  if (!env.TEST_SUPABASE_SERVICE_ROLE_KEY) throw new Error('TEST_SUPABASE_SERVICE_ROLE_KEY is required (the TEST project\'s key).');
  return true;
}

// Mirrors the server's offers in api/create-subscription-checkout.js (Starter 14-day trial, Pro/Business 50% off month one).
export function checkoutConfig({ plan, priceId, couponId, customerId, shopId, site }) {
  const metadata = { shopId, planKey: plan, ...TAG };
  const cfg = { mode: 'subscription', payment_method_types: ['card'], line_items: [{ price: priceId, quantity: 1 }], customer: customerId,
    client_reference_id: shopId, metadata, subscription_data: { metadata }, payment_method_collection: 'always',
    success_url: `${site}/?subscribed=1&plan=${plan}`, cancel_url: `${site}/?subscribeCancelled=1` };
  if (plan === 'starter') cfg.subscription_data = { ...cfg.subscription_data, trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } };
  else cfg.discounts = [{ coupon: couponId }];
  return cfg;
}

async function main(argv, env) {
  assertSafe(env);
  const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY);
  const db = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const [cmd, a, b] = argv;
  const catalogue = async () => {
    const prices = {}; for (const p of Object.keys(PLANS)) { const r = await stripe.prices.list({ lookup_keys: ['dm_test_' + p], limit: 1 }); prices[p] = r.data[0]?.id; }
    const coupon = (await stripe.coupons.retrieve('DM_TEST_FIRST_MONTH_50').catch(() => null))?.id;
    return { prices, coupon };
  };
  const shopRow = async (id) => { const { data, error } = await db.from('shops').select('*').eq('id', id).eq('is_test_data', true).maybeSingle(); if (error) throw error; if (!data) throw new Error('No [TEST] shop with id ' + id); return data; };
  const subOf = async (shop) => { const subs = await stripe.subscriptions.list({ customer: shop.stripe_customer_id || (await customerFor(shop)).id, status: 'all', limit: 1 }); return subs.data[0]; };
  const customerFor = async (shop) => { const r = await stripe.customers.search({ query: `metadata['shopId']:'${shop.id}'` }); if (!r.data[0]) throw new Error('No test customer yet; run checkout first'); return r.data[0]; };

  if (cmd === 'setup') {
    for (const [k, p] of Object.entries(PLANS)) {
      const have = await stripe.prices.list({ lookup_keys: ['dm_test_' + k], limit: 1 });
      if (have.data[0]) { console.log(k, 'exists', have.data[0].id); continue; }
      const prod = await stripe.products.create({ name: p.name, metadata: TAG });
      const price = await stripe.prices.create({ product: prod.id, unit_amount: p.cents, currency: 'usd', recurring: { interval: 'month' }, lookup_key: 'dm_test_' + k, metadata: TAG });
      console.log(k, 'created', price.id);
    }
    if (!(await stripe.coupons.retrieve('DM_TEST_FIRST_MONTH_50').catch(() => null))) await stripe.coupons.create({ id: 'DM_TEST_FIRST_MONTH_50', percent_off: 50, duration: 'once', name: '50% off first month (TEST)', metadata: TAG });
    const c = await catalogue(); console.log('Set these on the TEST deployment:', JSON.stringify({ STRIPE_PRICE_STARTER: c.prices.starter, STRIPE_PRICE_PRO: c.prices.pro, STRIPE_PRICE_BUSINESS: c.prices.business, STRIPE_COUPON_FIRST_MONTH_50: c.coupon }));
  } else if (cmd === 'shop') {
    const name = '[TEST] ' + String(a || 'Disposable shop').slice(0, 60);
    const email = `dm-test+${Date.now()}@example.com`, password = 'Test-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error: ue } = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (ue) throw ue;
    const { data: s, error: se } = await db.from('shops').insert({ name, is_test_data: true, subscription_plan: 'none', subscription_status: 'needs_plan' }).select('id').single(); if (se) throw se;
    const { error: ee } = await db.from('employees').insert({ user_id: u.user.id, shop_id: s.id, role: 'shop_owner', active: true }); if (ee) throw ee;
    console.log(JSON.stringify({ shopId: s.id, name, login: email, password, note: 'TEST database only' }));
  } else if (cmd === 'checkout') {
    const shop = await shopRow(a); const plan = b; if (!PLANS[plan]) throw new Error('plan must be starter|pro|business');
    const { prices, coupon } = await catalogue(); if (!prices[plan] || !coupon) throw new Error('Run setup first');
    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `${shop.name} ${plan}`.slice(0, 300) });
    const cust = await stripe.customers.create({ name: shop.name, test_clock: clock.id, metadata: { ...TAG, shopId: shop.id, testClock: clock.id } });
    const session = await stripe.checkout.sessions.create(checkoutConfig({ plan, priceId: prices[plan], couponId: coupon, customerId: cust.id, shopId: shop.id, site: env.TEST_SITE_URL }));
    console.log('Open and pay with test card 4242 4242 4242 4242, any future date, any CVC (no real money):\n' + session.url);
  } else if (cmd === 'advance' || cmd === 'fail') {
    const shop = await shopRow(a); const cust = await customerFor(shop); const clockId = cust.metadata.testClock;
    if (cmd === 'fail') { const pm = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: cust.id }); await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm.id } }); const sub = await subOf(shop); if (sub) await stripe.subscriptions.update(sub.id, { default_payment_method: pm.id }); }
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId); const days = cmd === 'fail' ? 32 : Number(b || 30);
    await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: clock.frozen_time + days * 86400 });
    console.log(`Test clock advanced ${days} days. Stripe now sends the renewal / trial-end / failure webhooks to the test site; run status in ~30 s.`);
  } else if (cmd === 'cancel') {
    const shop = await shopRow(a); const sub = await subOf(shop); if (!sub) throw new Error('No test subscription'); await stripe.subscriptions.cancel(sub.id); console.log('Canceled', sub.id);
  } else if (cmd === 'status') {
    let q = db.from('shops').select('id,name,subscription_plan,subscription_status,stripe_subscription_id').eq('is_test_data', true); if (a) q = q.eq('id', a);
    const { data: shops, error } = await q; if (error) throw error;
    const { data: ev } = await db.from('stripe_events').select('type,outcome,shop_id,received_at').order('received_at', { ascending: false }).limit(20);
    console.log(JSON.stringify({ shops, recentWebhooks: ev }, null, 1));
  } else if (cmd === 'reset') {
    const { data: shops } = await db.from('shops').select('id').eq('is_test_data', true);
    for (const s of shops || []) { const { data: emps } = await db.from('employees').select('user_id').eq('shop_id', s.id); await db.from('shops').delete().eq('id', s.id).eq('is_test_data', true); for (const e of emps || []) await db.auth.admin.deleteUser(e.user_id); }
    for await (const c of stripe.testHelpers.testClocks.list({ limit: 100 })) await stripe.testHelpers.testClocks.del(c.id);   // deleting a clock deletes its test customers and subscriptions
    console.log(`Reset: removed ${shops?.length || 0} [TEST] shops and all test clocks.`);
  } else {
    console.log('Commands: setup | shop "Name" | checkout <shopId> <starter|pro|business> | advance <shopId> <days> | fail <shopId> | cancel <shopId> | status [shopId] | reset');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2), process.env).catch((e) => { console.error('dm-test:', e.message); process.exit(1); });
