/* DriveMetrik - Add Vehicle: Year -> Make -> Model -> Engine Size pickers.
   Loaded AFTER the main app script and /vehicle-ui.js (scripts/vehicleform.mjs adds the tag). It replaces the
   vehicle step of Bay Station check-in and the customer app's Add / Edit Vehicle form.

   Rules this file keeps:
   - A license plate is only recorded. Typing, editing or pasting one never fills in or changes anything else.
   - Every picker starts blank. Changing an earlier choice clears the later ones.
   - The VIN is optional and starts blank. A blank VIN is saved as blank (no placeholder is invented).
   - Options come from /vehicle-catalog/<year>.json (built from the U.S. EPA vehicle list) plus the shop's own
     vehicle library. Anything missing can still be typed in with "Not listed", so the catalog never blocks a save. */
(function () {
  'use strict';
  var OTHER = '__other__';
  var FIELDS = ['year', 'make', 'model', 'engine'];
  var NAME = { year: 'year', make: 'make', model: 'model', engine: 'engine size' };
  var WAIT = { make: 'Select a year first', model: 'Select a make first', engine: 'Select a model first' };
  var TYPE_IT = { year: 'Type the year, e.g. 1979', make: 'Type the make', model: 'Type the model', engine: 'Type the engine, e.g. 6.7L diesel' };
  var FIRST_YEAR = 1984;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var blank = function (v) { return v == null || v === '—' ? '' : String(v).trim(); };
  var $ = function (id) { return document.getElementById(id); };
  var norm = function (s) { return blank(s).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var isPlaceholderVin = function (v) { return /^VIN[A-Z0-9]{10}$/.test(v || ''); };
  var realVin = function (v) { return v && !isPlaceholderVin(v) ? String(v) : ''; };
  var byName = function (a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' }); };

  /* ---------- catalog (static files, fetched once per year and kept) ---------- */
  var cat = { index: null, indexP: null, years: {}, yearP: {} };
  function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function loadIndex() {
    if (!cat.indexP) cat.indexP = getJson('/vehicle-catalog/index.json').then(function (j) { cat.index = j; return j; }, function (e) { cat.indexP = null; throw e; });
    return cat.indexP;
  }
  function loadYear(year) {
    var y = String(year);
    if (!/^\d{4}$/.test(y)) return Promise.resolve({});
    if (cat.years[y]) return Promise.resolve(cat.years[y]);
    if (!cat.yearP[y]) cat.yearP[y] = loadIndex().then(function (idx) {
      if ((idx.years || []).indexOf(Number(y)) < 0) return {};
      return getJson('/vehicle-catalog/' + y + '.json');
    }).then(function (j) { cat.years[y] = j; return j; }, function (e) { delete cat.yearP[y]; throw e; });
    return cat.yearP[y];
  }
  function yearList() {
    if (cat.index && cat.index.years && cat.index.years.length) return cat.index.years.slice();
    var out = []; for (var y = new Date().getFullYear() + 1; y >= FIRST_YEAR; y--) out.push(y);
    return out;
  }
  function findKey(obj, name) { var n = norm(name); if (!obj || !n) return null; for (var k in obj) if (norm(k) === n) return k; return null; }
  function addUnique(list, value) { var n = norm(value); if (n && !list.some(function (x) { return norm(x) === n; })) list.push(String(value).trim()); }
  function library(year) { return (typeof DATA !== 'undefined' && DATA.vehicleSpecs || []).filter(function (s) { return String(s.year) === String(year); }); }
  // The choices for one picker, given what is chosen above it: catalog first, then the shop's own library.
  function optionsFor(field, year, make, model) {
    return loadYear(year).then(function (data) {
      var list = [], mk = findKey(data, make), md = mk ? findKey(data[mk], model) : null, lib = library(year);
      if (field === 'make') {
        list = Object.keys(data);
        lib.forEach(function (s) { addUnique(list, s.make); });
        return list.sort(byName);
      }
      if (field === 'model') {
        if (mk) list = Object.keys(data[mk]);
        lib.forEach(function (s) { if (norm(s.make) === norm(make)) addUnique(list, s.model); });
        return list.sort(byName);
      }
      if (md) list = data[mk][md].slice();
      lib.forEach(function (s) { if (norm(s.make) === norm(make) && norm(s.model) === norm(model) && blank(s.engine)) addUnique(list, s.engine); });
      return list;
    });
  }

  /* ---------- the four dependent pickers ---------- */
  var tokens = {}, hooks = {};
  function val(p, f) {
    var s = $(p + '_' + f); if (!s) return '';
    if (s.value === OTHER) { var o = $(p + '_' + f + '_other'); return o ? o.value.trim() : ''; }
    return s.value;
  }
  function showOther(p, f, on, text) {
    var o = $(p + '_' + f + '_other'); if (!o) return;
    o.style.display = on ? '' : 'none';
    o.value = on ? (text == null ? o.value : text) : '';
  }
  function reset(p, f) {
    var s = $(p + '_' + f); if (!s) return;
    s.innerHTML = '<option value="">' + esc(WAIT[f]) + '</option>'; s.disabled = true; showOther(p, f, false);
  }
  function setOptions(p, f, list) {
    var s = $(p + '_' + f); if (!s) return;
    s.innerHTML = '<option value="">— Select ' + NAME[f] + ' —</option>' +
      list.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') +
      '<option value="' + OTHER + '">Not listed — type it in</option>';
    s.disabled = false; showOther(p, f, false);
    if (!list.length) { s.value = OTHER; showOther(p, f, true, ''); }   // nothing in the catalog: go straight to typing
  }
  function note(p, text) { var n = $(p + '_vfnote'); if (n) { n.textContent = text || ''; n.style.display = text ? '' : 'none'; } }
  function fill(p, f, tok) {
    var s = $(p + '_' + f); if (!s) return Promise.resolve();
    s.innerHTML = '<option value="">Loading…</option>'; s.disabled = true;
    return optionsFor(f, val(p, 'year'), val(p, 'make'), val(p, 'model')).then(function (list) {
      if (tokens[p] !== tok) return;
      setOptions(p, f, list); note(p, '');
    }, function () {
      if (tokens[p] !== tok) return;
      setOptions(p, f, []); note(p, 'The vehicle list could not be loaded. Type the details in instead — nothing is lost.');
    });
  }
  function done(p) { if (hooks[p]) hooks[p](); }
  // Called when a picker (or its typed value) changes: everything after it is cleared, the next one is filled.
  function cascade(p, f) {
    var i = FIELDS.indexOf(f), tok = tokens[p] = (tokens[p] || 0) + 1;
    for (var k = i + 1; k < FIELDS.length; k++) reset(p, FIELDS[k]);
    var next = FIELDS[i + 1];
    if (!next || !val(p, f)) { done(p); return Promise.resolve(); }
    return fill(p, next, tok).then(function () { if (tokens[p] === tok) done(p); });
  }
  window.vfChanged = function (p, f) {
    var s = $(p + '_' + f); if (!s) return;
    showOther(p, f, s.value === OTHER, '');
    if (s.value === OTHER) { var o = $(p + '_' + f + '_other'); if (o) o.focus(); }
    cascade(p, f);
  };
  window.vfTyped = function (p, f) { cascade(p, f); };

  function choose(p, f, want) {
    var s = $(p + '_' + f); want = blank(want);
    if (!s || !want) return;
    var n = norm(want), hit = null, starts = [];
    for (var i = 0; i < s.options.length; i++) {
      var v = s.options[i].value; if (!v || v === OTHER) continue;
      if (norm(v) === n) { hit = v; break; }
      if (f === 'engine' && norm(v).indexOf(n) === 0) starts.push(v);
    }
    if (hit == null && starts.length === 1) hit = starts[0];
    if (hit != null) { s.value = hit; showOther(p, f, false); }
    else { s.value = OTHER; showOther(p, f, true, want); }
  }
  // Put known values (a VIN decode, a library pick, a saved vehicle) into the pickers, in order.
  function setValues(p, v) {
    var tok = tokens[p] = (tokens[p] || 0) + 1, live = function () { return tokens[p] === tok && $(p + '_year'); };
    FIELDS.slice(1).forEach(function (f) { reset(p, f); });
    var ys = $(p + '_year'); if (!ys) return Promise.resolve();
    ys.value = ''; showOther(p, 'year', false);
    choose(p, 'year', v.year);
    var step = function (f, want, then) {
      return function () {
        if (!live() || !val(p, FIELDS[FIELDS.indexOf(f) - 1])) return;
        return fill(p, f, tok).then(function () { if (!live()) return; choose(p, f, want); return then ? then() : undefined; });
      };
    };
    return Promise.resolve().then(step('make', v.make, step('model', v.model, step('engine', v.engine)))).then(function () { if (live()) done(p); });
  }
  // Markup for the four pickers. opt.wrap(label, html) lays one field out; opt.style styles the controls.
  function pickers(p, opt) {
    var st = opt.style ? ' style="' + opt.style + '"' : '';
    var one = function (f, label) {
      var options = f === 'year'
        ? '<option value="">— Select year —</option>' + yearList().map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('') + '<option value="' + OTHER + '">Older / not listed — type it in</option>'
        : '<option value="">' + esc(WAIT[f]) + '</option>';
      return opt.wrap(label,
        '<select id="' + p + '_' + f + '" onchange="vfChanged(\'' + p + '\',\'' + f + '\')"' + (f === 'year' ? '' : ' disabled') + st + '>' + options + '</select>' +
        '<input id="' + p + '_' + f + '_other" type="' + (f === 'year' ? 'number' : 'text') + '" placeholder="' + esc(TYPE_IT[f]) + '" autocomplete="off" oninput="vfTyped(\'' + p + '\',\'' + f + '\')" style="display:none;margin-top:6px;' + (opt.style || '') + '">');
    };
    return one('year', 'Year') + one('make', 'Make') + one('model', 'Model') + one('engine', 'Engine Size');
  }
  function validYear(y) { return y >= 1900 && y <= new Date().getFullYear() + 2; }
  // After the screen's HTML is on the page, fill the pickers (the app renders from strings, so wait a tick).
  function afterRender(p, fn) {
    var tries = 0, go = function () { if ($(p + '_year')) fn(); else if (++tries < 20) setTimeout(go, 25); };
    setTimeout(go, 0);
  }
  loadIndex().catch(function () {});   // warm the year list; a failure is handled when a year is picked

  /* ---------- Bay Station check-in: vehicle step ---------- */
  var STYLE = 'width:100%;background:var(--bg-input);border:1px solid var(--border-subtle);color:var(--text-hi);border-radius:9px;padding:11px 14px;font-size:13.5px;outline:none;font-family:inherit;';
  function inp(id, type, ph, v, extra) { return '<input id="' + id + '" type="' + type + '" placeholder="' + esc(ph) + '" value="' + esc(v) + '" ' + (extra || '') + ' style="' + STYLE + '">'; }
  function sel(id, opts, cur, extra) {
    return '<select id="' + id + '" ' + (extra || '') + ' style="' + STYLE + '">' + opts.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }
  function field(label, html) { return '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-mid);margin-bottom:5px;font-weight:600;">' + label + '</div>' + html + '</div>'; }
  var DRIVES = ['', 'FWD', 'RWD', 'AWD', '4WD'];
  var GRID = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">';

  window.bayCatalogStatus = function () {
    var el = $('bv_specstatus'); if (!el) return;
    var s = findVehicleSpecs(val('bv', 'year'), val('bv', 'make'), val('bv', 'model'));
    el.innerHTML = s ? '✓ Fluid &amp; parts specs are on file for this vehicle and will show on its page.' : '<span style="color:var(--text-low);">No specs on file yet — add them later from the vehicle page (Fluid &amp; Parts Reference → Edit).</span>';
    el.style.color = s ? 'var(--success)' : 'var(--text-low)';
  };
  hooks.bv = function () { window.bayCatalogStatus(); };
  window.bayMakeChanged = function () {};   // the old free-text Make box is gone; kept so nothing that still calls it can fail
  // "Find the vehicle" is the shop's own library: an explicit pick by the user, never a plate lookup.
  window.bayCatalogPick = function (label) {
    var s = (DATA.vehicleSpecs || []).find(function (x) { return (x.year + ' ' + x.make + ' ' + x.model) === label; });
    if (!s) return;
    $('bv_catalog').value = '';
    setValues('bv', { year: s.year, make: s.make, model: s.model, engine: s.engine }).then(function () {
      if (s.tires && s.tires.size && $('bv_tire')) $('bv_tire').value = s.tires.size;
    });
  };
  window.bayRenderVehicleStep = function () {
    var lv = bayState.vehicleLookup || {};
    var plate = String(lv.plate || bayState.plate || '').toUpperCase(), state = lv.state || bayState.state || 'TX';
    var specs = (DATA.vehicleSpecs || []).slice().sort(function (a, b) { return a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.year - b.year; });
    var tag = lv.fromNhtsa ? '✓ Decoded from the VIN' : (lv.fromSystem ? '✓ Already on file' : '');
    afterRender('bv', function () {
      if (blank(lv.year) || blank(lv.make) || blank(lv.model)) setValues('bv', { year: lv.year, make: lv.make, model: lv.model, engine: lv.engine });
      else window.bayCatalogStatus();
    });
    return dBackLink('Back to Bay Station', 'bayStation') + bayStepBar('vehicle') +
      '<div class="d-panel" style="max-width:600px;margin:0 auto;">' +
      '<div class="d-panel-title">Vehicle Information' + (plate ? ' — Plate: ' + esc(plate) + ' (' + esc(state) + ')' : '') + (tag ? '<span style="font-size:11px;font-weight:400;color:var(--success);margin-left:8px;">' + tag + '</span>' : '') + '</div>' +
      (specs.length ? '<datalist id="bv_catalog_list">' + specs.map(function (s) { return '<option value="' + esc(s.year + ' ' + s.make + ' ' + s.model) + '">' + esc(s.engine || '') + '</option>'; }).join('') + '</datalist>' +
        '<div style="background:rgba(77,141,255,0.07);border:1px solid rgba(77,141,255,0.25);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
        '<div style="font-size:11px;font-family:var(--font-mono);letter-spacing:.06em;color:var(--blue-bright);margin-bottom:6px;">FIND THE VEHICLE</div>' +
        '<input id="bv_catalog" list="bv_catalog_list" placeholder="Type to search your vehicle library, e.g. 2021 Ford F-150" oninput="bayCatalogPick(this.value)" style="' + STYLE + '">' +
        '<div style="font-size:11px;color:var(--text-low);margin-top:6px;">Pick a vehicle from your library to fill in year, make, model, engine and tires — or choose them below. DriveMetrik does not guess a vehicle from a plate.</div></div>' : '') +
      '<div style="background:rgba(22,199,172,0.08);border:1.5px solid rgba(22,199,172,0.35);border-radius:12px;padding:14px;margin-bottom:14px;"><div style="font-size:11px;font-family:var(--font-mono);letter-spacing:.06em;color:var(--teal);margin-bottom:6px;">CURRENT ODOMETER READING (required)</div>' +
      '<div style="display:flex;align-items:center;background:var(--bg-input);border:2px solid var(--teal);border-radius:9px;padding:0 16px;"><input id="bv_miles" type="number" placeholder="e.g. 128450" min="0" style="flex:1;background:transparent;border:none;color:var(--text-hi);padding:12px 8px;font-size:22px;font-family:var(--font-mono);font-weight:700;outline:none;"><span style="font-size:14px;color:var(--teal);font-weight:700;">mi</span></div></div>' +
      GRID + pickers('bv', { wrap: field, style: STYLE }) + '</div>' +
      '<div id="bv_vfnote" style="display:none;font-size:11.5px;color:var(--warn);margin:-4px 0 12px;"></div>' +
      '<div id="bv_specstatus" style="font-size:11.5px;margin:-4px 0 12px;"></div>' +
      GRID + field('Trim', inp('bv_trim', 'text', 'e.g. SE', lv.trim || '')) + field('Color', inp('bv_color', 'text', 'e.g. Silver', lv.color || '')) +
      field('License Plate + State', '<div style="display:flex;gap:8px;"><input id="bv_plate" type="text" placeholder="ABC1234" value="' + esc(plate) + '" autocomplete="off" oninput="this.value=this.value.toUpperCase()" style="' + STYLE + 'flex:1;min-width:0;"><div style="width:92px;flex-shrink:0;">' + sel('bv_state', US_STATE_CODES, state) + '</div></div>') +
      field('Drivetrain', sel('bv_drive', DRIVES.map(function (d) { return [d, d || '— Not set —']; }), '')) +
      field('Transmission', inp('bv_trans', 'text', 'e.g. 6-speed automatic', '')) + field('Tire size', inp('bv_tire', 'text', 'e.g. 275/60R20', '')) + '</div>' +
      field('VIN <span style="color:var(--text-low);font-weight:400;">(optional — leave it blank and add it later)</span>', inp('bv_vin', 'text', '17-character VIN', realVin(lv.vin), 'maxlength="17" class="mono" autocomplete="off"')) +
      '<div style="font-size:11.5px;color:var(--text-low);margin-bottom:10px;">The plate is only recorded — it does not fill in the vehicle. Everything here can be corrected later from the vehicle page.</div>' +
      '<button class="btn btn-primary btn-block" style="font-size:15px;padding:14px;" onclick="baySubmitVehicle()">Next — Customer Info →</button></div>';
  };
  window.baySubmitVehicle = function () {
    var year = parseInt(val('bv', 'year'), 10) || 0, make = val('bv', 'make'), model = val('bv', 'model');
    if (!year || !make || !model) { showToast('Year, make and model are required'); return; }
    if (!validYear(year)) { showToast('Check the year — ' + year + ' does not look right'); return; }
    if (bayState.isNewVehicle) {
      var miles = parseInt($('bv_miles').value, 10) || 0;
      if (miles <= 0) { showToast('Current mileage is required'); $('bv_miles').focus(); return; }
      var plate = $('bv_plate').value.toUpperCase().replace(/\s+/g, ''), st = $('bv_state').value, vin = $('bv_vin').value.toUpperCase().trim();
      if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { showToast('That VIN is not 17 characters — fix it or clear it'); return; }
      if (vin && !window._bayVinDupSkipped) { var vm = DATA.vehicles.find(function (x) { return realVin(x.vin).toUpperCase() === vin; }); if (vm) { showExistingVehicleFoundModal(vm); return; } }
      if (plate && !window._bayPlateDupSkipped && typeof showPlateFoundModal === 'function') { var pm = DATA.vehicles.find(function (x) { return blank(x.licensePlate).toUpperCase() === plate && (x.plateState || '') === st; }); if (pm) { showPlateFoundModal(pm); return; } }
      window._bayVinDupSkipped = false; window._bayPlateDupSkipped = false;
      var ids = DATA.vehicles.map(function (x) { return x.id; }).concat((DATA.archivedVehicles || []).map(function (x) { return x.id; }));
      var newVid = Math.max.apply(null, [0].concat(ids)) + 1, tireSize = $('bv_tire').value.trim();
      DATA.vehicles.push({ id: newVid, year: year, make: make, model: model, trim: $('bv_trim').value.trim(), color: $('bv_color').value.trim(),
        engine: val('bv', 'engine') || '—', drivetrain: $('bv_drive').value || '—', transmission: $('bv_trans').value.trim() || '—',
        tires: tireSize ? { size: tireSize, brand: '', installMileage: null, installDate: '', tread: { fl: null, fr: null, rl: null, rr: null }, tpms: 'unknown', lastRotationMileage: null } : undefined,
        mileage: miles, licensePlate: plate, plateState: plate ? st : '', plateHistory: [], vin: vin, ownerId: null, accent: 'var(--blue-bright)', history: [] });
      bayState.serviceMileage = miles; bayState.vehicleId = newVid;
    }
    dGoto('bayCheckout', { bayStep: 'customer' });
  };

  /* ---------- customer app: Add / Edit Vehicle ---------- */
  var appField = function (label, html) { return '<div class="field"><label>' + label + '</label>' + html + '</div>'; };
  var COLORS = ['', 'White', 'Black', 'Gray', 'Silver', 'Red', 'Blue', 'Green', 'Brown', 'Beige/Tan', 'Gold', 'Orange', 'Yellow', 'Purple'];
  window.renderVehicleForm = function (isEdit) {
    var v = isEdit ? (DATA.vehicles.find(function (x) { return idsMatch(x.id, activeVehicleId); }) || {}) : {};
    if (isEdit) afterRender('f', function () { setValues('f', { year: v.year, make: v.make, model: v.model, engine: v.engine }); });
    return '<div class="back-row"><div class="back-btn" onclick="back()">' + svgIn('back', 18) + '</div><div class="topbar-title">' + (isEdit ? 'Edit Vehicle' : 'Add Vehicle') + '</div></div>' +
      '<div class="section-pad">' +
      pickers('f', { wrap: appField }) +
      '<div id="f_vfnote" style="display:none;font-size:11.5px;color:var(--warn);margin:-4px 0 12px;"></div>' +
      appField('Trim <span style="color:var(--text-low);font-weight:400;">(optional)</span>', '<input id="f_trim" placeholder="e.g. TRD Off Road" value="' + esc(v.trim || '') + '">') +
      appField('Color', '<select id="f_color">' + COLORS.map(function (c) { return '<option value="' + esc(c) + '"' + (v.color === c ? ' selected' : '') + '>' + esc(c || '— Select —') + '</option>'; }).join('') + '</select>') +
      appField('License Plate', '<div style="display:flex;gap:8px;"><input id="f_plate" placeholder="ABC-1234" autocomplete="off" value="' + esc(v.licensePlate || '') + '" style="flex:1;text-transform:uppercase;">' +
        '<select id="f_plate_state" style="flex-shrink:0;width:70px;">' + US_STATE_CODES.map(function (s) { return '<option' + ((v.plateState || 'TX') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        '<div style="font-size:11px;color:var(--text-low);margin-top:4px;">The plate is only recorded — it does not fill in the vehicle.</div>') +
      appField('VIN <span style="color:var(--text-low);font-weight:400;">(optional — leave it blank and add it later)</span>',
        '<div style="display:flex;gap:8px;"><input id="f_vin" class="mono" placeholder="17-character VIN" maxlength="17" autocomplete="off" value="' + esc(realVin(v.vin)) + '" style="flex:1;">' +
        '<button type="button" onclick="decodeVinToForm()" style="flex-shrink:0;background:var(--blue-bright);border:none;color:#fff;border-radius:9px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;">Decode VIN</button></div>' +
        '<div id="vinDecodeStatus" style="font-size:11px;color:var(--text-low);margin-top:4px;"></div>') +
      '<button class="btn btn-primary btn-block" onclick="saveVehicle(' + (isEdit ? 'true' : 'false') + ')">Save Vehicle</button></div>';
  };
  window.vehicleFormMakeChanged = function () {};
  // Decoding is something the user asks for, with a VIN they typed. A plate never triggers it.
  window.decodeVinToForm = function () {
    var vin = ($('f_vin').value || '').trim().toUpperCase(), statusEl = $('vinDecodeStatus');
    var say = function (t, c) { statusEl.textContent = t; statusEl.style.color = c; };
    if (vin.length !== 17) { say('VIN must be 17 characters', 'var(--danger)'); return Promise.resolve(); }
    say('Decoding…', 'var(--text-low)');
    return fetch('https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/' + encodeURIComponent(vin) + '?format=json').then(function (res) {
      if (!res.ok) throw new Error('lookup failed');
      return res.json();
    }).then(function (data) {
      var r = data.Results && data.Results[0];
      if (!r || (!r.Make && !r.Model)) { say('No data found for this VIN', 'var(--warn)'); return; }
      var engine = [r.DisplacementL ? parseFloat(r.DisplacementL).toFixed(1) + 'L' : '', r.EngineCylinders ? r.EngineCylinders + '-cyl' : ''].filter(Boolean).join(' ');
      if (r.Trim && $('f_trim')) $('f_trim').value = r.Trim;
      return setValues('f', { year: r.ModelYear, make: titleCase(r.Make), model: r.Model, engine: engine }).then(function () { say('✓ Decoded — review and adjust if needed', 'var(--success)'); });
    }).catch(function () { say('Could not reach VIN lookup service — choose the details manually', 'var(--warn)'); });
  };
  window.decodePlateToForm = function () {};   // there is no plate lookup; the plate is only recorded
  window.saveVehicle = function (isEdit) {
    var year = parseInt(val('f', 'year'), 10) || 0, make = val('f', 'make'), model = val('f', 'model');
    if (!year || !make || !model) { showToast('Year, make and model are required'); return; }
    if (!validYear(year)) { showToast('Check the year — ' + year + ' does not look right'); return; }
    var vin = ($('f_vin').value || '').trim().toUpperCase();
    if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { showToast('That VIN is not 17 characters — fix it or clear it'); return; }
    var rec = { year: year, make: make, model: model, trim: $('f_trim').value.trim(), color: $('f_color').value || '',
      licensePlate: ($('f_plate').value || '').trim().toUpperCase(), plateState: $('f_plate_state').value || '', vin: vin, engine: val('f', 'engine') || '—' };
    if (isEdit) {
      var v = DATA.vehicles.find(function (x) { return idsMatch(x.id, activeVehicleId); });
      if (!v) { showToast('That vehicle is no longer here'); return; }
      Object.assign(v, rec);
      showToast('Vehicle updated');
    } else {
      var id = Math.max.apply(null, [0].concat(DATA.vehicles.map(function (x) { return x.id; }))) + 1;
      DATA.vehicles.push(Object.assign({ id: id }, rec, { drivetrain: '—', transmission: '—', mileage: 0, accent: 'var(--purple)', history: [] }));
      activeVehicleId = id;
      showToast('Vehicle added to your garage');
    }
    if (typeof dmSyncSoon === 'function') dmSyncSoon();
    goto('vehicleDetail');
  };
  window.vehicleFormVersion = 1;
})();
