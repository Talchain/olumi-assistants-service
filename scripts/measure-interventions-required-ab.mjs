// DECISIVE A/B: does demoting `data.interventions` out of the draft grammar's
// `required` list (v9, PR #520) cause the model to OMIT option interventions —
// producing the OPTIONS_IDENTICAL / empty-signature P0 outage?
//
// THE CLAIM UNDER TEST
// --------------------
// #520 demoted eight `data` fields from `required` to optional, justified as
// "downstream-neutral" because the ingress normaliser coerces each sentinel
// back to `undefined`. That reasoning holds for genuinely inapplicable fields
// (raw_value, unit, cap, encoding_map, display_value...). It does NOT hold for
// `interventions`, which on an OPTION node is not a sentinel — it is the ONLY
// content that distinguishes one option from another. Demoting it removed the
// grammar's sole guarantee that option nodes carry interventions at all.
//
// The two arms differ in EXACTLY ONE property: whether `interventions` appears
// in the `data` object's `required` list. Same model, same prompt, same
// temperature, same brief.
//   arm A (current staging, v9): interventions OPTIONAL  -> hypothesised omission
//   arm B (fix):                 interventions REQUIRED   -> hypothesised populated
//
// The metric is the one the validator actually uses: the intervention signature
// per option node (graph-validator.ts buildInterventionSignature). An EMPTY
// signature on >1 option is precisely the live failure
// (violation_code: OPTIONS_IDENTICAL, intervention_signature: "").
//
// POSITIVE CONTROL (trap-13): the scorer must be shown to SEE populated
// interventions, not merely to report zero for everything. Arm B is that
// control; additionally a synthetic fixture is scored at startup and must
// report a non-empty signature, or the harness aborts.
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-interventions-required-ab.mjs [--n 3]

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("FATAL: ANTHROPIC_API_KEY not set."); process.exit(2); }
const args = process.argv.slice(2);
let N = 3, OUTDIR = "/tmp/interventions-ab";
let PROMPT_FILE = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--n" && args[i + 1]) N = parseInt(args[++i], 10);
  if (args[i] === "--out" && args[i + 1]) OUTDIR = args[++i];
  if (args[i] === "--prompt-file" && args[i + 1]) PROMPT_FILE = args[++i];
}
mkdirSync(OUTDIR, { recursive: true });

// SERVED-PROMPT FIDELITY: --prompt-file lets this run against the exact text
// staging serves (draft_graph v195, sha256[:16] 152998b447819c2e, 59,293 chars,
// read from cee_prompt_versions and cross-checked against
// /admin/prompts/verify). The on-disk v187 default is a DIFFERENT prompt and
// measuring against it would answer a question production never asks.
const SYSTEM_PROMPT = PROMPT_FILE ? readFileSync(PROMPT_FILE, "utf8") : DRAFT_GRAPH_PROMPT_V187;
console.log(`system prompt: ${PROMPT_FILE ?? "on-disk v187"} (${SYSTEM_PROMPT.length} chars)`);

const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0;

// The brief from the live P0 reproduction (2026-07-19).
const BRIEF = "I need to decide whether to hire two senior engineers now or wait six months. Budget is about 250k. Go ahead and draft the model with sensible defaults.";

// ── Arm schemas. Arm A is the live object by identity; arm B differs in ONE
// property. Both are DERIVED from the live schema (trap-12: never hand-mirror).
const armA = ANTHROPIC_DRAFT_GRAPH_SCHEMA;

function buildArmB(base) {
  const clone = structuredClone(base);
  const dataObj = clone.properties.nodes.items.properties.data.anyOf[0];
  // ANCHOR ASSERTIONS (trap-15): every write must be proven to have landed.
  if (!dataObj || dataObj.type !== "object" || !dataObj.properties?.interventions) {
    throw new Error("ANCHOR FAILED: data.anyOf[0].properties.interventions not found — schema shape changed, harness would measure the wrong thing");
  }
  if (dataObj.required.includes("interventions")) {
    throw new Error("ANCHOR FAILED: interventions is ALREADY required in the base schema — arm A/B would be identical and this harness would be vacuous");
  }
  dataObj.required = [...dataObj.required, "interventions"];
  if (!dataObj.required.includes("interventions")) {
    throw new Error("ANCHOR FAILED: write did not land");
  }
  return clone;
}
const armB = buildArmB(armA);

// Prove the arms actually differ, and differ ONLY in that one list.
{
  const a = JSON.parse(JSON.stringify(armA));
  const b = JSON.parse(JSON.stringify(armB));
  b.properties.nodes.items.properties.data.anyOf[0].required =
    a.properties.nodes.items.properties.data.anyOf[0].required;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("ANCHOR FAILED: arms differ in more than the interventions required-list");
  }
  if (JSON.stringify(armA) === JSON.stringify(armB)) {
    throw new Error("ANCHOR FAILED: arms are identical");
  }
}

