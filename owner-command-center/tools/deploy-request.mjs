// Prints the exact Vercel create-deployment request body for the recorded production release.
// Usage: node tools/deploy-request.mjs [preview|production] > request.json
// Unchanged files are referenced by SHA1 (Vercel already stores them); only the three release files are sent inline,
// and each of those is checked against its recorded SHA1 first, so the request can only reproduce the recorded release.
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'owner-command-center/release/production-manifest.json'), 'utf8'));
const target = process.argv[2] === 'production' ? 'production' : undefined;
const files = m.files.map((f) => {
  if (!f.inlineFrom) return { file: f.path, sha: f.sha1 };
  const data = fs.readFileSync(path.join(root, f.inlineFrom), 'utf8');
  const sha = createHash('sha1').update(data).digest('hex');
  if (sha !== f.sha1) throw new Error(`${f.inlineFrom} does not match the recorded release (${sha} != ${f.sha1})`);
  return { file: f.path, encoding: 'utf-8', data };
});
process.stdout.write(JSON.stringify({ name: 'mygarageappai-deploy-13', project: m.project, ...(target ? { target } : {}), files }, null, 1) + '\n');
