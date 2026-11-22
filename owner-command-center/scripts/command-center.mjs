// scripts/command-center.mjs -- runs LAST in the build chain (after scripts/feedback.mjs). Owner Command Center v1:
// live activity (who is online), red/yellow/green payment monitor, shop drill-down, inside the existing Owner Analytics.
// Additive only. Every file it changes must first hash to the exact reviewed version, every edit must match exactly once,
// and the tests must pass, or the build aborts and nothing is deployed.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const h = (alg, b) => createHash(alg).update(b).digest('hex');
const fail = (m) => { throw new Error('command-center: ' + m); };
const swap = (s, find, repl, file) => { const n = s.split(find).length - 1; if (n !== 1) fail(`${file}: expected 1 match, found ${n}: ${find.slice(0, 80)}`); return s.replace(find, () => repl); };

const PIN = JSON.parse(fs.readFileSync('scripts/command-center.pins.json', 'utf8'));
for (const [f, sha] of Object.entries(PIN.own)) if (h('sha256', fs.readFileSync(f)) !== sha) fail(f + ' is not the tested version');
for (const [f, sha] of Object.entries(PIN.inputs)) if (h('sha1', fs.readFileSync(f)) !== sha) fail(f + ' is not the reviewed version (it changed since this step was written)');
for (const f of ['api/_lib/command-center.js', 'api/_lib/presence.js']) if (fs.existsSync(f)) fail(f + ' already exists');

// 1) identity-only helper for the heartbeat (no read-only write gate; it only ever writes the caller's own presence row)
let sb = fs.readFileSync('api/_lib/supabase.js', 'utf8');
sb = swap(sb, "  await assertCanWrite(db, req);\n  return { db, user: data.user };\n}\n", `  await assertCanWrite(db, req);
  return { db, user: data.user };
}

// Identity check only, without the read-only write gate. Used solely by the live-activity heartbeat (api/_lib/presence.js),
// which must keep working for read-only shops and can only write the caller's own presence row.
export async function requireSession(req) {
  if (!isConfigured()) throw httpError(503, 'Database not configured on this deployment');
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw httpError(401, 'Not authenticated');
  const db = createClient(URL, ANON, { ...opts, global: { headers: { Authorization: \`Bearer \${token}\` } } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'Not authenticated');
  return { db, user: data.user };
}
`, 'supabase.js');
fs.writeFileSync('api/_lib/supabase.js', sb);

// 2) server modules
fs.copyFileSync('scripts/cc-lib.js', 'api/_lib/command-center.js');
fs.copyFileSync('scripts/cc-presence.js', 'api/_lib/presence.js');

// 3) Owner Analytics API: per-shop payment rows + live activity (both behind the existing platform-owner check)
let ow = fs.readFileSync('api/_lib/owner.js', 'utf8');
ow = swap(ow, "import { readBody, httpError } from './supabase.js';\n",
  "import { readBody, httpError } from './supabase.js';\nimport { fetchAccounts, buildAccounts, presenceSnapshot } from './command-center.js';\n", 'owner.js');
ow = swap(ow, "trialEnd: ts(s.trial_end), priceCents: price?.unit_amount ?? null };",
  "trialEnd: ts(s.trial_end), priceCents: price?.unit_amount ?? null,\n      monthlyCents: Math.round(monthly), interval: price?.recurring?.interval || null, created: ts(s.created) };", 'owner.js');
ow = swap(ow, "  if (req.method === 'GET' && req.query?.probe === '1') return res.status(200).json({ owner: true });\n",
  "  if (req.method === 'GET' && req.query?.probe === '1') return res.status(200).json({ owner: true });\n" +
  "  if (req.method === 'GET' && req.query?.part === 'presence') { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(await presenceSnapshot(db)); }   // live activity poll (no Stripe calls)\n", 'owner.js');
ow = swap(ow, "    try { billing = await billingSummary(new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }), dash.shops || [], range); }\n",
  "    try {\n      const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });\n      billing = await billingSummary(stripe, dash.shops || [], range);\n" +
  "      try { billing.accounts = await fetchAccounts(stripe, dash.shops || [], billing, range); }\n" +
  "      catch (e) { console.error('owner accounts error:', e?.type || '', e?.message || e); billing.accounts = buildAccounts({ shops: dash.shops || [], billingAvailable: false }); billing.accountsError = 'Per-shop payment details are unavailable: Stripe could not be reached.'; }\n    }\n", 'owner.js');
