/** DISCRIMINATING probe. `_agent` is present ONLY on the agent route;
 *  `_diagnostic_trace`/`analysis_ready` only on the orchestrator. A turn row is
 *  NOT a discriminator: the agent's build_model_from_brief writes one via the
 *  graph-register writer. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const ORIGIN='https://staging--olumi.netlify.app';
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## DISCRIMINATING ROUTE PROBE — build ${hz.build}\n`);
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID(),origin:ORIGIN};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const mk=async(t,g)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(g)},1) returning id`)[0].id;

const cases=[
  ['/proxy/v5/turn  · EMPTY graph  · frame', '/proxy/v5/turn', {nodes:[],edges:[]}, 'We are deciding whether to expand into Germany or the Nordics.', 'frame'],
  ['/proxy/v5/turn  · POPULATED    · edit ', '/proxy/v5/turn', src.graph, 'change Sales Cycle Length to 11', 'decide'],
  ['/proxy/v5/turn/stream · EMPTY   · frame', '/proxy/v5/turn/stream', {nodes:[],edges:[]}, 'We are deciding whether to expand into Germany or the Nordics.', 'frame'],
];
for (const [label,path,graph,msg,tc] of cases) {
  const sid=await mk('ZZZ-DISC', graph); const T=randomUUID();
  let status=0, body='';
  try{
    const r=await fetch(`${BASE}${path}`,{method:'POST',headers:H(),
      body:JSON.stringify({kind:'message',turn_id:T,scenario_id:sid,stage:'frame',message:msg,turn_class:tc,source:'composer'}),
      signal:AbortSignal.timeout(240000)});
    status=r.status; body=await r.text();
  }catch(e){ body='ERR '+(e?.message??e); }
  const hasAgent=/"_agent"/.test(body);
  const hasDiag=/_diagnostic_trace|analysis_ready/.test(body);
  const turns=(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length;
  const nodes=(await sql`select jsonb_array_length(graph->'nodes') n from public.scenarios where id=${sid}`)[0]?.n;
  const verdict = hasAgent && !hasDiag ? 'AGENT' : hasDiag && !hasAgent ? 'ORCHESTRATOR' : 'INDETERMINATE';
  console.log(`${label}`);
  console.log(`   HTTP ${status}  _agent=${hasAgent}  _diagnostic_trace|analysis_ready=${hasDiag}  turn_rows=${turns}  nodes=${nodes}`);
  console.log(`   VERDICT: ${verdict}\n`);
}
await sql.end();
