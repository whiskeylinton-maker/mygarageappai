// api/create-subscription-checkout.js
//
// Real backend for shop owners subscribing to MyGarageAppAI itself (Shop
// $175/mo or Pro $275/mo) -- distinct from create-checkout-session.js, which
// handles a SHOP's customer paying THEIR invoice. This one is your own
// subscription revenue.
//
// THE 10% FIRST-MONTH DISCOUNT, DONE THE RIGHT WAY:
//
// This uses Stripe's own coupon system with duration: 'once' -- meaning
// Stripe itself applies the discount to exactly the first invoice, then
// automatically reverts to full price on every renewal after that. This is
// NOT something you (or this code) has to remember to "turn off" later --
// Stripe's subscription billing engine handles the reversion natively. That
// directly satisfies the requirement that this "does not require manual
// changes later."
//
// SETUP STEPS:
//   1. In Stripe Dashboard -> Product catalog, create two real Products:
//        "MyGarageAppAI - Garage Shop" with a recurring Price of $175.00/mo
//        "MyGarageAppAI - Garage Pro"   with a recurring Price of $275.00/mo
//      Copy each Price ID (starts with price_...) into the PRICE_IDS map below.
//   2. In Stripe Dashboard -> Product catalog -> Coupons, create ONE real
//      coupon: 10% off, duration = "Once". Copy its ID into FIRST_MONTH_COUPON_ID
//      below. (A single coupon works for both plans -- Stripe applies the
//      percentage to whichever price the customer is actually subscribing to.)
//   3. In Vercel -> Settings -> Environment Variables, add:
//        STRIPE_SECRET_KEY = sk_live_...  (same key used elsewhere)
//   4. Save this file as api/create-subscription-checkout.js and deploy.
//   5. Wire the two pricing-page buttons to call this endpoint:
//        subscribeNow(planKey) with useDiscount=true  -> applies the coupon
//        A plain "start subscription without the trial" path with
//        useDiscount=false is also supported below, for completeness.

import Stripe from 'stripe';

// TEST-MODE values, confirmed directly in Stripe's dashboard on Aug 30.
// These only work with a test-mode (sk_test_...) secret key. Once the full
// checkout flow is proven working end to end with these, the exact same
// products/coupon need to be recreated in LIVE mode, and these three values
// swapped for their live-mode equivalents before this can take real payments.
const PRICE_IDS = {
  start: 'price_1UAHx3EPcevq976KPZONIIOY', // Garage Shop, $175/mo (test mode)
  pro:   'price_1UAI2bEPcevq976KZV0vNEga', // Garage Pro, $275/mo (test mode)
};

const FIRST_MONTH_COUPON_ID = '92BGyp9E'; // 10% off, duration:"once" (test mode)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set in Vercel environment variables.');
    return res.status(500).json({ error: 'Payment service is not configured yet.' });
  }
  const stripe = new Stripe(secretKey);

  const { planKey, shopId, shopEmail, useDiscount } = req.body || {};
  const priceId = PRICE_IDS[planKey];
  if (!priceId) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  if (!shopId) {
    return res.status(400).json({ error: 'A shop ID is required so the webhook knows whose subscription this is.' });
  }

  const origin = req.headers.origin || 'https://mygarageappai.com';

  try {
    const sessionConfig = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // Real, server-side metadata -- this is what stripe-webhook.js reads to
      // know which shop to mark as paid/active. Never trust plan info sent
      // from the client for anything that actually grants access.
      metadata: { shopId: String(shopId), planKey },
      subscription_data: { metadata: { shopId: String(shopId), planKey } },
      success_url: `${origin}/?subscribed=1&plan=${encodeURIComponent(planKey)}`,
      cancel_url: `${origin}/?subscribeCancelled=1`,
    };
    if (shopEmail) sessionConfig.customer_email = shopEmail;

    // The actual discount logic -- one line, because Stripe does the real
    // work of expiring it after the first cycle. If useDiscount is false
    // (e.g. someone converting from a completed free trial rather than
    // skipping straight to a paid plan), this is simply omitted and they're
    // charged the regular price from day one.
    if (useDiscount) {
      sessionConfig.discounts = [{ coupon: FIRST_MONTH_COUPON_ID }];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe subscription checkout error:', err);
    return res.status(500).json({ error: 'Could not start the subscription checkout.' });
  }
}
