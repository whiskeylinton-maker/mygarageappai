// Offline tests for dm-test.mjs safety locks and offer configuration. No network calls.
import { assertSafe, checkoutConfig, PRODUCTION_SUPABASE_REF } from './dm-test.mjs';
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok:', m); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const good = { STRIPE_TEST_SECRET_KEY: 'sk_test_x', TEST_SUPABASE_URL: 'https://abcdtest.supabase.co', TEST_SUPABASE_SERVICE_ROLE_KEY: 'k' };
ok(assertSafe(good), 'test key + test project accepted');
ok(throws(() => assertSafe({ ...good, STRIPE_TEST_SECRET_KEY: 'sk_live_x' })), 'LIVE secret key refused');
ok(throws(() => assertSafe({ ...good, STRIPE_TEST_SECRET_KEY: 'rk_live_x' })), 'LIVE restricted key refused');
ok(throws(() => assertSafe({ ...good, STRIPE_TEST_SECRET_KEY: '' })), 'missing key refused');
ok(throws(() => assertSafe({ ...good, TEST_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` })), 'PRODUCTION database refused');
ok(throws(() => assertSafe({ ...good, TEST_SUPABASE_SERVICE_ROLE_KEY: '' })), 'missing test DB key refused');
const base = { priceId: 'price_t', couponId: 'DM_TEST_FIRST_MONTH_50', customerId: 'cus_t', shopId: 's1', site: 'https://test.example' };
const st = checkoutConfig({ ...base, plan: 'starter' });
ok(st.subscription_data.trial_period_days === 14 && !st.discounts && st.payment_method_collection === 'always', 'Starter: 14-day trial, card required, no discount');
for (const p of ['pro', 'business']) { const c = checkoutConfig({ ...base, plan: p }); ok(c.discounts?.[0]?.coupon === 'DM_TEST_FIRST_MONTH_50' && !c.subscription_data.trial_period_days, p + ': 50% off first month, no trial'); }
ok(st.metadata.dm_test === 'true' && st.subscription_data.metadata.dm_test === 'true' && st.metadata.shopId === 's1', 'every test object labelled dm_test and linked to its shop');
