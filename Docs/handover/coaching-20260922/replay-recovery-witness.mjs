import pg from 'pg';
import { randomUUID } from 'node:crypto';
const pw=process.env.SUPABASE_DB_PASSWORD, ref=(process.env.SUPABASE_URL||'').replace(/^https?:\/\//,'').split('.')[0];
const c=new pg.Client({host:'aws-0-us-east-1.pooler.supabase.com',port:5432,database:'postgres',user:`postgres.${ref}`,password:pw,ssl:{rejectUnauthorized:false}});
await c.connect();

const SC = '0000dead-0000-4000-8000-00000bee f00d'.replace(/\s/g,'');
const T1='replay-witness-T1', T2='replay-witness-T2', T3='replay-witness-T3';
const M1=randomUUID(), M3=randomUUID();
const hx=(d)=>d.repeat(64).slice(0,64);
const H0=hx('a0'), H1=hx('b1'), H2=hx('c2'), H3=hx('d3');
const g=(n)=>({schema_version:'3.0.0',nodes:[{id:'fac_'+n,kind:'factor',label:'w'+n}],edges:[]});

const q=(s,p)=>c.query(s,p);
const cleanup=async()=>{
  await q(`delete from public.model_versions where scenario_id=$1`,[SC]).catch(()=>{});
  await q(`delete from public.v5_conversation_turns where scenario_id=$1`,[SC]).catch(()=>{});
  await q(`delete from public.v5_turn_fence where scenario_id=$1`,[SC]).catch(()=>{});
  await q(`update public.scenarios set current_model_version_id=null where id=$1`,[SC]).catch(()=>{});
  await q(`delete from public.scenarios where id=$1`,[SC]).catch(()=>{});
};
await cleanup();

const u=await q(`select user_id from public.scenarios where user_id is not null limit 1`);
const USER=u.rows[0]?.user_id ?? null;
const st=await q(`select analysis_status, count(*)::int n from public.scenarios group by 1 order by n desc limit 3`);
console.log('analysis_status values in use:', st.rows.map(r=>r.analysis_status+'('+r.n+')').join(', '));
const STATUS=st.rows[0].analysis_status;
console.log('witness scenario:', SC, '| borrowed user_id present:', USER!==null);

await q(`insert into public.scenarios (id,user_id,title,scenario_schema_version,stage,graph,graph_identity_hash,analysis_status,events,event_seq,last_turn_nonce,is_pinned,is_archived)
         values ($1,$2,'REPLAY WITNESS — delete me',3,'frame',$3,$4,$5,'[]'::jsonb,0,0,false,false)`,[SC,USER,g(0),H0,STATUS]);

const call=(turn,graph,expected,incoming,mutation)=>q(
 `select public.append_turn_atomic_v5($1,$2,'direct_answer',null,'sha256:w',true,0,1,'[]'::jsonb,$3,null,'[]'::jsonb,null,'u','a',$4,$5,true,null,$6,$7,'sha256','v1','v1','3.0.0','known',$8,'committed_mutation',$2,true) as r`,
 [SC,turn,graph,expected,incoming,mutation,incoming,USER]);

const counts=async(tag)=>{
 const t=await q(`select count(*)::int n from public.v5_conversation_turns where scenario_id=$1`,[SC]);
 const v=await q(`select count(*)::int n from public.model_versions where scenario_id=$1`,[SC]);
 const h=await q(`select graph_identity_hash from public.scenarios where id=$1`,[SC]);
 console.log(`  [${tag}] turns=${t.rows[0].n} versions=${v.rows[0].n} head=${h.rows[0].graph_identity_hash}`);
 return {turns:t.rows[0].n, versions:v.rows[0].n};
};

try {
  console.log('\nSTEP 1 — original commit (T1), expected=H0');
  const r1=await call(T1,g(1),H0,H1,M1); const j1=r1.rows[0].r;
  console.log('  returned turn_row_id:', j1.turn_row_id, '| receipt:', j1.model_version_receipt? 'PRESENT':'null');
  const c1=await counts('after 1');

  console.log('\nSTEP 2 — a DIFFERENT turn moves the head (T2), expected=H1');
  await call(T2,g(2),H1,H2,randomUUID());
  await counts('after 2');

  console.log('\nSTEP 3 — REPLAY of T1 with its ORIGINAL (now stale) expected=H0');
  const r3=await call(T1,g(1),H0,H1,M1); const j3=r3.rows[0].r;
  console.log('  returned turn_row_id:', j3.turn_row_id, '| receipt:', j3.model_version_receipt? 'PRESENT':'null');
  const c3=await counts('after 3');
  console.log('  SAME turn row as the original?  ', j3.turn_row_id===j1.turn_row_id);
  console.log('  NO duplicate turn row?          ', c3.turns===c1.turns+1);
  console.log('  NO duplicate version?           ', c3.versions===(await (async()=>c1.versions)())+1 || c3.versions<=c1.versions+1);
  if (j1.model_version_receipt && j3.model_version_receipt)
    console.log('  receipt version_id identical?   ', j1.model_version_receipt.version_id===j3.model_version_receipt.version_id);

  console.log('\nSTEP 4 — CONTRAST: a genuinely NEW mutation (T3) with the SAME stale expected=H0');
  try { const r4=await call(T3,g(3),H0,H3,M3);
        console.log('  ⛔ ACCEPTED — returned', r4.rows[0].r.turn_row_id, '(the stale write was NOT refused)'); }
  catch(e){ console.log('  ✅ REFUSED:', (e.code||'')+' '+String(e.message).slice(0,120)); }
  await counts('after 4');
} catch(e) {
  console.log('WITNESS ERROR:', e.code||'', String(e.message).slice(0,300));
} finally {
  console.log('\n=== cleanup ==='); await cleanup();
  const left=await q(`select count(*)::int n from public.scenarios where id=$1`,[SC]);
  console.log('scenario rows remaining:', left.rows[0].n);
  await c.end();
}
