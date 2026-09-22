/**
 * THE SIGNED-IN REPEAT the panel lane cannot make.
 * Q: does a Model-tab `factor_value_edit` have a RECEIPT-BEARING carrier?
 * A guest mints no model_versions at all, so a guest run cannot tell
 * "no carrier" from "carrier exists but guests are excluded".
 * Signed-in arm + guest arm as the control, same event, same build.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## RECEIPT CARRIER PROBE — build ${hz.build}\n`);
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;

async function arm(label, owner, jwt) {
  const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
    values (${owner},${'ZZZ-RECEIPT-'+label},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
  const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if(jwt)h.authorization=`Bearer ${jwt}`;
  const body={kind:'system_event',turn_id:randomUUID(),scenario_id:sid,stage:'analyse',
    event:{kind:'factor_value_edit',target_id:'bc936d4c',value:14,field:'value'}};
  const r=await fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:h,
    body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
  const t=await r.text(); let j=null; try{j=JSON.parse(t)}catch{}
  const vers=await sql`select id,version_number,mutation_id from public.model_versions where scenario_id=${sid}`;
  const [node]=await sql`select n->'observed_state'->>'source' src, n->'observed_state'->>'raw_value' raw,
    n->>'provenance' prov from public.scenarios s, lateral jsonb_array_elements(s.graph->'nodes') n
    where s.id=${sid} and n->>'id'='bc936d4c'`;
  const turns=(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length;
  console.log(`--- ${label} (owner=${owner?'signed-in':'GUEST'}) HTTP ${r.status}`);
  console.log(`    model_versions rows : ${vers.length}`);
  console.log(`    turn rows           : ${turns}`);
  console.log(`    observed_state.source: ${node?.src}   raw_value: ${node?.raw}`);
  console.log(`    node.provenance      : ${node?.prov}`);
  if(r.status!==200) console.log(`    body: ${t.slice(0,240)}`);
  else console.log(`    text: "${String(j?.assistant_text??'').slice(0,110)}"`);
  return {label,status:r.status,versions:vers.length,turns,source:node?.src,raw:node?.raw,sid,
          body:r.status!==200?t.slice(0,400):undefined};
}
const signed = await arm('SIGNEDIN', OWNER, JWT);
const guest  = await arm('GUEST', null, null);
console.log(`\nCONTROL — guest mints ${guest.versions} version(s); signed-in mints ${signed.versions}.`);
console.log(`VERDICT: receipt-bearing carrier for factor_value_edit = ${signed.versions>0 ? 'YES (signed-in)' : 'NO — even signed-in'}`);
fs.writeFileSync(process.env.OUT??'/tmp/receipt.json',JSON.stringify({build:hz.build,signed,guest},null,2));
await sql.end();
