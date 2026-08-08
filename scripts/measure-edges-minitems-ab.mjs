// A/B measurement harness for the draft grammar's top-level `edges` guarantee —
// the edges:0 draft-failure regression (2026-08-08).
//
// Sibling of `measure-interventions-ab.mjs` (the 2026-07-19 OPTIONS_IDENTICAL
// P0), and deliberately built on its anti-vacuity machinery. The defect is the
// same one level up the tree: a `required` array with no length bound, which a
// structured-outputs model may satisfy with `[]`.
//
// THE DEFECT UNDER TEST
// ---------------------
// `edges` has always been in the schema's top-level `required` list, but the
// property declared only `{type:"array", items:{...}}` — no `minItems`. So
// `{nodes:[...], edges:[]}` is a STRICTLY CONFORMANT structured output, and the
// model may emit it and stop. Measured from the CEE Render log stream for 8 Aug
// (PHASE0-EVIDENCE-2026-07-28/structured-outputs-witness-2026-08-08.md §1.5):
//   claude-sonnet-4-6, structured_outputs_used:true   n=45  edges:0   0%
//   claude-sonnet-5,   structured_outputs_used:false  n=12  edges:0  25%
//   claude-sonnet-5,   structured_outputs_used:true   n=15  edges:0  80%
//
// DIRECTION OF THE ARMS — NOTE THIS, IT IS THE INVERSE OF THE PRECEDENT.
// `measure-interventions-ab.mjs` ran against a BROKEN base and ADDED the
// candidate fix. The fix is already in this tree, so here the SHIPPED grammar is
// the treatment arm and the CONTROL is DERIVED BY DELETING `minItems` — i.e. the
// control reconstructs the grammar deployed at `db985bbe`. `assertFixedShape()`
// and `assertControlIsThePreFixGrammar()` below make the vacuous version of that
// impossible: if the fix is NOT in the tree, or if the control does not
// reproduce the deployed grammar byte-for-byte, the harness ABORTS with a named
// error rather than printing a reassuring null result.
//
// FIDELITY: this measures `buildDraftGraphSchema()`, the object actually handed
// to `output_config.format.schema` (anthropic.ts:795 -> :909) — NOT the base
// constant. The precedent measured the base, which is a subtly different
// grammar (it still carries the deferred aux keys and the runaway-prone
// node-data fields).
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-edges-minitems-ab.mjs \
//     [--n 3] [--model claude-sonnet-5] [--prompt <served-v195.txt>]

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildDraftGraphSchema } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";
import { rejectsSamplingParams } from "../src/config/models.ts";
import { normaliseDraftResponse } from "../src/adapters/llm/normalisation.ts";
import { validateGraph } from "../src/validators/graph-validator.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("FATAL: ANTHROPIC_API_KEY not set."); process.exit(2); }

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const N = Number(argOf("n", 3));
const MODEL = argOf("model", "claude-sonnet-5");
const PROMPT_FILE = argOf("prompt", null);
const SYSTEM_PROMPT = PROMPT_FILE ? readFileSync(PROMPT_FILE, "utf8") : DRAFT_GRAPH_PROMPT_V187;
// The live cap observed on the failing events (evidence §1.3): outputs were
// 183-986 tokens against this ceiling, which is why truncation was excluded.
const MAX_TOKENS = Number(argOf("max-tokens", 8489));

// `claude-sonnet-5` returns HTTP 400 for temperature/top_p/top_k. The product
// routes every call through this predicate; the harness must too, or it measures
// a request the product could never send. (Derived, not hardcoded.)
const OMIT_TEMPERATURE = rejectsSamplingParams(MODEL);

// The brief from the live golden-journey harness (the CRM decision the 8 Aug
// witness ran). Kept fixed across arms.
const BRIEF =
  "We are deciding whether to replace our CRM this year or keep the current one and " +
  "invest in training. Annual licence is around 60k and the team is 25 people. " +
  "Go ahead and draft the model with sensible defaults.";

const OUTDIR = `evidence/edges-minitems-ab-${Date.now()}`;
mkdirSync(OUTDIR, { recursive: true });

// ---------------------------------------------------------------------------
// Anchors + arm derivation — the anti-vacuity machinery
// ---------------------------------------------------------------------------

/** The top-level `edges` array schema. */
function edgesSchema(schema) {
  const e = schema?.properties?.edges;
  if (!e || e.type !== "array") {
    throw new Error(
      "ANCHOR FAILED: properties.edges is not an array schema — the grammar changed and this harness would measure the wrong thing",
    );
  }
  return e;
}

/**
 * The tree under measurement must CONTAIN THE FIX, or the treatment arm is a
 * copy of the control and the run reports "no effect" from a grammar that never
 * had one.
 */
