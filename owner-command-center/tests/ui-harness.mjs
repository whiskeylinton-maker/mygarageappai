// Builds a LOCAL-ONLY page that runs the real Owner Analytics + Command Center code against illustrative fixtures,
// then drives it with Playwright at desktop / tablet / phone widths. Nothing here talks to production.
import fs from 'node:fs'; import path from 'node:path';
const [buildDir, outDir] = process.argv.slice(2);
const { buildAccounts } = await import(path.resolve(buildDir, 'api/_lib/command-center.js'));
const now = new Date(); const iso = (d) => new Date(now.getTime() + d * 86400000).toISOString(); const isoS = (s) => new Date(now.getTime() - s * 1000).toISOString();
const shops = [
  { id: 's-a', name: 'Example Shop A (fixture)', ownerEmail: 'a@example.test', phone: '555-0100', plan: 'pro', status: 'active', createdAt: iso(-60), stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a' },
  { id: 's-b', name: 'Example Shop B (fixture)', ownerEmail: 'b@example.test', plan: 'starter', status: 'active', createdAt: iso(-20), stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b' },
  { id: 's-c', name: 'Example Shop C (fixture)', ownerEmail: 'c@example.test', plan: 'business', status: 'past_due', createdAt: iso(-90), stripeCustomerId: 'cus_c', stripeSubscriptionId: 'sub_c' },
  { id: 's-d', name: 'Example Shop D (fixture)', ownerEmail: 'd@example.test', plan: 'trial', status: 'trialing', createdAt: iso(-50), complimentary: true },
  { id: 's-e', name: 'Owner HQ (fixture)', plan: 'trial', status: 'trialing', createdAt: iso(-40), internal: true, complimentary: true },
];
const subs = { sub_a: { status: 'active', customer: 'cus_a', currentPeriodEnd: iso(18), monthlyCents: 19900, created: iso(-60) },
  sub_b: { status: 'active', customer: 'cus_b', currentPeriodEnd: iso(3), monthlyCents: 9900, created: iso(-20) },
  sub_c: { status: 'past_due', customer: 'cus_c', currentPeriodEnd: iso(-4), monthlyCents: 24900, created: iso(-90) } };
const sec = (d) => Math.floor((now.getTime() + d * 86400000) / 1000);
const accounts = buildAccounts({ shops, subs, billingAvailable: true, now, from: new Date(now.getFullYear(), now.getMonth(), 1), to: now,
  openInvoices: [{ customer: 'cus_c', amount_remaining: 24900, attempted: true, attempt_count: 3 }],
  paidInvoices: [{ customer: 'cus_a', amount_paid: 19900, status_transitions: { paid_at: sec(-12) } }, { customer: 'cus_b', amount_paid: 9900, status_transitions: { paid_at: sec(-27) } }] });
const users = [
  { userId: 'u1', email: 'a@example.test', role: 'shop_owner', shopId: 's-a', lastSignInAt: isoS(3600) },
  { userId: 'u2', email: 'tech1@example.test', role: 'technician', shopId: 's-a', lastSignInAt: isoS(7200) },
  { userId: 'u3', email: 'b@example.test', role: 'shop_owner', shopId: 's-b', lastSignInAt: isoS(9000) },
  { userId: 'u4', email: 'c@example.test', role: 'manager', shopId: 's-c', lastSignInAt: isoS(86400 * 3) },
];
const sess = (sid, u, st, page, dev, seen, act) => ({ sessionId: sid, userId: u.userId, email: u.email, name: u.email.split('@')[0], role: u.role, shopId: u.shopId,
  shopName: shops.find((s) => s.id === u.shopId).name, lastSignInAt: u.lastSignInAt, startedAt: isoS(seen + 1800), lastSeenAt: isoS(seen), lastActiveAt: act == null ? null : isoS(act), page, device: dev, status: st });
const presence = { available: true, serverNow: now.toISOString(), thresholds: { offlineAfterSeconds: 150, idleAfterSeconds: 300 }, sessions: [
  sess('p1', users[0], 'active', 'invoices', 'desktop', 12, 40), sess('p2', users[0], 'idle', 'dashboard', 'tablet', 25, 900),
  sess('p3', users[1], 'active', 'jobs', 'mobile', 8, 15), sess('p4', users[2], 'idle', 'schedule', 'desktop', 20, 700), sess('p5', users[3], 'offline', 'customers', 'desktop', 4000, 4100)] };
const dash = { shops, users, feedback: [{ id: 'f1', kind: 'complaint', body: 'Fixture message: invoice PDF is slow to load.', status: 'new', createdAt: isoS(5000), shopId: 's-b', shopName: shops[1].name, fromEmail: 'b@example.test' }],
  billingProblems: [], promoClaims: [], openAlerts: 0,
  billing: { available: true, syncedAt: now.toISOString(), livemode: true, mrrCents: 54700, collectedCents: 29800, payments: 2, refundedCents: 0, netCollectedCents: 29800, stripeFeeCents: 0, payoutCents: 0, subscriptions: subs, accounts },
  presence, generatedAt: now.toISOString() };
const mode = process.argv[4] || 'ok';
if (mode === 'down') { dash.billing = { available: false, reason: 'Billing data is unavailable: the payment connection is not configured on this deployment.', accounts: buildAccounts({ shops, billingAvailable: false }) }; dash.presence = { available: false, reason: 'Live activity is not switched on yet: the presence database migration has not been applied.' }; }
const built = fs.readFileSync(path.join(buildDir, 'public/index.html'), 'utf8');
const body = built.slice(built.indexOf('<body>') + 6, built.lastIndexOf('</body>'));
const stub = `<style>:root{--bg-elevated:#161b22;--bg-panel:#0f141a;--bg-input:#0b0f14;--border-subtle:#2a313c;--border-mid:#3a4350;--text-hi:#e6e9ee;--text-low:#8b95a5;--blue-bright:#3b82f6}
body{margin:0;background:#0b0f14;color:#e6e9ee;font:14px system-ui,sans-serif}#desktopShell{display:flex}.d-sidebar-scroll{width:180px;padding:8px;border-right:1px solid #2a313c;min-height:100vh}
.d-nav-item{padding:6px;display:flex;gap:6px;cursor:pointer}#dMain{flex:1;padding:14px;min-width:0}.btn{background:#1f2630;color:#e6e9ee;border:1px solid #3a4350;border-radius:7px;padding:5px 9px}
.d-topbar{display:flex;justify-content:space-between;align-items:center}.d-title{font-weight:800;font-size:18px}@media(max-width:700px){.d-sidebar-scroll{display:none}}</style>
<script>window.__calls=[];window.DM_ACCESS={state:'active'};var DM_CLOUD=true;let dNav={screen:'dashboard',params:{}};var FIX=${JSON.stringify(dash)};
function dmGetSession(){return {access_token:'local-test',expires_at:Date.now()/1000+3600};} function dmSetSession(s){}
async function dmApi(m,p,b){ window.__calls.push(m+' '+p); if(p.indexOf('probe=1')>0) return {ok:true,status:200,data:{owner:true}};
 if(p.indexOf('part=presence')>0) return window.__presenceDown?{ok:false,status:500,data:{error:'server error'}}:{ok:true,status:200,data:FIX.presence};
 if(p.indexOf('view=presence')>0) return {ok:true,status:204,data:null};
 if(m==='POST'&&p.indexOf('view=owner')>0){ var it=FIX.feedback.find(function(x){return x.id===b.feedbackId;}); if(it) it.status=b.status; return {ok:true,status:200,data:{feedback:{id:b.feedbackId,status:b.status}}}; }
 if(p.indexOf('view=owner')>0) return {ok:true,status:200,data:JSON.parse(JSON.stringify(FIX))}; return {ok:false,status:404,data:{}}; }
function showToast(){} window.dRenderMain=function(){ document.getElementById('dMain').innerHTML='<div>dashboard</div>'; };
window.renderDesktop=function(){ document.getElementById('desktopShell').innerHTML='<div class="d-sidebar-scroll"></div><div id="dMain"></div>'; window.dRenderMain(); };</script>`;
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + stub + '</head><body><div id="desktopShell"></div>' + body + '<script>renderDesktop();</script></body></html>';
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'harness-' + mode + '.html'), html);
fs.writeFileSync(path.join(outDir, 'fixture-' + mode + '.json'), JSON.stringify(dash));
console.log('wrote', path.join(outDir, 'harness-' + mode + '.html'));
