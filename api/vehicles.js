// GET    /api/vehicles[?ownerId=<uuid>]
// POST   /api/vehicles { ownerId, year?, make?, model?, trim?, vin?, licensePlate?, plateState?, mileage? }
// DELETE /api/vehicles?id=<uuid>
// Owner must belong to the caller's shop: checked here AND by the (owner_id, shop_id) composite FK.
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
const COLS = 'id, shop_id, owner_id, year, make, model, trim, vin, license_plate, plate_state, mileage, created_at';
const int = (v) => (v === undefined || v === null || v === '' ? null : Number.parseInt(v, 10));
export default async function handler(req, res) {
  try {
    const { db } = await requireUser(req);
    const shopId = await requireShop(db);
    if (req.method === 'GET') {
      let q = db.from('vehicles').select(COLS).order('created_at', { ascending: false });
      if (req.query.ownerId) q = q.eq('owner_id', req.query.ownerId);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ vehicles: data });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      if (!b.ownerId) return res.status(400).json({ error: 'ownerId is required' });
      const { data: owner, error: oe } = await db.from('customers').select('id').eq('id', b.ownerId).maybeSingle();
      if (oe) throw oe;
      if (!owner) return res.status(404).json({ error: 'Customer not found in this shop' });
      const { data, error } = await db.from('vehicles').insert({
        shop_id: shopId, owner_id: b.ownerId, year: int(b.year), make: b.make || null, model: b.model || null,
        trim: b.trim || null, vin: b.vin ? String(b.vin).toUpperCase() : null, license_plate: b.licensePlate || null,
        plate_state: b.plateState || null, mileage: int(b.mileage), is_test_data: b.isTestData === true,
      }).select(COLS).single();
      if (error) throw error;
      return res.status(200).json({ vehicle: data });
    }
    if (req.method === 'DELETE') {
      if (!req.query.id) return res.status(400).json({ error: 'id is required' });
      const { data, error } = await db.from('vehicles').delete().eq('id', req.query.id).select('id');
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ deleted: data[0].id });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
