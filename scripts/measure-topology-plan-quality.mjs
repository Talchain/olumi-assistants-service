// Structural-quality A/B for the v10 flag-dark `topology_plan` omission.
//
// WHY THIS EXISTS
// ---------------
// Round 2 of the draft output-token lane was HALTED on a quality alarm: run 1
// showed a 912-token delta where only ~508 was predicted, raising the
// possibility that arm B wins on tokens by drafting a SMALLER graph — a
// quality regression wearing a speed win's clothing. Nothing about a token
// number can settle that. This does.
//
// The emission-order argument (topology_plan is written AFTER nodes and edges)
// proves it cannot have scaffolded the graph structure. It does NOT prove the
// model doesn't reason better overall for having been made to write it, and
// today's OPTIONS_IDENTICAL regression is a live reminder that draft quality
// degrades invisibly. So we score both arms on mechanically-checkable
// structural properties and REJECT the candidate on any material shortfall,
// no matter how good the token numbers look.
//
// PROMPT CAVEAT (important, and it makes this test CONSERVATIVE)
// -------------
// This runs against the on-disk DRAFT_GRAPH_PROMPT_V187, whose line 144
// instructs: "Build topology_plan (required string[], <=15 lines)". The SERVED
// PMS prompt is v195, whose line 159 says the opposite: do the planning
// silently, the "output JSON must NOT contain a topology_plan key". So here:
//   arm A (flag off): prompt says emit + grammar requires  -> agree
//   arm B (flag on):  prompt says emit + grammar FORBIDS   -> CONFLICT
// Arm B is therefore tested under maximum prompt/grammar conflict, which
// production (v195, where prompt and grammar AGREE it is not emitted) never
// experiences. A structural PASS here is a conservative pass: the production
// configuration is strictly less conflicted than the one measured. Only a FAIL
// would be ambiguous between "removal hurts" and "the induced conflict hurts".
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-topology-plan-quality.mjs [--n 5]
// Key read from the environment BY NAME only; never printed.

import { writeFileSync, mkdirSync } from "node:fs";
import { buildDraftGraphSchema } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("FATAL: ANTHROPIC_API_KEY is not set in the environment.");
  process.exit(2);
}
const args = process.argv.slice(2);
let N = 5;
let OUTDIR = "/tmp/topoplan-ab";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--n" && args[i + 1]) N = parseInt(args[++i], 10);
  if (args[i] === "--out" && args[i + 1]) OUTDIR = args[++i];
}
mkdirSync(OUTDIR, { recursive: true });

// Production draft path uses temperature 0 (anthropic.ts:596 — thinking is off
// on the structured-outputs path), so this matches production exactly.
const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0;

const REMINDER_A = `\n\nOUTPUT FORMAT OVERRIDE (structured mode):
Emit "coaching", "causal_claims", and "topology_plan" as JSON-encoded STRINGS.
Each must contain exactly the JSON value the schema instructions describe
(coaching object, causal_claims array, topology_plan string array), serialised
with correctly escaped quotes. Example: "topology_plan": "[\\"line 1\\",\\"line 2\\"]".`;

const REMINDER_B = `\n\nOUTPUT FORMAT OVERRIDE (structured mode):
Emit "coaching" and "causal_claims" as JSON-encoded STRINGS.
Each must contain exactly the JSON value the schema instructions describe
(coaching object, causal_claims array), serialised with correctly escaped
quotes. Example: "causal_claims": "[{\\"type\\":\\"direct\\"}]".`;

// Primary brief — the mandated "same brief, n>=5 per arm" comparison.
const BRIEF_PRIMARY = `Our B2B SaaS net revenue retention has fallen from 112% to 94% over three quarters.
Churn is concentrated in customers under 50 seats who onboarded in the last year.
We have budget for roughly one significant initiative this half. The options on the table are:
rebuild onboarding, add a customer success team for small accounts, or cut price for the
under-50-seat tier. I need to decide which to fund by the end of the month.`;

// Coverage supplement. At temperature 0 the primary brief measures
// reproducibility rather than a distribution, so two further decision SHAPES
// are sampled once per arm to check the verdict is not brief-specific.
const BRIEF_SUPPLEMENT = [
  `We run a 40-person hardware startup. Our contract manufacturer in Shenzhen has raised unit
price 18% and lead times have gone from 6 to 14 weeks. We can stay and absorb it, dual-source
with a Vietnamese plant at higher unit cost but shorter lead time, or bring final assembly
in-house which needs capex we would have to raise. Decide within six weeks.`,
  `Our clinical research team must choose how to handle a safety signal that appeared in 3 of
400 patients in an ongoing trial. We can pause enrolment pending review, continue with an
amended monitoring protocol, or narrow the inclusion criteria and continue. Regulator
notification is due in 15 days either way.`,
];

