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

const step = async (crit, fn) => { try { await fn(); } catch (e) { rec(crit, 'BLOCK CRASHED — criterion NOT measured', 'FAIL', String(e?.message ?? e).slice(0, 120)); } };
const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## SPINE WITNESS — build ${hz.build}  degraded=${hz.degraded}  owner=${OWNER ? 'signed-in' : 'guest'}\n`);

const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const mk = async (t, graph = src.graph) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER}, ${t}, 'evaluate', ${sql.json(graph)}, 1) returning id`)[0].id;
// A reply only counts as a truthful answer if the service actually answered.
const answered = (r) => r.status === 200 && String(r.j?.assistant_text ?? '').trim().length > 0;
// observed_state.value for any node, by id.
const val = async (sid, node) => (await sql`select n->'observed_state'->>'value' v from public.scenarios s,
  lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'=${node}`)[0]?.v;
const turn = async (sid, tid, msg, stage = 'frame', attempt = 0) => {
  const h = { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID() };
  if (JWT) h.authorization = `Bearer ${JWT}`;
  try {
    const r = await fetch(`${BASE}/orchestrate/v2/turn`, { method: 'POST', headers: h,
      body: JSON.stringify({ kind: 'message', turn_id: tid, scenario_id: sid, stage, message: msg, turn_class: 'decide', source: 'composer' }),
      signal: AbortSignal.timeout(240000) });
    const b = await r.text(); let j = null; try { j = JSON.parse(b); } catch {}
    return { status: r.status, j, b };
  } catch (e) {
    // No response was received, so nothing was observed about the product.
    // Same turn_id ⇒ the retry rides the service's own idempotent-replay path.
    if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); return turn(sid, tid, msg, stage, attempt + 1); }
    return { status: 0, j: null, b: `TRANSPORT_FAILED after 3 attempts: ${e?.cause?.code ?? e?.message ?? e}` };
  }
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
await step('1', async () => {
  const sid = await mk('ZZZ-SPINE-1'); const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14');
  const s = await st(sid);
  rec('1', 'mutation commits exactly once', s.turns === 1 ? 'PASS' : 'FAIL', `turns=${s.turns}`);
  const match = (await sql`select 1 from public.v5_conversation_turns where scenario_id=${sid} and turn_id=${T1}`).length === 1;
  rec('1', 'committed turn_id EQUALS the client identity', match ? 'PASS' : 'FAIL');
  rec('1', 'a receipt was minted', OWNER ? (s.versions.length >= 1 ? 'PASS' : 'FAIL') : 'SKIP', OWNER ? `versions=${s.versions.length}` : 'guest mints none — vacuous, not passed');
});

// ── 2a/2b: retry recovers truthfully, no duplicate, no false narration ──────
await step('2', async () => {
  const sid = await mk('ZZZ-SPINE-2'); const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14');
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 17');   // the intervening write
  const before = await st(sid); const vBefore = await raw(sid);
  const retry = await turn(sid, T1, 'change Sales Cycle Length to 14');
  const after = await st(sid);
  rec('2a', 'retry creates NO duplicate turn', after.turns === before.turns ? 'PASS' : 'FAIL', `Δ${after.turns - before.turns}`);
  rec('2a', 'retry creates NO duplicate version', after.versions.length === before.versions.length ? 'PASS' : 'FAIL');
  rec('2a', 'retry RECOVERS the same receipt', OWNER ? (after.versions.at(-1) === before.versions.at(-1) ? 'PASS' : 'FAIL') : 'SKIP', OWNER ? '' : 'needs signed-in');
  // ⚠ A bare !/Updated/ passes VACUOUSLY on a 500, a 409 or an empty body —
  //   none of which is a truthful reconciliation. Conjoined with answered().
  rec('2b', 'retry does NOT claim an edit (and actually answered)',
      answered(retry) && !/\bUpdated\b/i.test(txt(retry)) ? 'PASS' : 'FAIL',
      `HTTP ${retry.status} "${txt(retry).slice(0, 60)}"`);
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
});

// ── 3: a genuinely stale DIFFERENT operation refuses truthfully ─────────────
await step('3', async () => {
  const sid = await mk('ZZZ-SPINE-3');
  const [A, B] = await Promise.all([turn(sid, randomUUID(), 'change Sales Cycle Length to 30'), turn(sid, randomUUID(), 'change Sales Cycle Length to 40')]);
  const s = await st(sid);
  const claims = [A, B].filter(r => /\bUpdated\b/i.test(txt(r))).length;
  rec('3', 'exactly one concurrent write wins', s.turns === 1 && claims === 1 ? 'PASS' : 'FAIL', `turns=${s.turns} claims=${claims}`);
  const refused = [A, B].find(r => r.status === 409);
  rec('3', 'the loser refuses TRUTHFULLY (409)', refused ? 'PASS' : 'FAIL', refused ? 'GRAPH_DIVERGED' : 'no 409 seen');
});

