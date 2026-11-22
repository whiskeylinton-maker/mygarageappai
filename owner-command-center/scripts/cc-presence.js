// Live-activity heartbeat for EVERY signed-in DriveMetrik user. Installed as api/_lib/presence.js and routed from
// api/watchtower.js (?view=presence) so no new serverless function is needed (the project is at its 12-function limit).
// It can only write the caller's own presence row: identity comes from the verified Supabase JWT and the database
// function public.presence_heartbeat() writes auth.uid()'s row only. It returns nothing about anyone else.
import { requireSession, readBody, httpError } from './supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handlePresenceBeat(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const { db } = await requireSession(req);                         // 401 unless a valid login; works for read-only shops too
  const b = readBody(req);
  if (!UUID.test(String(b.session || ''))) throw httpError(400, 'Invalid request.');
  const { error } = await db.rpc('presence_heartbeat', {
    p_session: b.session,
    p_page: typeof b.page === 'string' ? b.page.slice(0, 60) : null,
    p_active: b.active === true,
    p_device: typeof b.device === 'string' ? b.device.slice(0, 12) : null,
    p_end: b.end === true,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01')
      return res.status(503).json({ error: 'Presence is not enabled yet.', code: 'presence_disabled' });
    if (error.code === '22023') throw httpError(400, 'Invalid request.');
    if (error.code === '28000') throw httpError(401, 'Not authenticated');
    throw error;
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(204).end();
}
