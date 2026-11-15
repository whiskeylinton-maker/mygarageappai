// Browser test for the Add Vehicle form. Not part of the Vercel build.
//   BASE=http://localhost:8765 PW=/path/to/playwright node scripts/vehicleform.test.cjs
// Drives the built page in headless Chrome with the app's API calls blocked, so nothing is written anywhere.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const results = [];
const ok = (name, pass, detail) => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  -> ' + JSON.stringify(detail))); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const b = await chromium.launch(process.env.CHANNEL === 'none' ? { args: ['--no-sandbox'] } : { channel: 'chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const origin = new URL(BASE).origin;
  await p.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(origin) && !u.startsWith(origin + '/api/')) return r.continue();
    return r.abort();   // no API, no CDNs, no VIN service: the form must work on its own
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  ok('vehicle-form.js loaded', await p.evaluate(() => window.vehicleFormVersion === 1));
  ok('no simulated lookup left in page', await p.evaluate(() => !/demoVehicles|Math\.random\(\)\.toString\(36\)\.slice\(2,12\)/.test(document.documentElement.outerHTML + String(bayLookupPlate) + String(baySubmitVehicle) + String(saveVehicle))));

  const snap = (pre) => p.evaluate((pre) => {
    const g = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
    const o = {};
    ['year', 'make', 'model', 'engine', 'year_other', 'make_other', 'model_other', 'engine_other', 'vin', 'trim', 'color', 'miles', 'drive', 'trans', 'tire'].forEach((k) => { o[k] = g(pre + '_' + k); });
    return o;
  }, pre);
  const opts = (id) => p.evaluate((id) => Array.from(document.getElementById(id).options).map((o) => o.value), id);
  const disabled = (id) => p.evaluate((id) => document.getElementById(id).disabled, id);
  const pick = async (id, value) => { await p.selectOption('#' + id, value); await p.waitForTimeout(350); };
  const pasteInto = async (id, text) => {
    await p.evaluate(({ id, text }) => {
      const el = document.getElementById(id); el.focus(); el.select();
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { id, text });
    await p.keyboard.insertText(text);   // what the browser does with the pasted text
    await p.waitForTimeout(250);
  };

  /* ---------------- Bay Station (shop) ---------------- */
  await p.evaluate(() => { setMode('shop'); dGoto('bayStation'); });
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => DATA.vehicles.length);
  await p.click('#bay_plate'); await p.keyboard.type('klm4821', { delay: 20 });
  await p.click('text=Continue →');
  await p.waitForTimeout(1200);   // the old code waited 800ms, then filled in a random demo vehicle
  let s = await snap('bv');
  ok('plate entry -> vehicle step opens with every vehicle detail blank', same([s.year, s.make, s.model, s.engine, s.vin, s.trim, s.color], ['', '', '', '', '', '', '']), s);
  ok('plate itself is recorded', (await p.inputValue('#bv_plate')) === 'KLM4821' && (await p.evaluate(() => bayState.plate)) === 'KLM4821');
  ok('no "looked up" claim on the form', !(await p.evaluate(() => /Looked up|Decoded from/.test(document.getElementById('desktopShell').innerText))));
  ok('nothing was added to the vehicle list by typing a plate', (await p.evaluate(() => DATA.vehicles.length)) === before);
  ok('Make / Model / Engine are blank and locked until the choice before them is made', same([await disabled('bv_year'), await disabled('bv_make'), await disabled('bv_model'), await disabled('bv_engine')], [false, true, true, true]));
  const years = await opts('bv_year');
  ok('Year starts blank and lists the catalog years', years[0] === '' && years.includes('2020') && years.includes('1984'), years.slice(0, 4));

  // typing / editing / pasting a plate on the form itself
  const blankSnap = await snap('bv');
  await p.click('#bv_plate'); await p.keyboard.press('End'); await p.keyboard.type('9', { delay: 20 });
  ok('typing in the plate field changes nothing else', same(await snap('bv'), blankSnap));
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.type('xy', { delay: 20 });
  ok('editing the plate changes nothing else', same(await snap('bv'), blankSnap));
  await pasteInto('bv_plate', 'ABC1234');
  ok('pasting a plate changes nothing else', same(await snap('bv'), blankSnap) && (await p.inputValue('#bv_plate')) === 'ABC1234', await snap('bv'));

  // dependent dropdowns
  await pick('bv_year', '2020');
  const makes = await opts('bv_make');
  ok('Year -> Make list appears, Model/Engine still locked', makes[0] === '' && makes.includes('Toyota') && makes.includes('Ford') && !(await disabled('bv_make')) && (await disabled('bv_model')) && (await disabled('bv_engine')) && (await p.inputValue('#bv_make')) === '', makes.slice(0, 6));
  await pick('bv_make', 'Toyota');
  const models = await opts('bv_model');
  ok('Year + Make -> all matching models, starting blank', models[0] === '' && models.includes('Camry') && models.includes('Corolla') && models.includes('Tacoma') && !models.includes('F-150') && (await p.inputValue('#bv_model')) === '', models);
  await pick('bv_model', 'Camry');
  const engines = await opts('bv_engine');
  ok('Model -> its engine options, starting blank', engines[0] === '' && engines.includes('2.5L 4-cyl') && engines.length >= 3 && (await p.inputValue('#bv_engine')) === '', engines);
  await pick('bv_engine', '2.5L 4-cyl');
  await pick('bv_make', 'Ford');
  s = await snap('bv');
  ok('changing Make clears Model and Engine', s.model === '' && s.engine === '' && (await disabled('bv_engine')) && (await opts('bv_model')).includes('F-150'), s);
  await pick('bv_model', 'F-150'); await pick('bv_engine', (await opts('bv_engine'))[1]);
  await pick('bv_model', 'Mustang');
  s = await snap('bv');
  ok('changing Model clears Engine', s.engine === '' && !(await disabled('bv_engine')), s);
  await pick('bv_year', '2021');
  s = await snap('bv');
  ok('changing Year clears Make, Model and Engine', s.make === '' && s.model === '' && s.engine === '' && (await disabled('bv_model')) && (await disabled('bv_engine')), s);

  // select, then prove the plate still does not disturb the selections, then save with the VIN blank
  await pick('bv_make', 'Toyota'); await pick('bv_model', 'Camry'); await pick('bv_engine', '2.5L 4-cyl');
  const chosen = await snap('bv');
  await pasteInto('bv_plate', 'TST9001');
  await p.click('#bv_plate'); await p.keyboard.press('End'); await p.keyboard.press('Backspace'); await p.keyboard.type('7', { delay: 20 });
  ok('plate typed / edited / pasted after choosing leaves Year, Make, Model, Engine and VIN alone', same(await snap('bv'), chosen) && chosen.vin === '', await snap('bv'));
  await p.fill('#bv_miles', '48210');
  await p.click('text=Next — Customer Info →');
  await p.waitForTimeout(500);
  const saved = await p.evaluate(() => { const v = DATA.vehicles.find((x) => idsMatch(x.id, bayState.vehicleId)); return v && { year: v.year, make: v.make, model: v.model, engine: v.engine, vin: v.vin, plate: v.licensePlate, state: v.plateState, miles: v.mileage }; });
  ok('saved with the VIN blank (no placeholder VIN invented)', same(saved, { year: 2021, make: 'Toyota', model: 'Camry', engine: '2.5L 4-cyl', vin: '', plate: 'TST9007', state: 'TX', miles: 48210 }), saved);
  await p.fill('#bc_first', 'Preview'); await p.fill('#bc_last', 'Tester'); await p.fill('#bc_phone', '8175550142');
  await p.evaluate(() => baySubmitCustomer());
  await p.waitForTimeout(500);
  const vid = await p.evaluate(() => bayState.vehicleId);
  const owner = await p.evaluate(() => { const v = DATA.vehicles.find((x) => idsMatch(x.id, bayState.vehicleId)); const c = DATA.customers.find((x) => idsMatch(x.id, v.ownerId)); return c && c.name; });
  ok('vehicle attached to its customer', owner === 'Preview Tester', owner);
  if (await p.evaluate(() => typeof dmVehFields === 'function')) {
    const sent = await p.evaluate(() => dmVehFields(DATA.vehicles.find((x) => idsMatch(x.id, bayState.vehicleId)), 'owner-uuid'));
    ok('record the cloud save would send: year/make/model/engine set, VIN empty', sent.year === 2021 && sent.make === 'Toyota' && sent.model === 'Camry' && sent.engine === '2.5L 4-cyl' && sent.vin === '' && sent.licensePlate === 'TST9007', sent);
  }
  // reopen the record
  await p.evaluate((id) => dGoto('vehicleDetailShop', { id: String(id) }), vid);
  await p.waitForTimeout(600);
  const page1 = await p.evaluate(() => document.getElementById('desktopShell').innerText);
  const at = page1.indexOf('2021 Toyota Camry');
  ok('reopened record shows 2021 Toyota Camry with engine 2.5L 4-cyl', at >= 0 && /2\.5L 4-cyl/.test(page1), page1.slice(Math.max(0, at - 50), at + 300));
  if (await p.evaluate(() => typeof vehicleUiVersion !== 'undefined')) ok('reopened record shows plate TST9007 (TX)', /TST9007/.test(page1), page1.slice(Math.max(0, at - 50), at + 500));
  ok('reopened record has no invented VIN', !/VIN[A-Z0-9]{10}\b/.test(page1));
  await p.screenshot({ path: 'shot-record.png' });

  // not-listed path + VIN added later is allowed to be skipped entirely (no plate, no VIN)
  await p.evaluate(() => { dGoto('bayStation'); }); await p.waitForTimeout(300);
  await p.evaluate(() => { bayState.plate = ''; bayManualEntry(); }); await p.waitForTimeout(600);
  s = await snap('bv');
  ok('manual entry also starts blank', same([s.year, s.make, s.model, s.engine, s.vin], ['', '', '', '', '']), s);
  await pick('bv_year', '2019'); await pick('bv_make', 'Ford'); await pick('bv_model', '__other__');
  await p.fill('#bv_model_other', 'F-350 Super Duty'); await p.waitForTimeout(400);
  await p.fill('#bv_engine_other', '6.7L diesel');
  await p.fill('#bv_miles', '120500'); await p.fill('#bv_plate', '');
  await p.screenshot({ path: 'shot-form.png' });
  await p.click('text=Next — Customer Info →'); await p.waitForTimeout(400);
  const typed = await p.evaluate(() => { const v = DATA.vehicles.find((x) => idsMatch(x.id, bayState.vehicleId)); return v && [v.year, v.make, v.model, v.engine, v.vin, v.licensePlate]; });
  ok('"Not listed" lets a model/engine be typed; saves with no VIN and no plate', same(typed, [2019, 'Ford', 'F-350 Super Duty', '6.7L diesel', '', '']), typed);

  /* ---------------- customer app Add / Edit Vehicle ---------------- */
  await p.evaluate(() => { setMode('customer'); goto('addVehicle'); });
  await p.waitForTimeout(500);
  if (await p.$('#f_year')) {
    s = await snap('f');
    ok('customer app: form starts blank (no default year/make, VIN empty)', same([s.year, s.make, s.model, s.engine, s.vin], ['', '', '', '', '']) && !(await p.$('text=Look Up')), s);
    const fb = await snap('f');
    await p.click('#f_plate'); await p.keyboard.type('qrs5560', { delay: 20 }); await pasteInto('f_plate', 'QRS5561');
    ok('customer app: plate typed / pasted changes nothing else', same(await snap('f'), fb));
    await pick('f_year', '2019'); await pick('f_make', 'Honda'); await pick('f_model', 'Civic'); await pick('f_engine', '1.5L 4-cyl Turbo');
    await p.click('text=Save Vehicle'); await p.waitForTimeout(500);
    const cv = await p.evaluate(() => { const v = DATA.vehicles.find((x) => idsMatch(x.id, activeVehicleId)); return v && [v.year, v.make, v.model, v.engine, v.vin, v.licensePlate]; });
    ok('customer app: saved with VIN blank', same(cv, [2019, 'Honda', 'Civic', '1.5L 4-cyl Turbo', '', 'QRS5561']), cv);
    await p.evaluate(() => goto('editVehicle')); await p.waitForTimeout(900);
    s = await snap('f');
    ok('customer app: reopening the record shows the saved selections', same([s.year, s.make, s.model, s.engine, s.vin], ['2019', 'Honda', 'Civic', '1.5L 4-cyl Turbo', '']), s);
  } else ok('customer app form reachable', false, 'no #f_year');

  ok('no script errors', errs.length === 0, errs.slice(0, 5));
  console.log(results.filter(Boolean).length + '/' + results.length + ' passed');
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('TEST CRASHED', e.message); process.exit(2); });
