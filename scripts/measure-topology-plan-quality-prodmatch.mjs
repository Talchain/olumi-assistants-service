// DECISIVE DISAMBIGUATION: production-realistic A/B for the v10 topology_plan
// omission.
//
// WHY A SECOND HARNESS
// --------------------
// The first harness (measure-topology-plan-quality.mjs) ran both arms against
// the on-disk v187 prompt, which INSTRUCTS the model to emit topology_plan.
// That makes the two arms asymmetric:
//   arm A (flag off): prompt says emit + grammar requires  -> AGREE
//   arm B (flag on):  prompt says emit + grammar FORBIDS    -> CONFLICT
// So arm B was measured under a prompt/grammar contradiction that PRODUCTION
// (served prompt v195, which tells the model NOT to emit topology_plan) never
// experiences. That harness found a goal_constraints drop in arm B — but it
// cannot tell whether the drop is caused by REMOVING the field or by the
// INDUCED CONFLICT unique to the harness.
//
// This harness removes the confound. It strips the topology_plan INSTRUCTION
// from the prompt (approximating v195's "do the planning silently; the output
// JSON must NOT contain a topology_plan key"), so BOTH arms see a prompt that
// does not ask for topology_plan. The ONLY remaining difference is the grammar:
//   arm A' (prod control):   silent prompt + grammar REQUIRES topology_plan
//                            -> the CURRENT LIVE STATE (v195 says no, grammar forces yes)
//   arm B' (prod candidate): silent prompt + grammar OMITS topology_plan
//                            -> what ships when the flag flips. NO conflict.
// This is the true production change. If goal_constraints / edges / options are
// equivalent between A' and B', the flag is structurally neutral in production
// and the v187 regression was a harness artifact. If B' still regresses, the
// removal genuinely costs graph configuration and the candidate is rejected.
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-topology-plan-quality-prodmatch.mjs [--n 5]

import { writeFileSync, mkdirSync } from "node:fs";
import { buildDraftGraphSchema } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("FATAL: ANTHROPIC_API_KEY not set."); process.exit(2); }
const args = process.argv.slice(2);
let N = 5, OUTDIR = "/tmp/topoplan-prodmatch";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--n" && args[i + 1]) N = parseInt(args[++i], 10);
  if (args[i] === "--out" && args[i + 1]) OUTDIR = args[++i];
}
mkdirSync(OUTDIR, { recursive: true });

const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0;

// ── Build a v195-consistent prompt by stripping the topology_plan INSTRUCTION.
// Three surgical replacements; each is asserted to have fired (trap-15: a
// silent no-op string.replace would make this test measure the wrong thing).
const SECTION8_ORIG = `## 8. TOPOLOGY PLAN AND EDGES
Build topology_plan (required string[], ≤15 lines):
- Each option and which controllable factors it sets, with values
- Compare interventions across all options — if any two match on all factors, fix now
- Each controllable factor and which outcomes/risks it connects to
- Each external/observable factor and what it feeds
- Each outcome and risk listing its bridge edge to the goal
- At least one complete positive path per option to goal
- At least one complete negative path through a risk to goal

Emit edges following the plan. Verify every planned arrow exists in edges[].`;
// v195 intent: same planning, done SILENTLY, not emitted as a key.
const SECTION8_SILENT = `## 8. TOPOLOGY PLANNING AND EDGES
Plan the topology silently in your reasoning (≤15 lines). Do NOT emit a topology_plan key in the output JSON. Cover:
- Each option and which controllable factors it sets, with values
- Compare interventions across all options — if any two match on all factors, fix now
- Each controllable factor and which outcomes/risks it connects to
- Each external/observable factor and what it feeds
- Each outcome and risk listing its bridge edge to the goal
- At least one complete positive path per option to goal
- At least one complete negative path through a risk to goal

Emit edges following the plan. Verify every planned arrow exists in edges[].`;

const REQKEYS_ORIG = `Required keys: "nodes", "edges", "causal_claims", "topology_plan", "coaching".`;
const REQKEYS_NEW = `Required keys: "nodes", "edges", "causal_claims", "coaching".`;

