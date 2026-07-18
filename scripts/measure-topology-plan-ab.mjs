// Live A/B for the v10 flag-dark `topology_plan` omission.
//
// WHAT IT MEASURES
// ----------------
// One variable: the CEE_DRAFT_OMIT_TOPOLOGY_PLAN flag, as production applies
// it — i.e. the schema variant AND its matching structured-outputs aux-string
// reminder together, since the flag changes both. Everything else (model,
// system prompt, brief, temperature, max_tokens) is byte-identical per arm.
//
//   arm A (flag OFF, current staging): schema REQUIRES topology_plan
//   arm B (flag ON,  this PR):         property removed from the schema
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-topology-plan-ab.mjs [--n 5]
// The key is read from the environment BY NAME only and never printed.
//
// METHOD NOTES (both learned the expensive way, see PR #520)
//  - A first call against a NEW schema pays a one-off server-side grammar
//    compile (~20s). Each arm therefore runs ONE DISCARDED WARM-UP before the
//    measured runs, and we report MEDIANS. Means would be misleading.
//  - Wall-clock is NOT tokens/80. Decode rate varies with schema shape, so
//    roughly a third of any token saving is eaten back. Report BOTH; never
//    project one from the other.
//  - Arms are INTERLEAVED (A,B,A,B,...) so any drift in API latency over the
//    run hits both arms equally rather than confounding the comparison.

import { buildDraftGraphSchema } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("FATAL: ANTHROPIC_API_KEY is not set in the environment.");
  process.exit(2);
}

const args = process.argv.slice(2);
let N = 5;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--n" && args[i + 1]) N = parseInt(args[++i], 10);
}

const MODEL = "claude-sonnet-4-6";

// The two aux-string reminders, copied verbatim from
// src/adapters/llm/anthropic.ts so the arms match what production sends.
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

// One fixed brief, used by BOTH arms and every run.
const BRIEF = `Our B2B SaaS net revenue retention has fallen from 112% to 94% over three quarters.
Churn is concentrated in customers under 50 seats who onboarded in the last year.
We have budget for roughly one significant initiative this half. The options on the table are:
rebuild onboarding, add a customer success team for small accounts, or cut price for the
under-50-seat tier. I need to decide which to fund by the end of the month.`;

const ARMS = [
  {
    name: "A (flag OFF — topology_plan REQUIRED)",
    schema: buildDraftGraphSchema({ omitTopologyPlan: false }),
    reminder: REMINDER_A,
  },
  {
    name: "B (flag ON — topology_plan REMOVED)",
    schema: buildDraftGraphSchema({ omitTopologyPlan: true }),
    reminder: REMINDER_B,
  },
];

async function callOnce(arm) {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      temperature: 0,
      system: DRAFT_GRAPH_PROMPT_V187,
      messages: [{ role: "user", content: BRIEF + arm.reminder }],
      output_config: { format: { type: "json_schema", schema: arm.schema } },
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) {
    return { ok: false, ms, status: res.status, error: JSON.stringify(body).slice(0, 300) };
  }
  const text = (body.content ?? []).map((b) => b.text ?? "").join("");
  return {
    ok: true,
    ms,
    outputTokens: body.usage?.output_tokens ?? null,
    inputTokens: body.usage?.input_tokens ?? null,
    chars: text.length,
    // Did the key actually appear in the response? The point of the change.
    hasTopologyPlan: /"topology_plan"/.test(text),
    // Emission ORDER evidence: where each key lands in the response.
    idxNodes: text.indexOf('"nodes"'),
    idxEdges: text.indexOf('"edges"'),
    idxTopology: text.indexOf('"topology_plan"'),
    idxCoaching: text.indexOf('"coaching"'),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

for (const arm of ARMS) {
  console.log(`\nschema bytes, ${arm.name}: ${JSON.stringify(arm.schema).length}`);
}

// Warm-ups (discarded) — pay the one-off grammar compile per schema.
console.log("\n=== WARM-UP (discarded: one-off server-side grammar compile) ===");
for (const arm of ARMS) {
  const r = await callOnce(arm);
  console.log(`  warmup ${arm.name}: ${r.ok ? `${r.ms}ms, ${r.outputTokens} tok` : `FAIL ${r.status} ${r.error}`}`);
  if (!r.ok) process.exit(1);
}

// Measured runs, INTERLEAVED.
const results = { 0: [], 1: [] };
console.log(`\n=== MEASURED RUNS (n=${N} per arm, interleaved) ===`);
for (let i = 0; i < N; i++) {
  for (let a = 0; a < ARMS.length; a++) {
    const r = await callOnce(ARMS[a]);
    if (!r.ok) {
      console.log(`  run ${i + 1} ${ARMS[a].name}: FAIL ${r.status} ${r.error}`);
      continue;
    }
    results[a].push(r);
    console.log(
      `  run ${i + 1} ${ARMS[a].name}: ${r.outputTokens} tok, ${r.ms}ms, ` +
      `${(r.outputTokens / (r.ms / 1000)).toFixed(1)} tok/s, topology_plan_present=${r.hasTopologyPlan}`
    );
  }
}

console.log("\n=== RESULTS (medians) ===");
const summary = ARMS.map((arm, a) => {
  const rs = results[a];
  return {
    arm: arm.name,
    n: rs.length,
    medTokens: median(rs.map((r) => r.outputTokens)),
    medMs: median(rs.map((r) => r.ms)),
    medTokPerSec: median(rs.map((r) => r.outputTokens / (r.ms / 1000))),
    everEmittedTopologyPlan: rs.some((r) => r.hasTopologyPlan),
  };
});
for (const s of summary) {
  console.log(
    `${s.arm}\n  n=${s.n}  median output tokens=${s.medTokens}  median wall-clock=${(s.medMs / 1000).toFixed(1)}s  ` +
    `median decode=${s.medTokPerSec.toFixed(1)} tok/s  topology_plan ever emitted=${s.everEmittedTopologyPlan}`
  );
}
if (summary[0].n && summary[1].n) {
  const dTok = summary[1].medTokens - summary[0].medTokens;
  const dMs = summary[1].medMs - summary[0].medMs;
  console.log(
    `\nDELTA (B - A): ${dTok} tokens (${((dTok / summary[0].medTokens) * 100).toFixed(1)}%), ` +
    `${(dMs / 1000).toFixed(1)}s (${((dMs / summary[0].medMs) * 100).toFixed(1)}%)`
  );
  console.log(
    `Token saving eaten back by decode-rate change: ` +
    `tokens ${((-dTok / summary[0].medTokens) * 100).toFixed(1)}% vs wall-clock ${((-dMs / summary[0].medMs) * 100).toFixed(1)}%`
  );
}

// Emission-order evidence from arm A (scaffolding assessment).
const a0 = results[0][0];
if (a0) {
  console.log(
    `\n=== EMISSION ORDER (arm A, run 1) — char index of each key ===\n` +
    `  nodes=${a0.idxNodes}  edges=${a0.idxEdges}  topology_plan=${a0.idxTopology}  coaching=${a0.idxCoaching}`
  );
}
