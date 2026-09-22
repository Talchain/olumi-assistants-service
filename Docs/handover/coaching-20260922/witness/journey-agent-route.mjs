/**
 * THE CANONICAL JOURNEY, ON THE ROUTE USERS ACTUALLY REACH (/proxy/v5/turn).
 * Criterion 1 of the goal — "a user-authorised real mutation commits exactly
 * once under stable operation identity" — tested against build_model_from_brief,
 * which is reported to have NO durable key (only a read-before check: a TOCTOU
 * window, not a key). A user double-submitting a brief is the ordinary case.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE='https://cee-staging.onrender.com', KEY=env.ASSIST_API_KEY;
const OWNER=process.env.WITNESS_OWNER, JWT=process.env.WITNESS_JWT;
const ORIGIN='https://staging--olumi.netlify.app';
const hz=await (await fetch(`${BASE}/healthz`)).json();
console.log(`## CANONICAL JOURNEY ON /proxy/v5/turn — build ${hz.build}\n`);
const H=()=>{const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID(),origin:ORIGIN};
  if(JWT)h.authorization=`Bearer ${JWT}`;return h;};
const mkEmpty=async(t)=>(await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'frame',${sql.json({nodes:[],edges:[]})},1) returning id`)[0].id;
const post=async(sid,msg,tid,tc='frame')=>{
  const r=await fetch(`${BASE}/proxy/v5/turn`,{method:'POST',headers:H(),
    body:JSON.stringify({kind:'message',turn_id:tid,scenario_id:sid,stage:'frame',message:msg,turn_class:tc,source:'composer'}),
    signal:AbortSignal.timeout(240000)});
  const b=await r.text(); let j=null; try{j=JSON.parse(b)}catch{}; return {status:r.status,j,b};
};
const snap=async(sid)=>({
  nodes:(await sql`select jsonb_array_length(graph->'nodes') n from public.scenarios where id=${sid}`)[0]?.n,
  turns:(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length,
  versions:(await sql`select 1 from public.model_versions where scenario_id=${sid}`).length,
  hash:(await sql`select graph_identity_hash h from public.scenarios where id=${sid}`)[0]?.h,
});
const BRIEF='We are deciding whether to expand into Germany or the Nordics next year.';
const out=[];

// A — EXACT RETRY of the same brief under the SAME turn_id (a user retrying).
{
  const sid=await mkEmpty('ZZZ-JA-RETRY'); const T=randomUUID();
  const a=await post(sid,BRIEF,T); const s1=await snap(sid);
  const b=await post(sid,BRIEF,T); const s2=await snap(sid);
  console.log(`A. SAME turn_id twice (exact retry)`);
  console.log(`   after 1st: nodes=${s1.nodes} turns=${s1.turns} versions=${s1.versions} hash=${String(s1.hash).slice(0,10)}`);
  console.log(`   after 2nd: nodes=${s2.nodes} turns=${s2.turns} versions=${s2.versions} hash=${String(s2.hash).slice(0,10)}`);
  console.log(`   graph REPLACED again: ${s1.hash !== s2.hash}   duplicate turn rows: ${s2.turns - s1.turns}`);
  console.log(`   2nd reply: "${String(b.j?.assistant_text??'').slice(0,110)}"\n`);
  out.push({case:'same_turn_id',s1,s2,replaced:s1.hash!==s2.hash});
}
// B — DIFFERENT turn_id, same brief (a user re-sending / double-click).
{
  const sid=await mkEmpty('ZZZ-JA-DOUBLE');
  const a=await post(sid,BRIEF,randomUUID()); const s1=await snap(sid);
  const b=await post(sid,BRIEF,randomUUID()); const s2=await snap(sid);
  console.log(`B. DIFFERENT turn_id, same brief (double submit)`);
  console.log(`   after 1st: nodes=${s1.nodes} turns=${s1.turns} hash=${String(s1.hash).slice(0,10)}`);
  console.log(`   after 2nd: nodes=${s2.nodes} turns=${s2.turns} hash=${String(s2.hash).slice(0,10)}`);
  console.log(`   graph REPLACED again: ${s1.hash !== s2.hash}`);
  console.log(`   2nd reply: "${String(b.j?.assistant_text??'').slice(0,110)}"\n`);
  out.push({case:'different_turn_id',s1,s2,replaced:s1.hash!==s2.hash});
}
// C — CONCURRENT identical briefs: the race the TOCTOU window describes.
{
  const sid=await mkEmpty('ZZZ-JA-RACE');
  const [x,y]=await Promise.all([post(sid,BRIEF,randomUUID()),post(sid,BRIEF,randomUUID())]);
  const s=await snap(sid);
  const claims=[x,y].filter(r=>/set up|drafted|I.{0,3}ve built|created/i.test(String(r.j?.assistant_text??''))).length;
  console.log(`C. CONCURRENT identical briefs (the TOCTOU window)`);
  console.log(`   nodes=${s.nodes} turns=${s.turns} versions=${s.versions}`);
  console.log(`   both claimed to have built a model: ${claims}/2   statuses ${x.status}/${y.status}`);
  out.push({case:'concurrent',s,claims});
}
fs.writeFileSync(process.env.OUT??'/tmp/journey-agent.json',JSON.stringify({build:hz.build,out},null,2));
await sql.end();
