// SPIKE ARM C — C-K0: the LIVE grammar-compile probe for the records schema.
//
// ⚠ THROWAWAY. Spike branch only.
//
// WHY THIS EXISTS AND WHY THE UNIT TEST IS NOT ENOUGH
// ---------------------------------------------------
// C-K0 (protocol §7) is "records tool schema fails the live compile probe".
// Anthropic's structured-outputs grammar compiler has an UNPUBLISHED size
// limit. `src/spike-c/__tests__/records-schema-grammar-budget.test.ts` pins
// every static budget, and the graph schema's own history proves static budgets
// are only proxies: it satisfied all of them and still drew 400 "The compiled
// grammar is too large" TWICE. When that happens the adapter SILENTLY falls
// back to prompt-only JSON on every draft — so a failed C-K0 does not announce
// itself at runtime, it just quietly removes the grammar from the arm and turns
// arm C into "arm A plus an instruction". That would be a measurement-validity
// catastrophe, not merely a kill.
//
// Sibling of `scripts/probe-grammar-compile.mjs`, deliberately in the same
// shape, and it imports the TS module directly so it probes the EXACT object
// the adapter attaches rather than a copy.
//
// USAGE
// -----
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/spike-c-probe-records-grammar.mjs
//   # optional: --model claude-sonnet-4-6   (default; repeatable)
//
// The key is read from the environment BY NAME ONLY and is never printed.
// Cost: one minimal messages.create per model (max_tokens: 16).
// A first compile of a new schema can take ~20s (grammars are cached server-side
// for 24h from last use), so the timeout is generous.
//
// EXIT CODES — and the distinction between 1 and 2 is load-bearing:
//   0 = the grammar COMPILES. C-K0 does not fire.
//   1 = HTTP 400: the provider REJECTED THE SCHEMA. C-K0 FIRES — stop, report
//       the provider message verbatim, spend no token on measured runs.
//   2 = COULD NOT MEASURE (missing key, 401/403 auth, 429, 5xx, network,
//       timeout, import failure). This is NEVER a pass AND NEVER a kill.
//
// ⚠ THE FIRST DRAFT OF THIS SCRIPT CONFLATED 1 AND 2, and its own self-check
// caught it: run with a deliberately invalid key it printed "C-K0: FIRES" on an
// HTTP 401. A lane with a stale key would have killed a live arm on an auth
// error. Same shape as trap 24b — a status filter that lumps "still running"
// in with "failed" misreports a gate in both directions. An unmeasurable probe
// must say so in its own voice, not borrow the failure verdict.
//
// ⚠ RECORD THE RESULT IN THE MANIFEST. §8 requires arm C's schema bytes to be
// hashed before run 1; this probe prints that hash so the manifest line and the
// probed object provably refer to the same artefact.

import { buildSpikeCRecordsSchema, measureSpikeCSchemaBudget } from "../src/spike-c/records-schema.ts";
import { spikeCPreRegistration } from "../src/spike-c/arm.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("FATAL: ANTHROPIC_API_KEY is not set in the environment.");
  process.exit(2);
}

const args = process.argv.slice(2);
const models = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) models.push(args[++i]);
}
// Default: the FROZEN spike model (§3 — the prompt-store pin, which outranks env).
if (models.length === 0) models.push("claude-sonnet-4-6");

const schema = buildSpikeCRecordsSchema();
const budget = measureSpikeCSchemaBudget(schema);
const reg = spikeCPreRegistration();

console.log("=== SPIKE ARM C — C-K0 live grammar-compile probe ===");
console.log(`schema sha256 : ${reg.schema_sha256}`);
console.log(`schema bytes  : ${budget.serializedBytes}`);
console.log(`object schemas: ${budget.objectSchemas}   optional: ${budget.optionalParams}   unions: ${budget.unionParams}`);
console.log(`models        : ${models.join(", ")}`);
console.log("");

let schemaRejected = false;
let couldNotMeasure = false;

for (const model of models) {
  const body = {
    model,
    max_tokens: 16,
    // The probe is about GRAMMAR COMPILATION, not about output quality. A
    // trivial brief keeps the call cheap; the compiler runs before generation.
    messages: [{ role: "user", content: "Reply with a minimal valid record set." }],
    output_config: { format: { type: "json_schema", schema } },
    // Mirror the adapter's explicit-disabled thinking posture so the probed
    // request shape matches the one arm C actually sends (F-5, anthropic.ts).
    thinking: { type: "disabled" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res;
  let text = "";
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    clearTimeout(timer);
    console.error(`${model}: COULD NOT MEASURE — transport error: ${err?.name ?? "Error"}: ${err?.message ?? String(err)}`);
    couldNotMeasure = true;
    continue;
  }
  clearTimeout(timer);

  if (res.ok) {
    console.log(`${model}: HTTP ${res.status} — GRAMMAR COMPILES. C-K0 does not fire.`);
    continue;
  }

  // Print the provider's own message: the difference between "compiled grammar
  // is too large" and any other 400 changes what the redesign note must say.
  let detail = text.slice(0, 800);
  try {
    detail = JSON.stringify(JSON.parse(text)?.error ?? JSON.parse(text));
  } catch {
    /* non-JSON body — the raw slice above is what we have */
  }

  if (res.status === 400) {
    // The ONLY status that is evidence about the schema.
    schemaRejected = true;
    console.error(`${model}: HTTP 400 — SCHEMA REJECTED. ${detail}`);
  } else {
    // 401/403 (auth), 429 (rate limit), 5xx (provider) — all say nothing
    // whatsoever about whether this grammar compiles.
    couldNotMeasure = true;
    console.error(`${model}: HTTP ${res.status} — COULD NOT MEASURE (not a schema verdict). ${detail}`);
  }
}

console.log("");
if (schemaRejected) {
  console.error("C-K0: FIRES. Arm C is killed before costing a token (§7). Report the provider message verbatim.");
  process.exit(1);
}
if (couldNotMeasure) {
  console.error("C-K0: COULD NOT MEASURE — this is NOT a pass and NOT a kill. Fix the probe's access and re-run before any measured run.");
  process.exit(2);
}
console.log("C-K0: PASS on every probed model. Record the schema sha256 above in SHA256-MANIFEST-SPIKE.txt before run 1.");
process.exit(0);
