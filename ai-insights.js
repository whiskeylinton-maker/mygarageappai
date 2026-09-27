// api/ai-insights.js
//
// Same pattern as api/jarvis-chat.js and api/mechanic-chat.js -- this exists
// because the AI Manager insights generator used to call
// https://api.anthropic.com/v1/messages directly from the browser with no
// key attached. See api/jarvis-chat.js for the full explanation.
//
// This one asks for JSON output, so max_tokens is higher (2000) than the
// chat endpoints -- still fixed server-side, not taken from the client.
//
// REQUIRED SETUP: same ANTHROPIC_API_KEY environment variable as the other
// two AI endpoints -- if you've already added it, nothing extra to do.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'AI Manager is not configured on this deployment yet (missing ANTHROPIC_API_KEY).' });
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
        max_tokens: 2000,
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

    res.status(200).json(data);
  } catch (err) {
    console.error('ai-insights error:', err);
    res.status(500).json({ error: 'Server error contacting AI Manager' });
  }
};