function assertFixedShape(built) {
  const e = edgesSchema(built);
  if (e.minItems === undefined) {
    throw new Error(
      "VACUOUS TREATMENT: edges.minItems is NOT set on the built grammar. The fix is not in this tree, so the treatment arm is byte-identical to the control and the run would report a null result that reads as 'the fix does nothing'.",
    );
  }
  if (!built.required?.includes("edges")) {
    throw new Error(
      "ANCHOR FAILED: `edges` is not in the built schema's top-level `required`. The premise of this measurement (required-does-not-bound-length) no longer holds.",
    );
  }
  return built;
}

/**
 * The control must reproduce the DEPLOYED grammar, not merely "the treatment
 * minus one keyword I happened to pick". The deployed built grammar serialised
 * to exactly 2,689 bytes — independently corroborated by the model-capability
 * probe note for claude-sonnet-5 ("the REAL 2689-byte draft grammar"). If this
 * drifts, the control is measuring something other than what shipped.
 */
const DEPLOYED_BUILT_BYTES = 2689;
function assertControlIsThePreFixGrammar(control) {
  const bytes = JSON.stringify(control).length;
  if (bytes !== DEPLOYED_BUILT_BYTES) {
    throw new Error(
      `CONTROL DRIFT: the derived control serialises to ${bytes} bytes, not the deployed ${DEPLOYED_BUILT_BYTES}. ` +
      "The control no longer reconstructs the grammar that produced the regression, so the comparison is not the one this harness claims to make.",
    );
  }
  if (edgesSchema(control).minItems !== undefined) {
    throw new Error("CONTROL FAILED: minItems survived the deletion — the control still carries the fix.");
  }
  return control;
}

const TREATMENT = assertFixedShape(buildDraftGraphSchema());
const TREATMENT_SNAPSHOT = JSON.stringify(TREATMENT);

/** Derive the pre-fix grammar: drop BOTH length bounds added by the fix. */
function deriveControl() {
  const clone = structuredClone(TREATMENT);
  delete clone.properties.edges.minItems;
  delete clone.properties.nodes.minItems;
  if (JSON.stringify(clone) === TREATMENT_SNAPSHOT) {
    throw new Error("ANCHOR FAILED: the control is byte-identical to the treatment — the deletion did not land");
  }
  if (JSON.stringify(TREATMENT) !== TREATMENT_SNAPSHOT) {
    throw new Error("ANCHOR FAILED: deriving the control MUTATED the shared treatment schema");
  }
  return assertControlIsThePreFixGrammar(clone);
}

const arms = [
  { label: "control", schema: deriveControl(), describe: "pre-fix grammar (edges/nodes minItems deleted) — reconstructs deployed db985bbe" },
  { label: "minitems", schema: TREATMENT, describe: "shipped grammar (edges + nodes minItems: 1)" },
];

const promptSha = createHash("sha256").update(SYSTEM_PROMPT).digest("hex").slice(0, 16);
console.log(`model            : ${MODEL}  (temperature ${OMIT_TEMPERATURE ? "OMITTED — model rejects sampling params" : "0"})`);
console.log(`system prompt    : ${PROMPT_FILE ?? "on-disk v187"} (${SYSTEM_PROMPT.length} chars, sha256[:16] ${promptSha})`);
console.log(`max_tokens       : ${MAX_TOKENS}`);
console.log(`control bytes    : ${JSON.stringify(arms[0].schema).length} (deployed ${DEPLOYED_BUILT_BYTES})`);
console.log(`treatment bytes  : ${JSON.stringify(arms[1].schema).length}`);
console.log(`arms             : ${arms.map((a) => a.label).join(", ")}  (n=${N} each)\n`);

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

/**
 * The enforcement codes that mean "this graph has no usable causal structure".
 * DERIVED from the codes the live edges:0 failures carried, and deliberately
 * NOT the whole error set: the CEE pipeline's enricher and repair stages fix
 * data-quality codes (CATEGORY_MISMATCH, CONTROLLABLE_MISSING_DATA,
 * OBSERVABLE_EXTRA_DATA, INVALID_EDGE_TYPE), so counting those would score the
 * raw model output against a bar the product never applies to it.
 *
 * ⚠ SCOPE: this harness calls the validator on the RAW draft. It does NOT run
 * the enricher or the LLM repair stage, so `structurallyUsable` is a NECESSARY
 * condition for a draft to commit, not a sufficient one. Do not read it as a
 * predicted success rate.
 */
const STRUCTURAL_CODES = new Set([
  "MISSING_BRIDGE",
  "MISSING_GOAL",
  "NO_PATH_TO_GOAL",
  "NO_EFFECT_PATH",
  "UNREACHABLE_FROM_DECISION",
]);

