// GET  /api/shop  -> the caller's shop + role (tenant resolved from employees)
// POST /api/shop  { name, phone?, address?, taxRatePct? } -> create first shop, caller becomes shop_owner
import { requireUser, readBody, sendError } from './_lib/supabase.js';
export default async function handler(req, res) {
  try {
    const { db, user } = await requireUser(req);
    if (req.method === 'GET') {
      const { data: emp, error: e1 } = await db.from('employees').select('shop_id, role, active').eq('user_id', user.id).maybeSingle();
      if (e1) throw e1;
      if (!emp || !emp.active || !emp.shop_id) return res.status(200).json({ shop: null, role: null });
      const { data: shop, error: e2 } = await db.from('shops')
        .select('id, name, address, phone, email, tax_rate_pct, subscription_plan, subscription_status, created_at')
        .eq('id', emp.shop_id).single();
      if (e2) throw e2;
      return res.status(200).json({ shop, role: emp.role });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Shop name is required' });
      const { data, error } = await db.rpc('create_shop', {
        p_name: String(b.name), p_phone: b.phone ?? null, p_address: b.address ?? null,
        p_tax_rate_pct: b.taxRatePct ?? 0, p_is_test_data: b.isTestData === true,
      });
      if (error) throw error;
      return res.status(200).json({ shop: { id: data.id, name: data.name, subscription_plan: data.subscription_plan, subscription_status: data.subscription_status } });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { sendError(res, e); }
}
