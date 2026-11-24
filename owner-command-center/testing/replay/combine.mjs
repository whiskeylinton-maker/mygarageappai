import fs from 'fs'; import crypto from 'crypto';
const [dir, out, list] = process.argv.slice(2);
const files = fs.readFileSync(list, 'utf8').trim().split('\n');
let sql = '-- drivemetrik-test ONLY (rtzlcizqmphfykwsswxj). Production migrations 10-30, exactly as stored in production history.\n'
  + '-- One transaction: if any statement fails, nothing is applied. Refuses to run on a database that has shops (production).\n'
  + 'begin;\n'
  + "do $g$ begin if exists (select 1 from public.shops limit 1) then raise exception 'Refusing: this database has shops, so it is not the empty test project.'; end if; end $g$;\n\n";
for (const f of files) {
  const body = fs.readFileSync(dir + '/' + f, 'utf8');
  if (body.includes('$dmmig$')) throw new Error('tag clash ' + f);
  const m = f.match(/^(\d+)_(.+)\.sql$/);
  const h = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
  sql += `-- ===== ${f} (sha256 ${h}) =====\n${body}\n;\n`;
  sql += `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${m[1]}', '${m[2]}', array[$dmmig$${body}$dmmig$]) on conflict (version) do nothing;\n\n`;
}
sql += 'commit;\n';
fs.writeFileSync(out, sql);
console.log(files.length, 'migrations,', Buffer.byteLength(sql), 'bytes');
