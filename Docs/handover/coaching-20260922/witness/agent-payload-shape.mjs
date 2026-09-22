/** What does the agent route's payload actually carry? The UI's four flag-free
 *  staleness surfaces all bind to analysis_ready / blocks[].freshness. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const mk=async(t)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;

console.log(`## AGENT PAYLOAD SHAPE — build ${hz.build}\n`);
const sid=await mk('ZZZ-AG-PAYLOAD');
const r=await fetch(`${BASE}/agent/v1/turn`,{method:'POST',headers:H(),
  body:JSON.stringify({scenario_id:sid,message:'Run the analysis.'}),signal:AbortSignal.timeout(240000)});
const j=await r.json().catch(()=>null);
console.log(`agent  /agent/v1/turn   HTTP ${r.status}`);
console.log(`  top-level keys : ${Object.keys(j??{}).join(', ')}`);
console.log(`  analysis_ready : ${j?.analysis_ready ? 'PRESENT' : 'ABSENT'}`);
console.log(`  graph_hash     : ${j?.graph_hash ?? '(absent)'}`);
console.log(`  blocks         : ${(j?.blocks??[]).length} ${(j?.blocks??[]).map(b=>b?.type).join(', ')}`);

// CONTROL: the same request on the conventional route, same scenario family.
const sid2=await mk('ZZZ-AG-PAYLOAD-CTL');
const r2=await fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:H(),
  body:JSON.stringify({kind:'message',turn_id:randomUUID(),scenario_id:sid2,stage:'analyse',
    message:'run the analysis',turn_class:'decide',source:'composer'}),signal:AbortSignal.timeout(240000)});
const j2=await r2.json().catch(()=>null);
console.log(`\nCONTROL /orchestrate/v2/turn  HTTP ${r2.status}`);
console.log(`  top-level keys : ${Object.keys(j2??{}).slice(0,14).join(', ')}`);
console.log(`  analysis_ready : ${j2?.analysis_ready ? 'PRESENT (freshness='+j2.analysis_ready.freshness+')' : 'ABSENT'}`);
console.log(`  graph_hash     : ${j2?.graph_hash ?? '(absent)'}`);
console.log(`  blocks         : ${(j2?.blocks??[]).length} ${(j2?.blocks??[]).map(b=>b?.type).join(', ')}`);
await sql.end();
