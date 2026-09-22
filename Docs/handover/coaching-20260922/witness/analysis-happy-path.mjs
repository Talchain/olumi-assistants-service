/** Does a PLAIN analysis — no concurrent edit — still COMPLETE after #1679?
 *  criterion 5 only ever exercises the DIVERGED case. If the refusal fired on
 *  every run, the witness would still read 20/5 and miss it entirely. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},'ZZZ-HAPPY','evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
if(JWT)h.authorization=`Bearer ${JWT}`;
const r=await fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:h,
  body:JSON.stringify({kind:'message',turn_id:randomUUID(),scenario_id:sid,stage:'analyse',
    message:'run the analysis',turn_class:'decide',source:'composer'}),
  signal:AbortSignal.timeout(240000)});
const j=await r.json().catch(()=>null);
const txt=String(j?.assistant_text??'');
const blocks=(j?.blocks??[]).map(b=>b?.type);
const [f]=await sql`select f.payload->'result'->>'graph_hash_at_run' har from public.v5_handler_facts f
  join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id
  where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
const refused=/stopped rather than mix|changed while this analysis/i.test(txt);
const ar=j?.analysis_ready;
console.log(`build ${hz.build}  HTTP ${r.status}`);
console.log(`blocks: ${blocks.join(', ')}`);
console.log(`handler fact row written : ${f?.har ? 'YES ('+String(f.har).slice(0,12)+')' : 'NO'}`);
console.log(`analysis_ready.freshness : ${ar?.freshness}  reason=${ar?.freshness_reason}`);
console.log(`spuriously REFUSED       : ${refused}`);
console.log(`text: "${txt.slice(0,200)}"`);
console.log(`\nHAPPY PATH INTACT: ${r.status===200 && !refused && Boolean(f?.har) && ar?.freshness==='fresh'}`);
await sql.end();
