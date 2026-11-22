// Owner Command Center: per-shop payment status (green / yellow / red / gray) and live-activity snapshot.
// Installed by scripts/command-center.mjs as api/_lib/command-center.js and called only from api/_lib/owner.js,
// i.e. after the platform-owner check (public.is_platform_owner) has passed. Nothing here is reachable by shop users.

const DAY_MS = 86400000;
const ts = (s) => (s ? new Date(s * 1000).toISOString() : null);
const idOf = (v) => (typeof v === 'string' ? v : v?.id || null);
const daysUntil = (iso, now) => (iso ? Math.ceil((new Date(iso) - now) / DAY_MS) : null);
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'in 1 day' : 'in ' + n + ' days');
const fmtDay = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const READ_ONLY_SHOP = new Set(['trial_expired', 'canceled', 'unpaid', 'past_due', 'paused', 'incomplete', 'incomplete_expired']);

// The single source of truth for the colour. GREEN is only ever returned from a live Stripe subscription that Stripe
// itself reports as active/trialing with nothing open, failed, overdue or scheduled to end.
export function classifyPayment({ shop = null, sub = null, inv = {}, billingAvailable, now = new Date() }) {
  const out = (color, label, detail = '') => ({ color, label, detail, stripeStatus: sub?.status || (billingAvailable ? 'none' : 'unknown') });
  if (shop?.isTest) return out('gray', 'Test account', 'Excluded from revenue');
  if (shop?.internal) return out('gray', 'Internal (owner) account', 'Excluded from revenue');
  if (shop?.complimentary && !shop?.stripeSubscriptionId) return out('gray', 'Complimentary', 'No charge · excluded from revenue');
  if (!billingAvailable) return { ...out('gray', 'Billing data unavailable', 'Stripe could not be read, so no payment status is shown'), stripeStatus: 'unknown' };
  if (!sub) {
    if (shop?.stripeSubscriptionId) return out('gray', 'Subscription not found in live Stripe', 'Linked id ' + shop.stripeSubscriptionId + ' is not a live subscription');
    if (shop && READ_ONLY_SHOP.has(shop.status)) return out('red', 'Access suspended: no active subscription', 'Shop status ' + shop.status);
    return out('gray', 'No Stripe subscription', shop?.status === 'needs_plan' || shop?.status === 'awaiting_plan' ? 'Has not chosen a plan' : 'Not billed through Stripe');
  }
  const s = sub.status;
  if (s === 'canceled' || s === 'incomplete_expired') return out('gray', 'Canceled', sub.canceledAt ? 'Ended ' + fmtDay(sub.canceledAt) : '');
  if (s === 'unpaid') return out('red', 'Unpaid: access suspended', 'Stripe stopped retrying the payment');
  if (s === 'past_due') return out('red', 'Past due', inv.failed ? 'Latest payment attempt failed' : 'Payment is overdue');
  if (s === 'incomplete') return out('red', 'First payment incomplete', 'The first payment never completed');
  if (s === 'paused') return out('red', 'Paused: no payment method', 'Trial ended without a card');
  if (s !== 'active' && s !== 'trialing') return out('gray', 'Unrecognized Stripe status', s);
  if (inv.failed) return out('red', 'Payment failed', 'An open invoice has a failed charge attempt');
  if (inv.overdue) return out('red', 'Invoice overdue', 'An open invoice is past its due date');
  if (sub.cancelAtPeriodEnd || sub.cancelAt) return out('yellow', 'Scheduled cancellation', 'Ends ' + fmtDay(sub.cancelAt || sub.currentPeriodEnd) + ' (will not renew)');
  if (s === 'trialing') {
    const d = daysUntil(sub.trialEnd, now);
    if (d !== null && d <= 7) return out('yellow', 'Trial ends ' + inDays(d), 'First charge ' + fmtDay(sub.trialEnd));
    return out('green', 'Trial in good standing', sub.trialEnd ? 'First charge ' + fmtDay(sub.trialEnd) : '');
  }
  if (inv.openCount > 0) return out('yellow', 'Invoice open: payment pending', 'Not yet attempted or awaiting confirmation');
  const d = daysUntil(sub.currentPeriodEnd, now);
  if (d !== null && d <= 7) return out('yellow', 'Renews ' + inDays(d), 'Scheduled renewal ' + fmtDay(sub.currentPeriodEnd) + ' (not overdue)');
  return out('green', 'Active: paid', sub.currentPeriodEnd ? 'Next renewal ' + fmtDay(sub.currentPeriodEnd) : '');
}

