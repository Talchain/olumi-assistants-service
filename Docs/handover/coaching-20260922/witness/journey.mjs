/**
 * FULL JOURNEY ACCEPTANCE HARNESS — write -> state -> reload -> analyse -> explain.
 *
 * Run:  node journey.mjs
 *   env CEE_BASE      default https://cee-staging.onrender.com
 *       WITNESS_OWNER a Supabase user id; omit for a GUEST scenario
 *
 * ⛔ A GUEST SCENARIO MINTS NO RECEIPT. Deployed `append_turn_atomic_v5` line 66 is
 *    `v_should_create := v_user_id IS NOT NULL`, so "no new version" on a guest is a
 *    VACUOUS pass. Pass WITNESS_OWNER to exercise receipts. Mint a throwaway owner
 *    with the UI's own helper (`e2e/core/lib/harness.ts mintWitnessUser`): an
 *    ordinary POST to /auth/v1/signup on the unroutable example.test domain.
 *    ⚠ Its JWT expires in ~1 hour.
 *
 * ⚠ PROBE TRAPS THAT COST REAL TIME, ALL MEASURED 22 Sep 2026:
 *   · `turn_class` must be frame|clarify|propose|decide|review — `edit` 422s.
 *     The `handler` value stored in v5_conversation_turns.turn_class is the
 *     COMMITTED class, not an ingress value.
 *   · wire `stage` is frame|analyse|decide|review, but the DATABASE's
 *     scenarios_stage_check accepts frame|ideate|evaluate|decide|optimise.
 *     Only `frame` and `decide` are in both. Do NOT echo scenarios.stage to the wire.
 *   · Supabase pooler: only aws-0-us-east-1 resolves.
 *   · IF EVERY ARM RETURNS THE SAME ANSWER, SUSPECT THE PROBE. An expired witness
 *     JWT refuses all arms identically and looks exactly like a product failure.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const OWNER = process.env.WITNESS_OWNER ?? null;
const JWT = process.env.WITNESS_JWT ?? null;
const SOURCE_GRAPH = '105baa8c-f206-4880-9017-59803af99193';
const pass = [], fail = [];
const check = (name, ok, detail='') => { (ok?pass:fail).push(name); console.log(`  ${ok?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## JOURNEY ACCEPTANCE — ${BASE} build ${hz.build} degraded=${hz.degraded}\n`);

const [src] = await sql`select graph from public.scenarios where id=${SOURCE_GRAPH}`;
const [mk] = await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER}, 'ZZZ-JOURNEY-ACCEPTANCE', 'evaluate', ${sql.json(src.graph)}, 1) returning id`;
const SID = mk.id;
console.log(`scenario ${SID}  owner=${OWNER ?? 'guest (no receipts)'}\n`);

function turn(turnId, msg, stage) {
  const headers = { 'content-type':'application/json', 'x-olumi-assist-key':KEY, 'x-request-id':randomUUID() };
  if (JWT) headers.authorization = `Bearer ${JWT}`;
  return fetch(`${BASE}/orchestrate/v2/turn`, { method:'POST', headers,
    body: JSON.stringify({ kind:'message', turn_id:turnId, scenario_id:SID, stage, message:msg, turn_class:'decide', source:'composer' }),
    signal: AbortSignal.timeout(240000) }).then(async r => { const b = await r.text(); let j=null; try{j=JSON.parse(b);}catch{} return {status:r.status, j, b}; });
}
const text = r => String(r.j?.assistant_text ?? r.b).slice(0,200);
async function state(){
  const t = await sql`select turn_id from public.v5_conversation_turns where scenario_id=${SID}`;
  const v = await sql`select id from public.model_versions where scenario_id=${SID} order by version_number`;
  const [s] = await sql`select graph_identity_hash h from public.scenarios where id=${SID}`;
  return { turns:t.length, versions:v.length, lastVersion:v[v.length-1]?.id ?? null, hash:s.h };
}

// 1 — authorised write under a durable identity
const T1 = randomUUID();
const w = await turn(T1, 'change Sales Cycle Length to 14', 'frame');
const s1 = await state();
check('write commits', s1.turns === 1, text(w).slice(0,60));
check('committed turn_id EQUALS the client identity', (await sql`select 1 from public.v5_conversation_turns where scenario_id=${SID} and turn_id=${T1}`).length === 1);
if (OWNER) check('a receipt (model_version) was minted', s1.versions >= 1, `version=${s1.lastVersion}`);

// 2 — lost response: retry the SAME durable identity
const r2 = await turn(T1, 'change Sales Cycle Length to 14', 'frame');
const s2 = await state();
check('retry creates NO second turn', s2.turns === s1.turns, `Δ${s2.turns-s1.turns}`);
check('retry creates NO second version', s2.versions === s1.versions, `Δ${s2.versions-s1.versions}`);
if (OWNER) check('retry RECOVERS the same receipt', s2.lastVersion === s1.lastVersion);

// 3 — contrast: a genuinely new operation must still act
const s2h = s2.hash;
await turn(randomUUID(), 'change Sales Cycle Length to 19', 'frame');
const s3 = await state();
check('a genuinely NEW operation still acts', s3.turns > s2.turns && s3.hash !== s2h);

// 4 — analyse, and it must say something
const a = await turn(randomUUID(), 'run the analysis', 'analyse');
const aTxt = text(a);
check('analysis returns 200', a.status === 200);
check('analysis is substantive (cites a share of runs)', /\d+%\s*of\s*runs/i.test(String(a.j?.assistant_text ?? '')), aTxt.slice(0,70));

// 5 — explain, grounded in the model
const e = await turn(randomUUID(), 'why did that option win?', 'analyse');
check('explanation returns 200', e.status === 200);
check('explanation names a weak point / fragility', /fragile|weak point|not yet (settled|robust)/i.test(String(e.j?.assistant_text ?? '')), text(e).slice(0,70));

console.log(`\n### ${pass.length} passed, ${fail.length} failed`);
if (fail.length) console.log('  failed: ' + fail.join(' | '));
console.log(`\nscenario left for inspection: ${SID}`);
await sql.end();
process.exit(fail.length ? 1 : 0);