function stripExampleTopologyPlan(s) {
  // Remove the `  "topology_plan": [ ... ],` block from the example JSON.
  const start = s.indexOf('  "topology_plan": [');
  if (start < 0) return { text: s, fired: false };
  // find the closing `],` line for this block
  const close = s.indexOf('\n  ],', start);
  if (close < 0) return { text: s, fired: false };
  const end = close + '\n  ],'.length;
  return { text: s.slice(0, start) + s.slice(end + 1), fired: true };
}

let prompt = DRAFT_GRAPH_PROMPT_V187;
let firedCount = 0;

if (prompt.includes(SECTION8_ORIG)) { prompt = prompt.replace(SECTION8_ORIG, SECTION8_SILENT); firedCount++; }
else { console.error("ANCHOR MISS: section-8 topology block not found. Prompt shape changed."); process.exit(4); }

if (prompt.includes(REQKEYS_ORIG)) { prompt = prompt.replace(REQKEYS_ORIG, REQKEYS_NEW); firedCount++; }
else { console.error("ANCHOR MISS: 'Required keys' line not found."); process.exit(4); }

const ex = stripExampleTopologyPlan(prompt);
if (ex.fired) { prompt = ex.text; firedCount++; }
else { console.error("ANCHOR MISS: example topology_plan block not found."); process.exit(4); }

// Positive control that the strip WORKED: the phrase "Build topology_plan
// (required" must be gone, the example key must be gone, and required-keys line
// must no longer list it — but the SILENT planning instruction must remain.
const checks = [
  ['3 anchors fired', firedCount === 3],
  ['no "Build topology_plan (required" left', !prompt.includes('Build topology_plan (required')],
  ['no example "topology_plan": [ left', !prompt.includes('  "topology_plan": [')],
  ['required-keys line no longer lists topology_plan', !prompt.includes('"causal_claims", "topology_plan", "coaching"')],
  ['silent-planning instruction present', prompt.includes('Plan the topology silently')],
  ['must-NOT-emit instruction present', prompt.includes('Do NOT emit a topology_plan key')],
];
console.log("=== PROMPT STRIP POSITIVE CONTROL ===");
let bad = 0;
for (const [l, p] of checks) { console.log(`  ${p ? 'PASS' : '**FAIL**'}  ${l}`); if (!p) bad++; }
if (bad) { console.error(`\nFATAL: prompt-strip control failed (${bad}). Aborting.`); process.exit(4); }
console.log(`  prompt length ${DRAFT_GRAPH_PROMPT_V187.length} -> ${prompt.length} chars\n`);

const REMINDER_A = `\n\nOUTPUT FORMAT OVERRIDE (structured mode):
Emit "coaching" and "causal_claims" as JSON-encoded STRINGS. topology_plan is
part of the schema; emit it too, as a JSON-encoded string array.
Example: "topology_plan": "[\\"line 1\\",\\"line 2\\"]".`;
const REMINDER_B = `\n\nOUTPUT FORMAT OVERRIDE (structured mode):
Emit "coaching" and "causal_claims" as JSON-encoded STRINGS.
Example: "causal_claims": "[{\\"type\\":\\"direct\\"}]".`;

const BRIEF_PRIMARY = `Our B2B SaaS net revenue retention has fallen from 112% to 94% over three quarters.
Churn is concentrated in customers under 50 seats who onboarded in the last year.
We have budget for roughly one significant initiative this half. The options on the table are:
rebuild onboarding, add a customer success team for small accounts, or cut price for the
under-50-seat tier. I need to decide which to fund by the end of the month.`;

const ARMS = [
  { name: "A' (prod control:  silent prompt + grammar REQUIRES topo)", schema: buildDraftGraphSchema({ omitTopologyPlan: false }), reminder: REMINDER_A },
  { name: "B' (prod candidate: silent prompt + grammar OMITS topo)", schema: buildDraftGraphSchema({ omitTopologyPlan: true }), reminder: REMINDER_B },
];

