/** CONTROL: does model CREATION mint a receipt on the CONVENTIONAL route?
 *  Without this, "the agent route mints no receipt" is not a finding — draft
 *  creation may legitimately mint none anywhere. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const ORIGIN='https://staging--olumi.netlify.app';
const hz=await (await fetch(`${BASE}/healthz`)).json();
const BRIEF='We are deciding whether to expand into Germany or the Nordics next year.';
const H=(o)=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if(o)h.origin=ORIGIN; if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const mkEmpty=async(t)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'frame',${sql.json({nodes:[],edges:[]})},1) returning id`)[0].id;
console.log(`## RECEIPT-ON-CREATION CONTROL — build ${hz.build}\n`);
for (const [label,path,useOrigin] of [['AGENT   (user surface) /proxy/v5/turn','/proxy/v5/turn',true],
                                      ['CONTROL (conventional) /orchestrate/v2/turn','/orchestrate/v2/turn',false]]) {
  const sid=await mkEmpty('ZZZ-RC');
  const r=await fetch(`${BASE}${path}`,{method:'POST',headers:H(useOrigin),
    body:JSON.stringify({kind:'message',turn_id:randomUUID(),scenario_id:sid,stage:'frame',
      message:BRIEF,turn_class:'frame',source:'composer'}),signal:AbortSignal.timeout(240000)});
  const b=await r.text();
  const nodes=(await sql`select jsonb_array_length(graph->'nodes') n from public.scenarios where id=${sid}`)[0]?.n;
  const vers=(await sql`select 1 from public.model_versions where scenario_id=${sid}`).length;
  const turns=(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length;
  const cur=(await sql`select current_model_version_id c from public.scenarios where id=${sid}`)[0]?.c;
  console.log(`${label}`);
  console.log(`   HTTP ${r.status}  nodes=0→${nodes}  turn_rows=${turns}  model_versions=${vers}  current_model_version_id=${cur?'set':'NULL'}`);
}
console.log(`\nA receipt on creation is only a DEFECT on the agent route if the control mints one.`);
await sql.end();
