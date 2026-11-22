// Drives the local harness pages with Playwright. Fails loudly on any wrong state.
const { chromium } = require('playwright'); const path = require('path');
const dir = process.argv[2]; const shots = process.argv[3];
const ok = (c, m) => { if (!c) throw new Error('UI TEST FAILED: ' + m); console.log('ok:', m); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['tablet', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }]]) {
    const pg = await b.newPage({ viewport: vp, deviceScaleFactor: name === 'desktop' ? 1 : 2 }); pg.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await pg.goto('file://' + path.join(dir, 'harness-ok.html')); await pg.waitForSelector('#dmcc_kpis');
    const t = await pg.innerText('#dMain');
    if (name === 'desktop') {
      ok(/Owner Command Center/.test(t) && t.indexOf('Owner Command Center') < t.indexOf('Subscriber details'), 'command center is at the top of Owner Analytics');
      for (const k of ['Registered shops', 'Active paying shops', 'Online right now', 'Monthly recurring revenue', 'Collected this month', 'Due in next 7 days', 'Failed or overdue', 'New subscriptions this month', 'Cancellations this month', 'Open complaints & messages']) ok(t.toLowerCase().includes(k.toLowerCase()), 'KPI: ' + k);
      const online = (await pg.innerText('#dmcc_kpi_online')).replace(/\n/g, ' ');
      ok(/Online right now\s+3\b/i.test(online), 'online now = 3 people: ' + online);
      ok(/2 active · .*1 idle · 2 shops/.test(online), 'online breakdown by status and shop');
      const live = await pg.innerText('#dmcc_live'); ok(/Thresholds:/.test(live) && /2\.5 min/.test(live) && /5 min/.test(live), 'activity thresholds are displayed');
      ok(!/c@example\.test/.test(live), 'offline people hidden by default');
      ok(/2 of 2 devices live/.test(live), 'multiple devices for one person are shown');
      await pg.check('#dmcc_live input[type=checkbox]'); ok(/c@example\.test/.test(await pg.innerText('#dmcc_live')), 'offline (last 24 h) can be shown');
      const mon = await pg.innerText('#dmcc_monitor');
      ok(/Past due/.test(mon) && /Renews in 3 days/.test(mon) && /Active: paid/.test(mon) && /Complimentary/.test(mon) && /Internal \(owner\) account/.test(mon), 'every billing colour state is shown with its label');
      const order = ['Past due', 'Renews in 3 days', 'Active: paid', 'Complimentary'].map((x) => mon.indexOf(x)); ok(order.every((v, i) => i === 0 || v > order[i - 1]), 'red first, then yellow, green, gray');
      ok(/\$249\.00/.test(mon) && /past_due/.test(mon), 'outstanding balance and exact Stripe status shown');
      await pg.selectOption('#dmcc_monitor select', 'red'); const red = await pg.innerText('#dmcc_monitor'); ok(/Past due/.test(red) && !/Active: paid/.test(red), 'billing colour filter works');
      await pg.selectOption('#dmcc_monitor select', '');
      await pg.click('#dmcc_monitor a.dmcc-link >> text=Example Shop B (fixture)'); await pg.waitForSelector('#dmcc_shop_modal');
      const m = await pg.innerText('#dmcc_shop_modal'); ok(/Membership/.test(m) && /Billing/.test(m) && /Activity \(1 of 1 people online now\)/.test(m) && /Support history \(1\)/.test(m) && /invoice PDF/.test(m), 'shop drill-down: membership, billing, activity, support history');
      await pg.click('#dmcc_shop_modal >> text=Mark reviewed'); await pg.waitForTimeout(100); ok(/Reviewed/.test(await pg.innerText('#dmcc_shop_modal')), 'complaint status control works from the drill-down');
      await pg.keyboard.press('Escape'); ok(!(await pg.$('#dmcc_shop_ov')), 'drill-down closes with Escape');
      await pg.click('table.dmo-tbl a.dmcc-link >> text=Example Shop A (fixture) >> nth=-1'); ok(!!(await pg.$('#dmcc_shop_modal')), 'shop names in the existing Shops table open the drill-down'); await pg.keyboard.press('Escape');
      ok(/Complaints & message board/.test(await pg.innerText('#dMain')) && (await pg.$$('text=Resolve')).length > 0, 'existing complaints board still present with its controls');
      await pg.screenshot({ path: path.join(shots, 'cc-desktop.png'), fullPage: true });
      await pg.waitForFunction(() => window.__calls.some((c) => c.includes('view=presence')), null, { timeout: 8000 }); const calls = await pg.evaluate(() => window.__calls);
      // live data goes stale -> nobody shown as online
      await pg.evaluate(() => { window.__presenceDown = true; const o = Date.now; Date.now = () => o() + 120000; }); await pg.evaluate(() => dmCC._test.poll());
      const st = await pg.innerText('#dmcc_live'); const on2 = await pg.innerText('#dmcc_kpi_online');
      ok(/out of date/.test(st) && /Unavailable/i.test(on2) && !/Active now\s/.test(st.split('Refreshes every')[1] || ''), 'presence outage: statuses become unknown, never "online"');
      ok(/Unknown/.test(await pg.innerText('#dmcc_monitor')), 'presence outage: monitor activity column shows Unknown');
      ok(calls.some((c) => c.includes('view=presence')), 'heartbeat is sent by the page');
    }
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(over <= 1, name + ': no horizontal page overflow (' + over + 'px); wide tables scroll inside their own box');
    if (name !== 'desktop') await pg.screenshot({ path: path.join(shots, 'cc-' + name + '.png'), fullPage: false });
    await pg.close();
  }
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); pg.on('pageerror', (e) => errors.push('down: ' + e.message));
  await pg.goto('file://' + path.join(dir, 'harness-down.html')); await pg.waitForSelector('#dmcc_kpis');
  const t = await pg.innerText('#dMain');
  ok(/Billing data is unavailable/.test(t) && !/Active: paid/.test(t) && !/\$0\.00/.test(await pg.innerText('#dmcc_kpis')), 'Stripe unavailable: no green, no fake $0 totals');
  ok((await pg.innerText('#dmcc_monitor')).match(/Billing data unavailable/g).length >= 3, 'Stripe unavailable: shops are gray "Billing data unavailable"');
  ok(/Live activity is unavailable/.test(t) && /migration has not been applied/.test(t), 'presence not enabled: clear message, nothing shown as online');
  await pg.screenshot({ path: path.join(shots, 'cc-unavailable.png'), fullPage: false });
  ok(errors.length === 0, 'no JavaScript errors (' + errors.join('; ') + ')');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
