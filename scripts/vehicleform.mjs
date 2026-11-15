// scripts/vehicleform.mjs -- runs on Vercel at build time, AFTER build.mjs / tablet.mjs / jobs.mjs / aigate.mjs.
//
// What it does to the already-built public/index.html:
//   1) Removes the simulated plate lookup. Typing a plate at Bay Station used to pick one of five
//      hard-coded demo vehicles at random and fill the form with it. Until a real plate-to-VIN
//      decoder is connected, a plate is only recorded.
//   2) Removes the made-up placeholder VIN ("VIN" + random characters) that was written when the
//      VIN was left blank. A blank VIN now stays blank.
//   3) Loads /vehicle-form.js (the Year -> Make -> Model -> Engine Size pickers) after /vehicle-ui.js.
//
// It also builds the vehicle catalog the pickers read (public/vehicle-catalog/<year>.json) from the
// U.S. EPA / DOE fueleconomy.gov vehicle list: free, public, no account, no API key.
//
// Like build.mjs, ANY surprise aborts the build, so a half-patched page can never be deployed.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EPA_ZIP = 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip';
const OUT = 'public';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const fail = (msg) => { console.error('vehicleform: ' + msg); process.exit(1); };

/* ------------------------------------------------------------------ 1. patch index.html */
function patchIndex() {
  const file = path.join(OUT, 'index.html');
  if (!fs.existsSync(file)) fail(file + ' is missing -- build.mjs must run first');
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('/vehicle-form.js')) fail('index.html is already patched');

  // Replace the text between two markers, but only if that text is exactly what was reviewed.
  const replaceSegment = (start, end, expectedSha, replacement) => {
    const a = html.indexOf(start);
    const b = html.indexOf(end, a + 1);
    if (a < 0 || b < 0 || html.indexOf(start, a + 1) >= 0) fail('marker not found exactly once: ' + start);
    const got = sha256(html.slice(a, b));
    if (got !== expectedSha) fail('code after "' + start + '" changed since this patch was reviewed (' + got + ')');
    html = html.slice(0, a) + replacement + html.slice(b);
  };
  const replaceOnce = (from, to) => {
    const a = html.indexOf(from);
    if (a < 0 || html.indexOf(from, a + 1) >= 0) fail('text not found exactly once: ' + from.slice(0, 70));
    html = html.slice(0, a) + to + html.slice(a + from.length);
  };

  // (1) Bay Station plate entry: no simulated lookup, no demo vehicles.
  replaceSegment('function bayLookupPlate(){', 'function bayManualEntry(){',
    '8944f8c20584d6144f00d0db59ab806beab29f5aeb3df319c11137587e5ea61d',
`function bayLookupPlate(){
  // No plate-to-VIN decoder is connected, so a plate is only RECORDED here. Nothing about the
  // vehicle (year, make, model, engine, VIN) is looked up, guessed or filled in from it.
  const plate = String((document.getElementById('bay_plate')||{}).value||bayState.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const state = (document.getElementById('bay_state')||{}).value||bayState.state;
  if(!plate||plate.length<2){showToast('Enter a license plate number');return;}
  bayState.plate = plate;
  bayState.state = state;

  // A plate this shop has ALREADY saved opens that saved record (the shop's own data, same plate
  // and state) -- it is not a lookup of an unknown vehicle.
  const existing = DATA.vehicles.find(v=>v.licensePlate&&v.licensePlate.replace(/\\s/g,'').toUpperCase()===plate&&(!v.plateState||v.plateState===state));
  if(existing){
    const owner = DATA.customers.find(c=>idsMatch(c.id,existing.ownerId));
    bayState.vehicleId = existing.id;
    bayState.customerId = owner ? owner.id : null;
    bayState.isNewCustomer = !owner;
    bayState.isNewVehicle = false;
    bayState.vehicleLookup = {year:existing.year,make:existing.make,model:existing.model,trim:existing.trim||'',vin:existing.vin||'',fromSystem:true};
    showToast('Vehicle found in system!');
    bayGoToServices();
    return;
  }

  bayState.vehicleLookup = {year:'',make:'',model:'',trim:'',vin:'',color:'',plate:plate,state:state,manual:true};
  bayState.isNewVehicle = true;
  bayState.isNewCustomer = true;
  bayState.vehicleId = null;
  bayState.customerId = null;
  dGoto('bayCheckout',{bayStep:'vehicle'});
}

`);
  replaceOnce('<div style="font-weight:700;font-size:17px;margin-bottom:4px;">License Plate Lookup</div>',
              '<div style="font-weight:700;font-size:17px;margin-bottom:4px;">License Plate</div>');
  replaceOnce('<div style="font-size:12.5px;color:var(--text-mid);">Enter the plate — we\'ll pull the vehicle info automatically.</div>',
              '<div style="font-size:12.5px;color:var(--text-mid);">Enter the plate number. It is saved with the vehicle — you pick the year, make, model and engine on the next step.</div>');
  replaceOnce('        🔍 Look Up Vehicle\n', '        Continue →\n');

  // (2) A blank VIN stays blank.
  replaceOnce("document.getElementById('f_vin').value || ('VIN'+Math.random().toString(36).slice(2,12).toUpperCase())",
              "(document.getElementById('f_vin').value||'').trim().toUpperCase()");
  replaceOnce("enteredVin||('VIN'+Math.random().toString(36).slice(2,12).toUpperCase())", 'enteredVin');

  // (3) Load the pickers after the shop vehicle screens they extend.
  replaceOnce('<script src="/vehicle-ui.js"></script>', '<script src="/vehicle-ui.js"></script>\n<script src="/vehicle-form.js"></script>');

  for (const gone of ['demoVehicles', "'VIN'+Math.random", 'Demo lookup result', 'Simulate plate lookup'])
    if (html.includes(gone)) fail('"' + gone + '" is still in index.html');

  fs.writeFileSync(file, html);
  fs.copyFileSync(path.join('scripts', 'vehicle-form.js'), path.join(OUT, 'vehicle-form.js'));
  console.log('vehicleform: index.html patched (' + sha256(html).slice(0, 12) + '), vehicle-form.js written');
}

