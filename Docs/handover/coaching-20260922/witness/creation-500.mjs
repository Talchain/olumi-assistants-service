/** Is creation on the user's surface returning 500s? Capture status + body. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const ORIGIN='https://staging--olumi.netlify.app';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## CREATION STATUS — build ${hz.build}\n`);
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID(),origin:ORIGIN};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const BRIEF='We are deciding whether to expand into Germany or the Nordics next year.';
let ok=0, fail=0;
for (let i=1;i<=4;i++){
  const sid=(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
    values (${OWNER},'ZZZ-C500','frame',${sql.json({nodes:[],edges:[]})},1) returning id`)[0].id;
  let st=0, body='';
  try{
    const r=await fetch(`${BASE}/proxy/v5/turn`,{method:'POST',headers:H(),
      body:JSON.stringify({kind:'message',turn_id:randomUUID(),scenario_id:sid,stage:'frame',
        message:BRIEF,turn_class:'frame',source:'composer'}),signal:AbortSignal.timeout(240000)});
    st=r.status; body=(await r.text()).slice(0,200).replace(/\n/g,' ');
  }catch(e){ st=0; body='TRANSPORT '+(e?.message??e); }
  const n=(await sql`select jsonb_array_length(graph->'nodes') n from public.scenarios where id=${sid}`)[0]?.n;
  if(st===200 && n>0) ok++; else fail++;
  console.log(`run ${i}: HTTP ${st}  nodes=${n}${st!==200?'  body: '+body:''}`);
}
console.log(`\nhealthy ${ok}/4 · not-healthy ${fail}/4`);
await sql.end();