// ── 3b: the OTHER stale-different-operation — a REUSED turn_id carrying a
//   DIFFERENT instruction. The concurrent case above is not the whole of
//   "a genuinely stale different operation refuses truthfully": the durable
//   key must bind the REQUEST, not just the id. Measured on a459d23 this
//   commits nothing (correct) and then tells the user the new value WAS
//   applied (wrong), with graph_patch status 'applied' and after.raw_value
//   set to a number the model never took.
await step('3', async () => {
  const sid = await mk('ZZZ-SPINE-3B'); const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14');
  const reuse = await turn(sid, T1, 'change Sales Cycle Length to 25');   // SAME id, DIFFERENT ask
  await new Promise(r => setTimeout(r, 3000));                            // exclude a late write
  const v = await raw(sid), t = (await st(sid)).turns;
  rec('3', 'a reused turn_id writes nothing', v !== '25' && t === 1 ? 'PASS' : 'FAIL', `value=${v} turns=${t}`);
  const txt3 = txt(reuse);
  rec('3', 'a reused turn_id does NOT claim the new value was applied',
      answered(reuse) && !(/\b25\b/.test(txt3) && /\bUpdated\b/i.test(txt3)) ? 'PASS' : 'FAIL',
      `"${txt3.slice(0, 60)}"`);
  const p3 = (reuse.j?.blocks ?? []).find(b => b?.type === 'graph_patch');
  rec('3', 'a reused turn_id does NOT emit an APPLIED patch', p3 === undefined || p3.status !== 'applied' ? 'PASS' : 'FAIL',
      `status=${p3?.status ?? '(none)'} after=${p3?.after ? JSON.stringify(p3.after).slice(0, 40) : '-'}`);
});

// ── 4: natural units preserve real unit safety ─────────────────────────────
await step('4', async () => {
  const sid = await mk('ZZZ-SPINE-4');
  const a = await turn(sid, randomUUID(), 'change Sales Cycle Length to 12 months');
  rec('4', 'the unit the UI displays is accepted', /\bUpdated\b/i.test(txt(a)) ? 'PASS' : 'FAIL');
  const b = await turn(sid, randomUUID(), 'change Sales Cycle Length to 20 weeks');
  rec('4', 'a REAL rescale is still refused (and actually answered)',
      answered(b) && !/\bUpdated\b/i.test(txt(b)) ? 'PASS' : 'FAIL', `HTTP ${b.status} "${txt(b).slice(0, 55)}"`);
  const c = await turn(sid, randomUUID(), 'set Product-Market Fit Investment to 0.8');
  rec('4', 'a proportion factor accepts a proportion', /\bUpdated\b/i.test(txt(c)) ? 'PASS' : 'FAIL', `"${txt(c).slice(0, 55)}"`);
  // Saying "Updated" is not the claim — the claim is that 0.8 REACHED the model.
  const pv = await val(sid, 'f9223d57');
  rec('4', 'the accepted proportion actually PERSISTS as 0.8', Number(pv) === 0.8 ? 'PASS' : 'FAIL', `persisted value=${pv}`);
});

// ── 4c: THE CORRUPTION CONTROL — a capped scale factor must NOT take a bare 0.8
//   Shape copied verbatim from live staging (`fac_internal_pipeline`, one of 128
//   real cap=100 proportion-unit factors). value = raw_value/cap, so 0.8 here
//   means 80, not 4/5. The REJECTED first version of #1686 persisted it as 0.8.
//   Without this row criterion 4 only ever tests the ACCEPT direction and a
//   regressed build goes green.
await step('4', async () => {
  const capped = {
    id: 'fac_internal_pipeline', kind: 'factor', label: 'Internal Talent Pipeline Investment',
    category: 'controllable', provenance: 'ai_inferred', display_value: 'Low pipeline investment',
    observed_state: { cap: 100, unit: 'scale', value: 0.2, source: 'cee_inference', raw_value: 20, factor_type: 'quality' },
  };
  const g = { ...src.graph, nodes: [...src.graph.nodes, capped] };
  const sid = await mk('ZZZ-SPINE-4C', g);
  const d = await turn(sid, randomUUID(), 'set Internal Talent Pipeline Investment to 0.8');
  const cv = await val(sid, 'fac_internal_pipeline');
  rec('4', 'a CAPPED scale factor does NOT swallow a bare 0.8', Number(cv) === 0.8 ? 'FAIL' : 'PASS',
      `persisted value=${cv} (was 0.2, cap=100) "${txt(d).slice(0, 45)}"`);
});

