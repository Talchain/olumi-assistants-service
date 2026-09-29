// A/B measurement harness for the draft grammar's option-`interventions`
// guarantees — the OPTIONS_IDENTICAL P0 (2026-07-19).
//
// REPLACES `measure-interventions-required-ab.mjs` (206 lines) and
// `measure-interventions-minitems-ab.mjs` (156). The two shared a byte-identical
// `signatureOf`, a near-identical `score`, arg parser, HTTP call, driver loop and
// summariser; they differed only in WHICH schema mutation each applied. Arms are
// now DATA (see `ARMS`), so adding a third costs one entry, not a third file.
//
// THE DEFECT UNDER TEST
// ---------------------
// #520 demoted eight `data` fields from `required` to optional, justified as
// "downstream-neutral" because the ingress normaliser coerces each sentinel back
// to `undefined`. That holds for genuinely inapplicable fields (raw_value, unit,
// cap, encoding_map, display_value...). It does NOT hold for `interventions`,
// which on an OPTION node is not a sentinel — it is the ONLY content that
// distinguishes one option from another. Demoting it removed the grammar's sole
// guarantee that option nodes carry interventions at all, and every draft turn
// 500'd with `intervention_signature: ""` / `violation_code: OPTIONS_IDENTICAL`.
//
// WHY THE UNIFICATION WAS URGENT, not cosmetic
// --------------------------------------------
// `measure-interventions-required-ab.mjs` bound `armA = ANTHROPIC_DRAFT_GRAPH_SCHEMA`
// BY IDENTITY. Once #529 merged `minItems: 1` into that live schema, arm A
// silently inherited the fix: both arms became incapable of emitting an empty
// interventions array, so the harness reported "no defect" while its own header
// still claimed arm A reproduced the outage 3/3. Since it was the only published
// reproduction of the P0 evidence, a clean run read as "the outage was never
// real". Its twin threw loudly on the equivalent breakage — the difference was
// luck of which anchor each author happened to write.
//
// `assertBaseShape()` below makes that class of vacuity IMPOSSIBLE, permanently,
// for EVERY arm: the base must still exhibit the defect (interventions present,
// NOT required, NO minItems) before any arm is derived. `deriveArm()` then
// refuses any mutation that produces a clone equal to the base.
//
// Consequence, by design: run this against a FIXED schema and it ABORTS with a
// named error rather than printing a reassuring null result. That is correct —
// the base no longer reproduces the defect, so there is nothing to measure. To
// re-measure historically, point it at the pre-fix schema.
//
// USAGE
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/measure-interventions-ab.mjs [--n 3] [--arms required,minitems] [--prompt <file>]

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../src/cee/draft/anthropic-graph-schema.ts";
import { DRAFT_GRAPH_PROMPT_V187 } from "../src/prompts/defaults-v187.ts";
// THE PRODUCT'S OWN definition of the defect being measured — imported, not
// retyped. Both predecessors carried a hand-written copy whose comment conceded
// it ("replicate graph-validator.ts buildInterventionSignature semantics"). An
// instrument calibrated against a copy of the thing it measures drifts silently.
import { buildInterventionSignature } from "../src/validators/graph-validator.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("FATAL: ANTHROPIC_API_KEY not set."); process.exit(2); }

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const N = Number(argOf("n", 3));
const PROMPT_FILE = argOf("prompt", null);
const SYSTEM_PROMPT = PROMPT_FILE ? readFileSync(PROMPT_FILE, "utf8") : DRAFT_GRAPH_PROMPT_V187;

const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0;
// The brief from the live P0 reproduction (2026-07-19).
const BRIEF = "I need to decide whether to hire two senior engineers now or wait six months. Budget is about 250k. Go ahead and draft the model with sensible defaults.";

const OUTDIR = `evidence/interventions-ab-${Date.now()}`;
mkdirSync(OUTDIR, { recursive: true });

// ---------------------------------------------------------------------------
// Base-shape guard + arm derivation — the anti-vacuity machinery
// ---------------------------------------------------------------------------

