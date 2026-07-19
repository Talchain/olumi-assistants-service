// ROUND 2 A/B — locating the ACTUAL lever for the OPTIONS_IDENTICAL P0.
//
// WHAT ROUND 1 SETTLED (scripts/measure-interventions-required-ab.mjs)
// -------------------------------------------------------------------
// Against the SERVED prompt (draft_graph v195, sha256[:16] 152998b447819c2e):
//   arm A  interventions OPTIONAL (current live v9): OPTIONS_IDENTICAL 3/3
//   arm B  interventions REQUIRED (naive fix):       OPTIONS_IDENTICAL 3/3
// Both arms emit `"interventions": []` on EVERY option. So:
//   * PR #520's demotion is NOT the root cause — restoring `required` fixes
//     nothing, because JSON-Schema `required` forces the KEY, never CONTENT.
//     An empty array satisfies `required` perfectly.
//   * Against the on-disk v187 prompt the SAME grammar populates interventions
//     correctly (0/3 failures), so the grammar alone is not sufficient either.
// The live defect is the pair: a grammar that PERMITS `[]` plus a served
// prompt whose every intervention example is an OBJECT (`{fac_id: 0.6}`) while
// the grammar demands an ARRAY of `{factor_id, value}`. Under structured
// outputs the grammar wins, so the model must translate shape on the fly; under
// v195's heavier OPTION_RULES it stops translating and satisfies the grammar
// with the empty array — legal, and catastrophic.
//
// WHAT THIS HARNESS TESTS
// -----------------------
//   arm C  interventions optional + `minItems: 1`  -> makes `[]` UNGRAMMATICAL.
//          If the model can no longer emit an empty array, does it emit real
//          interventions? Also probes whether Anthropic's grammar compiler
//          even accepts minItems (unverified for this API — a 400 here is a
//          finding, not a bug).
//   arm D  NO structured outputs at all (prompt-only).  The control that says
//          whether the served prompt can produce a good draft when no grammar
//          is imposed. If D passes, the grammar is the whole story.
//
// Both arms are scored by the same signature function as round 1 and gated by
// the same positive/negative controls (trap-13).
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-interventions-minitems-ab.mjs \
//     --prompt-file <served-v195.txt> [--n 3]

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../src/cee/draft/anthropic-graph-schema.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("FATAL: ANTHROPIC_API_KEY not set."); process.exit(2); }
const args = process.argv.slice(2);
let N = 3, OUTDIR = "/tmp/interventions-minitems", PROMPT_FILE = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--n" && args[i + 1]) N = parseInt(args[++i], 10);
  if (args[i] === "--out" && args[i + 1]) OUTDIR = args[++i];
  if (args[i] === "--prompt-file" && args[i + 1]) PROMPT_FILE = args[++i];
}
if (!PROMPT_FILE) { console.error("FATAL: --prompt-file (the SERVED prompt) is required; the on-disk default answers a question production never asks."); process.exit(2); }
mkdirSync(OUTDIR, { recursive: true });

const SYSTEM_PROMPT = readFileSync(PROMPT_FILE, "utf8");
const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0;
const BRIEF = "I need to decide whether to hire two senior engineers now or wait six months. Budget is about 250k. Go ahead and draft the model with sensible defaults.";
console.log(`system prompt: ${PROMPT_FILE} (${SYSTEM_PROMPT.length} chars)`);

function interventionsNode(schema) {
  const d = schema.properties.nodes.items.properties.data.anyOf[0];
  if (!d?.properties?.interventions) throw new Error("ANCHOR FAILED: interventions not found");
  return d;
}

