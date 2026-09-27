// POST /api/auth/refresh  { refresh_token }  -> new Supabase Auth session
import { anonClient, readBody, sendError } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { refresh_token } = readBody(req);
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });
    const { data, error } = await anonClient().auth.refreshSession({ refresh_token });
    if (error || !data.session) return res.status(401).json({ error: 'Session expired' });
    const s = data.session;
    res.status(200).json({ session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at } });
  } catch (e) { sendError(res, e); }
}
