// /api/auth/signup | /api/auth/login | /api/auth/refresh  (all POST)
// One dynamic route instead of three files: Vercel Hobby allows max 12 functions per deploy.
import { anonClient, readBody, sendError } from '../_lib/supabase.js';

const pick = (s) => ({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });

async function signup(b) {
  const { email, password, displayName } = b;
  if (!email || !password) return [400, { error: 'Email and password are required' }];
  if (String(password).length < 8) return [400, { error: 'Password must be at least 8 characters' }];
  const { data, error } = await anonClient().auth.signUp({
    email: String(email).trim().toLowerCase(), password,
    options: { data: { display_name: displayName || undefined } },
  });
  if (error) return [400, { error: error.message }];
  return [200, {
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session ? pick(data.session) : null,
    confirmationRequired: !data.session,
  }];
}

async function login(b) {
  const { email, password } = b;
  if (!email || !password) return [400, { error: 'Email and password are required' }];
  const { data, error } = await anonClient().auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
  if (error && (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')))
    return [403, { error: 'Please confirm your email first — check your inbox for the confirmation link.' }];
  if (error || !data.session) return [401, { error: 'Invalid email or password' }];
  return [200, { user: { id: data.user.id, email: data.user.email }, session: pick(data.session) }];
}

async function refresh(b) {
  if (!b.refresh_token) return [400, { error: 'refresh_token is required' }];
  const { data, error } = await anonClient().auth.refreshSession({ refresh_token: b.refresh_token });
  if (error || !data.session) return [401, { error: 'Session expired' }];
  return [200, { session: pick(data.session) }];
}

const ACTIONS = { signup, login, refresh };

export default async function handler(req, res) {
  const fn = ACTIONS[req.query.action];
  if (!fn) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { const [status, body] = await fn(readBody(req)); res.status(status).json(body); }
  catch (e) { sendError(res, e); }
}
