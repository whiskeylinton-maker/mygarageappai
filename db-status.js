// GET /api/db-status -> whether this deployment has Supabase configured (names only, never values)
import { isConfigured } from './_lib/supabase.js';
export default function handler(req, res) {
  res.status(200).json({ configured: isConfigured(), provider: 'supabase' });
}
