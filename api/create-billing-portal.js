// Create a secure Stripe-hosted Customer Portal session for the caller's own shop.
import Stripe from 'stripe';
import { requireUser, requireShop, sendError } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Billing is not configured.' });

  try {
    const { db, user } = await requireUser(req);
    const shopId = await requireShop(db);
    const { data: employee, error: employeeError } = await db
      .from('employees').select('role, active')
      .eq('user_id', user.id).eq('shop_id', shopId).maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee?.active || !['shop_owner', 'manager'].includes(employee.role)) {
      return res.status(403).json({ error: 'Only a shop owner or manager can manage subscription billing.' });
    }

    const { data: shop, error: shopError } = await db
      .from('shops').select('stripe_customer_id, stripe_subscription_id')
      .eq('id', shopId).single();
    if (shopError) throw shopError;
    if (!shop.stripe_customer_id || !shop.stripe_subscription_id) {
      return res.status(409).json({ error: 'No paid subscription is linked to this shop yet.' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const params = {
      customer: shop.stripe_customer_id,
      return_url: 'https://www.drivemetrik.com/?billing=updated',
    };
    // Set this only after a Customer Portal configuration exists in Stripe Live mode.
    if (process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID) {
      params.configuration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    }
    const portalSession = await stripe.billingPortal.sessions.create(params);
    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('DriveMetrik billing portal session failed:', err);
    if (err?.status) return sendError(res, err);
    return res.status(503).json({
      error: 'The billing portal is not ready yet. Finish Customer Portal setup in Stripe Live mode and try again.',
    });
  }
}
