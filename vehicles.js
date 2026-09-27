// GET    /api/vehicles[?ownerId=<uuid>]
// POST   /api/vehicles { id?, ownerId, year?, make?, model?, trim?, engine?, drivetrain?, color?, vin?, licensePlate?, plateState?, mileage? }
// PATCH  /api/vehicles?id=<uuid> { any of the above }
// DELETE /api/vehicles?id=<uuid>
// Owner must belong to the caller's shop: checked here AND by the (owner_id, shop_id) composite FK.
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
const COLS = 'id, shop_id, owner_id, year, make, model, trim, engine, drivetrain, color, vin, license_plate, plate_state, mileage, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const int = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const txt = (v) => { const s = String(v ?? '').trim(); return s && s !== '—' ? s : null; };
function fields(b) {
  const u = {};
  if (b.year !== undefined) u.year = int(b.year);
  if (b.mileage !== undefined) u.mileage = int(b.mileage);
  for (const [k, col] of [['make','make'],['model','model'],['trim','trim'],['engine','engine'],['drivetrain','drivetrain'],['color','color'],['licensePlate','license_plate'],['plateState','plate_state']])
    if (b[k] !== undefined) u[col] = txt(b[k]);
  if (b.vin !== undefined) { const v = txt(b.vin); u.vin = v ? v.toUpperCase() : null; }
  return u;
}
async function ownerInShop(db, ownerId) {
  if (!UUID.test(String(ownerId || ''))) return false;
  const { data, error } = await db.from('customers').select('id').eq('id', ownerId).maybeSingle();
  if (error) throw error;
  return !!data;
}
export default async function handler(req, res) {
  try {
    const { db } = await requireUser(req);
    const shopId = await requireShop(db);
    const id = req.query.id;
    if (id && !UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    if (req.method === 'GET') {
      let q = db.from('vehicles').select(COLS).order('created_at', { ascending: false });
      if (req.query.ownerId) { if (!UUID.test(req.query.ownerId)) return res.status(200).json({ vehicles: [] }); q = q.eq('owner_id', req.query.ownerId); }
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ vehicles: data });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      if (!b.ownerId) return res.status(400).json({ error: 'ownerId is required' });
      if (b.id !== undefined && !UUID.test(String(b.id))) return res.status(400).json({ error: 'id must be a UUID' });
      if (!(await ownerInShop(db, b.ownerId))) return res.status(404).json({ error: 'Customer not found in this shop' });
      const row = { shop_id: shopId, owner_id: b.ownerId, is_test_data: b.isTestData === true, ...fields(b) };
      if (b.id) row.id = b.id;
      const { data, error } = await db.from('vehicles').insert(row).select(COLS).single();
      if (error) throw error;
      return res.status(200).json({ vehicle: data });
    }
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      const b = readBody(req); const u = fields(b);
      if (b.ownerId !== undefined) {
        if (!(await ownerInShop(db, b.ownerId))) return res.status(404).json({ error: 'Customer not found in this shop' });
        u.owner_id = b.ownerId;
      }
      if (!Object.keys(u).length) return res.status(400).json({ error: 'Nothing to update' });
      const { data, error } = await db.from('vehicles').update(u).eq('id', id).select(COLS);
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ vehicle: data[0] });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data, error } = await db.from('vehicles').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ deleted: data[0].id });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
