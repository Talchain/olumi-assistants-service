/**
 * THE WHOLE SPINE, ON ONE BUILD, IN ONE RUN.
 *
 * Every criterion of the spine goal, witnessed together against a single
 * deployed build so the result is one artefact rather than a scatter of runs.
 *
 *   node spine.mjs            # guest: receipt criteria are SKIPPED, not passed
 *   WITNESS_OWNER=… WITNESS_JWT=… node spine.mjs   # exercises receipts too
 *
 * ⚠ A SKIP IS NOT A PASS. Guest scenarios mint no model_version (deployed
 *   append_turn_atomic_v5 line 66), so "no new version" on a guest is VACUOUS.
 *   Receipt assertions are reported as SKIP unless an owner is supplied.
 * ⚠ The deployed build is printed and asserted into the result. A green run
 *   against the wrong build proves nothing.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const OWNER = process.env.WITNESS_OWNER ?? null;
const JWT = process.env.WITNESS_JWT ?? null;
const SRC = '105baa8c-f206-4880-9017-59803af99193';
const rows = [];
const rec = (crit, name, state, detail = '') => { rows.push({ crit, name, state, detail }); console.log(`  ${state.padEnd(4)} [${crit}] ${name}${detail ? '  — ' + detail : ''}`); };

const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## SPINE WITNESS — build ${hz.build}  degraded=${hz.degraded}  owner=${OWNER ? 'signed-in' : 'guest'}\n`);

const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const mk = async (t) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER}, ${t}, 'evaluate', ${sql.json(src.graph)}, 1) returning id`)[0].id;
const turn = (sid, tid, msg, stage = 'frame') => {
  const h = { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID() };
  if (JWT) h.authorization = `Bearer ${JWT}`;
  return fetch(`${BASE}/orchestrate/v2/turn`, { method: 'POST', headers: h,
    body: JSON.stringify({ kind: 'message', turn_id: tid, scenario_id: sid, stage, message: msg, turn_class: 'decide', source: 'composer' }),
    signal: AbortSignal.timeout(240000) }).then(async r => { const b = await r.text(); let j = null; try { j = JSON.parse(b); } catch {} return { status: r.status, j, b }; });
};
const txt = r => String(r.j?.assistant_text ?? r.b);
const st = async (sid) => ({
  turns: (await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid}`).length,
  versions: (await sql`select id from public.model_versions where scenario_id=${sid} order by version_number`).map(v => v.id),
  hash: (await sql`select graph_identity_hash h from public.scenarios where id=${sid}`)[0]?.h,
});
const raw = async (sid, node = 'bc936d4c') => (await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
  lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'=${node}`)[0]?.r;

// ── 1: exactly once under stable operation identity ─────────────────────────
{
  const sid = await mk('ZZZ-SPINE-1'); const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14');
  const s = await st(sid);
  rec('1', 'mutation commits exactly once', s.turns === 1 ? 'PASS' : 'FAIL', `turns=${s.turns}`);
  const match = (await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid} and turn_id=${T1}`).length === 1;
  rec('1', 'committed turn_id EQUALS the client identity', match ? 'PASS' : 'FAIL');
  rec('1', 'a receipt was minted', OWNER ? (s.versions.length >= 1 ? 'PASS' : 'FAIL') : 'SKIP', OWNER ? `versions=${s.versions.length}` : 'guest mints none — vacuous, not passed');
}

// ── 2a/2b: retry recovers truthfully, no duplicate, no false narration ──────
{
  const sid = await mk('ZZZ-SPINE-2'); const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14');
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 17');   // the intervening write
  const before = await st(sid); const vBefore = await raw(sid);
  const retry = await turn(sid, T1, 'change Sales Cycle Length to 14');
  const after = await st(sid);
  rec('2a', 'retry creates NO duplicate turn', after.turns === before.turns ? 'PASS' : 'FAIL', `Δ${after.turns - before.turns}`);
  rec('2a', 'retry creates NO duplicate version', after.versions.length === before.versions.length ? 'PASS' : 'FAIL');
  rec('2a', 'retry RECOVERS the same receipt', OWNER ? (after.versions.at(-1) === before.versions.at(-1) ? 'PASS' : 'FAIL') : 'SKIP', OWNER ? '' : 'needs signed-in');
  rec('2b', 'retry does NOT claim an edit', /\bUpdated\b/i.test(txt(retry)) ? 'FAIL' : 'PASS', `"${txt(retry).slice(0, 70)}"`);
  const patch = (retry.j?.blocks ?? []).find(b => b?.type === 'graph_patch');
  rec('2b', 'graph_patch does NOT say applied', patch === undefined || patch.status !== 'applied' ? 'PASS' : 'FAIL', `status=${patch?.status ?? '(none)'}`);
  // ⚠ ONLY MEANINGFUL ALONGSIDE THE "does NOT claim an edit" ROW. On a build
  //   WITHOUT the fix this passes VACUOUSLY: the misleading text "Updated ...
  //   from 17 months to 14 months" also contains 17. Conjoined so it cannot.
  const namesCurrent = new RegExp(`\\b${vBefore}\\b`).test(txt(retry));
  const claimsEdit = /\bUpdated\b/i.test(txt(retry));
  rec('2b', 'reply RECONCILES current state (and makes no edit claim)',
      namesCurrent && !claimsEdit ? 'PASS' : 'FAIL',
      `current=${vBefore} names=${namesCurrent} claims_edit=${claimsEdit}`);
}

// ── 3: a genuinely stale DIFFERENT operation refuses truthfully ─────────────
{
  const sid = await mk('ZZZ-SPINE-3');
  const [A, B] = await Promise.all([turn(sid, randomUUID(), 'change Sales Cycle Length to 30'), turn(sid, randomUUID(), 'change Sales Cycle Length to 40')]);
  const s = await st(sid);
  const claims = [A, B].filter(r => /\bUpdated\b/i.test(txt(r))).length;
  rec('3', 'exactly one concurrent write wins', s.turns === 1 && claims === 1 ? 'PASS' : 'FAIL', `turns=${s.turns} claims=${claims}`);
  const refused = [A, B].find(r => r.status === 409);
  rec('3', 'the loser refuses TRUTHFULLY (409)', refused ? 'PASS' : 'FAIL', refused ? 'GRAPH_DIVERGED' : 'no 409 seen');
}

// ── 4: natural units preserve real unit safety ─────────────────────────────
{
  const sid = await mk('ZZZ-SPINE-4');
  const a = await turn(sid, randomUUID(), 'change Sales Cycle Length to 12 months');
  rec('4', 'the unit the UI displays is accepted', /\bUpdated\b/i.test(txt(a)) ? 'PASS' : 'FAIL');
  const b = await turn(sid, randomUUID(), 'change Sales Cycle Length to 20 weeks');
  rec('4', 'a REAL rescale is still refused', /\bUpdated\b/i.test(txt(b)) ? 'FAIL' : 'PASS', `"${txt(b).slice(0, 60)}"`);
  const c = await turn(sid, randomUUID(), 'set Product-Market Fit Investment to 0.8');
  rec('4', 'a proportion factor accepts a proportion', /\bUpdated\b/i.test(txt(c)) ? 'PASS' : 'FAIL', `"${txt(c).slice(0, 60)}"`);
}

// ── 5: one analysis turn cannot silently mix model revisions ───────────────
{
  const sid = await mk('ZZZ-SPINE-5');
  const a = turn(sid, randomUUID(), 'run the analysis', 'analyse');
  await new Promise(r => setTimeout(r, 400));
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 21');
  const res = await a;
  const [f] = await sql`select f.payload->'result'->>'graph_hash_at_run' as har from public.v5_handler_facts f
    join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
  const diverged = f?.har && res.j?.graph_hash && res.j.graph_hash !== f.har;
  rec('5', 'the two reads never silently disagree', diverged ? 'FAIL' : 'PASS', `resp=${String(res.j?.graph_hash).slice(0, 12)} fact=${String(f?.har).slice(0, 12)}`);
  rec('5', 'a refusal is not a 500 that loses the turn', res.status !== 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
}

// ── 6: authoritative reread / receipt / state agree ───────────────────────
{
  const sid = await mk('ZZZ-SPINE-6');
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 33');
  const [s] = await sql`select graph_identity_hash gh, current_model_version_id cur from public.scenarios where id=${sid}`;
  const [v] = await sql`select id, mutation_id, graph_identity_hash gh, source_turn_id from public.model_versions where scenario_id=${sid} order by version_number desc limit 1`;
  const [t] = await sql`select turn_id, model_version_mutation_id mvm from public.v5_conversation_turns where scenario_id=${sid} order by created_at desc limit 1`;
  rec('6', 'scenario head == latest version', OWNER ? (s.cur === v?.id ? 'PASS' : 'FAIL') : 'SKIP', OWNER ? '' : 'guest mints no version');
  rec('6', 'version hash == scenario hash', OWNER ? (v?.gh === s.gh ? 'PASS' : 'FAIL') : 'SKIP');
  rec('6', 'turn mutation_id == version mutation_id', OWNER ? (t?.mvm === v?.mutation_id ? 'PASS' : 'FAIL') : 'SKIP');
  const rr = await turn(sid, randomUUID(), 'what value does Sales Cycle Length have?');
  rec('6', 'the product rereads state truthfully', /\b33\b/.test(txt(rr)) ? 'PASS' : 'FAIL', `"${txt(rr).slice(0, 60)}"`);
}

const p = rows.filter(r => r.state === 'PASS').length, f = rows.filter(r => r.state === 'FAIL').length, s = rows.filter(r => r.state === 'SKIP').length;
console.log(`\n### ${p} PASS · ${f} FAIL · ${s} SKIP   on build ${hz.build}`);
const byCrit = {};
for (const r of rows) { byCrit[r.crit] ??= { p: 0, f: 0 }; r.state === 'PASS' ? byCrit[r.crit].p++ : r.state === 'FAIL' ? byCrit[r.crit].f++ : 0; }
console.log('criterion roll-up: ' + Object.entries(byCrit).map(([k, v]) => `${k}=${v.f === 0 ? 'PASS' : 'FAIL'}`).join(' · '));
fs.writeFileSync(process.env.OUT ?? '/tmp/spine.json', JSON.stringify({ build: hz.build, owner: !!OWNER, rows }, null, 2));
await sql.end();
process.exit(f ? 1 : 0);
