/** Reproduce criterion 2b and dump the FULL reply + blocks + node state. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},'ZZZ-RECON','evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const turn=async(tid,msg)=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
 if(JWT)h.authorization=`Bearer ${JWT}`;
 const r=await fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:h,
  body:JSON.stringify({kind:'message',turn_id:tid,scenario_id:sid,stage:'frame',message:msg,turn_class:'decide',source:'composer'}),
  signal:AbortSignal.timeout(240000)});
 const b=await r.text();let j=null;try{j=JSON.parse(b)}catch{};return{status:r.status,j};};
const T1=randomUUID();
await turn(T1,'change Sales Cycle Length to 14');
await turn(randomUUID(),'change Sales Cycle Length to 17');
const [n]=await sql`select n->>'display_value' dv, n->>'label' lbl, n->'observed_state'->>'raw_value' raw
  from public.scenarios s, lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`;
console.log(`build ${hz.build}`);
console.log(`node BEFORE retry: label=${JSON.stringify(n?.lbl)} display_value=${JSON.stringify(n?.dv)} raw=${n?.raw}`);
const retry=await turn(T1,'change Sales Cycle Length to 14');
console.log(`\nretry HTTP ${retry.status}`);
console.log(`FULL assistant_text:\n---\n${String(retry.j?.assistant_text??'')}\n---`);
for (const b of (retry.j?.blocks??[])) console.log(`block ${b?.type}: status=${b?.status} target_id=${b?.target_id} after=${JSON.stringify(b?.after)}`);
await sql.end();
