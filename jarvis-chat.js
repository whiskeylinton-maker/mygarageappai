// api/jarvis-chat.js
//
// Vercel serverless function (zero-config, no build step needed).
//
// This exists because dSendJarvis() in the app used to call
// https://api.anthropic.com/v1/messages directly from the browser -- which
// can't work (no key attached, and browsers block that kind of direct
// cross-origin call anyway) and would be actively dangerous if "fixed" by
// just pasting a key into the frontend, since anyone could read it out of
// the page source.
//
// This function holds the real key server-side and is the only thing that
// talks to Anthropic. The frontend only ever talks to this same origin.
//
// REQUIRED SETUP (one-time, in the Vercel dashboard):
//   Project -> Settings -> Environment Variables -> add ANTHROPIC_API_KEY
//   (an API key from https://console.anthropic.com/settings/keys)

module.exports = async (req, res) => {
  // Lightweight status ping -- see mechanic-chat.js for why this exists.
  if (req.method === 'GET') {
    res.status(200).json({ configured: !!process.env.ANTHROPIC_API_KEY });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'AI Assistant is not configured on this deployment yet (missing ANTHROPIC_API_KEY).' });
    return;
  }

  try {
    const { system, messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Missing messages' });
      return;
    }

    // Model and max_tokens are fixed here, not taken from the client --
    // this endpoint has no auth of its own, so a stranger who found the URL
    // shouldn't be able to dictate cost-relevant parameters.
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: typeof system === 'string' ? system.slice(0, 8000) : undefined,
        messages,
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data.error);
      res.status(502).json({ error: (data.error && data.error.message) || 'AI provider error' });
      return;
    }

    // Pass the response straight through -- dSendJarvis() already knows how
    // to read Anthropic's { content: [{text}] } shape.
    res.status(200).json(data);
  } catch (err) {
    console.error('jarvis-chat error:', err);
    res.status(500).json({ error: 'Server error contacting AI Assistant' });
  }
};
