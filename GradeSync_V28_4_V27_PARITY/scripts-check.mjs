import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
function walk(dir){
  return readdirSync(dir).flatMap(name=>{
    const p=join(dir,name); const s=statSync(p);
    return s.isDirectory()?walk(p):(p.endsWith('.js')?[p]:[]);
  });
}
const files=[...walk('src'),...walk('api'),...walk('tests')];
let fail=false;
for(const f of files){
  const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});
  if(r.status!==0) fail=true;
}
process.exit(fail?1:0);
