// Create a recurring DriveMetrik subscription checkout for the authenticated shop.
import Stripe from 'stripe';
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
import { BILLING_PLANS, normalizePlanKey } from './_lib/billing-plans.js';

const ACTIVE_SUBSCRIPTION_STATES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Subscription billing is not configured.' });

  try {
    const { db, user } = await requireUser(req);
    const shopId = await requireShop(db);
    const body = readBody(req);
    const planKey = normalizePlanKey(body.planKey);
    if (!planKey) return res.status(400).json({ error: 'Choose Starter, Pro, or Business.' });
    if (body.termsAccepted !== true) {
      return res.status(400).json({ error: 'Please confirm the monthly subscription terms before continuing.' });
    }

    const { data: employee, error: employeeError } = await db
      .from('employees').select('role, active')
      .eq('user_id', user.id).eq('shop_id', shopId).maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee?.active || !['shop_owner', 'manager'].includes(employee.role)) {
      return res.status(403).json({ error: 'Only a shop owner or manager can change subscription billing.' });
    }

    const { data: shop, error: shopError } = await db
      .from('shops')
      .select('id, name, email, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id')
      .eq('id', shopId).single();
    if (shopError) throw shopError;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    if (shop.stripe_subscription_id) {
      // Do not start a second recurring charge while an existing subscription
      // still exists, even if the local status is stale.
      try {
        const current = await stripe.subscriptions.retrieve(shop.stripe_subscription_id);
        if (ACTIVE_SUBSCRIPTION_STATES.has(current.status)) {
          return res.status(409).json({ error: 'This shop already has a subscription. Use Manage Billing to change or cancel it.' });
        }
      } catch (err) {
        if (err?.code !== 'resource_missing') throw err;
      }
    }

    const plan = BILLING_PLANS[planKey];
    const termsVersion = String(body.termsVersion || 'drivemetrik-recurring-v1').slice(0, 100);
    const { data: consent, error: consentError } = await db
      .from('plan_consents')
      .insert({
        shop_id: shopId,
        user_id: user.id,
        plan_key: planKey,
        price_cents: plan.priceCents,
        terms_version: termsVersion,
        details: {
          price_id: plan.priceId,
          currency: 'usd',
          interval: 'month',
          accepted_via: 'subscription_checkout',
          user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        },
      })
      .select('id').single();
    if (consentError) throw consentError;

    const metadata = {
      shopId: String(shopId),
      planKey,
      termsVersion,
      consentId: consent.id,
    };
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: plan.priceId, quantity: 1 }],
      client_reference_id: String(shopId),
      metadata,
      subscription_data: { metadata },
      success_url: 'https://www.drivemetrik.com/?subscribed=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.drivemetrik.com/?subscribeCancelled=1',
      allow_promotion_codes: true,
    };
    if (shop.stripe_customer_id) sessionParams.customer = shop.stripe_customer_id;
    else if (shop.email || user.email) sessionParams.customer_email = shop.email || user.email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return res.status(200).json({ url: session.url, plan: planKey, priceCents: plan.priceCents });
  } catch (err) {
    console.error('DriveMetrik subscription checkout failed:', err);
    if (err?.status) return sendError(res, err);
    return res.status(502).json({ error: 'Could not start secure checkout. No charge was made; please try again.' });
  }
}