// ── 5: one analysis turn cannot silently mix model revisions ───────────────
await step('5', async () => {
  const sid = await mk('ZZZ-SPINE-5');
  const a = turn(sid, randomUUID(), 'run the analysis', 'analyse');
  await new Promise(r => setTimeout(r, 400));
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 21');
  const res = await a;
  const [f] = await sql`select f.payload->'result'->>'graph_hash_at_run' as har from public.v5_handler_facts f
    join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
  // ⚠ The old form was `diverged ? FAIL : PASS`, which passed whenever the probe
  //   found NO data — exactly what a refusal (no handler fact row) produces. A
  //   fix would then have "passed" for the wrong reason. Classified explicitly;
  //   indeterminate is a FAILURE to measure, never a pass.
  const refusedCleanly = res.status === 200 && /stopped rather than mix|changed while this analysis/i.test(txt(res));
  const both = Boolean(f?.har) && Boolean(res.j?.graph_hash);
  const verdict = refusedCleanly ? 'PASS'
    : both ? (res.j.graph_hash === f.har ? 'PASS' : 'FAIL')
    : 'FAIL';
  rec('5', 'the two reads never silently disagree', verdict,
      refusedCleanly ? 'refused truthfully, no mixing'
      : both ? `resp=${String(res.j.graph_hash).slice(0, 12)} fact=${String(f.har).slice(0, 12)}`
      : `INDETERMINATE — fact=${f?.har ? 'yes' : 'MISSING'} resp=${res.j?.graph_hash ? 'yes' : 'MISSING'} (not a pass)`);
  rec('5', 'a refusal is not a 500 that loses the turn', res.status !== 500 ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
});

// ── 5b: THE CONTRAST CONTROL for criterion 5.
//   Everything above exercises the DIVERGED case only. A build whose refusal
//   fired on EVERY analysis would satisfy all of it and still be catastrophic —
//   the witness would read green while no user could ever get a result. A
//   target-passes assertion needs a control that proves the probe can tell the
//   two apart.
await step('5', async () => {
  const sid = await mk('ZZZ-SPINE-5B');
  const a = await turn(sid, randomUUID(), 'run the analysis', 'analyse');   // NO concurrent edit
  const txtA = txt(a);
  const overRefused = /stopped rather than mix|changed while this analysis/i.test(txtA);
  const [f] = await sql`select f.payload->'result'->>'graph_hash_at_run' as har from public.v5_handler_facts f
    join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
  const hasResult = (a.j?.blocks ?? []).some((b) => b?.type === 'analysis_result');
  rec('5', 'CONTROL — an UNDISTURBED analysis still completes', 
      answered(a) && !overRefused && hasResult && Boolean(f?.har) ? 'PASS' : 'FAIL',
      `refused=${overRefused} analysis_result=${hasResult} fact=${f?.har ? 'yes' : 'MISSING'}`);
  rec('5', 'CONTROL — and reports itself FRESH', a.j?.analysis_ready?.freshness === 'fresh' ? 'PASS' : 'FAIL',
      `freshness=${a.j?.analysis_ready?.freshness} reason=${a.j?.analysis_ready?.freshness_reason}`);
});

// ── 6: authoritative reread / receipt / state agree ───────────────────────
await step('6', async () => {
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
});

