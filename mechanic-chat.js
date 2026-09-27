// api/mechanic-chat.js
//
// Same pattern as api/jarvis-chat.js -- this exists because sendChat() in the
// app used to call https://api.anthropic.com/v1/messages directly from the
// browser with no key attached. See api/jarvis-chat.js for the full
// explanation of why that can't work and shouldn't be "fixed" by embedding a
// key in frontend code.
//
// REQUIRED SETUP: same ANTHROPIC_API_KEY environment variable as
// api/jarvis-chat.js -- if you've already added it for that endpoint, this
// one is already covered, nothing extra to configure.

module.exports = async (req, res) => {
  // Lightweight status ping -- reports whether the API key is configured
  // WITHOUT calling Anthropic (no cost, no delay). This exists specifically
  // so the frontend can show an honest "Online" / "Setup required" status
  // instead of a hardcoded claim that might not be true.
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
    res.status(500).json({ error: 'AI Mechanic is not configured on this deployment yet (missing ANTHROPIC_API_KEY).' });
    return;
  }

  try {
    const { system, messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Missing messages' });
      return;
    }

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
        system: typeof system === 'string' ? system.slice(0, 4000) : undefined,
        messages,
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data.error);
      res.status(502).json({ error: (data.error && data.error.message) || 'AI provider error' });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('mechanic-chat error:', err);
    res.status(500).json({ error: 'Server error contacting AI Mechanic' });
  }
};
