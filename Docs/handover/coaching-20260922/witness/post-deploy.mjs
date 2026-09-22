/**
 * POST-DEPLOY VERIFICATION for the two criteria that were failing on c12a54d.
 *
 * Run AFTER #1679 and #1685 merge and deploy:   node post-deploy.mjs
 *
 * Criterion 2b — an exact retry must recover truthfully WITHOUT misleading
 *                success narration.
 * Criterion 5  — one analysis turn must not silently mix model revisions, and
 *                the refusal must not be an HTTP 500 that loses the turn.
 *
 * Both were RED on build c12a54d and are expected GREEN once the fixes deploy.
 * The RED baselines are recorded inline so a re-run is a comparison, not a fresh
 * judgement.
 *
 * ⚠ ASSERT THE DEPLOYED BUILD FIRST. A green run against the OLD build proves
 *   nothing; this script prints the build and refuses to imply otherwise.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const SRC = '105baa8c-f206-4880-9017-59803af99193';
const pass = [], fail = [];
const ck = (n, ok, d = '') => { (ok ? pass : fail).push(n); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## POST-DEPLOY VERIFICATION — build ${hz.build} degraded=${hz.degraded}`);
console.log(`   (the criteria below were RED on build c12a54d)\n`);

const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const mk = async (title) => (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${null},${title},'evaluate',${sql.json(src.graph)},1) returning id`)[0].id;
const turn = (sid, turnId, msg, stage) => fetch(`${BASE}/orchestrate/v2/turn`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID() },
  body: JSON.stringify({ kind: 'message', turn_id: turnId, scenario_id: sid, stage, message: msg, turn_class: 'decide', source: 'composer' }),
  signal: AbortSignal.timeout(240000) }).then(async r => { const b = await r.text(); let j = null; try { j = JSON.parse(b); } catch {} return { status: r.status, j, b }; });
const txt = r => String(r.j?.assistant_text ?? r.b);
const valOf = async (sid) => (await sql`select n->'observed_state'->>'raw_value' r from public.scenarios s,
  lateral jsonb_array_elements(s.graph->'nodes') n where s.id=${sid} and n->>'id'='bc936d4c'`)[0]?.r;

// ── CRITERION 2b ──────────────────────────────────────────────────────────
// RED baseline on c12a54d: the retry replied "Updated Sales Cycle Length from
// 17 months to 14 months" while dTurns=0, dVersions=0 and the value stayed 17.
console.log('### Criterion 2b — a retry must not narrate an edit it did not make');
{
  const sid = await mk('ZZZ-POSTDEPLOY-2B');
  const T1 = randomUUID();
  await turn(sid, T1, 'change Sales Cycle Length to 14', 'frame');
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 17', 'frame');
  const before = await valOf(sid);
  const retry = await turn(sid, T1, 'change Sales Cycle Length to 14', 'frame');
  const after = await valOf(sid);
  ck('the retry writes nothing', before === after, `value ${before} -> ${after}`);
  ck('the retry does NOT claim "Updated"', !/\bUpdated\b/i.test(txt(retry)), `"${txt(retry).slice(0, 90)}"`);
  const patch = (retry.j?.blocks ?? []).find((b) => b?.type === 'graph_patch');
  ck('the graph_patch block does NOT say "applied"',
     patch === undefined || patch.status !== 'applied', `status=${patch?.status ?? '(no block)'}`);
  ck('no open_inspector directive on a turn that changed nothing',
     !(retry.j?.blocks ?? []).some((b) => b?.type === 'ui_directive'));
  console.log(`   scenario ${sid}`);
}

// ── CRITERION 5 ───────────────────────────────────────────────────────────
// RED baseline on c12a54d: writes landing within ~1s of the analysis turn made
// the response hash and the fact's graph_hash_at_run disagree, HTTP 200, silent.
console.log('\n### Criterion 5 — one analysis turn cannot silently mix revisions');
{
  const sid = await mk('ZZZ-POSTDEPLOY-5');
  const a = turn(sid, randomUUID(), 'run the analysis', 'analyse');
  await new Promise(r => setTimeout(r, 400));          // inside the measured ~0.8-1.5s window
  await turn(sid, randomUUID(), 'change Sales Cycle Length to 21', 'frame');
  const res = await a;
  const [f] = await sql`select f.payload->'result'->>'graph_hash_at_run' as har
    from public.v5_handler_facts f join public.v5_conversation_turns c on c.id=f.v5_conversation_turn_id
    where c.scenario_id=${sid} and f.handler_id='run_analysis' limit 1`;
  const respHash = res.j?.graph_hash ?? null;
  const factHash = f?.har ?? null;
  const diverged = factHash !== null && respHash !== null && respHash !== factHash;
  ck('the two reads never silently disagree', !diverged, `resp=${String(respHash).slice(0,12)} fact=${String(factHash).slice(0,12)}`);
  ck('a refusal is NOT an HTTP 500 that loses the turn', res.status !== 500, `HTTP ${res.status}`);
  if (res.status === 200 && factHash === null) {
    ck('the refusal is honest about WHY', /chang|prepar|again/i.test(txt(res)), `"${txt(res).slice(0, 90)}"`);
  }
  console.log(`   scenario ${sid}`);
}

console.log(`\n### ${pass.length} passed, ${fail.length} failed`);
if (fail.length) console.log('  failed: ' + fail.join(' | '));
console.log(`\n⚠ This proves the criteria only for build ${hz.build}. If that is not the`);
console.log(`  build carrying #1679 and #1685, the result says nothing about the fixes.`);
await sql.end();
process.exit(fail.length ? 1 : 0);