async function draft(arm, brief) {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, temperature: TEMPERATURE,
      system: prompt,
      messages: [{ role: "user", content: brief + arm.reminder }],
      output_config: { format: { type: "json_schema", schema: arm.schema } },
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) return { ok: false, ms, error: JSON.stringify(body).slice(0, 300) };
  const text = (body.content ?? []).map((b) => b.text ?? "").join("");
  try { return { ok: true, ms, raw: text, graph: JSON.parse(text), tokens: body.usage?.output_tokens }; }
  catch (e) { return { ok: false, ms, error: `unparseable: ${String(e).slice(0, 160)}` }; }
}

function decodeMaybe(v) { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } }

function score(g) {
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const options = nodes.filter((n) => n.kind === "option");
  const goals = nodes.filter((n) => n.kind === "goal");
  const out = new Map();
  for (const e of edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); }
  const reaches = (start, targetIds) => {
    const seen = new Set([start]); const stack = [start];
    while (stack.length) { const cur = stack.pop(); if (targetIds.has(cur) && cur !== start) return true;
      for (const nx of out.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); } }
    return false;
  };
  const goalIds = new Set(goals.map((n) => n.id));
  const optionsReachingGoal = options.filter((o) => reaches(o.id, goalIds)).length;
  const riskIds = new Set(nodes.filter((n) => n.kind === "risk").map((n) => n.id));
  const negThroughRisk = edges.some((e) => e.effect_direction === "negative" && (riskIds.has(e.from) || riskIds.has(e.to)));
  const sig = (o) => JSON.stringify((o.data?.interventions ?? []).map((i) => [i.factor_id, i.value]).sort());
  const sigs = options.map(sig).filter((s) => s !== "[]" && s !== "null");
  const distinctInterventionSets = new Set(sigs).size;
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const orphans = nodes.filter((n) => !touched.has(n.id)).length;
  const kinds = new Set(nodes.map((n) => n.kind));
  const gc = decodeMaybe(g.goal_constraints);
  const claims = decodeMaybe(g.causal_claims);
  const coaching = decodeMaybe(g.coaching);
  return {
    nodes: nodes.length, edges: edges.length, options: options.length,
    factors: nodes.filter((n) => n.kind === "factor").length,
    risks: riskIds.size, outcomes: nodes.filter((n) => n.kind === "outcome").length,
    hasGoalKind: kinds.has("goal"), hasRiskKind: kinds.has("risk"), hasOutcomeKind: kinds.has("outcome"),
    allOptionsReachGoal: options.length > 0 && optionsReachingGoal === options.length,
    negThroughRisk, distinctInterventionSets,
    identicalOptions: sigs.length !== distinctInterventionSets,
    totalInterventions: options.reduce((n, o) => n + (o.data?.interventions?.length ?? 0), 0),
    orphans,
    goalConstraints: Array.isArray(gc) ? gc.length : 0,
    hasGoalConstraints: Array.isArray(gc) && gc.length > 0,
    causalClaims: Array.isArray(claims) ? claims.length : 0,
    strengthenItems: Array.isArray(coaching?.strengthen_items) ? coaching.strengthen_items.length : 0,
    hasTopologyPlan: g.topology_plan !== undefined,
  };
}

