// GET   /api/shop  -> the caller's shop + role (tenant resolved from employees)
// POST  /api/shop  { name, phone?, address?, taxRatePct?, ownerName?, email? } -> create first shop, caller becomes shop_owner
// PATCH /api/shop  { name?, phone?, address?, email?, taxRatePct?, ownerName? } -> owner/manager only (RLS);
//                  plan/subscription columns are not client-writable (column grants).
import { requireUser, requireShop, readBody, sendError } from './_lib/supabase.js';
const COLS = 'id, name, address, phone, email, owner_name, tax_rate_pct, subscription_plan, subscription_status, created_at';
const txt = (v) => { const s = String(v ?? '').trim(); return s ? s : null; };
export default async function handler(req, res) {
  try {
    const { db, user } = await requireUser(req);
    if (req.method === 'GET') {
      const { data: emp, error: e1 } = await db.from('employees').select('shop_id, role, active').eq('user_id', user.id).maybeSingle();
      if (e1) throw e1;
      if (!emp || !emp.active || !emp.shop_id) return res.status(200).json({ shop: null, role: null });
      const { data: shop, error: e2 } = await db.from('shops').select(COLS).eq('id', emp.shop_id).single();
      if (e2) throw e2;
      return res.status(200).json({ shop, role: emp.role });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      if (!txt(b.name)) return res.status(400).json({ error: 'Shop name is required' });
      const { data, error } = await db.rpc('create_shop', {
        p_name: String(b.name), p_phone: txt(b.phone), p_address: txt(b.address),
        p_tax_rate_pct: Number(b.taxRatePct) || 0, p_is_test_data: b.isTestData === true,
      });
      if (error) throw error;
      const extra = {};
      if (txt(b.ownerName)) extra.owner_name = txt(b.ownerName);
      if (txt(b.email)) extra.email = txt(b.email);
      if (Object.keys(extra).length) await db.from('shops').update(extra).eq('id', data.id);
      const { data: shop, error: e3 } = await db.from('shops').select(COLS).eq('id', data.id).single();
      if (e3) throw e3;
      return res.status(200).json({ shop, role: 'shop_owner' });
    }
    if (req.method === 'PATCH') {
      const shopId = await requireShop(db);
      const b = readBody(req); const u = {};
      if (b.name !== undefined) { if (!txt(b.name)) return res.status(400).json({ error: 'Shop name is required' }); u.name = txt(b.name); }
      for (const [k, col] of [['phone','phone'],['address','address'],['email','email'],['ownerName','owner_name']]) if (b[k] !== undefined) u[col] = txt(b[k]);
      if (b.taxRatePct !== undefined) { const t = Number(b.taxRatePct); if (!Number.isFinite(t) || t < 0 || t > 25) return res.status(400).json({ error: 'Invalid tax rate' }); u.tax_rate_pct = t; }
      if (!Object.keys(u).length) return res.status(400).json({ error: 'Nothing to update' });
      const { data, error } = await db.from('shops').update(u).eq('id', shopId).select(COLS);
      if (error) throw error;
      if (!data.length) return res.status(403).json({ error: 'Only the shop owner or a manager can change shop settings' });
      return res.status(200).json({ shop: data[0] });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