// Pure: builds one row per shop (plus one per live Stripe subscription that is not linked to any shop) and the
// command-center counters. Inputs are plain Stripe objects, so the build-time tests can exercise every branch.
export function buildAccounts({ shops = [], subs = {}, openInvoices = [], paidInvoices = [], customers = {}, billingAvailable, now = new Date(), from, to }) {
  const byCust = new Map();
  for (const i of openInvoices) {
    const c = idOf(i.customer); if (!c) continue;
    const r = byCust.get(c) || { outstandingCents: 0, openCount: 0, failed: false, overdue: false, oldestDue: null };
    r.outstandingCents += i.amount_remaining || 0; r.openCount += 1;
    if (i.attempted && (i.attempt_count || 0) > 0) r.failed = true;
    if (i.due_date && i.due_date * 1000 < now) { r.overdue = true; const d = ts(i.due_date); if (!r.oldestDue || d < r.oldestDue) r.oldestDue = d; }
    byCust.set(c, r);
  }
  const lastPaid = new Map();
  for (const i of paidInvoices) {
    const c = idOf(i.customer), at = i.status_transitions?.paid_at; if (!c || !at || !(i.amount_paid > 0)) continue;
    const p = lastPaid.get(c); if (!p || at > p.at) lastPaid.set(c, { at, cents: i.amount_paid });
  }
  const subByCustomer = new Map(Object.entries(subs).map(([id, s]) => [s.customer, { id, ...s }]));
  const row = (shop, sub, cust) => {
    const inv = (cust && byCust.get(cust)) || {};
    const c = classifyPayment({ shop, sub, inv, billingAvailable, now });
    const lp = cust && lastPaid.get(cust);
    const renewing = sub && sub.status === 'active' && !sub.cancelAtPeriodEnd && !sub.cancelAt;
    const nextBillingAt = !sub || !billingAvailable ? null : renewing ? sub.currentPeriodEnd : sub.status === 'trialing' && !sub.cancelAtPeriodEnd ? sub.trialEnd : null;
    const overdueDays = inv.oldestDue ? daysUntil(inv.oldestDue, now) : null;
    return {
      shopId: shop?.id || null, shopName: shop?.name || customers[cust]?.name || customers[cust]?.email || 'Unlinked Stripe customer',
      linked: !!shop, contactEmail: shop ? shop.ownerEmail || shop.shopEmail || null : customers[cust]?.email || null, contactPhone: shop?.phone || null,
      plan: shop?.plan || null, monthlyCents: sub?.monthlyCents ?? null, stripeCustomerId: cust || null, subscriptionId: sub?.id || shop?.stripeSubscriptionId || null,
      ...c,
      lastPaymentAt: billingAvailable && lp ? ts(lp.at) : null, lastPaymentCents: billingAvailable && lp ? lp.cents : null,
      nextBillingAt, daysUntilDue: billingAvailable ? (overdueDays !== null ? overdueDays : daysUntil(nextBillingAt, now)) : null,
      outstandingCents: billingAvailable && !(shop && (shop.isTest || shop.internal || (shop.complimentary && !shop.stripeSubscriptionId))) ? inv.outstandingCents || 0 : null,
      cancelAt: sub?.cancelAt || (sub?.cancelAtPeriodEnd ? sub.currentPeriodEnd : null), canceledAt: sub?.canceledAt || null, trialEnd: sub?.trialEnd || null,
      excluded: !!(shop && (shop.isTest || shop.internal || (shop.complimentary && !shop.stripeSubscriptionId))),
    };
  };
  const rows = [], seenCust = new Set();
  for (const shop of shops) {
    const sub = shop.stripeSubscriptionId ? (subs[shop.stripeSubscriptionId] ? { id: shop.stripeSubscriptionId, ...subs[shop.stripeSubscriptionId] } : null)
      : shop.stripeCustomerId ? subByCustomer.get(shop.stripeCustomerId) || null : null;
    const cust = shop.stripeCustomerId || sub?.customer || null; if (cust) seenCust.add(cust);
    rows.push(row(shop, sub, cust));
  }
  if (billingAvailable) for (const [id, s] of Object.entries(subs)) if (!seenCust.has(s.customer) && s.status !== 'canceled' && s.status !== 'incomplete_expired') rows.push(row(null, { id, ...s }, s.customer));
  const live = rows.filter((r) => !r.excluded);
  const inRange = (iso) => iso && from && to && new Date(iso) >= from && new Date(iso) <= to;
  const liveSubs = Object.values(subs).filter((s) => !rows.find((r) => r.stripeCustomerId === s.customer && r.excluded));
  const upcoming = live.filter((r) => r.color !== 'red' && r.nextBillingAt && r.daysUntilDue !== null && r.daysUntilDue >= 0 && r.daysUntilDue <= 7);
  return {
    rows,
    counts: billingAvailable ? {
      payingShops: live.filter((r) => r.stripeStatus === 'active').length,   // past-due shops are counted under failed/overdue, not as paying
      green: live.filter((r) => r.color === 'green').length, yellow: live.filter((r) => r.color === 'yellow').length,
      red: live.filter((r) => r.color === 'red').length, gray: rows.filter((r) => r.color === 'gray').length,
      upcoming7d: upcoming.length, upcoming7dCents: upcoming.reduce((s, r) => s + (r.monthlyCents || 0), 0),
      failedOrOverdue: live.filter((r) => r.color === 'red').length,
      newSubscriptions: liveSubs.filter((s) => inRange(s.created)).length,
      cancellations: liveSubs.filter((s) => inRange(s.canceledAt)).length,
      scheduledCancellations: live.filter((r) => r.label === 'Scheduled cancellation').length,
    } : null,
  };
}

