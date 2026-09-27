// GET    /api/customers[?id=<uuid>]  -> list this shop's customers (or one)
// POST   /api/customers { id?, name, phone?, email?, address?, notes?, isFleet? }
// PATCH  /api/customers?id=<uuid> { name?, phone?, email?, address?, notes?, isFleet? }
// DELETE /api/customers?id=<uuid>
// shop_id is always set server-side from the caller's employee record; RLS double-enforces.
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
const COLS = 'id, shop_id, name, phone, email, address, notes, is_fleet, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (v) => { if (v === undefined) return undefined; const s = String(v ?? '').trim(); return s && s !== '—' ? s : null; };
export default async function handler(req, res) {
  try {
    const { db } = await requireUser(req);
    const shopId = await requireShop(db);
    const id = req.query.id;
    if (id && !UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await db.from('customers').select(COLS).eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ customer: data });
      }
      const { data, error } = await db.from('customers').select(COLS).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ customers: data });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      if (!clean(b.name)) return res.status(400).json({ error: 'Customer name is required' });
      if (b.id !== undefined && !UUID.test(String(b.id))) return res.status(400).json({ error: 'id must be a UUID' });
      const row = { shop_id: shopId, name: clean(b.name), phone: clean(b.phone) ?? null, email: clean(b.email) ?? null,
        address: clean(b.address) ?? null, notes: clean(b.notes) ?? null, is_fleet: b.isFleet === true, is_test_data: b.isTestData === true };
      if (b.id) row.id = b.id;
      const { data, error } = await db.from('customers').insert(row).select(COLS).single();
      if (error) throw error;
      return res.status(200).json({ customer: data });
    }
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      const b = readBody(req); const u = {};
      if (b.name !== undefined) { if (!clean(b.name)) return res.status(400).json({ error: 'Customer name is required' }); u.name = clean(b.name); }
      for (const k of ['phone', 'email', 'address', 'notes']) if (b[k] !== undefined) u[k] = clean(b[k]);
      if (b.isFleet !== undefined) u.is_fleet = b.isFleet === true;
      if (!Object.keys(u).length) return res.status(400).json({ error: 'Nothing to update' });
      const { data, error } = await db.from('customers').update(u).eq('id', id).select(COLS);
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ customer: data[0] });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { data, error } = await db.from('customers').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ deleted: data[0].id });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