function score(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  let structuralCodes = [];
  try {
    const normalised = normaliseDraftResponse(graph);
    const result = validateGraph({ graph: normalised, requestId: "measure-edges-ab" });
    structuralCodes = [...new Set((result.errors ?? []).map((e) => e.code))]
      .filter((c) => STRUCTURAL_CODES.has(c))
      .sort();
  } catch (e) {
    structuralCodes = [`THREW:${String(e?.message).slice(0, 40)}`];
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    // THE DEFECT, exactly as the Render log names it.
    edgesZero: edges.length === 0,
    structuralCodes,
    structurallyUsable: structuralCodes.length === 0,
  };
}

// POSITIVE + NEGATIVE CONTROL (trap-13): an absence assertion must first be
// shown able to SEE a presence.
{
  const good = score({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "b" }] });
  if (good.edgesZero || good.edgeCount !== 1 || good.nodeCount !== 1) {
    throw new Error(`POSITIVE CONTROL FAILED: scorer cannot read a good draft: ${JSON.stringify(good)}`);
  }
  const bad = score({ nodes: [{ id: "a" }, { id: "b" }], edges: [] });
  if (!bad.edgesZero || bad.edgeCount !== 0 || bad.nodeCount !== 2) {
    throw new Error(`NEGATIVE CONTROL FAILED: scorer cannot see the defect: ${JSON.stringify(bad)}`);
  }
  console.log("controls: scorer reads a GOOD draft (1 edge) and the DEFECT (edges:0) — OK\n");
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function callArm(schema, label, i) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    ...(OMIT_TEMPERATURE ? {} : { temperature: 0 }),
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: BRIEF }],
    output_config: { format: { type: "json_schema", schema } },
    thinking: { type: "disabled" },
  };
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json();
  if (!res.ok) {
    console.error(`${label}#${i} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return { httpError: res.status, ms };
  }
  const text = json.content?.map((c) => c.text ?? "").join("") ?? "";
  writeFileSync(`${OUTDIR}/${label}-${i}.json`, text);
  let graph;
  try { graph = JSON.parse(text); } catch { console.error(`${label}#${i}: unparseable`); return { unparseable: true, ms }; }
  return { ...score(graph), ms, outTokens: json.usage?.output_tokens, stopReason: json.stop_reason };
}

const results = Object.fromEntries(arms.map((a) => [a.label, []]));
for (let i = 0; i < N; i++) {
  for (const arm of arms) {
    const r = await callArm(arm.schema, arm.label, i);
    if (r.httpError || r.unparseable) { results[arm.label].push(r); continue; }
    results[arm.label].push(r);
    console.log(
      `arm ${arm.label} #${i}: nodes=${r.nodeCount} edges=${r.edgeCount} ` +
      `EDGES_ZERO=${r.edgesZero} usable=${r.structurallyUsable} stop=${r.stopReason} ` +
      `(${r.ms}ms, ${r.outTokens}tok)` +
      (r.structuralCodes.length ? ` [${r.structuralCodes.join(",")}]` : ""),
    );
  }
}

function summarise(rs, label, describe) {
  const usable = rs.filter((r) => !r.httpError && !r.unparseable);
  if (!usable.length) return `arm ${label}: NO USABLE DATA (${rs.length} attempts)`;
  const fails = usable.filter((r) => r.edgesZero).length;
  const structOk = usable.filter((r) => r.structurallyUsable).length;
  // The displaced-defect counter. `minItems: 1` cannot compel a SUFFICIENT edge
  // set — only a non-empty one — so an arm can score 0 on `edges:0` while the
  // model still terminates early, now emitting exactly one edge. Reporting this
  // separately is what stops the headline number reading as "regression fixed".
  const degenerate = usable.filter((r) => r.edgeCount === 1).length;
  const avg = (f) => (usable.reduce((a, r) => a + f(r), 0) / usable.length).toFixed(1);
  const range = (f) => `${Math.min(...usable.map(f))}-${Math.max(...usable.map(f))}`;
  return (
    `arm ${label} (${describe}):\n` +
    `    edges:0 ${fails}/${usable.length} | STRUCTURALLY USABLE ${structOk}/${usable.length} | ` +
    `degenerate (exactly 1 edge) ${degenerate}/${usable.length}\n` +
    `    avg nodes ${avg((r) => r.nodeCount)} | ` +
    `avg edges ${avg((r) => r.edgeCount)} | edge range ${range((r) => r.edgeCount)} | ` +
    `out_tokens ${range((r) => r.outTokens ?? 0)}`
  );
}

console.log("");
for (const arm of arms) console.log(summarise(results[arm.label], arm.label, arm.describe));
writeFileSync(
  `${OUTDIR}/summary.json`,
  JSON.stringify({ model: MODEL, promptSha, promptChars: SYSTEM_PROMPT.length, maxTokens: MAX_TOKENS, n: N, arms: arms.map((a) => ({ label: a.label, describe: a.describe, bytes: JSON.stringify(a.schema).length })), results }, null, 2),
);
console.log(`\nevidence: ${OUTDIR}/`);
