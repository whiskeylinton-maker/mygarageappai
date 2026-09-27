// api/stripe-webhook.js
//
// This is the missing piece api/create-subscription-checkout.js's own comments
// pointed to: after a shop owner completes Stripe Checkout, Stripe calls this
// endpoint to say "this subscription is now active" (or later, "it was
// cancelled" / "the renewal payment failed"). Without this file, a completed
// checkout was a dead end -- money changes hands in Stripe, but nothing in
// the app ever finds out.
//
// THE HONEST LIMIT OF WHAT THIS FILE CAN DO RIGHT NOW:
// This app has no database yet (SUPABASE_URL is still empty in index.html).
// So this webhook correctly verifies each event is really from Stripe and
// correctly figures out which shop and which plan it's about -- but it has
// nowhere durable to WRITE that down. Every event is logged in detail to
// Vercel's function logs (Project -> Logs, or the get_runtime_logs tool) so
// you can see exactly who subscribed to what and reconcile manually for now.
// The moment Supabase is connected, the single block marked below is where
// a real `UPDATE shops SET ...` belongs -- everything around it (signature
// verification, event parsing, figuring out shopId/planKey) is already
// correct and won't need to change.
//
// SETUP STEPS (in addition to STRIPE_SECRET_KEY, which create-checkout-session
// and create-subscription-checkout already need):
//   1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
//   2. Endpoint URL: https://mygarageappai.com/api/stripe-webhook
//   3. Events to send: checkout.session.completed, customer.subscription.updated,
//      customer.subscription.deleted, invoice.payment_failed
//   4. Stripe shows you a signing secret (starts with whsec_...) once you save --
//      copy it into Vercel -> Settings -> Environment Variables as STRIPE_WEBHOOK_SECRET
//   5. Deploy. Do a real test subscription (or use Stripe's "Send test webhook"
//      button on the endpoint's page) and check Vercel's logs for this
//      function to confirm events are arriving and verifying correctly.

import Stripe from 'stripe';

// Signature verification needs the exact raw request bytes Stripe signed --
// if Vercel's default JSON body parser touches it first, the signature check
// fails even for genuine events. This turns that default parsing off.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error('stripe-webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET env var.');
    // Still 500 here (not a Stripe-facing concern yet, this is a deploy
    // misconfiguration) -- Stripe will retry, which is fine once fixed.
    return res.status(500).json({ error: 'Webhook not configured yet.' });
  }
  const stripe = new Stripe(secretKey);

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // A bad signature means this request did NOT genuinely come from Stripe --
    // reject it rather than trust anything in the body.
    console.error('stripe-webhook: signature verification failed:', err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const shopId = session.metadata?.shopId;
          const planKey = session.metadata?.planKey;
          const subscriptionId = session.subscription;
          const customerId = session.customer;

          console.log('SUBSCRIPTION STARTED', {
            shopId,
            planKey,
            subscriptionId,
            customerId,
            customerEmail: session.customer_details?.email,
          });

          // ---- REAL DATABASE WRITE GOES HERE ONCE SUPABASE IS CONNECTED ----
          // await supabase.from('shops').update({
          //   plan: planKey,
          //   subscription_status: 'active',
          //   stripe_customer_id: customerId,
          //   stripe_subscription_id: subscriptionId,
          // }).eq('id', shopId);
          // -------------------------------------------------------------------
        }
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        console.log('SUBSCRIPTION CREATED (Stripe object)', {
          shopId: subscription.metadata?.shopId,
          planKey: subscription.metadata?.planKey,
          status: subscription.status,
          subscriptionId: subscription.id,
        });
        // Usually checkout.session.completed above is the more useful signal
        // (it also has the Checkout Session's customer email/details), but
        // Stripe fires this one too -- logged for completeness/reconciliation.
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const shopId = subscription.metadata?.shopId;
        const planKey = subscription.metadata?.planKey;

        console.log('SUBSCRIPTION UPDATED', {
          shopId,
          planKey,
          status: subscription.status, // active, past_due, unpaid, canceled, trialing, etc.
          subscriptionId: subscription.id,
        });

        // ---- REAL DATABASE WRITE GOES HERE ONCE SUPABASE IS CONNECTED ----
        // await supabase.from('shops').update({
        //   subscription_status: subscription.status,
        // }).eq('id', shopId);
        // -------------------------------------------------------------------
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const shopId = subscription.metadata?.shopId;

        console.log('SUBSCRIPTION CANCELLED', {
          shopId,
          subscriptionId: subscription.id,
        });

        // ---- REAL DATABASE WRITE GOES HERE ONCE SUPABASE IS CONNECTED ----
        // await supabase.from('shops').update({
        //   subscription_status: 'cancelled',
        // }).eq('id', shopId);
        // -------------------------------------------------------------------
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('SUBSCRIPTION PAYMENT SUCCEEDED', {
          customerId: invoice.customer,
          subscriptionId: invoice.subscription,
          amountPaid: invoice.amount_paid, // cents
          billingReason: invoice.billing_reason, // 'subscription_create', 'subscription_cycle', etc.
        });
        // Useful mainly for renewals (billing_reason: 'subscription_cycle') --
        // the initial payment is already covered by checkout.session.completed.
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('SUBSCRIPTION PAYMENT FAILED', {
          customerId: invoice.customer,
          subscriptionId: invoice.subscription,
          attemptCount: invoice.attempt_count,
        });
        // Once email is connected: this is where a "your payment failed,
        // please update your card" email would be triggered.
        break;
      }

      default:
        // Unhandled event types are fine to ignore -- just don't error on them.
        console.log(`stripe-webhook: received unhandled event type ${event.type}`);
    }

    // Acknowledge receipt. Stripe retries on non-2xx for a while, which
    // would be pointless here since the failure (no database) won't resolve
    // itself on retry -- logging clearly and returning 200 is the honest
    // choice until Supabase is wired in.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook: error handling event:', err);
    return res.status(500).json({ error: 'Error processing webhook event.' });
  }
}