// ── Scorer: replicate graph-validator.ts buildInterventionSignature semantics
// on the RAW model output (pre-normalisation), which is where the omission is.
function signatureOf(node) {
  const iv = node?.data?.interventions;
  if (iv === undefined || iv === null) return { present: false, sig: "" };
  // Grammar emits array-form [{factor_id, value}]; normalisation converts to object.
  const entries = Array.isArray(iv)
    ? iv.map((x) => `${x.factor_id}:${Number(x.value).toFixed(4)}`)
    : Object.entries(iv).map(([k, v]) => `${k}:${Number(v).toFixed(4)}`);
  return { present: true, sig: entries.sort().join("|") };
}

function score(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const options = nodes.filter((n) => n.kind === "option");
  const sigs = options.map((o) => ({ id: o.id, ...signatureOf(o) }));
  const empty = sigs.filter((s) => s.sig === "");
  const byMap = new Map();
  for (const s of sigs) byMap.set(s.sig, [...(byMap.get(s.sig) ?? []), s.id]);
  const collisions = [...byMap.entries()].filter(([, ids]) => ids.length > 1);
  return {
    optionCount: options.length,
    withInterventionsKey: sigs.filter((s) => s.present).length,
    emptySignature: empty.length,
    distinctSignatures: byMap.size,
    optionsIdentical: collisions.length > 0,
    collisionIds: collisions.flatMap(([, ids]) => ids),
    sigs,
  };
}

// ── POSITIVE CONTROL: the scorer must SEE a good draft, not just report zeros.
{
  const good = { nodes: [
    { id: "opt_a", kind: "option", data: { interventions: [{ factor_id: "f_head", value: 2 }] } },
    { id: "opt_b", kind: "option", data: { interventions: [{ factor_id: "f_head", value: 0 }] } },
  ] };
  const s = score(good);
  if (s.optionsIdentical || s.emptySignature !== 0 || s.distinctSignatures !== 2 || s.withInterventionsKey !== 2) {
    throw new Error(`POSITIVE CONTROL FAILED: scorer cannot see a good draft: ${JSON.stringify(s)}`);
  }
  const bad = { nodes: [
    { id: "opt_a", kind: "option", data: {} },
    { id: "opt_b", kind: "option", data: {} },
  ] };
  const sb = score(bad);
  if (!sb.optionsIdentical || sb.emptySignature !== 2) {
    throw new Error(`NEGATIVE CONTROL FAILED: scorer cannot see the defect: ${JSON.stringify(sb)}`);
  }
  console.log("controls: scorer sees a GOOD draft (2 distinct sigs) and the DEFECT (2 empty sigs) — OK\n");
}

async function callArm(schema, label, i) {
  const body = {
    model: MODEL,
    max_tokens: 12000,
    temperature: TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: BRIEF }],
    output_config: { format: { type: "json_schema", schema } },
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
    return null;
  }
  const text = json.content?.map((c) => c.text ?? "").join("") ?? "";
  writeFileSync(`${OUTDIR}/${label}-${i}.json`, text);
  let graph;
  try { graph = JSON.parse(text); } catch { console.error(`${label}#${i}: unparseable`); return null; }
  return { ...score(graph), ms, outTokens: json.usage?.output_tokens };
}

const results = { A: [], B: [] };
for (let i = 0; i < N; i++) {
  for (const [label, schema] of [["A", armA], ["B", armB]]) {
    const r = await callArm(schema, label, i);
    if (r) {
      results[label].push(r);
      console.log(`arm ${label} #${i}: options=${r.optionCount} withKey=${r.withInterventionsKey} emptySig=${r.emptySignature} distinct=${r.distinctSignatures} OPTIONS_IDENTICAL=${r.optionsIdentical} (${r.ms}ms, ${r.outTokens}tok)`);
    }
  }
}

function summarise(rs, label) {
  if (!rs.length) return `arm ${label}: NO DATA`;
  const fails = rs.filter((r) => r.optionsIdentical).length;
  const avgEmpty = (rs.reduce((a, r) => a + r.emptySignature, 0) / rs.length).toFixed(2);
  const avgKey = (rs.reduce((a, r) => a + r.withInterventionsKey, 0) / rs.length).toFixed(2);
  const avgOpt = (rs.reduce((a, r) => a + r.optionCount, 0) / rs.length).toFixed(2);
  const avgTok = (rs.reduce((a, r) => a + (r.outTokens ?? 0), 0) / rs.length).toFixed(0);
  return `arm ${label}: OPTIONS_IDENTICAL ${fails}/${rs.length} | avg options ${avgOpt} | avg options carrying interventions ${avgKey} | avg empty signatures ${avgEmpty} | avg output tokens ${avgTok}`;
}
console.log("\n" + summarise(results.A, "A (v9 live: interventions OPTIONAL)"));
console.log(summarise(results.B, "B (fix: interventions REQUIRED)"));
writeFileSync(`${OUTDIR}/summary.json`, JSON.stringify(results, null, 2));
