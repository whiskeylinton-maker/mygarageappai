// api/_lib/supabase.js — shared Supabase access for DriveMetrik API routes.
// (Underscore-prefixed: Vercel does not expose this file as a route.)
//
// Security model: routes use the PUBLISHABLE anon key and forward the caller's
// Supabase Auth JWT, so every query runs AS that user and Postgres RLS enforces
// shop isolation. No service-role key is needed or used for business data.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

export const isConfigured = () => Boolean(URL && ANON);

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function anonClient() {
  if (!isConfigured()) throw httpError(503, 'Database not configured on this deployment');
  return createClient(URL, ANON, opts);
}

export function httpError(status, message) {
  const e = new Error(message); e.status = status; return e;
}

// Resolve the caller from their Bearer token (verified by Supabase Auth, not trusted
// blindly) and return a client whose every request carries that token.
export async function requireUser(req) {
  if (!isConfigured()) throw httpError(503, 'Database not configured on this deployment');
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw httpError(401, 'Not authenticated');
  const db = createClient(URL, ANON, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'Not authenticated');
  return { db, user: data.user };
}

// Tenant resolution comes from the database (employees row), never the request body.
export async function requireShop(db) {
  const { data, error } = await db.rpc('current_shop_id');
  if (error) throw error;
  if (!data) throw httpError(403, 'This user is not linked to any shop');
  return data;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Map Postgres / PostgREST errors to honest HTTP statuses without leaking internals.
export function sendError(res, err) {
  const code = err?.code;
  let status = err?.status || 400;
  let message = err?.message || 'Request failed';
  if (code === '42501') { status = 403; message = 'Not permitted'; }
  else if (code === '23503') { status = 404; message = 'Referenced record not found in this shop'; }
  else if (code === '23505') { status = 409; message = err.message?.includes('already linked') ? err.message : 'Duplicate record'; }
  else if (code === '28000') { status = 401; message = 'Not authenticated'; }
  else if (code === 'PGRST116') { status = 404; message = 'Not found'; }
  if (status >= 500) console.error('API error:', err);
  res.status(status).json({ error: message });
}
