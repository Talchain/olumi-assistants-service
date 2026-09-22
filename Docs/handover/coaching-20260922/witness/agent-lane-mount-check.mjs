import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## AGENT LANE MOUNT CHECK — build ${hz.build}\n`);
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const mk=async(t)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;

// 1. MOUNTED? Discriminator: a route that exists answers from its own handler.
const sid1=await mk('ZZZ-AGENT-MOUNT');
const r1=await fetch(`${BASE}/agent/v1/turn`,{method:'POST',headers:H(),
  body:JSON.stringify({scenario_id:sid1,message:'hello'}),signal:AbortSignal.timeout(120000)});
const b1=(await r1.text()).slice(0,200);
const ctl=await fetch(`${BASE}/agent/v1/zzz-does-not-exist`,{method:'POST',headers:H(),body:'{}'});
console.log(`1. POST /agent/v1/turn        -> HTTP ${r1.status}   ${b1.slice(0,120)}`);
console.log(`   CONTROL absent route       -> HTTP ${ctl.status}`);
console.log(`   MOUNTED: ${r1.status !== 404 && ctl.status === 404}\n`);

// 2. READ-ONLY? Ask it to MUTATE and require a refusal (test the refusal, not the absence).
if (r1.status !== 404) {
  const sid2=await mk('ZZZ-AGENT-RO');
  const before=(await sql`select graph_identity_hash h from public.scenarios where id=${sid2}`)[0]?.h;
  const r2=await fetch(`${BASE}/agent/v1/turn`,{method:'POST',headers:H(),
    body:JSON.stringify({scenario_id:sid2,message:'Change Sales Cycle Length to 42 months. Apply it now.'}),
    signal:AbortSignal.timeout(240000)});
  const t2=await r2.text();
  const after=(await sql`select graph_identity_hash h from public.scenarios where id=${sid2}`)[0]?.h;
  const [n]=await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
    lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid2} and n->>'id'='bc936d4c'`;
  console.log(`2. mutation attempt           -> HTTP ${r2.status}`);
  console.log(`   graph hash before/after    : ${String(before).slice(0,10)} / ${String(after).slice(0,10)}  changed=${before!==after}`);
  console.log(`   Sales Cycle raw_value      : ${n?.r}  (must NOT be 42)`);
  console.log(`   reply: ${t2.slice(0,220)}`);
  console.log(`   READ-ONLY HELD: ${n?.r !== '42' && before === after}\n`);
}

// 3. Does /proxy/v5/turn still reach the ORCHESTRATOR? Behavioural, not config.
const sid3=await mk('ZZZ-PROXY-TARGET');
const T=randomUUID();
const r3=await fetch(`${BASE}/proxy/v5/turn`,{method:'POST',headers:H(),
  body:JSON.stringify({kind:'message',turn_id:T,scenario_id:sid3,stage:'frame',
    message:'change Sales Cycle Length to 11',turn_class:'decide',source:'composer'}),
  signal:AbortSignal.timeout(240000)});
const t3=await r3.text();
const turns=(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid3} and turn_id=${T}`).length;
console.log(`3. POST /proxy/v5/turn        -> HTTP ${r3.status}`);
console.log(`   v5_conversation_turns row  : ${turns}   (orchestrator writes one; agent route writes NONE)`);
console.log(`   FORWARDS TO ORCHESTRATOR: ${turns === 1}`);
console.log(`   reply: ${t3.slice(0,140)}`);
await sql.end();