const ARMS = [
  { name: "A (control, flag OFF)", schema: buildDraftGraphSchema({ omitTopologyPlan: false }), reminder: REMINDER_A },
  { name: "B (candidate, flag ON)", schema: buildDraftGraphSchema({ omitTopologyPlan: true }), reminder: REMINDER_B },
];

async function draft(arm, brief) {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, temperature: TEMPERATURE,
      system: DRAFT_GRAPH_PROMPT_V187,
      messages: [{ role: "user", content: brief + arm.reminder }],
      output_config: { format: { type: "json_schema", schema: arm.schema } },
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) return { ok: false, ms, error: JSON.stringify(body).slice(0, 300) };
  const text = (body.content ?? []).map((b) => b.text ?? "").join("");
  try {
    return { ok: true, ms, raw: text, graph: JSON.parse(text), tokens: body.usage?.output_tokens };
  } catch (e) {
    return { ok: false, ms, error: `unparseable: ${String(e).slice(0, 160)}` };
  }
}

// Some top-level keys arrive as JSON-encoded strings (the grammar declares them
// as { type: "string" }); decode defensively so scoring sees the real value.
function decodeMaybe(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

// -- mechanical structural scoring -------------------------------------
function score(g) {
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const options = nodes.filter((n) => n.kind === "option");
  const goals = nodes.filter((n) => n.kind === "goal");

  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const reaches = (start, targetIds) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      if (targetIds.has(cur) && cur !== start) return true;
      for (const nx of out.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
    }
    return false;
  };
  const goalIds = new Set(goals.map((n) => n.id));
  const optionsReachingGoal = options.filter((o) => reaches(o.id, goalIds)).length;

  const riskIds = new Set(nodes.filter((n) => n.kind === "risk").map((n) => n.id));
  const negThroughRisk = edges.some(
    (e) => e.effect_direction === "negative" && (riskIds.has(e.from) || riskIds.has(e.to)),
  );

  // OPTIONS_IDENTICAL class: distinct intervention SETS across options.
  const sig = (o) => JSON.stringify(
    (o.data?.interventions ?? []).map((i) => [i.factor_id, i.value]).sort(),
  );
  const sigs = options.map(sig).filter((s) => s !== "[]" && s !== "null");
  const distinctInterventionSets = new Set(sigs).size;
  const identicalOptions = sigs.length !== distinctInterventionSets;
  const optionsWithNoInterventions = options.length - sigs.length;
  const totalInterventions = options.reduce(
    (n, o) => n + (o.data?.interventions?.length ?? 0), 0);

  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const orphans = nodes.filter((n) => !touched.has(n.id)).length;

  const kinds = new Set(nodes.map((n) => n.kind));
  const gc = decodeMaybe(g.goal_constraints);
  const claims = decodeMaybe(g.causal_claims);
  const coaching = decodeMaybe(g.coaching);

  return {
    nodes: nodes.length,
    edges: edges.length,
    options: options.length,
    goals: goals.length,
    risks: riskIds.size,
    outcomes: nodes.filter((n) => n.kind === "outcome").length,
    factors: nodes.filter((n) => n.kind === "factor").length,
    hasGoalKind: kinds.has("goal"),
    hasRiskKind: kinds.has("risk"),
    hasOutcomeKind: kinds.has("outcome"),
    optionsReachingGoal,
    allOptionsReachGoal: options.length > 0 && optionsReachingGoal === options.length,
    negThroughRisk,
    distinctInterventionSets,
    identicalOptions,
    optionsWithNoInterventions,
    totalInterventions,
    orphans,
    goalConstraints: Array.isArray(gc) ? gc.length : 0,
    hasGoalConstraints: Array.isArray(gc) && gc.length > 0,
    causalClaims: Array.isArray(claims) ? claims.length : 0,
    strengthenItems: Array.isArray(coaching?.strengthen_items) ? coaching.strengthen_items.length : 0,
    hasTopologyPlan: g.topology_plan !== undefined,
    kinds: [...kinds].sort().join(","),
  };
}

