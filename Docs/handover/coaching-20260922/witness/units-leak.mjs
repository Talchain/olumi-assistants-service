/** Does the agent route quote the STORED NORMALISED value to the user?
 *  I reported this once, then withdrew it as intermittent (1 of 2). Measuring
 *  the rate properly this time, with the conventional route as a same-run
 *  control on the identical request. */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const SRC='105baa8c-f206-4880-9017-59803af99193';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## UNITS LEAK — build ${hz.build}\n`);
const [src]=await sql`select graph from public.scenarios where id=${SRC}`;
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const mk=async()=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},'ZZZ-UNITS','evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const ask=async(path,body)=>{const r=await fetch(`${BASE}${path}`,{method:'POST',headers:H(),
  body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const t=await r.text();
  let j=null;try{j=JSON.parse(t)}catch{};return String(j?.assistant_text??t);};
// Node bc936d4c: raw_value 9, unit months, stored normalised value 0.45.
let agentLeak=0, convLeak=0;
for (let i=1;i<=3;i++){
  const sid=await mk();
  const a=await ask('/agent/v1/turn',{scenario_id:sid,message:'Set Sales Cycle Length to 12 months.'});
  const leakA=/\b0\.45\b/.test(a);
  if(leakA)agentLeak++;
  console.log(`agent run ${i}: quotes 0.45 = ${leakA}  "${a.slice(0,95).replace(/\n/g,' ')}"`);
}
for (let i=1;i<=2;i++){
  const sid=await mk();
  const c=await ask('/orchestrate/v2/turn',{kind:'message',turn_id:randomUUID(),scenario_id:sid,
    stage:'frame',message:'Set Sales Cycle Length to 12 months.',turn_class:'decide',source:'composer'});
  const leakC=/\b0\.45\b/.test(c);
  if(leakC)convLeak++;
  console.log(`CONTROL conventional run ${i}: quotes 0.45 = ${leakC}  "${c.slice(0,95).replace(/\n/g,' ')}"`);
}
console.log(`\nagent leaked ${agentLeak}/3 · conventional control leaked ${convLeak}/2`);
await sql.end();
