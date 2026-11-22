// Regenerates scripts/command-center.pins.json after a reviewed change. Usage: node tools/pin.mjs <dir with scripts/>
import { createHash } from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2] || '.'; const h = (a, f) => createHash(a).update(fs.readFileSync(path.join(dir, f))).digest('hex');
const own = Object.fromEntries(['scripts/cc-lib.js', 'scripts/cc-presence.js', 'scripts/cc-ui.html', 'scripts/cc-tests.mjs'].map((f) => [f, h('sha256', f)]));
// inputs = the files as they are AFTER scripts/owner.mjs + coupons.mjs + feedback.mjs (verified against the Nov 16 Owner Analytics build log)
const inputs = { 'api/watchtower.js': '8e0e97fc7de381bff5369060489e24ff1bbbf704', 'api/_lib/owner.js': '3f3d6aa49932d54d456ee2c30b3de7a0d9549a02', 'api/_lib/supabase.js': '9a73d1e4b593b3b0add0727ac4cf4e59b67dc501' };
fs.writeFileSync(path.join(dir, 'scripts/command-center.pins.json'), JSON.stringify({ own, inputs }, null, 1) + '\n');
console.log(JSON.stringify({ own, inputs }, null, 1));
