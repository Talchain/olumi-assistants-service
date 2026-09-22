/** The panel lane's journey, on THEIR board, signed-in AND guest. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='90b70bd0-23e4-4431-b977-f2d1ecd680e2';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## INTERNATIONAL EXPANSION — build ${hz.build}\n`);
const [src]=await sql`select graph, brief_text, framing, brief from public.scenarios where id=${SRC}`;

const AUTH=[/Olumi's/gi,/not yours/gi,/still Olumi/gi,/Still Olumi's:/gi];
const scan=(blob)=>AUTH.map(p=>`${String(p)}=${(blob.match(p)||[]).length}`).join('  ');

async function arm(label, owner, jwt) {
  const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version,brief_text,framing,brief)
    values (${owner},${'ZZZ-IES-'+label},'evaluate',${sql.json(src.graph)},1,${src.brief_text},${src.framing},${src.brief}) returning id`)[0].id;
  const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if(jwt)h.authorization=`Bearer ${jwt}`;
  const post=(body)=>fetch(`${BASE}/orchestrate/v2/turn`,{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(240000)})
    .then(async r=>{const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:r.status,j,t};});

  const a1=await post({kind:'message',turn_id:randomUUID(),scenario_id:sid,stage:'analyse',message:'run the analysis',turn_class:'decide',source:'composer'});
  const before=scan(JSON.stringify(a1.j));
  const ed=await post({kind:'system_event',turn_id:randomUUID(),scenario_id:sid,stage:'analyse',
    event:{kind:'factor_value_edit',target_id:'fac_arr',value:0.6,field:'value'}});
  const [n]=await sql`select n->'observed_state'->>'source' s, n->'observed_state'->>'value' v
    from public.scenarios sc, lateral jsonb_array_elements(sc.graph->'nodes') n where sc.id=${sid} and n->>'id'='fac_arr'`;
  const vers=(await sql`select 1 from public.model_versions where scenario_id=${sid}`).length;
  const a2=await post({kind:'message',turn_id:randomUUID(),scenario_id:sid,stage:'analyse',message:'run the analysis',turn_class:'decide',source:'composer'});
  const after=scan(JSON.stringify(a2.j));
  console.log(`--- ${label} (${owner?'SIGNED-IN':'GUEST'})`);
  console.log(`    edit HTTP ${ed.status}  fac_arr.source=${n?.s}  value=${n?.v}  model_versions=${vers}`);
  console.log(`    authorship BEFORE edit : ${before}`);
  console.log(`    authorship AFTER re-run: ${after}`);
  console.log(`    changed = ${before!==after}`);
  return {label,owner:!!owner,editStatus:ed.status,source:n?.s,value:n?.v,versions:vers,before,after,
    text_after:String(a2.j?.assistant_text??'').slice(0,200)};
}
const s=await arm('SIGNEDIN',OWNER,JWT);
const g=await arm('GUEST',null,null);
fs.writeFileSync(process.env.OUT??'/tmp/ies.json',JSON.stringify({build:hz.build,signed:s,guest:g},null,2));
await sql.end();
