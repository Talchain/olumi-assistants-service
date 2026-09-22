/**
 * THE DISCRIMINATING WITNESS FOR #1688, ON DEPLOYED STAGING.
 *
 * One run, one build, both arms — because the whole point of this fix is that
 * a REPLAY and a CONFLICT must be treated DIFFERENTLY. A probe that exercised
 * only one arm would score a correct build and a collapsed one identically.
 *
 *   REPLAY   same turn_id, SAME request     -> reconciles, receipt PRESERVED
 *   CONFLICT same turn_id, DIFFERENT request-> refuses, receipt ABSENT, no write
 *
 * Receipt rows report SKIP (never PASS) without a signed-in owner: a guest
 * mints no model_versions at all, so "no receipt" there is vacuous.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const OWNER = process.env.WITNESS_OWNER ?? null, JWT = process.env.WITNESS_JWT ?? null;
const SRC = '105baa8c-f206-4880-9017-59803af99193';
const rows = [];
const rec = (arm, name, state, detail='') => { rows.push({arm,name,state,detail});
  console.log(`  ${state.padEnd(4)} [${arm}] ${name}${detail?'  — '+detail:''}`); };
const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## REPLAY vs CONFLICT — build ${hz.build}  owner=${OWNER?'signed-in':'guest'}\n`);
const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const mk = async (t) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER},${t},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const turn = async (sid, tid, msg) => {
  const h = { 'content-type':'application/json','x-olumi-assist-key':KEY,'x-request-id':randomUUID() };
  if (JWT) h.authorization = `Bearer ${JWT}`;
  const r = await fetch(`${BASE}/orchestrate/v2/turn`, { method:'POST', headers:h,
    body: JSON.stringify({ kind:'message', turn_id:tid, scenario_id:sid, stage:'frame',
      message:msg, turn_class:'decide', source:'composer' }), signal: AbortSignal.timeout(240000) });
  const b = await r.text(); let j=null; try{j=JSON.parse(b)}catch{}; return {status:r.status,j,b};
};
const st = async (sid) => ({
  turns:(await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length,
  versions:(await sql`select 1 from public.model_versions where scenario_id=${sid}`).length,
  raw:(await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
    lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`)[0]?.r,
});
const txt = r => String(r.j?.assistant_text ?? r.b);
const receiptOf = r => (r.j ?? {}).model_version_receipt;

// ── REPLAY: same turn_id, SAME request. Must reconcile AND keep the receipt.
{
  const sid = await mk('ZZZ-RVC-REPLAY'); const T = randomUUID();
  await turn(sid, T, 'change Sales Cycle Length to 14');
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 17');   // intervening write
  const before = await st(sid);
  const replay = await turn(sid, T, 'change Sales Cycle Length to 14');
  const after = await st(sid);
  const t = txt(replay);
  rec('REPLAY','no duplicate turn or version', after.turns===before.turns && after.versions===before.versions ? 'PASS':'FAIL',
      `Δturns=${after.turns-before.turns} Δversions=${after.versions-before.versions}`);
  rec('REPLAY','says already recorded, claims no edit', /already been recorded/i.test(t) && !/\bUpdated\b/i.test(t) ? 'PASS':'FAIL', `"${t.slice(0,62)}"`);
  rec('REPLAY','reconciles to authoritative current state (17)', /\b17\b/.test(t) ? 'PASS':'FAIL', `"${t.slice(0,90)}"`);
  const p = (replay.j?.blocks??[]).find(b=>b?.type==='graph_patch');
  rec('REPLAY','graph_patch is noop', p===undefined||p.status!=='applied' ? 'PASS':'FAIL', `status=${p?.status??'(none)'}`);
  rec('REPLAY','⭐ the original receipt is PRESERVED', OWNER ? (receiptOf(replay)!==undefined?'PASS':'FAIL') : 'SKIP',
      OWNER ? `model_version_receipt=${receiptOf(replay)!==undefined?'present':'ABSENT'}` : 'guest mints none — vacuous');
}
// ── CONFLICT: same turn_id, DIFFERENT request. Must refuse AND drop the receipt.
{
  const sid = await mk('ZZZ-RVC-CONFLICT'); const T = randomUUID();
  await turn(sid, T, 'change Sales Cycle Length to 14');
  const before = await st(sid);
  const conflict = await turn(sid, T, 'change Sales Cycle Length to 25');
  await new Promise(r=>setTimeout(r,3000));
  const after = await st(sid);
  const t = txt(conflict);
  rec('CONFLICT','nothing was written', after.raw!=='25' && after.turns===before.turns ? 'PASS':'FAIL',
      `raw_value=${after.raw} Δturns=${after.turns-before.turns}`);
  rec('CONFLICT','does NOT claim the new value was applied', !(/\b25\b/.test(t) && /\bUpdated\b/i.test(t)) ? 'PASS':'FAIL', `"${t.slice(0,62)}"`);
  rec('CONFLICT','states plainly it did not make the change', /did not make that change/i.test(t) ? 'PASS':'FAIL', `"${t.slice(0,62)}"`);
  rec('CONFLICT','is NOT told "already recorded"', !/already been recorded/i.test(t) ? 'PASS':'FAIL');
  const p = (conflict.j?.blocks??[]).find(b=>b?.type==='graph_patch');
  rec('CONFLICT','graph_patch does NOT say applied', p===undefined||p.status!=='applied' ? 'PASS':'FAIL',
      `status=${p?.status??'(none)'} after=${p?.after?JSON.stringify(p.after).slice(0,34):'-'}`);
  rec('CONFLICT','⭐ the prior receipt is ABSENT', OWNER ? (receiptOf(conflict)===undefined?'PASS':'FAIL') : 'SKIP',
      OWNER ? `model_version_receipt=${receiptOf(conflict)===undefined?'absent':'LEAKED'}` : 'guest mints none — vacuous');
}
const p=rows.filter(r=>r.state==='PASS').length, f=rows.filter(r=>r.state==='FAIL').length, s=rows.filter(r=>r.state==='SKIP').length;
console.log(`\n### ${p} PASS · ${f} FAIL · ${s} SKIP   on build ${hz.build}`);
console.log(`⭐ The pair is the point: a build that collapsed the two arms would fail one of the two starred rows.`);
fs.writeFileSync(process.env.OUT ?? '/tmp/rvc.json', JSON.stringify({build:hz.build,owner:!!OWNER,rows},null,2));
await sql.end();
process.exit(f?1:0);
