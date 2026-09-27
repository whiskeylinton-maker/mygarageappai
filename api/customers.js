// GET    /api/customers            -> list this shop's customers
// POST   /api/customers { name, phone?, email?, address?, notes?, isFleet? }
// DELETE /api/customers?id=<uuid>
// shop_id is always set server-side from the caller's employee record; RLS double-enforces.
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
const COLS = 'id, shop_id, name, phone, email, address, notes, is_fleet, created_at';
export default async function handler(req, res) {
  try {
    const { db } = await requireUser(req);
    const shopId = await requireShop(db);
    if (req.method === 'GET') {
      if (req.query.id) {
        const { data, error } = await db.from('customers').select(COLS).eq('id', req.query.id).maybeSingle();
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
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Customer name is required' });
      const { data, error } = await db.from('customers').insert({
        shop_id: shopId, name: String(b.name).trim(), phone: b.phone || null, email: b.email || null,
        address: b.address || null, notes: b.notes || null, is_fleet: b.isFleet === true, is_test_data: b.isTestData === true,
      }).select(COLS).single();
      if (error) throw error;
      return res.status(200).json({ customer: data });
    }
    if (req.method === 'DELETE') {
      if (!req.query.id) return res.status(400).json({ error: 'id is required' });
      const { data, error } = await db.from('customers').delete().eq('id', req.query.id).select('id');
      if (error) throw error;
      if (!data.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ deleted: data[0].id });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