/** The `data` sub-schema that carries `interventions`. */
function interventionsHost(schema) {
  const host = schema?.properties?.nodes?.items?.properties?.data?.anyOf?.[0];
  if (!host || host.type !== "object" || !host.properties?.interventions) {
    throw new Error(
      "ANCHOR FAILED: data.anyOf[0].properties.interventions not found — the schema shape changed and this harness would measure the wrong thing",
    );
  }
  return host;
}

/**
 * The base must still EXHIBIT the defect, or every arm is vacuous.
 *
 * This is the check `measure-interventions-required-ab.mjs` lacked. It asserted
 * only that `required` did not already contain `interventions`, so when #529
 * merged `minItems: 1` it sailed straight past and measured a fixed grammar
 * against a fixed grammar.
 */
function assertBaseShape(base) {
  const host = interventionsHost(base);
  if (host.required?.includes("interventions")) {
    throw new Error(
      "VACUOUS BASE: `interventions` is ALREADY in the data object's `required` list. The base no longer reproduces the defect, so no arm can measure it. (Has the fix landed? Point --prompt/schema at the pre-fix revision to re-measure historically.)",
    );
  }
  if (host.properties.interventions.minItems !== undefined) {
    throw new Error(
      `VACUOUS BASE: interventions.minItems is ALREADY set (${host.properties.interventions.minItems}). An empty interventions array is already ungrammatical, so the base cannot produce the OPTIONS_IDENTICAL defect and every arm would report a null result that reads as "the outage was never real".`,
    );
  }
  return base;
}

/**
 * Derive an arm by cloning the base and applying `mutate`. Throws if the
 * mutation was a no-op — a clone equal to its base is an arm that measures
 * nothing while looking like a control.
 */
function deriveArm(base, label, mutate) {
  const clone = structuredClone(base);
  mutate(interventionsHost(clone), clone);

  if (JSON.stringify(clone) === JSON.stringify(base)) {
    throw new Error(`ANCHOR FAILED: arm "${label}" is byte-identical to the base — the mutation did not land`);
  }
  if (JSON.stringify(base) !== JSON.stringify(assertBaseShape.__snapshot)) {
    throw new Error(`ANCHOR FAILED: deriving arm "${label}" mutated the SHARED base schema`);
  }
  return clone;
}

const BASE = assertBaseShape(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
assertBaseShape.__snapshot = structuredClone(BASE);

/**
 * ARMS AS DATA. Each entry is one schema mutation under test. The control arm
 * (the live base) is added by the driver, so an arm here is always a change.
 */
const ARM_DEFS = {
  required: {
    describe: "interventions promoted back into the data object's `required` list",
    mutate: (host) => { host.required = [...host.required, "interventions"]; },
    verify: (host) => host.required.includes("interventions"),
  },
  minitems: {
    describe: "interventions array given minItems: 1 (an empty array becomes ungrammatical)",
    mutate: (host) => { host.properties.interventions.minItems = 1; },
    verify: (host) => host.properties.interventions.minItems === 1,
  },
};

const requestedArms = argOf("arms", Object.keys(ARM_DEFS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
for (const name of requestedArms) {
  if (!ARM_DEFS[name]) {
    console.error(`FATAL: unknown arm "${name}". Known: ${Object.keys(ARM_DEFS).join(", ")}`);
    process.exit(2);
  }
}

const arms = [{ label: "control", schema: BASE, describe: "live schema, unmodified" }];
for (const name of requestedArms) {
  const def = ARM_DEFS[name];
  const schema = deriveArm(BASE, name, def.mutate);
  if (!def.verify(interventionsHost(schema))) {
    throw new Error(`ANCHOR FAILED: arm "${name}" write did not land (verify() false)`);
  }
  arms.push({ label: name, schema, describe: def.describe });
}

console.log(`system prompt: ${PROMPT_FILE ?? "on-disk v187"} (${SYSTEM_PROMPT.length} chars)`);
console.log(`arms: ${arms.map((a) => a.label).join(", ")}  (n=${N} each)\n`);

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

/**
 * The grammar emits array-form `[{factor_id, value}]`; the ingress normaliser
 * converts it to the object form the validator consumes. This shim is the ONLY
 * local logic — a genuine addition (the harness scores RAW model output,
 * pre-normalisation, which is where the omission lives), not a duplication.
 * The signature itself comes from the product.
 */
function signatureOf(node) {
  const iv = node?.data?.interventions;
  if (iv === undefined || iv === null) return { present: false, sig: "" };
  const asObject = Array.isArray(iv)
    ? Object.fromEntries(iv.map((x) => [x.factor_id, Number(x.value)]))
    : Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, Number(v)]));
  return { present: true, sig: buildInterventionSignature(asObject) };
}

