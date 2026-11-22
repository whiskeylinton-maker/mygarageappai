// End-to-end test of the REAL staging build (public/index.html as served by the staging deployment), run in a local
// browser with every /api/* call answered locally. No request reaches production, Supabase or Stripe.
// Usage: node tests/e2e-staging-page.cjs <staging-index.html> <fixture-ok.json> <screenshot dir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const [pagePath, fixturePath, shots] = process.argv.slice(2);
const html = fs.readFileSync(pagePath, 'utf8'); const FIX = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const ok = (c, m) => { if (!c) throw new Error('E2E FAILED: ' + m); console.log('ok:', m); };

async function run(asOwner, viewport) {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport });
  const calls = [], beats = [], errors = [];
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname !== 'staging.local') return route.abort();                       // CDN scripts etc: offline on purpose
    if (!u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    const auth = req.headers()['authorization'] || '';
    const key = req.method() + ' ' + u.pathname + u.search; calls.push(key);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
    if (!auth.startsWith('Bearer ')) return json(401, { error: 'Not authenticated' });
    if (u.pathname === '/api/shop') return json(200, { role: asOwner ? 'platform_owner' : 'technician', shop: { id: 's-a', name: 'Example Shop A (fixture)', access: { state: 'active', can_write: true } } });
    if (u.pathname === '/api/customers' && !u.search) return json(200, { customers: [] });
    if (u.pathname === '/api/vehicles') return json(200, { vehicles: [] });
    if (u.pathname === '/api/watchtower') {
      const v = u.searchParams.get('view');
      if (v === 'presence') { if (req.method() !== 'POST') return json(405, { error: 'Method not allowed' }); beats.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ status: 204, body: '' }); }
      if (!asOwner) return json(403, { error: 'Not authorized.' });                  // what the server does for every non-owner
      if (v === 'owner' && u.searchParams.get('probe') === '1') return json(200, { owner: true });
      if (v === 'owner' && u.searchParams.get('part') === 'presence') return json(200, FIX.presence);
      if (v === 'owner') return json(200, FIX);
    }
    return json(200, {});
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message)); pg.on('dialog', (d) => d.accept());
  await pg.addInitScript(() => { try { localStorage.setItem('dm-session', JSON.stringify({ access_token: 'local-test-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 })); } catch (e) {} });
  await pg.goto('http://staging.local/');
  return { b, pg, calls, beats, errors };
}

(async () => {
  // ---------- platform owner ----------
  let t = await run(true, { width: 1440, height: 1000 });
  await t.pg.waitForSelector('[data-key="ownerAnalytics"]', { timeout: 20000 });
  ok(true, 'owner: "Owner Analytics" appears in the real app sidebar');
  await t.pg.click('[data-key="ownerAnalytics"]'); await t.pg.waitForSelector('#dmcc_kpis', { timeout: 10000 });
  const main = await t.pg.innerText('#dMain');
  ok(/Owner Command Center/.test(main) && /Who is online now/.test(main) && /Subscriber payment monitor/.test(main) && /Complaints & message board/i.test(main), 'owner: command center, live activity, payment monitor and complaints board render inside the real app');
  ok(main.indexOf('Owner Command Center') < main.indexOf('Subscriber details'), 'owner: command center is at the top');
  await t.pg.click('#dmcc_monitor a.dmcc-link >> text=Example Shop C (fixture)'); await t.pg.waitForSelector('#dmcc_shop_modal');
  ok(/Past due/.test(await t.pg.innerText('#dmcc_shop_modal')), 'owner: shop drill-down opens from the payment monitor');
  await t.pg.screenshot({ path: path.join(shots, 'e2e-owner-drilldown.png') }); await t.pg.keyboard.press('Escape');
  await t.pg.waitForFunction(() => true); await t.pg.waitForTimeout(4500);
  ok(t.beats.length >= 1, 'heartbeat sent by the real app (' + t.beats.length + ')');
  const beat = t.beats[0];
  ok(/^[0-9a-f-]{36}$/.test(beat.session) && typeof beat.active === 'boolean' && ['desktop', 'tablet', 'mobile'].includes(beat.device) && Object.keys(beat).sort().join() === 'active,device,end,page,session', 'heartbeat carries only session id, page, active flag, device, end (' + JSON.stringify(beat) + ')');
  // sign out ends the session immediately
  const before = t.beats.length;
  await t.pg.evaluate(() => { try { dmSignOut(); } catch (e) {} }); await t.pg.waitForTimeout(800);
  ok(t.beats.slice(before).some((x) => x.end === true), 'signing out sends an "end" heartbeat (shows Offline at once)');
  ok(t.errors.filter((e) => /dmCC|presence|dm-cc/i.test(e)).length === 0, 'no command-center JavaScript errors (' + t.errors.slice(0, 3).join(' | ') + ')');
  await t.b.close();

  // ---------- regular shop user ----------
  t = await run(false, { width: 1440, height: 1000 });
  await t.pg.waitForTimeout(6000);
  ok(!(await t.pg.$('[data-key="ownerAnalytics"]')), 'shop user: no Owner Analytics entry');
  ok(t.calls.filter((c) => c.includes('view=owner') && !c.includes('probe=1')).length === 0, 'shop user: never requests owner data (only the 403 probe)');
  ok(t.beats.length >= 1, 'shop user: their own heartbeat is still sent (so the owner can see them online)');
  ok(!(await t.pg.$('#dmcc_kpis')), 'shop user: command center never renders');
  await t.b.close();

  // ---------- owner on a phone ----------
  t = await run(true, { width: 390, height: 844 });
  await t.pg.waitForTimeout(6000);
  const hasNav = !!(await t.pg.$('[data-key="ownerAnalytics"]'));
  console.log('info: phone width: Owner Analytics nav present in DOM =', hasNav);
  if (hasNav) { await t.pg.evaluate(() => { try { dNav.screen = 'ownerAnalytics'; window.dRenderMain(); } catch (e) {} }); await t.pg.waitForTimeout(1500);
    if (await t.pg.$('#dmcc_kpis')) { const over = await t.pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(over <= 1, 'phone: no horizontal page overflow in the real app (' + over + 'px)'); await t.pg.screenshot({ path: path.join(shots, 'e2e-owner-phone.png') }); } }
  await t.b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
