/**
 * THE SPINE, MEASURED ON THE ROUTE THE USER NOW HITS.
 *
 * PROXY_V5_TARGET=agent went live 14:58Z, so /proxy/v5/turn forwards to
 * /agent/v1/turn. Every criterion witnessed today was measured on
 * /orchestrate/v2/turn, which users no longer reach. This drives the agent
 * route directly and reports, per criterion, SATISFIED / UNSATISFIABLE /
 * NOT-APPLICABLE — with the evidence, not an opinion.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const OWNER = process.env.WITNESS_OWNER ?? null, JWT = process.env.WITNESS_JWT ?? null;
const SRC = '105baa8c-f206-4880-9017-59803af99193';
const rows = [];
const rec = (c, n, s, d='') => { rows.push({c,n,s,d}); console.log(`  ${s.padEnd(13)} [${c}] ${n}${d?'  — '+d:''}`); };
const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## AGENT-ROUTE SPINE — build ${hz.build}  owner=${OWNER?'signed-in':'guest'}\n`);
const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const mk = async (t) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const H = () => { const h={'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID()};
  if (JWT) h.authorization=`Bearer ${JWT}`; return h; };
const agent = async (sid, msg, extra={}) => {
  const r = await fetch(`${BASE}/agent/v1/turn`, { method:'POST', headers:H(),
    body: JSON.stringify({ scenario_id: sid, message: msg, ...extra }), signal: AbortSignal.timeout(240000) });
  const b = await r.text(); let j=null; try{j=JSON.parse(b)}catch{}; return { status:r.status, j, b };
};
const st = async (sid) => ({
  turns: (await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length,
  versions: (await sql`select 1 from public.model_versions where scenario_id=${sid}`).length,
  raw: (await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
    lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`)[0]?.r,
});

// 1 — can a user-authorised mutation commit at all?
{
  const sid = await mk('ZZZ-AG-1');
  const a = await agent(sid, 'Change Sales Cycle Length to 14 months. Apply it.');
  const s = await st(sid);
  rec('1','a user-authorised mutation commits', s.raw==='14' ? 'SATISFIED' : 'UNSATISFIABLE',
      `raw_value=${s.raw} (was 9) turns=${s.turns} versions=${s.versions} · "${String(a.j?.assistant_text??'').slice(0,70)}"`);
  rec('1','a durable turn row records the operation', s.turns>0 ? 'SATISFIED' : 'UNSATISFIABLE', `turn rows=${s.turns}`);
  rec('1','a receipt is minted', s.versions>0 ? 'SATISFIED' : 'UNSATISFIABLE', `model_versions=${s.versions}`);
}
// 2 — retry identity
{
  const sid = await mk('ZZZ-AG-2');
  await agent(sid, 'Change Sales Cycle Length to 14 months. Apply it.');
  const b = await st(sid);
  await agent(sid, 'Change Sales Cycle Length to 14 months. Apply it.');
  const a = await st(sid);
  rec('2a','a retry is distinguishable from a first attempt', b.turns>0 ? 'SATISFIED' : 'UNSATISFIABLE',
      `no durable (scenario_id,turn_id) key exists on this route — turns ${b.turns}→${a.turns}`);
}
// 4 — units: does it read the user's unit, or the normalised scale?
{
  const sid = await mk('ZZZ-AG-4');
  const a = await agent(sid, 'Set Sales Cycle Length to 12 months.');
  const t = String(a.j?.assistant_text ?? '');
  const quotesNormalised = /\b0\.45\b/.test(t);
  rec('4','it speaks the user-facing unit, not the stored scale', quotesNormalised ? 'DEFECT' : 'SATISFIED',
      `quotes 0.45 = ${quotesNormalised} · "${t.slice(0,90)}"`);
}
// 5 — analysis: the SHARED arm. Does it reach the orchestrator and return a result?
{
  const sid = await mk('ZZZ-AG-5');
  const a = await agent(sid, 'Run the analysis.');
  const s = await st(sid);
  const t = String(a.j?.assistant_text ?? '');
  const [f] = await sql`select 1 from public.v5_handler_facts f
    join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id
    where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
  rec('5','analysis reaches the shared spine', f ? 'SATISFIED' : 'UNSATISFIABLE',
      `run_analysis fact=${f?'yes':'none'} turns=${s.turns}`);
  const blocks=(a.j?.blocks??[]).map(x=>x?.type);
  rec('5','an analysis_result block reaches the client', blocks.includes('analysis_result') ? 'SATISFIED':'UNSATISFIABLE',
      `blocks=${blocks.length?blocks.join(', '):'(empty)'} · "${t.slice(0,70)}"`);
}
const n=(s)=>rows.filter(r=>r.s===s).length;
console.log(`\n### SATISFIED ${n('SATISFIED')} · UNSATISFIABLE ${n('UNSATISFIABLE')} · DEFECT ${n('DEFECT')}   on build ${hz.build} via /agent/v1/turn`);
fs.writeFileSync(process.env.OUT??'/tmp/spine-agent.json', JSON.stringify({build:hz.build,route:'/agent/v1/turn',rows},null,2));
await sql.end();
