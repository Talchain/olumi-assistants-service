import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const turn=async(sid,tid,msg)=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
 if(JWT)h.authorization=`Bearer ${JWT}`;
 const r=await fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:h,
  body:JSON.stringify({kind:'message',turn_id:tid,scenario_id:sid,stage:'frame',message:msg,turn_class:'decide',source:'composer'}),
  signal:AbortSignal.timeout(240000)});
 const b=await r.text();let j=null;try{j=JSON.parse(b)}catch{} ;return{status:r.status,j,b};};
const raw=async(sid)=>(await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
  lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`)[0]?.r;
const turns=async(sid)=>(await sql`select turn_id from public.v5_conversation_turns where scenario_id=${sid}`).map(r=>r.turn_id);

const out=[];
for (const trial of [1,2]) {
  const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
    values (${OWNER},'ZZZ-IDREUSE2','evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
  const T1=randomUUID();
  await turn(sid,T1,'change Sales Cycle Length to 14');
  const b=await turn(sid,T1,'change Sales Cycle Length to 25');
  await new Promise(r=>setTimeout(r,4000));            // rule out a late/async write
  const v=await raw(sid), ts=await turns(sid);
  const blocks=(b.j?.blocks??[]).map(x=>({type:x?.type,status:x?.status,after:x?.after?JSON.stringify(x.after).slice(0,90):undefined}));
  const txt=String(b.j?.assistant_text??'');
  console.log(`\n=== trial ${trial} === value_after_4s=${v}  turn_rows=${ts.length}  sameId=${ts.filter(t=>t===T1).length}`);
  console.log(`   text: "${txt.slice(0,150)}"`);
  console.log(`   blocks: ${JSON.stringify(blocks)}`);
  console.log(`   claims25=${/\b25\b/.test(txt)}  claimsUpdated=${/\bUpdated\b/i.test(txt)}  actual=${v}`);
  out.push({trial,value:v,turn_rows:ts.length,blocks,text:txt});
}
fs.writeFileSync(process.env.OUT??'/tmp/idreuse2.json',JSON.stringify({build:hz.build,out},null,2));
await sql.end();