export async function fetchAccounts(stripe, shops, billing, range, now = new Date()) {
  const subs = billing.subscriptions || {};
  const openInvoices = await stripe.invoices.list({ status: 'open', limit: 100 }).autoPagingToArray({ limit: 2000 });
  const paidInvoices = await stripe.invoices.list({ status: 'paid', created: { gte: Math.floor(now / 1000) - 400 * 86400 }, limit: 100 }).autoPagingToArray({ limit: 10000 });
  const linked = new Set(shops.map((s) => s.stripeCustomerId).filter(Boolean));
  const customers = {};
  for (const c of [...new Set(Object.values(subs).map((s) => s.customer))].filter((c) => c && !linked.has(c)).slice(0, 25)) {
    try { const k = await stripe.customers.retrieve(c); if (k && !k.deleted) customers[c] = { name: k.name || null, email: k.email || null }; } catch { /* name is optional */ }
  }
  return buildAccounts({ shops, subs, openInvoices, paidInvoices, customers, billingAvailable: true, now, from: range.from, to: range.to });
}

// Live activity snapshot for the owner (cheap: one RPC, no Stripe). The database computes active / idle / offline.
export async function presenceSnapshot(db) {
  const { data, error } = await db.rpc('owner_presence');
  if (error) {
    if (error.code === '42501') { const e = new Error('Not authorized.'); e.status = 403; throw e; }
    if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01')
      return { available: false, reason: 'Live activity is not switched on yet: the presence database migration has not been applied.' };
    console.error('owner presence error:', error.code || '', error.message || error);
    return { available: false, reason: 'Live activity is unavailable right now.' };
  }
  return { available: true, ...data };
}
