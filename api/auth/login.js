// POST /api/auth/login  { email, password }  -> Supabase Auth session
import { anonClient, readBody, sendError } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, password } = readBody(req);
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const { data, error } = await anonClient().auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
    if (error || !data.session) return res.status(401).json({ error: 'Invalid email or password' });
    const s = data.session;
    res.status(200).json({
      user: { id: data.user.id, email: data.user.email },
      session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at },
    });
  } catch (e) { sendError(res, e); }
}
