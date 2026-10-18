import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const oldLine="  const accepted=confirm('Subscribe to DriveMetrik '+plan.label+' for $'+plan.price+'/month, billed monthly until canceled? Payment details are entered securely on Stripe Checkout. Continuing records your consent to this recurring monthly subscription.');";
const newLines="  const commitment=typeof shopCommitmentLabel==='function'?shopCommitmentLabel(planKey):'month-to-month, cancel anytime';\n  const accepted=confirm('Subscribe to DriveMetrik '+plan.label+' for $'+plan.price+'/month. Commitment: '+commitment+'. Payment details are entered securely on Stripe Checkout. Continuing records your consent to this recurring subscription.');";
for(const file of ['index.html','api/index.html']){
  let html=fs.readFileSync(file,'utf8');
  const first=html.indexOf(oldLine);
  if(first<0||html.indexOf(oldLine,first+oldLine.length)>=0) throw new Error(file+': expected exactly one outdated consent prompt');
  html=html.slice(0,first)+newLines+html.slice(first+oldLine.length);
  if(!html.includes('const commitment=typeof shopCommitmentLabel')) throw new Error(file+': commitment text missing after patch');
  const tags=[...html.matchAll(/<script\s*>/gi)];
  const tag=tags[tags.length-1];
  if(!tag) throw new Error(file+': inline app script missing');
  const end=html.indexOf('</script>',tag.index+tag[0].length);
  if(end<0) throw new Error(file+': app script closing tag missing');
  const tmp=path.join(os.tmpdir(),'drivemetrik-consent-'+process.pid+'.js');
  fs.writeFileSync(tmp,html.slice(tag.index+tag[0].length,end),'utf8');
  execFileSync(process.execPath,['--check',tmp],{stdio:'inherit'});
  fs.unlinkSync(tmp);
  fs.writeFileSync(file,html,'utf8');
  console.log('Consent copy syntax-checked and updated: '+file);
}