// -- SCORER POSITIVE CONTROL (trap 13) ---------------------------------
// "Any test proving an ABSENCE must first prove it can SEE a PRESENCE."
// A scorer that silently returns clean on everything would rubber-stamp both
// arms. Prove every detector FIRES on a graph engineered to trip it, and stays
// quiet on a clean one. Abort the whole run if either direction fails.
function selfTest() {
  const BAD = {
    nodes: [
      { id: "g1", kind: "goal" },
      { id: "o1", kind: "option", data: { interventions: [{ factor_id: "f1", value: 1 }] } },
      { id: "o2", kind: "option", data: { interventions: [{ factor_id: "f1", value: 1 }] } }, // identical to o1
      { id: "o3", kind: "option", data: { interventions: [{ factor_id: "f2", value: 5 }] } }, // never reaches goal
      { id: "f1", kind: "factor" },
      { id: "orph", kind: "factor" }, // orphan: no edge touches it
    ],
    edges: [
      { from: "o1", to: "f1", effect_direction: "positive" },
      { from: "f1", to: "g1", effect_direction: "positive" },
      { from: "o2", to: "f1", effect_direction: "positive" },
    ],
    goal_constraints: [],
    causal_claims: [],
  };
  const GOOD = {
    nodes: [
      { id: "g1", kind: "goal" },
      { id: "r1", kind: "risk" },
      { id: "u1", kind: "outcome" },
      { id: "o1", kind: "option", data: { interventions: [{ factor_id: "f1", value: 1 }] } },
      { id: "o2", kind: "option", data: { interventions: [{ factor_id: "f2", value: 2 }] } },
      { id: "f1", kind: "factor" },
      { id: "f2", kind: "factor" },
    ],
    edges: [
      { from: "o1", to: "f1", effect_direction: "positive" },
      { from: "o2", to: "f2", effect_direction: "positive" },
      { from: "f1", to: "g1", effect_direction: "positive" },
      { from: "f2", to: "g1", effect_direction: "positive" },
      { from: "r1", to: "g1", effect_direction: "negative" },
      { from: "f1", to: "r1", effect_direction: "positive" },
      { from: "u1", to: "g1", effect_direction: "positive" },
      { from: "g1", to: "u1", effect_direction: "positive" },
    ],
    goal_constraints: [{ constraint_id: "c1", node_id: "g1", operator: ">=", value: 1, label: "x" }],
    causal_claims: [{ type: "direct" }],
  };

  const b = score(BAD);
  const gd = score(GOOD);
  const checks = [
    ["detects identical option pair", b.identicalOptions === true],
    ["detects option not reaching goal", b.allOptionsReachGoal === false],
    ["detects orphan node", b.orphans > 0],
    ["detects missing risk kind", b.hasRiskKind === false],
    ["detects missing outcome kind", b.hasOutcomeKind === false],
    ["detects absent goal_constraints", b.hasGoalConstraints === false],
    ["detects no negative-via-risk path", b.negThroughRisk === false],
    ["counts distinct intervention sets", b.distinctInterventionSets === 2],
    ["clean graph: options distinct", gd.identicalOptions === false],
    ["clean graph: all options reach goal", gd.allOptionsReachGoal === true],
    ["clean graph: no orphans", gd.orphans === 0],
    ["clean graph: risk kind seen", gd.hasRiskKind === true],
    ["clean graph: outcome kind seen", gd.hasOutcomeKind === true],
    ["clean graph: goal_constraints seen", gd.hasGoalConstraints === true],
    ["clean graph: negative-via-risk seen", gd.negThroughRisk === true],
  ];
  console.log("=== SCORER POSITIVE CONTROL ===");
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? "PASS" : "**FAIL**"}  ${label}`);
    if (!pass) failed++;
  }
  if (failed) {
    console.error(`\nFATAL: ${failed} scorer self-check(s) failed. Every structural`);
    console.error("verdict below would be vacuous. Aborting before spending any API calls.");
    process.exit(3);
  }
  console.log("  -> all detectors fire on a bad graph and stay quiet on a clean one.\n");
}
selfTest();

// -- run ----------------------------------------------------------------
const PLAN = [
  ...Array.from({ length: N }, () => ({ brief: BRIEF_PRIMARY, tag: "primary" })),
  ...BRIEF_SUPPLEMENT.map((b, i) => ({ brief: b, tag: `supplement${i + 1}` })),
];

const rows = { 0: [], 1: [] };
console.log(`=== STRUCTURAL A/B  model=${MODEL} temp=${TEMPERATURE} ===`);
console.log(`primary brief n=${N} per arm, plus ${BRIEF_SUPPLEMENT.length} coverage briefs x1, interleaved\n`);

for (let i = 0; i < PLAN.length; i++) {
  const { brief, tag } = PLAN[i];
  for (let a = 0; a < ARMS.length; a++) {
    const r = await draft(ARMS[a], brief);
    if (!r.ok) { console.log(`  [${tag} ${i + 1}] ${ARMS[a].name}: FAIL(${r.ms}ms) ${r.error}`); continue; }
    let s;
    try { s = score(r.graph); }
    catch (e) { console.log(`  [${tag} ${i + 1}] ${ARMS[a].name}: SCORE ERROR ${String(e).slice(0, 160)}`); continue; }
    s._tag = tag; s._ms = r.ms; s._tokens = r.tokens;
    rows[a].push(s);
    writeFileSync(`${OUTDIR}/${tag}-${i + 1}-arm${a === 0 ? "A" : "B"}.json`, r.raw);
    console.log(
      `  [${tag} ${i + 1}] ${ARMS[a].name}: ${s.nodes}n/${s.edges}e ${s.options}opt ` +
      `distinctIvSets=${s.distinctInterventionSets} allOptsReachGoal=${s.allOptionsReachGoal} ` +
      `risk=${s.hasRiskKind} outcome=${s.hasOutcomeKind} gc=${s.goalConstraints} ` +
      `orphans=${s.orphans} claims=${s.causalClaims} topoPlan=${s.hasTopologyPlan} ` +
      `| ${s._tokens}tok ${s._ms}ms`
    );
  }
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log("\n=== STRUCTURAL SUMMARY (decide on THIS, before any token number) ===");
for (let a = 0; a < ARMS.length; a++) {
  const rs = rows[a];
  if (!rs.length) { console.log(`${ARMS[a].name}: no successful runs`); continue; }
  const avg = (f) => (rs.reduce((n, r) => n + f(r), 0) / rs.length).toFixed(2);
  const mn = (f) => Math.min(...rs.map(f));
  const all = (f) => rs.every(f);
  const any = (f) => rs.some(f);
  console.log(
    `\n${ARMS[a].name}  n=${rs.length}\n` +
    `  avg nodes=${avg((r) => r.nodes)} (min ${mn((r) => r.nodes)})  edges=${avg((r) => r.edges)} (min ${mn((r) => r.edges)})\n` +
    `  avg options=${avg((r) => r.options)} (min ${mn((r) => r.options)})  distinct intervention sets=${avg((r) => r.distinctInterventionSets)} (min ${mn((r) => r.distinctInterventionSets)})\n` +
    `  avg total interventions=${avg((r) => r.totalInterventions)}  factors=${avg((r) => r.factors)}  risks=${avg((r) => r.risks)}  outcomes=${avg((r) => r.outcomes)}\n` +
    `  avg goal_constraints=${avg((r) => r.goalConstraints)} (min ${mn((r) => r.goalConstraints)})  causal_claims=${avg((r) => r.causalClaims)}  strengthen_items=${avg((r) => r.strengthenItems)}\n` +
    `  ALL runs: every option reaches goal   = ${all((r) => r.allOptionsReachGoal)}\n` +
    `  ALL runs: goal kind present           = ${all((r) => r.hasGoalKind)}\n` +
    `  ALL runs: risk kind present           = ${all((r) => r.hasRiskKind)}\n` +
    `  ALL runs: outcome kind present        = ${all((r) => r.hasOutcomeKind)}\n` +
    `  ALL runs: goal_constraints non-empty  = ${all((r) => r.hasGoalConstraints)}\n` +
    `  ALL runs: negative path via risk      = ${all((r) => r.negThroughRisk)}\n` +
    `  ANY run:  identical option pair       = ${any((r) => r.identicalOptions)}   <- OPTIONS_IDENTICAL class\n` +
    `  ANY run:  option with 0 interventions = ${any((r) => r.optionsWithNoInterventions > 0)}\n` +
    `  ANY run:  orphan nodes                = ${any((r) => r.orphans > 0)}\n` +
    `  topology_plan present in output       = ${any((r) => r.hasTopologyPlan)}`
  );
}

console.log("\n=== PERFORMANCE (report ONLY after the structural verdict) ===");
for (let a = 0; a < ARMS.length; a++) {
  const rs = rows[a];
  if (!rs.length) continue;
  console.log(
    `${ARMS[a].name}  n=${rs.length}  median tokens=${median(rs.map((r) => r._tokens))}  ` +
    `median wall-clock=${(median(rs.map((r) => r._ms)) / 1000).toFixed(1)}s`
  );
}
const A = rows[0], B = rows[1];
if (A.length && B.length) {
  const dTok = median(A.map((r) => r._tokens)) - median(B.map((r) => r._tokens));
  const dMs = median(A.map((r) => r._ms)) - median(B.map((r) => r._ms));
  console.log(
    `\ndelta (A - B): ${dTok} tokens (${((dTok / median(A.map((r) => r._tokens))) * 100).toFixed(1)}%), ` +
    `${(dMs / 1000).toFixed(1)}s (${((dMs / median(A.map((r) => r._ms))) * 100).toFixed(1)}%)`
  );
  console.log("NOTE: do not project latency from tokens. Round 1 measured -26.6% tokens but");
  console.log("only -13% wall-clock; decode rate drops under a larger optional surface, so");
  console.log("roughly 1/3 of any token saving is eaten back. Both are measured above.");
}

writeFileSync(`${OUTDIR}/rows.json`, JSON.stringify({ A: rows[0], B: rows[1] }, null, 2));
console.log(`\nraw responses + rows.json written to ${OUTDIR}`);
