// Canonical live DriveMetrik subscription catalog.
// Keep these IDs aligned with the active recurring prices in Stripe Live mode.
export const BILLING_PLANS = Object.freeze({
  starter: Object.freeze({
    key: 'starter',
    label: 'DriveMetrik Starter',
    priceId: 'price_1UQV74EPcevq976Kbmk9TueO',
    priceCents: 9900,
  }),
  pro: Object.freeze({
    key: 'pro',
    label: 'DriveMetrik Pro',
    priceId: 'price_1UQVCBEPcevq976KfyJ3FcFB',
    priceCents: 19900,
  }),
  business: Object.freeze({
    key: 'business',
    label: 'DriveMetrik Business',
    priceId: 'price_1UQVAiEPcevq976K4IhqKQHZ',
    priceCents: 24900,
  }),
});

const PRICE_TO_PLAN = Object.freeze(
  Object.fromEntries(Object.values(BILLING_PLANS).map((plan) => [plan.priceId, plan.key]))
);

export function normalizePlanKey(value) {
  const key = String(value || '').trim().toLowerCase();
  // "start" was the legacy Starter key used by an earlier version of checkout.
  const normalized = key === 'start' ? 'starter' : key;
  return Object.prototype.hasOwnProperty.call(BILLING_PLANS, normalized) ? normalized : null;
}

export function inferPlanKey(subscription) {
  // The recurring Stripe price is authoritative. Metadata is a fallback for
  // older subscriptions only; it must never override the price actually billed.
  const items = subscription?.items?.data || [];
  for (const item of items) {
    const priceId = typeof item?.price === 'string' ? item.price : item?.price?.id;
    if (priceId && PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];
  }
  return normalizePlanKey(subscription?.metadata?.planKey);
}

export function isSubscriptionAccessStatus(status) {
  return ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(String(status || '').toLowerCase());
}
