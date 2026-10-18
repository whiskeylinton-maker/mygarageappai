// Canonical live DriveMetrik subscription catalog.
// Keep these IDs aligned with the active recurring prices in Stripe Live mode.
export const BILLING_PLANS = Object.freeze({
  starter: Object.freeze({
    key: 'starter',
    label: 'DriveMetrik Starter',
    priceId: 'price_1UQV74EPcevq976Kbmk9TueO',
    priceCents: 9900,
    commitmentMonths: null,
    commitmentLabel: 'Month-to-month; cancel anytime',
  }),
  pro: Object.freeze({
    key: 'pro',
    label: 'DriveMetrik Pro',
    priceId: 'price_1UQVCBEPcevq976KfyJ3FcFB',
    priceCents: 19900,
    commitmentMonths: 6,
    commitmentLabel: '6-month minimum commitment; billed monthly',
  }),
  business: Object.freeze({
    key: 'business',
    label: 'DriveMetrik Business',
    priceId: 'price_1UQVAiEPcevq976K4IhqKQHZ',
    priceCents: 24900,
    commitmentMonths: null,
    commitmentLabel: 'Month-to-month; cancel anytime',
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
  // The recurring Stripe price is authoritative. Never grant a tier for an
  // unknown price merely because its metadata claims a known plan.
  const items = subscription?.items?.data || [];
  let sawPriceId = false;
  for (const item of items) {
    const priceId = typeof item?.price === 'string' ? item.price : item?.price?.id;
    if (!priceId) continue;
    sawPriceId = true;
    if (PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];
  }
  return sawPriceId ? null : normalizePlanKey(subscription?.metadata?.planKey);
}

export function isSubscriptionAccessStatus(status) {
  return ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(String(status || '').toLowerCase());
}
