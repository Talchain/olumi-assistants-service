/**
 * WIRE-LEVEL REPLAY WITNESS — POST /orchestrate/v2/turn
 *
 * Run:  node witness.mjs OUT.md
 *   env WITNESS_BASE   default https://cee-staging.onrender.com
 *       WITNESS_SID    reuse an existing throwaway scenario instead of making one
 *       WITNESS_MSG    the mutation (default lands a real graph write)
 *       WITNESS_MSG2   the contrast-control mutation
 *
 * RESULT ON build 9b98fcd (no Gate-1 fix): phase 2 creates a SECOND turn row
 * with a DIFFERENT mutation_id — HTTP 200, "already set to ...". See
 * WIRE-REPLAY-WITNESS-20260922.md in this directory.
 *
 * EXPECTED AFTER PR #1677 DEPLOYS: phase 2's committed turn_id EQUALS the sent
 * turn_id, dTURNS = 0, and the SAME mutation_id comes back.
 * ⚠ Phase 3 MUST still fire. If it stops firing, the fix has broken ordinary
 *   mutation and that control is what catches it.
 *
 * ⛔ THE RECEIPT HALF IS NOT WITNESSABLE HERE. This runs on a GUEST scenario,
 *    and deployed append_turn_atomic_v5 mints a model_version only when
 *    user_id IS NOT NULL (line 66). So "dVERSIONS = 0" below is VACUOUS, not
 *    evidence. An owned scenario needs a real Supabase user JWT; a shared
 *    assist key is refused `scenario_requires_authenticated_owner`.
 *
 * ⚠ INGRESS GOTCHA: turn_class must be one of
 *   frame | clarify | propose | decide | review.  `edit` is rejected 422.
 *   The `handler` value stored in v5_conversation_turns.turn_class is the
 *   COMMITTED class, not an ingress value.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.WITNESS_BASE || 'https://cee-staging.onrender.com';
const KEY  = env.ASSIST_API_KEY;
const SRC  = '105baa8c-f206-4880-9017-59803af99193';
const LOG  = [];
const say = (...a) => { const s = a.join(' '); console.log(s); LOG.push(s); };

async function state(sid) {
  const [t] = await sql`select count(*)::int as n from public.v5_conversation_turns where scenario_id=${sid}`;
  const [v] = await sql`select count(*)::int as n from public.model_versions where scenario_id=${sid}`;
  const turns = await sql`select turn_id, handler_id, model_version_mutation_id, model_version_created, created_at
                          from public.v5_conversation_turns where scenario_id=${sid} order by created_at`;
  const [s] = await sql`select graph_identity_hash, current_model_version_id from public.scenarios where id=${sid}`;
  return { turns: t.n, versions: v.n, rows: turns, hash: s.graph_identity_hash, cur: s.current_model_version_id };
}

let OWNER = null;
async function post(sid, turnId, message) {
  const body = { kind:'message', turn_id:turnId, scenario_id:sid, stage:'frame',
                 message, turn_class:'decide', source:'composer', user_id: OWNER };
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/orchestrate/v2/turn`, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-olumi-assist-key':KEY, 'x-request-id':randomUUID() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status:r.status, ms:Date.now()-t0, text, j };
  } catch (e) { return { status:0, ms:Date.now()-t0, text:String(e.message), j:null }; }
}

const brief = (r) => `HTTP ${r.status} in ${r.ms}ms` +
  (r.j ? ` | assistant="${String(r.j.assistant_text??'').slice(0,80)}" | error=${JSON.stringify(r.j.error??r.j.code??null)}` : ` | raw=${r.text.slice(0,200)}`);

// ── SETUP ────────────────────────────────────────────────────────────────────
const [src] = await sql`select graph, user_id from public.scenarios where id=${SRC}`;
let SID = process.env.WITNESS_SID || null;
if (!SID) {
  const [mk] = await sql`insert into public.scenarios (user_id, title, stage, graph, scenario_schema_version)
    values (${null}, ${'ZZZ-COACHING-REPLAY-WITNESS-20260922'}, 'frame', ${sql.json(src.graph)}, 1)
    returning id`;
  SID = mk.id;
}
say(`## WIRE REPLAY WITNESS — deployed staging build 9b98fcd (no Gate-1 fix)`);
say(`scenario   : ${SID}  (throwaway, copied graph, signed-in owner so versioning is enabled)`);
say(`endpoint   : POST ${BASE}/orchestrate/v2/turn`);
say('');

OWNER = null;  // guest scenario: key-authed callers may act, but NO receipt is minted
say(`owner      : ${OWNER}`);
const s0 = await state(SID);
say(`S0 baseline: turns=${s0.turns} versions=${s0.versions} hash=${String(s0.hash).slice(0,16)}`);

// ── PHASE 1 — the original mutation ──────────────────────────────────────────
const T1 = randomUUID();
const MSG = process.env.WITNESS_MSG || 'change Product-Market Fit Investment to 0.5';
say(`\n### Phase 1 — original mutation, turn_id T1=${T1}`);
const r1 = await post(SID, T1, MSG);
say(`  ${brief(r1)}`);
const s1 = await state(SID);
say(`  S1: turns=${s1.turns} versions=${s1.versions} hash=${String(s1.hash).slice(0,16)} cur_version=${s1.cur}`);
say(`  committed turn_ids: ${JSON.stringify(s1.rows.map(r=>r.turn_id))}`);
say(`  T1 present as a committed turn_id? ${s1.rows.some(r=>r.turn_id===T1) ? 'YES' : 'NO  <-- identity destroyed'}`);

// ── PHASE 2 — the retry: SAME durable identity, response assumed lost ────────
say(`\n### Phase 2 — RETRY with the SAME turn_id T1 (client lost the response)`);
const r2 = await post(SID, T1, MSG);
say(`  ${brief(r2)}`);
const s2 = await state(SID);
say(`  S2: turns=${s2.turns} versions=${s2.versions} hash=${String(s2.hash).slice(0,16)} cur_version=${s2.cur}`);
say(`  committed turn_ids: ${JSON.stringify(s2.rows.map(r=>r.turn_id))}`);
say(`  ΔTURNS=${s2.turns-s1.turns}  ΔVERSIONS=${s2.versions-s1.versions}`);

// ── PHASE 3 — contrast control: a genuinely NEW operation ────────────────────
const T2 = randomUUID();
say(`\n### Phase 3 — CONTRAST CONTROL: a genuinely new turn_id T2=${T2}`);
const r3 = await post(SID, T2, process.env.WITNESS_MSG2 || 'change Product-Market Fit Investment to 0.7');
say(`  ${brief(r3)}`);
const s3 = await state(SID);
say(`  S3: turns=${s3.turns} versions=${s3.versions} hash=${String(s3.hash).slice(0,16)}`);
say(`  ΔTURNS=${s3.turns-s2.turns}  ΔVERSIONS=${s3.versions-s2.versions}`);

// ── VERDICT ──────────────────────────────────────────────────────────────────
say(`\n### VERDICT`);
say(`  acceptance 1 — original commits            : ${s1.turns>s0.turns ? 'PASS' : 'FAIL'}`);
say(`  acceptance 2 — retry creates NO second turn : ${s2.turns===s1.turns ? 'PASS' : `FAIL (+${s2.turns-s1.turns})`}`);
say(`  acceptance 3 — retry creates NO new version : ${s2.versions===s1.versions ? 'PASS' : `FAIL (+${s2.versions-s1.versions})`}`);
say(`  acceptance 4 — retry RECOVERS the receipt   : NOT OBSERVABLE on a guest scenario (deployed append_turn_atomic_v5 line 66: v_should_create := v_user_id IS NOT NULL)`);
say(`  contrast     — a new operation still acts   : ${s3.turns>s2.turns ? 'fired' : 'refused'}`);
say(`\n  full turn table:`);
s3.rows.forEach(r=>say(`    ${r.turn_id}  handler=${r.handler_id} mutation=${r.model_version_mutation_id} created=${r.model_version_created}`));
say(`\n  scenario left in place for inspection: ${SID}`);

fs.writeFileSync(process.argv[2] || '/tmp/witness.md', LOG.join('\n'));
fs.writeFileSync((process.argv[2]||'/tmp/witness.md')+'.raw.json', JSON.stringify({SID,T1,T2,r1,r2,r3,s0,s1,s2,s3},null,2));
await sql.end();
