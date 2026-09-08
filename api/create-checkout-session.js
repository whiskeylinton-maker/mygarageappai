// api/create-checkout-session.js
//
// Vercel serverless function (zero-config: Vercel auto-detects any .js file in
// an /api folder as a Node function, no build step or package.json needed).
//
// Called by payNowCreateCheckoutSession() and fleetPortalPaySelected() in the
// app. Since the app has no backend database, the frontend computes the
// authoritative amount (via docTotals()) and sends it here -- this function's
// only job is to ask Stripe to create a Checkout Session for that amount and
// hand back the URL Stripe hosts. Card details never pass through this
// function or anywhere else in MyGarageAppAI.
//
// REQUIRED SETUP (one-time, in the Vercel dashboard):
//   Project -> Settings -> Environment Variables -> add STRIPE_SECRET_KEY
//   Use the TEST key (starts with sk_test_...) first and confirm a full
//   payment end-to-end with Stripe's test card 4242 4242 4242 4242 before
//   ever switching this to the LIVE key (sk_live_...).

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ error: 'Stripe is not configured on this deployment yet (missing STRIPE_SECRET_KEY).' });
    return;
  }

  try {
    const { invoiceId, fleetId, invoiceIds, amount, description, customerEmail, successUrl, cancelUrl } = req.body || {};

    const cents = Math.round(Number(amount));
    if (!cents || cents < 50) { // Stripe's practical minimum is ~$0.50 USD
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    const origin = (req.headers && req.headers.origin) || `https://${req.headers.host}`;

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl || `${origin}/?paid=1`);
    params.append('cancel_url', cancelUrl || `${origin}/`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', description || (invoiceId ? `Invoice #${invoiceId}` : 'Payment'));
    params.append('line_items[0][price_data][unit_amount]', String(cents));
    params.append('line_items[0][quantity]', '1');
    if (customerEmail) params.append('customer_email', customerEmail);
    if (invoiceId) params.append('metadata[invoiceId]', String(invoiceId));
    if (fleetId) params.append('metadata[fleetId]', String(fleetId));
    if (invoiceIds) params.append('metadata[invoiceIds]', JSON.stringify(invoiceIds));

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe error creating checkout session:', session.error);
      res.status(502).json({ error: (session.error && session.error.message) || 'Stripe rejected the request' });
      return;
    }

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Server error creating checkout session' });
  }
};