function score(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const options = nodes.filter((n) => n.kind === "option");
  const sigs = options.map((o) => ({ id: o.id, ...signatureOf(o) }));
  const byMap = new Map();
  for (const s of sigs) byMap.set(s.sig, [...(byMap.get(s.sig) ?? []), s.id]);
  const collisions = [...byMap.entries()].filter(([, ids]) => ids.length > 1);
  return {
    optionCount: options.length,
    withInterventionsKey: sigs.filter((s) => s.present).length,
    emptySignature: sigs.filter((s) => s.sig === "").length,
    distinctSignatures: byMap.size,
    optionsIdentical: collisions.length > 0,
    collisionIds: collisions.flatMap(([, ids]) => ids),
    sigs,
  };
}

// POSITIVE + NEGATIVE CONTROL (trap-13): an absence assertion must first be
// shown able to SEE a presence. The scorer must read a good draft as good AND
// the defect as the defect, or it is reporting zeros for everything.
{
  const good = { nodes: [
    { id: "opt_a", kind: "option", data: { interventions: [{ factor_id: "f_head", value: 2 }] } },
    { id: "opt_b", kind: "option", data: { interventions: [{ factor_id: "f_head", value: 0 }] } },
  ] };
  const sg = score(good);
  if (sg.optionsIdentical || sg.emptySignature !== 0 || sg.distinctSignatures !== 2 || sg.withInterventionsKey !== 2) {
    throw new Error(`POSITIVE CONTROL FAILED: scorer cannot see a good draft: ${JSON.stringify(sg)}`);
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

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

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

const results = Object.fromEntries(arms.map((a) => [a.label, []]));
for (let i = 0; i < N; i++) {
  for (const arm of arms) {
    const r = await callArm(arm.schema, arm.label, i);
    if (!r) continue;
    results[arm.label].push(r);
    console.log(
      `arm ${arm.label} #${i}: options=${r.optionCount} withKey=${r.withInterventionsKey} ` +
      `emptySig=${r.emptySignature} distinct=${r.distinctSignatures} ` +
      `OPTIONS_IDENTICAL=${r.optionsIdentical} (${r.ms}ms, ${r.outTokens}tok)`,
    );
  }
}

function summarise(rs, label, describe) {
  if (!rs.length) return `arm ${label}: NO DATA`;
  const fails = rs.filter((r) => r.optionsIdentical).length;
  const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(2);
  return (
    `arm ${label} (${describe}): OPTIONS_IDENTICAL ${fails}/${rs.length} | ` +
    `avg options ${avg((r) => r.optionCount)} | ` +
    `avg options carrying interventions ${avg((r) => r.withInterventionsKey)} | ` +
    `avg empty signatures ${avg((r) => r.emptySignature)} | ` +
    `avg output tokens ${avg((r) => r.outTokens ?? 0)}`
  );
}

console.log("");
for (const arm of arms) console.log(summarise(results[arm.label], arm.label, arm.describe));
writeFileSync(`${OUTDIR}/summary.json`, JSON.stringify({ arms: arms.map((a) => ({ label: a.label, describe: a.describe })), results }, null, 2));
console.log(`\nevidence: ${OUTDIR}/`);