const rows = { 0: [], 1: [] };
console.log(`=== PRODUCTION-MATCH A/B  model=${MODEL} temp=${TEMPERATURE}  primary brief n=${N}/arm ===\n`);
for (let i = 0; i < N; i++) {
  for (let a = 0; a < ARMS.length; a++) {
    const r = await draft(ARMS[a], BRIEF_PRIMARY);
    if (!r.ok) { console.log(`  [${i + 1}] ${ARMS[a].name}: FAIL(${r.ms}ms) ${r.error}`); continue; }
    let s; try { s = score(r.graph); } catch (e) { console.log(`  [${i + 1}] SCORE ERR ${e}`); continue; }
    s._ms = r.ms; s._tokens = r.tokens; rows[a].push(s);
    writeFileSync(`${OUTDIR}/run${i + 1}-arm${a === 0 ? "A" : "B"}.json`, r.raw);
    console.log(
      `  [${i + 1}] ${ARMS[a].name}: ${s.nodes}n/${s.edges}e ${s.options}opt ` +
      `distinctIvSets=${s.distinctInterventionSets} allOptsReachGoal=${s.allOptionsReachGoal} ` +
      `risk=${s.hasRiskKind} outcome=${s.hasOutcomeKind} gc=${s.goalConstraints} orphans=${s.orphans} ` +
      `claims=${s.causalClaims} topoPlan=${s.hasTopologyPlan} | ${s._tokens}tok ${s._ms}ms`);
  }
}

const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((p, q) => p - q); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log("\n=== STRUCTURAL SUMMARY (production-realistic) ===");
for (let a = 0; a < ARMS.length; a++) {
  const rs = rows[a]; if (!rs.length) { console.log(`${ARMS[a].name}: none`); continue; }
  const avg = (f) => (rs.reduce((n, r) => n + f(r), 0) / rs.length).toFixed(2);
  const mn = (f) => Math.min(...rs.map(f)); const all = (f) => rs.every(f); const any = (f) => rs.some(f);
  console.log(
    `\n${ARMS[a].name}  n=${rs.length}\n` +
    `  avg nodes=${avg((r) => r.nodes)} (min ${mn((r) => r.nodes)})  edges=${avg((r) => r.edges)} (min ${mn((r) => r.edges)})  options=${avg((r) => r.options)} (min ${mn((r) => r.options)})\n` +
    `  avg distinct intervention sets=${avg((r) => r.distinctInterventionSets)}  total interventions=${avg((r) => r.totalInterventions)}  factors=${avg((r) => r.factors)}  risks=${avg((r) => r.risks)}  outcomes=${avg((r) => r.outcomes)}\n` +
    `  avg goal_constraints=${avg((r) => r.goalConstraints)} (min ${mn((r) => r.goalConstraints)})  causal_claims=${avg((r) => r.causalClaims)}  strengthen_items=${avg((r) => r.strengthenItems)}\n` +
    `  goal_constraints populated in: ${rs.filter((r) => r.hasGoalConstraints).length}/${rs.length} runs\n` +
    `  ALL: every option reaches goal=${all((r) => r.allOptionsReachGoal)}  risk kind=${all((r) => r.hasRiskKind)}  outcome kind=${all((r) => r.hasOutcomeKind)}  neg-via-risk=${all((r) => r.negThroughRisk)}\n` +
    `  ANY: identical option pair=${any((r) => r.identicalOptions)}  orphans=${any((r) => r.orphans > 0)}\n` +
    `  topology_plan present=${any((r) => r.hasTopologyPlan)}`);
}
console.log("\n=== PERFORMANCE ===");
for (let a = 0; a < ARMS.length; a++) { const rs = rows[a]; if (!rs.length) continue;
  console.log(`${ARMS[a].name}  median tokens=${median(rs.map((r) => r._tokens))}  median wall-clock=${(median(rs.map((r) => r._ms)) / 1000).toFixed(1)}s`); }
const A = rows[0], B = rows[1];
if (A.length && B.length) {
  const dTok = median(A.map((r) => r._tokens)) - median(B.map((r) => r._tokens));
  const dMs = median(A.map((r) => r._ms)) - median(B.map((r) => r._ms));
  console.log(`\ndelta (A' - B'): ${dTok} tokens (${((dTok / median(A.map((r) => r._tokens))) * 100).toFixed(1)}%), ${(dMs / 1000).toFixed(1)}s (${((dMs / median(A.map((r) => r._ms))) * 100).toFixed(1)}%)`);
}
writeFileSync(`${OUTDIR}/rows.json`, JSON.stringify({ A: rows[0], B: rows[1] }, null, 2));
console.log(`\nraw + rows.json -> ${OUTDIR}`);
