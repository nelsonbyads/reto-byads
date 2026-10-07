import fs from 'node:fs';
function parseEnv(p){const r={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<1)continue;r[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');}return r;}
const env=parseEnv('.env.local');
const url=env.VITE_SUPABASE_URL+'/rest/v1/rpc/__eco4b_consume_test';
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
const budget='00000000-0000-0000-0000-0000000000b1';
const post=(amount,keyName)=>fetch(url,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_budget:budget,p_amount:amount,p_key:keyName})}).then(r=>r.json());
const [a,b]=await Promise.all([post(25,'test-concurrent-a'),post(25,'test-concurrent-b')]);
console.log('concurrent A:',JSON.stringify(a));
console.log('concurrent B:',JSON.stringify(b));
const c1=await post(10,'test-idem-1');
const c2=await post(10,'test-idem-1');
console.log('idempotent first:',JSON.stringify(c1));
console.log('idempotent replay:',JSON.stringify(c2));
