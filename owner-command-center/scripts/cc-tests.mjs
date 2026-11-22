// Owner Command Center regression tests. Run by scripts/command-center.mjs on every build; any failure aborts the deployment.
// All data below is in-memory test fixtures for the classifier only. Nothing is written to Stripe or the database.
import fs from 'node:fs';
const fail = (m) => { throw new Error('command-center test FAILED: ' + m); };
const ok = (c, m) => { if (!c) fail(m); };

export async function runCommandCenterTests(root = '.') {
  const out = [];
  const lib = await import(new URL('file://' + fs.realpathSync(root + '/api/_lib/command-center.js')));
  const { classifyPayment: C, buildAccounts } = lib;
  const now = new Date('2026-11-22T12:00:00Z');
  const iso = (d) => new Date(now.getTime() + d * 86400000).toISOString();
  const sec = (d) => Math.floor((now.getTime() + d * 86400000) / 1000);
  const shop = (x = {}) => ({ id: 'shop', name: 'Shop', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', status: 'active', ...x });
  const sub = (x = {}) => ({ status: 'active', customer: 'cus_1', currentPeriodEnd: iso(20), monthlyCents: 19900, ...x });
  const k = (a) => a.color + ' | ' + a.label;

  // ---- colour rules ----
  ok(C({ shop: shop(), sub: sub(), billingAvailable: true, now }).color === 'green', 'active, renews in 20 days = green');
  ok(k(C({ shop: shop(), sub: sub({ currentPeriodEnd: iso(5) }), billingAvailable: true, now })) === 'yellow | Renews in 5 days', 'renewal within 7 days = yellow renewal (not overdue)');
  ok(k(C({ shop: shop(), sub: sub({ currentPeriodEnd: iso(7) }), billingAvailable: true, now })).startsWith('yellow'), 'exactly 7 days = yellow');
  ok(C({ shop: shop(), sub: sub({ currentPeriodEnd: iso(8) }), billingAvailable: true, now }).color === 'green', '8 days = green');
  ok(k(C({ shop: shop(), sub: sub({ cancelAtPeriodEnd: true, currentPeriodEnd: iso(20) }), billingAvailable: true, now })) === 'yellow | Scheduled cancellation', 'scheduled cancellation is its own yellow state');
  ok(C({ shop: shop(), sub: sub({ status: 'trialing', trialEnd: iso(3) }), billingAvailable: true, now }).label === 'Trial ends in 3 days', 'trial ending soon = yellow');
  ok(C({ shop: shop(), sub: sub({ status: 'trialing', trialEnd: iso(20) }), billingAvailable: true, now }).color === 'green', 'trial far from ending = green');
  ok(k(C({ shop: shop(), sub: sub(), inv: { openCount: 1 }, billingAvailable: true, now })) === 'yellow | Invoice open: payment pending', 'open invoice = yellow attention');
  ok(k(C({ shop: shop(), sub: sub(), inv: { openCount: 1, failed: true }, billingAvailable: true, now })) === 'red | Payment failed', 'failed charge = red');
  ok(k(C({ shop: shop(), sub: sub(), inv: { openCount: 1, overdue: true }, billingAvailable: true, now })) === 'red | Invoice overdue', 'overdue invoice = red');
  ok(k(C({ shop: shop(), sub: sub({ status: 'past_due' }), billingAvailable: true, now })) === 'red | Past due', 'past_due = red');
  ok(C({ shop: shop(), sub: sub({ status: 'unpaid' }), billingAvailable: true, now }).color === 'red', 'unpaid = red');
  ok(C({ shop: shop(), sub: sub({ status: 'incomplete' }), billingAvailable: true, now }).color === 'red', 'incomplete = red');
  ok(C({ shop: shop(), sub: sub({ status: 'paused' }), billingAvailable: true, now }).color === 'red', 'paused = red');
  ok(k(C({ shop: shop(), sub: sub({ status: 'canceled', canceledAt: iso(-3) }), billingAvailable: true, now })) === 'gray | Canceled', 'canceled = gray');
  ok(k(C({ shop: shop({ complimentary: true, stripeSubscriptionId: null }), billingAvailable: true, now })) === 'gray | Complimentary', 'complimentary = gray');
  ok(C({ shop: shop({ isTest: true }), sub: sub(), billingAvailable: true, now }).label === 'Test account', 'test shop = gray, even with a sub');
  ok(C({ shop: shop({ internal: true }), sub: sub(), billingAvailable: true, now }).color === 'gray', 'internal owner shop = gray');
  // the most important rule: no Stripe data -> never green
  for (const s of [sub(), sub({ status: 'trialing', trialEnd: iso(30) }), sub({ status: 'past_due' })]) {
    const r = C({ shop: shop(), sub: s, billingAvailable: false, now });
    ok(r.color === 'gray' && r.label === 'Billing data unavailable' && r.stripeStatus === 'unknown', 'Stripe unavailable must be gray, never green (' + s.status + ')');
  }
  ok(C({ shop: shop(), sub: null, billingAvailable: true, now }).label === 'Subscription not found in live Stripe', 'linked id missing from live Stripe (e.g. a test-mode id) = gray, not green');
  ok(k(C({ shop: shop({ stripeSubscriptionId: null, stripeCustomerId: null, status: 'trial_expired' }), billingAvailable: true, now })) === 'red | Access suspended: no active subscription', 'read-only shop without a subscription = red');
  ok(C({ shop: shop({ stripeSubscriptionId: null, stripeCustomerId: null, status: 'needs_plan' }), billingAvailable: true, now }).color === 'gray', 'no plan chosen yet = gray');
  ok(C({ shop: shop(), sub: sub({ status: 'weird_new_status' }), billingAvailable: true, now }).color === 'gray', 'unknown Stripe status = gray');
  out.push('payment colours: 25 rules (renewal vs overdue vs scheduled cancellation; never green without live Stripe data)');

  // ---- per-shop rows and counters ----
  const shops = [
    { id: 'A', name: 'Paid Shop', ownerEmail: 'a@x.test', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', status: 'active', plan: 'pro' },
    { id: 'B', name: 'Due Soon', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b', status: 'active', plan: 'starter' },
    { id: 'C', name: 'Failed', stripeCustomerId: 'cus_c', stripeSubscriptionId: 'sub_c', status: 'past_due', plan: 'business' },
    { id: 'D', name: 'Comp', status: 'trialing', complimentary: true },
    { id: 'E', name: 'Owner HQ', status: 'trialing', internal: true, complimentary: true },
    { id: 'F', name: 'Test Shop', stripeCustomerId: 'cus_f', stripeSubscriptionId: 'sub_f', status: 'active', isTest: true },
  ];
  const subs = {
    sub_a: sub({ customer: 'cus_a', currentPeriodEnd: iso(20), created: iso(-40) }),
    sub_b: sub({ customer: 'cus_b', currentPeriodEnd: iso(2), monthlyCents: 9900, created: iso(-5) }),
    sub_c: sub({ customer: 'cus_c', status: 'past_due', currentPeriodEnd: iso(-3), monthlyCents: 24900, created: iso(-60) }),
    sub_f: sub({ customer: 'cus_f', created: iso(-2) }),
    sub_x: sub({ customer: 'cus_x', currentPeriodEnd: iso(4), monthlyCents: 9900, created: iso(-1) }),          // in Stripe, linked to no shop
    sub_old: sub({ customer: 'cus_old', status: 'canceled', canceledAt: iso(-2), created: iso(-90) }),
  };
  const openInvoices = [{ customer: 'cus_c', amount_remaining: 24900, attempted: true, attempt_count: 2, due_date: null }];
  const paidInvoices = [
    { customer: 'cus_a', amount_paid: 9950, status_transitions: { paid_at: sec(-40) } },
    { customer: 'cus_a', amount_paid: 19900, status_transitions: { paid_at: sec(-10) } },
    { customer: 'cus_a', amount_paid: 0, status_transitions: { paid_at: sec(-1) } },                                  // $0 invoice is not a payment
    { customer: 'cus_c', amount_paid: 24900, status_transitions: { paid_at: sec(-33) } },
  ];
  const from = new Date('2026-11-01T00:00:00Z'), to = now;
  const r = buildAccounts({ shops, subs, openInvoices, paidInvoices, customers: { cus_x: { name: 'Mystery LLC', email: 'm@x.test' } }, billingAvailable: true, now, from, to });
  const row = (n) => r.rows.find((x) => x.shopName === n);
  ok(row('Paid Shop').color === 'green' && row('Paid Shop').lastPaymentCents === 19900 && row('Paid Shop').lastPaymentAt === new Date(sec(-10) * 1000).toISOString(), 'last successful payment = latest paid, non-zero invoice');
  ok(row('Paid Shop').nextBillingAt === iso(20) && row('Paid Shop').daysUntilDue === 20 && row('Paid Shop').outstandingCents === 0, 'next billing date and days until due');
  ok(row('Due Soon').color === 'yellow' && row('Due Soon').daysUntilDue === 2, 'renewal in 2 days is yellow');
  ok(row('Failed').color === 'red' && row('Failed').outstandingCents === 24900, 'past due shop is red with its outstanding balance');
  ok(row('Comp').color === 'gray' && row('Comp').excluded && row('Owner HQ').excluded && row('Test Shop').excluded, 'complimentary / internal / test rows are gray and excluded');
  ok(row('Mystery LLC') && !row('Mystery LLC').linked && row('Mystery LLC').color === 'yellow', 'a live Stripe subscription with no shop is still listed (flagged unlinked)');
  ok(!r.rows.find((x) => x.stripeCustomerId === 'cus_old'), 'canceled subscriptions without a shop are not listed as live rows');
  const c = r.counts;
  ok(c.payingShops === 3, 'paying shops = Stripe active only, excluding test; past due is counted as failed (got ' + c.payingShops + ')');
  ok(row('Comp').outstandingCents === null && row('Owner HQ').outstandingCents === null, 'unbilled shops show no balance, not $0');
  ok(c.upcoming7d === 2 && c.upcoming7dCents === 19800, 'due in next 7 days: Due Soon + unlinked, red excluded (got ' + c.upcoming7d + ', ' + c.upcoming7dCents + ')');
  ok(c.failedOrOverdue === 1, 'failed or overdue count');
  ok(c.newSubscriptions === 2, 'new subscriptions this period exclude the test shop (got ' + c.newSubscriptions + ')');
  ok(c.cancellations === 1, 'cancellations this period');
  const off = buildAccounts({ shops, subs, openInvoices, paidInvoices, billingAvailable: false, now, from, to });
  ok(off.counts === null && off.rows.every((x) => x.color === 'gray') && off.rows.every((x) => x.lastPaymentAt === null && x.outstandingCents === null), 'Stripe unavailable: every row gray, no invented amounts, counters withheld');
  ok(off.rows.length === shops.length, 'Stripe unavailable: unlinked Stripe rows are not guessed');
  const none = buildAccounts({ shops: [], billingAvailable: true, now, from, to });
  ok(none.rows.length === 0 && none.counts.payingShops === 0 && none.counts.upcoming7d === 0, 'empty live account: zero, not errors');
  out.push('subscriber rows: last payment, next billing, days due, outstanding balance, unlinked Stripe customers, 7-day/failed/new/cancel counters, unavailable state');

  // ---- the patched Owner Analytics handler end to end, with an in-memory database stand-in (no network) ----
  const { handleOwner } = await import(new URL('file://' + fs.realpathSync(root + '/api/_lib/owner.js')));
  const mkRes = () => ({ code: 0, h: {}, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, setHeader(k, v) { this.h[k] = v; } });
  const fakeDb = (owner, presence) => ({ rpc: async (fn) => fn === 'is_platform_owner' ? { data: owner, error: null }
    : fn === 'owner_dashboard' ? { data: { shops: shops.slice(0, 4), users: [], feedback: [] }, error: null }
    : fn === 'owner_presence' ? presence : { data: null, error: { code: 'XX' } } });
  const savedKey = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  try {
    let res = mkRes(); await handleOwner({ method: 'GET', query: {} }, res, fakeDb(true, { data: { serverNow: now.toISOString(), sessions: [] }, error: null }));
    ok(res.code === 200 && res.body.billing.available === false && res.body.billing.accounts.rows.length === 4 && res.body.billing.accounts.rows.every((x) => x.color === 'gray'), 'no Stripe key: dashboard loads, every shop gray');
    ok(res.body.presence.available === true && res.h['Cache-Control'] === 'no-store', 'dashboard carries live activity, not cached');
    res = mkRes(); await handleOwner({ method: 'GET', query: {} }, res, fakeDb(true, { data: null, error: { code: 'PGRST202', message: 'not found' } }));
    ok(res.code === 200 && res.body.presence.available === false && /migration/.test(res.body.presence.reason), 'presence migration not applied: dashboard still loads and says why');
    res = mkRes(); await handleOwner({ method: 'GET', query: { part: 'presence' } }, res, fakeDb(true, { data: { serverNow: now.toISOString(), sessions: [{ status: 'active' }] }, error: null }));
    ok(res.code === 200 && res.body.available && res.body.sessions.length === 1, 'presence poll returns the snapshot');
    let threw = null; try { await handleOwner({ method: 'GET', query: { part: 'presence' } }, mkRes(), fakeDb(false, { data: {}, error: null })); } catch (e) { threw = e; }
    ok(threw && threw.status === 403, 'non-owner gets 403 from the presence poll');
    threw = null; try { await handleOwner({ method: 'GET', query: { part: 'presence' } }, mkRes(), fakeDb(true, { data: null, error: { code: '42501' } })); } catch (e) { threw = e; }
    ok(threw && threw.status === 403, 'database refusal (42501) is a 403, not data');
  } finally { if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY = savedKey; }
  out.push('owner handler: Stripe unavailable = all gray, presence attached, migration-missing state, owner-only presence poll');

  // ---- routing guards on the patched API (no credentials are used) ----
  const { default: handler } = await import(new URL('file://' + fs.realpathSync(root + '/api/watchtower.js')));
  const call = async (method, query, headers = {}) => { const res = { code: 0, h: {}, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, setHeader(k, v) { this.h[k] = v; } };
    await handler({ method, query, headers, url: '/api/watchtower', body: {} }, res); return res; };
  ok((await call('GET', { view: 'presence' })).code === 405, 'presence route accepts POST only');
  for (const [m, q] of [['POST', { view: 'presence' }], ['GET', { view: 'owner' }], ['GET', { view: 'owner', part: 'presence' }]]) {
    const res = await call(m, q); ok(res.code === 401 || res.code === 503, m + ' ' + JSON.stringify(q) + ' without a login must be refused (got ' + res.code + ')');
  }
  const s = fs.readFileSync(root + '/api/watchtower.js', 'utf8');
  ok(s.indexOf("view === 'presence'") < s.indexOf('requireUser(req)') && s.indexOf("is_platform_owner") < s.indexOf("view === 'owner'"), 'only the heartbeat runs before the owner check; Owner Analytics stays behind it');
  const page = fs.readFileSync(root + '/public/index.html', 'utf8');
  ok(!/sk_(live|test)_|service_role|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY/.test(fs.readFileSync(root + '/scripts/cc-ui.html', 'utf8')), 'no secrets in the browser code');
  ok(page.split('id="dm-cc-js"').length === 2 && page.split('id="dm-presence-js"').length === 2, 'command center and heartbeat injected exactly once');
  out.push('routes: heartbeat POST-only and login-only, Owner Analytics + presence owner-only, no secrets in page');
  return out;
}
