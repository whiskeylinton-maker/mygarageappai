// Stripe webhook: verify signatures, deduplicate deliveries, and persist subscription state.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { inferPlanKey } from './_lib/billing-plans.js';

const ACCESSIBLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled', 'paused']);
const TERMINAL_STATUSES = new Set(['canceled', 'cancelled', 'incomplete_expired']);
const supabaseOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function objectId(value) {
  return typeof value === 'string' ? value : (value && typeof value.id === 'string' ? value.id : null);
}
function safeShopState(shop) {
  return {
    subscription_plan: shop.subscription_plan,
    subscription_status: shop.subscription_status,
    stripe_customer_id: shop.stripe_customer_id,
    stripe_subscription_id: shop.stripe_subscription_id,
  };
}

async function claimEvent(db, event) {
  const base = {
    id: event.id,
    type: event.type,
    stripe_created: new Date(event.created * 1000).toISOString(),
    outcome: 'processing',
    before_state: null,
    after_state: null,
  };
  const { error } = await db.from('stripe_events').insert(base);
  if (!error) return { claimed: true };
  if (error.code !== '23505') throw error;

  const { data: previous, error: readError } = await db
    .from('stripe_events').select('outcome, received_at').eq('id', event.id).maybeSingle();
  if (readError) throw readError;
  if (!previous) throw error;
  if (previous.outcome === 'processed' || previous.outcome === 'ignored_unhandled' || previous.outcome === 'ignored_stale') {
    return { claimed: false, outcome: previous.outcome };
  }

  const retryFailed = previous.outcome === 'error';
  const staleProcessing = previous.outcome === 'processing' &&
    Date.now() - new Date(previous.received_at || 0).getTime() > 5 * 60 * 1000;
  if (retryFailed || staleProcessing) {
    let q = db.from('stripe_events')
      .update({ outcome: 'processing', received_at: new Date().toISOString() })
      .eq('id', event.id).eq('outcome', previous.outcome);
    if (staleProcessing) q = q.lt('received_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    const { data: claimed, error: claimError } = await q.select('id').maybeSingle();
    if (claimError) throw claimError;
    if (claimed) return { claimed: true };
  }
  return { claimed: false, outcome: previous.outcome || 'duplicate' };
}

async function findShop(db, subscription, shopIdHint) {
  const subscriptionId = subscription.id;
  const customerId = objectId(subscription.customer);
  let query = db.from('shops')
    .select('id, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id');

  if (shopIdHint || subscription.metadata?.shopId) {
    query = query.eq('id', String(shopIdHint || subscription.metadata.shopId));
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) return data;
    throw new Error('Subscription metadata refers to a shop that does not exist.');
  }

  const { data: bySubscription, error: subError } = await query
    .eq('stripe_subscription_id', subscriptionId).maybeSingle();
  if (subError) throw subError;
  if (bySubscription) return bySubscription;
  if (!customerId) throw new Error('Cannot identify the shop for this subscription event.');

  const { data: customers, error: customerError } = await db
    .from('shops')
    .select('id, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id')
    .eq('stripe_customer_id', customerId).limit(2);
  if (customerError) throw customerError;
  if (!customers || customers.length !== 1) {
    throw new Error(customers?.length > 1
      ? 'Stripe customer ID is linked to more than one shop.'
      : 'Cannot identify the shop for this subscription event.');
  }
  return customers[0];
}

async function persistSubscription(db, subscription, shopIdHint) {
  const status = String(subscription.status || '').toLowerCase();
  if (!ACCESSIBLE_STATUSES.has(status)) throw new Error('Stripe returned an unrecognized subscription status.');
  const planKey = inferPlanKey(subscription);
  if (!planKey) throw new Error('Subscription uses a price ID that is not part of the DriveMetrik catalog.');

  const shop = await findShop(db, subscription, shopIdHint);
  const subscriptionId = subscription.id;
  const customerId = objectId(subscription.customer);
  const currentId = shop.stripe_subscription_id;
  const currentStatus = String(shop.subscription_status || '').toLowerCase();

  // Out-of-order events from an old subscription must never replace a newer,
  // still-live subscription already attached to the shop.
  if (currentId && currentId !== subscriptionId && !TERMINAL_STATUSES.has(currentStatus)) {
    return {
      outcome: 'ignored_stale',
      shopId: shop.id,
      before: safeShopState(shop),
      after: safeShopState(shop),
      reason: 'A different non-terminal subscription is already linked.',
    };
  }
  if (currentId === subscriptionId && shop.stripe_customer_id && customerId &&
      shop.stripe_customer_id !== customerId) {
    throw new Error('Subscription customer does not match the customer already linked to this shop.');
  }

  const values = {
    subscription_plan: planKey,
    subscription_status: status,
    stripe_customer_id: customerId || shop.stripe_customer_id,
    stripe_subscription_id: subscriptionId,
  };
  const { data: after, error } = await db.from('shops').update(values).eq('id', shop.id)
    .select('id, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id').single();
  if (error) throw error;
  return { outcome: 'processed', shopId: shop.id, before: safeShopState(shop), after: safeShopState(after) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    console.error('stripe-webhook: required Stripe/Supabase environment variables are missing.');
    return res.status(500).json({ error: 'Webhook is not configured.' });
  }

  let event;
  try {
    const stripe = new Stripe(stripeSecret);
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], webhookSecret);
  } catch (error) {
    console.error('stripe-webhook: signature verification failed:', error.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  const stripe = new Stripe(stripeSecret);
  const db = createClient(supabaseUrl, serviceKey, supabaseOptions);
  let claim;
  try {
    claim = await claimEvent(db, event);
    if (!claim.claimed) return res.status(200).json({ received: true, duplicate: true });

    let result = { outcome: 'ignored_unhandled', shopId: null, before: null, after: null };
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' && objectId(session.subscription)) {
        const subscriptionId = objectId(session.subscription);
        const subscription = typeof session.subscription === 'object'
          ? session.subscription
          : await stripe.subscriptions.retrieve(subscriptionId);
        result = await persistSubscription(db, subscription, session.metadata?.shopId || session.client_reference_id);
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object;
      result = await persistSubscription(db, subscription, subscription.metadata?.shopId || null);
    } else if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const subscriptionId = objectId(invoice.subscription);
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        result = await persistSubscription(db, subscription, subscription.metadata?.shopId || null);
      }
    }

    const { error: auditError } = await db.from('stripe_events').update({
      outcome: result.outcome,
      shop_id: result.shopId || null,
      before_state: result.before || null,
      after_state: result.after ? { ...result.after, reason: result.reason || null } : null,
    }).eq('id', event.id);
    if (auditError) throw auditError;
    return res.status(200).json({ received: true, outcome: result.outcome });
  } catch (error) {
    console.error('stripe-webhook: event processing failed:', event.id, event.type, error.message || error);
    try {
      await db.from('stripe_events').update({
        outcome: 'error',
        after_state: { error: String(error.message || 'Processing failed').slice(0, 500) },
      }).eq('id', event.id);
    } catch (auditError) {
      console.error('stripe-webhook: could not record processing failure:', auditError.message || auditError);
    }
    return res.status(500).json({ error: 'Webhook processing failed; Stripe may retry this event.' });
  }
}