/* ------------------------------------------------------------------ 2. vehicle catalog */
// Minimal ZIP reader (one deflated entry is all the EPA file holds); avoids a dependency.
function unzipFirst(buf, wantSuffix) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) fail('EPA download is not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail('EPA zip directory is damaged');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.toLowerCase().endsWith(wantSuffix)) {
      const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(dataStart, dataStart + csize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      fail('EPA zip uses an unsupported compression method (' + method + ')');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  fail('no ' + wantSuffix + ' inside the EPA zip');
}

// RFC-4180 style CSV (quoted fields, doubled quotes).
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "5.3L 8-cyl", "2.0L 4-cyl Turbo", "3.0L 6-cyl Turbo Diesel", "2.5L 4-cyl Hybrid", "Electric".
// Cylinder layout (V / inline / flat) is not in the EPA data, so it is not claimed.
function engineLabel(r) {
  const fuel = r.fuelType1 || '', atv = r.atvType || '';
  const d = parseFloat(r.displ), c = parseInt(r.cylinders, 10);
  if (atv === 'EV' || (fuel === 'Electricity' && !(d > 0))) return 'Electric';
  if (atv === 'FCV' || atv === 'eFCV' || fuel === 'Hydrogen') return 'Hydrogen fuel cell';
  let s = d > 0 ? d.toFixed(1) + 'L' : '';
  if (c > 0) s += (s ? ' ' : '') + c + '-cyl';
  else if (s && /rotary/i.test(r.eng_dscr || '')) s += ' Rotary';
  if (!s) return '';
  if (r.tCharger === 'T') s += ' Turbo';
  if (r.sCharger === 'S') s += ' Supercharged';
  if (fuel === 'Diesel' || atv === 'Diesel') s += ' Diesel';
  if (atv === 'Plug-in Hybrid') s += ' Plug-in Hybrid';
  else if (atv === 'Hybrid') s += ' Hybrid';
  if (fuel === 'Natural Gas' || atv === 'CNG') s += ' CNG';
  return s;
}
// EPA writes Ford trucks/vans as "F150", "E150 Econoline"; shops write "F-150".
const modelName = (make, base) => (make === 'Ford' ? base.replace(/^([EF])(\d50)\b/, '$1-$2') : base).replace(/\s+/g, ' ').trim();
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const byEngine = (a, b) => (parseFloat(a) || 99) - (parseFloat(b) || 99) || byName(a, b);

async function download(url) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'DriveMetrik-build (vehicle catalog)' }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = e; console.warn('vehicleform: EPA download attempt ' + attempt + ' failed: ' + (e.message || e)); await new Promise((r) => setTimeout(r, attempt * 3000)); }
  }
  fail('could not download the EPA vehicle list (' + (last && last.message) + '). Nothing was deployed; retry the build.');
}