ow = swap(ow, "  res.setHeader('Cache-Control', 'no-store');\n  return res.status(200).json({ ...dash, billing, generatedAt: new Date().toISOString() });\n",
  "  if (!billing.available) billing.accounts = buildAccounts({ shops: dash.shops || [], billingAvailable: false });   // every shop gray: never a healthy colour without Stripe\n" +
  "  let presence;\n  try { presence = await presenceSnapshot(db); } catch (e) { if (e?.status === 403) throw e; presence = { available: false, reason: 'Live activity is unavailable right now.' }; }\n" +
  "  res.setHeader('Cache-Control', 'no-store');\n  return res.status(200).json({ ...dash, billing, presence, generatedAt: new Date().toISOString() });\n", 'owner.js');
fs.writeFileSync('api/_lib/owner.js', ow);

// 4) route: the heartbeat is the ONLY thing reachable before the platform-owner check, and it needs a valid login
let wt = fs.readFileSync('api/watchtower.js', 'utf8');
wt = swap(wt, "import { handleOwner } from './_lib/owner.js';\n", "import { handleOwner } from './_lib/owner.js';\nimport { handlePresenceBeat } from './_lib/presence.js';\n", 'watchtower.js');
wt = swap(wt, "    const { db } = await requireUser(req); // 401 unless a valid login\n",
  "    if (req.query?.view === 'presence') return await handlePresenceBeat(req, res); // any signed-in user: own live-activity heartbeat only\n    const { db } = await requireUser(req); // 401 unless a valid login\n", 'watchtower.js');
fs.writeFileSync('api/watchtower.js', wt);

// 5) page: the command center renders at the top of the existing Owner Analytics screen; shop names open the drill-down
let p = fs.readFileSync('public/index.html', 'utf8');
if (p.split('id="dm-owner-js"').length !== 2 || p.includes('id="dm-cc-js"') || p.includes('id="dm-presence-js"')) fail('unexpected page structure');
p = swap(p, "    var shops=data.shops||[], now=Date.now(), b=data.billing||{};\n",
  "    var shops=data.shops||[], now=Date.now(), b=data.billing||{};\n    if(window.dmCC) h+=window.dmCC.render(data,{from:f.from,to:f.to});\n", 'index.html');
p = swap(p, "return '<tr><td><b>'+esc(s.name)+'</b></td><td>'+esc(s.ownerEmail||s.shopEmail||'—')",
  "return '<tr><td><b><a class=\"dmcc-link\" onclick=\"window.dmCC&&dmCC.openShop(\\''+s.id+'\\')\">'+esc(s.name)+'</a></b></td><td>'+esc(s.ownerEmail||s.shopEmail||'—')", 'index.html');
p = swap(p, "h+='<div class=\"dmo-h\">Subscribers</div>", "h+='<div class=\"dmo-h\">Subscriber details</div>", 'index.html');
const i = p.lastIndexOf('</body>'); if (i < 0) fail('no </body>');
p = p.slice(0, i) + fs.readFileSync('scripts/cc-ui.html', 'utf8') + p.slice(i);
fs.writeFileSync('public/index.html', p);

// 6) tests: the patched route loads, the existing owner billing tests still pass, then the command-center tests
await import(new URL('../api/watchtower.js', import.meta.url));
const { runOwnerTests } = await import(new URL('./owner-tests.mjs', import.meta.url));
for (const line of await runOwnerTests('.')) console.log('command-center: existing owner test still ok:', line);
const { runCommandCenterTests } = await import(new URL('./cc-tests.mjs', import.meta.url));
for (const line of await runCommandCenterTests('.')) console.log('command-center test ok:', line);
console.log('command-center ok: page ' + Buffer.byteLength(p) + ' bytes; watchtower.js sha1 ' + h('sha1', wt) + '; owner.js sha1 ' + h('sha1', ow));
