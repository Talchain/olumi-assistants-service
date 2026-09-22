import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const ORIGIN='https://staging--olumi.netlify.app';
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## /proxy/v5/turn TARGET — build ${hz.build}  (PROXY_V5_TARGET=agent)\n`);
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const mk=async(t)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID(),'origin':ORIGIN};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};

const sid=await mk('ZZZ-PROXY-REAL'); const T=randomUUID();
const r=await fetch(`${BASE}/proxy/v5/turn`,{method:'POST',headers:H(),
  body:JSON.stringify({kind:'message',turn_id:T,scenario_id:sid,stage:'frame',
    message:'change Sales Cycle Length to 11',turn_class:'decide',source:'composer'}),
  signal:AbortSignal.timeout(240000)});
const t=await r.text(); let j=null; try{j=JSON.parse(t)}catch{}
const turns=(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length;
const [n]=await sql`select n->'observed_state'->>'raw_value' rv from public.scenarios s,
  lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`;
const blocks=(j?.blocks??[]).map(b=>b?.type);
console.log(`HTTP ${r.status}`);
console.log(`v5_conversation_turns rows : ${turns}`);
console.log(`blocks                     : ${blocks.length? blocks.join(', ') : '(empty)'}`);
console.log(`Sales Cycle raw_value      : ${n?.rv}  (9 = unchanged, 11 = applied)`);
console.log(`assistant_text: "${String(j?.assistant_text??t).slice(0,240)}"`);
console.log(`\nSERVED BY AGENT ROUTE (no turn row, empty blocks): ${turns===0 && blocks.length===0}`);
console.log(`EDIT APPLIED                                      : ${n?.rv==='11'}`);
await sql.end();