async function buildCatalog() {
  // VEHICLE_CATALOG_ZIP=<path> builds from a saved copy of the EPA file instead of downloading it (tests, offline builds).
  const zip = process.env.VEHICLE_CATALOG_ZIP ? fs.readFileSync(process.env.VEHICLE_CATALOG_ZIP) : await download(EPA_ZIP);
  const csv = unzipFirst(zip, '.csv').toString('utf8');
  const rows = parseCsv(csv);
  const head = rows.shift();
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  for (const need of ['year', 'make', 'baseModel', 'model', 'displ', 'cylinders', 'fuelType1', 'atvType', 'tCharger', 'sCharger', 'eng_dscr'])
    if (!(need in col)) fail('EPA vehicle list no longer has the "' + need + '" column');
  if (rows.length < 45000) fail('EPA vehicle list looks truncated (' + rows.length + ' rows)');

  const cat = {}; // year -> make -> model -> Set(engine)
  for (const cells of rows) {
    if (cells.length < head.length) continue;
    const r = {}; for (const k in col) r[k] = (cells[col[k]] || '').trim();
    const year = parseInt(r.year, 10), make = r.make, model = modelName(make, r.baseModel || r.model);
    if (!(year >= 1980 && year <= 2100) || !make || !model) continue;
    const set = (((cat[year] ||= {})[make] ||= {})[model] ||= new Set());
    const e = engineLabel(r); if (e) set.add(e);
  }
  const years = Object.keys(cat).map(Number).sort((a, b) => b - a);
  if (years.length < 40 || years[years.length - 1] > 1984 || years[0] < 2026) fail('EPA vehicle list covers an unexpected range of years: ' + years[years.length - 1] + '-' + years[0]);

  const dir = path.join(OUT, 'vehicle-catalog');
  fs.mkdirSync(dir, { recursive: true });
  let makes = 0, models = 0, engines = 0;
  const out = {};
  for (const y of years) {
    const o = {};
    for (const mk of Object.keys(cat[y]).sort(byName)) {
      o[mk] = {}; makes++;
      for (const md of Object.keys(cat[y][mk]).sort(byName)) { const list = [...cat[y][mk][md]].sort(byEngine); o[mk][md] = list; models++; engines += list.length; }
    }
    out[y] = o;
    fs.writeFileSync(path.join(dir, y + '.json'), JSON.stringify(o));
  }
  // Spot checks against vehicles every shop sees: wrong data must not ship quietly.
  const has = (y, mk, md, e) => !!(out[y] && out[y][mk] && out[y][mk][md] && out[y][mk][md].includes(e));
  const checks = [[2020, 'Toyota', 'Camry', '2.5L 4-cyl'], [2021, 'Ford', 'F-150', '5.0L 8-cyl'], [2019, 'Honda', 'Civic', '1.5L 4-cyl Turbo'], [2020, 'Chevrolet', 'Silverado', '5.3L 8-cyl'], [2015, 'Nissan', 'Altima', '2.5L 4-cyl']];
  for (const c of checks) if (!has(...c)) fail('catalog spot check failed: ' + c.join(' '));

  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ source: 'U.S. EPA / DOE fueleconomy.gov vehicle list', built: new Date().toISOString(), years }));
  console.log('vehicleform: catalog built from ' + rows.length + ' EPA records: ' + years[years.length - 1] + '-' + years[0] + ', ' + models + ' year/make/model entries, ' + engines + ' engine options');
}

patchIndex();
await buildCatalog();