// arm C: minItems on the interventions array. Derived, with landed-write asserts.
const armC = structuredClone(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
{
  const d = interventionsNode(armC);
  if (d.properties.interventions.minItems !== undefined) throw new Error("ANCHOR FAILED: minItems already set — arm would be vacuous");
  d.properties.interventions.minItems = 1;
  if (interventionsNode(armC).properties.interventions.minItems !== 1) throw new Error("ANCHOR FAILED: minItems write did not land");
  if (interventionsNode(ANTHROPIC_DRAFT_GRAPH_SCHEMA).properties.interventions.minItems !== undefined) {
    throw new Error("ANCHOR FAILED: arm C mutated the shared base schema");
  }
}

function signatureOf(node) {
  const iv = node?.data?.interventions;
  if (iv === undefined || iv === null) return { present: false, sig: "" };
  const entries = Array.isArray(iv)
    ? iv.map((x) => `${x.factor_id}:${Number(x.value).toFixed(4)}`)
    : Object.entries(iv).map(([k, v]) => `${k}:${Number(v).toFixed(4)}`);
  return { present: true, sig: entries.sort().join("|") };
}
function score(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const options = nodes.filter((n) => n.kind === "option");
  const sigs = options.map((o) => ({ id: o.id, ...signatureOf(o) }));
  const byMap = new Map();
  for (const s of sigs) byMap.set(s.sig, [...(byMap.get(s.sig) ?? []), s.id]);
  return {
    optionCount: options.length,
    withInterventionsKey: sigs.filter((s) => s.present).length,
    emptySignature: sigs.filter((s) => s.sig === "").length,
    distinctSignatures: byMap.size,
    optionsIdentical: [...byMap.values()].some((ids) => ids.length > 1),
    sigs,
  };
}
{
  const good = { nodes: [
    { id: "opt_a", kind: "option", data: { interventions: [{ factor_id: "f", value: 2 }] } },
    { id: "opt_b", kind: "option", data: { interventions: [{ factor_id: "f", value: 0 }] } },
  ] };
  const s = score(good);
  if (s.optionsIdentical || s.distinctSignatures !== 2) throw new Error("POSITIVE CONTROL FAILED");
  const bad = { nodes: [{ id: "a", kind: "option", data: {} }, { id: "b", kind: "option", data: {} }] };
  if (!score(bad).optionsIdentical) throw new Error("NEGATIVE CONTROL FAILED");
  console.log("controls: scorer sees a GOOD draft and the DEFECT — OK\n");
}

async function call(label, schema, i) {
  const body = {
    model: MODEL, max_tokens: 12000, temperature: TEMPERATURE,
    system: SYSTEM_PROMPT, messages: [{ role: "user", content: BRIEF }],
    ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
  };
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json();
  if (!res.ok) { console.error(`${label}#${i} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`); return null; }
  let text = json.content?.map((c) => c.text ?? "").join("") ?? "";
  writeFileSync(`${OUTDIR}/${label}-${i}.json`, text);
  // Prompt-only arm may fence the JSON; strip a leading ```json fence if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  let graph; try { graph = JSON.parse(text); } catch { console.error(`${label}#${i}: unparseable`); return null; }
  return { ...score(graph), ms, outTokens: json.usage?.output_tokens };
}

const ARMS = [["C_minItems", armC], ["D_no_grammar", null]];
const results = {};
for (const [label] of ARMS) results[label] = [];
for (let i = 0; i < N; i++) {
  for (const [label, schema] of ARMS) {
    const r = await call(label, schema, i);
    if (r) {
      results[label].push(r);
      console.log(`${label} #${i}: options=${r.optionCount} withKey=${r.withInterventionsKey} emptySig=${r.emptySignature} distinct=${r.distinctSignatures} OPTIONS_IDENTICAL=${r.optionsIdentical} (${r.ms}ms, ${r.outTokens}tok)`);
    }
  }
}
console.log("");
for (const [label] of ARMS) {
  const rs = results[label];
  if (!rs.length) { console.log(`${label}: NO DATA`); continue; }
  const fails = rs.filter((r) => r.optionsIdentical).length;
  console.log(`${label}: OPTIONS_IDENTICAL ${fails}/${rs.length} | avg options ${(rs.reduce((a, r) => a + r.optionCount, 0) / rs.length).toFixed(2)} | avg empty sigs ${(rs.reduce((a, r) => a + r.emptySignature, 0) / rs.length).toFixed(2)} | avg tok ${(rs.reduce((a, r) => a + (r.outTokens ?? 0), 0) / rs.length).toFixed(0)}`);
}
writeFileSync(`${OUTDIR}/summary.json`, JSON.stringify(results, null, 2));
