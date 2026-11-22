// Fetches the Owner Command Center step from GitHub at ONE pinned commit and verifies every file's SHA-256 (same model as build.mjs).
import { createHash } from 'node:crypto'; import fs from 'node:fs';
const COMMIT = 'f9aadafc2ef7f9dc0da3dab3a21a75247cb85391';
const PINS = {
 "scripts/command-center.mjs": "d24330bd2b4198c0690d591a6df3d2a372df3b78364da0f38d01aac5c3262493",
 "scripts/command-center.pins.json": "2581038671d63ae48a53f0ce0a04145049bebc8c6861143209572e3fac8267e1",
 "scripts/cc-lib.js": "ddbc35468bded25605914b5e1545083d28745dffdaf089787e6841f3dd83e918",
 "scripts/cc-presence.js": "d19ae955afacd753fe5ac648f4e3d5374dc18226d3c4b26917dbd426f070e9e7",
 "scripts/cc-ui.html": "ff4363632de82d1816a9aaf8e2259ba83d2904edb600715248884ec6a497441b",
 "scripts/cc-tests.mjs": "85c3472d1de41b8329dae13254b2a9f0693c52b61d0c48213eaf52bc576655a7"
};
for (const [f, sha] of Object.entries(PINS)) {
  const r = await fetch('https://raw.githubusercontent.com/whiskeylinton-maker/mygarageappai/' + COMMIT + '/owner-command-center/' + f);
  if (!r.ok) throw new Error('fetch-cc: could not download ' + f + ' (' + r.status + ')');
  const b = Buffer.from(await r.arrayBuffer());
  if (createHash('sha256').update(b).digest('hex') !== sha) throw new Error('fetch-cc: ' + f + ' does not match the reviewed version');
  if (fs.existsSync(f)) throw new Error('fetch-cc: ' + f + ' already exists');
  fs.writeFileSync(f, b);
}
console.log('fetch-cc ok: ' + Object.keys(PINS).length + ' files verified at ' + COMMIT.slice(0, 7));
