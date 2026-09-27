// POST /api/auth/signup  { email, password, displayName? }  -> Supabase Auth sign-up
import { anonClient, readBody, sendError } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, password, displayName } = readBody(req);
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const { data, error } = await anonClient().auth.signUp({
      email: String(email).trim().toLowerCase(), password,
      options: { data: { display_name: displayName || undefined } },
    });
    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data.session ? pickSession(data.session) : null,
      confirmationRequired: !data.session,
    });
  } catch (e) { sendError(res, e); }
}
export const pickSession = (s) => ({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