// ── 7: THE ROUTE THE USER ACTUALLY REACHES ─────────────────────────────────
//   Everything above drives /orchestrate/v2/turn. Since PROXY_V5_TARGET can
//   forward /proxy/v5/turn to /agent/v1/turn, a green run above may describe a
//   surface no user touches. These rows are reported SEPARATELY so they never
//   flatter the conventional roll-up — and the forwarding target is established
//   BEHAVIOURALLY, because config and a running process can disagree (they did,
//   for 8 minutes, on 22 Sep).
const userRoute = [];
await step('7', async () => {
  const ORIGIN = process.env.WITNESS_ORIGIN ?? 'https://staging--olumi.netlify.app';
  const sid = await mk('ZZZ-SPINE-7'); const T = randomUUID();
  const h = { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID(), origin: ORIGIN };
  if (JWT) h.authorization = `Bearer ${JWT}`;
  let res = null;
  try {
    const r = await fetch(`${BASE}/proxy/v5/turn`, { method: 'POST', headers: h,
      body: JSON.stringify({ kind: 'message', turn_id: T, scenario_id: sid, stage: 'frame',
        message: 'change Sales Cycle Length to 11', turn_class: 'decide', source: 'composer' }),
      signal: AbortSignal.timeout(240000) });
    const b = await r.text(); let j = null; try { j = JSON.parse(b); } catch {}
    res = { status: r.status, j, b };
  } catch (e) { res = { status: 0, j: null, b: String(e?.message ?? e) }; }

  if (res.status === 403) {
    // Origin rejected ⇒ the probe never reached the forwarder. NOT a product fact.
    rec('7', 'the user-facing route was measurable', 'FAIL', `PROXY_ORIGIN_REJECTED — probe blocked, NOT a product failure (set WITNESS_ORIGIN)`);
    return;
  }
  const s7 = await st(sid), v7 = await raw(sid);
  const servedByAgent = s7.turns === 0 && (res.j?.blocks ?? []).length === 0;
  rec('7', `/proxy/v5/turn forwards to ${servedByAgent ? 'THE AGENT ROUTE' : 'the orchestrator'}`,
      servedByAgent ? 'FAIL' : 'PASS',
      `turns=${s7.turns} blocks=${(res.j?.blocks ?? []).length} analysis_ready=${res.j?.analysis_ready ? 'present' : 'ABSENT'}`);
  rec('7', 'a user CAN apply a model edit on their own surface', v7 === '11' ? 'PASS' : 'FAIL',
      `raw_value=${v7} (9 = refused, 11 = applied) · "${txt(res).slice(0, 60)}"`);
  userRoute.push(servedByAgent);

  // ── A model created on the user's surface must be receipted.
  //   Measured 22 Sep on the agent route: 25 nodes written, model_versions = 0,
  //   current_model_version_id NULL — a model with no version to reread, no
  //   receipt and no rollback point. The CONVENTIONAL control mints one for the
  //   identical brief, which is what makes it a defect rather than a property
  //   of creation. Both arms are run here so the claim can never rest on one.
  const brief = 'We are deciding whether to expand into Germany or the Nordics next year.';
  const mkEmpty = async (t) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
    values (${OWNER}, ${t}, 'frame', ${sql.json({ nodes: [], edges: [] })}, 1) returning id`)[0].id;
  const creationReceipt = async (path, useOrigin) => {
    const sid2 = await mkEmpty('ZZZ-SPINE-7-CREATE');
    const hh = { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID() };
    if (useOrigin) hh.origin = ORIGIN;
    if (JWT) hh.authorization = `Bearer ${JWT}`;
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: hh,
      body: JSON.stringify({ kind: 'message', turn_id: randomUUID(), scenario_id: sid2, stage: 'frame',
        message: brief, turn_class: 'frame', source: 'composer' }), signal: AbortSignal.timeout(240000) });
    await r.text();
    const [row] = await sql`select jsonb_array_length(graph->'nodes') n, current_model_version_id c from public.scenarios where id=${sid2}`;
    const vers = (await sql`select 1 from public.model_versions where scenario_id=${sid2}`).length;
    return { nodes: row?.n, versions: vers, head: row?.c };
  };
  const onUser = await creationReceipt('/proxy/v5/turn', true);
  const onConv = await creationReceipt('/orchestrate/v2/turn', false);
  rec('7', 'CONTROL — creation IS receipted on the conventional route',
      onConv.versions > 0 && onConv.head ? 'PASS' : 'FAIL',
      `nodes=${onConv.nodes} versions=${onConv.versions} head=${onConv.head ? 'set' : 'NULL'}`);
  rec('7', 'a model created on the user surface mints a receipt',
      OWNER ? (onUser.versions > 0 && onUser.head ? 'PASS' : 'FAIL') : 'SKIP',
      OWNER ? `nodes=${onUser.nodes} versions=${onUser.versions} head=${onUser.head ? 'set' : 'NULL'}`
            : 'guest mints none — vacuous, not passed');
});

const p = rows.filter(r => r.state === 'PASS').length, f = rows.filter(r => r.state === 'FAIL').length, s = rows.filter(r => r.state === 'SKIP').length;
console.log(`\n### ${p} PASS · ${f} FAIL · ${s} SKIP   on build ${hz.build}`);
const byCrit = {};
for (const r of rows) { byCrit[r.crit] ??= { p: 0, f: 0 }; r.state === 'PASS' ? byCrit[r.crit].p++ : r.state === 'FAIL' ? byCrit[r.crit].f++ : 0; }
console.log(`\n⚠ criteria 1-6 were measured on /orchestrate/v2/turn. Criterion 7 says whether a user reaches it.`);
console.log('criterion roll-up: ' + Object.entries(byCrit).map(([k, v]) => `${k}=${v.f === 0 ? 'PASS' : 'FAIL'}`).join(' · '));
fs.writeFileSync(process.env.OUT ?? '/tmp/spine.json', JSON.stringify({ build: hz.build, owner: !!OWNER, rows }, null, 2));
await sql.end();
process.exit(f ? 1 : 0);
