// Live grammar-compile probe for ANTHROPIC_DRAFT_GRAPH_SCHEMA.
//
// WHY
// ---
// Anthropic's structured-outputs grammar compiler has an UNPUBLISHED size
// limit. A schema that passes every static budget in
// tests/unit/anthropic-graph-schema-grammar-budget.test.ts can still draw
// 400 "The compiled grammar is too large" at runtime — when that happens the
// adapter silently falls back to prompt-only JSON on EVERY draft (telemetry:
// cee.draft_graph.structured_outputs_fell_back). This has now happened twice
// (2026-04-02 at 11KB; 2026-05-02 v0.11.0 amendment re-tripped it at ~4.6KB,
// found 2026-07-07 via a 15-probe live bisect). The static budgets are
// proxies; THIS probe is the ground truth.
//
// USAGE
// -----
// Run before merging ANY amendment to src/cee/draft/anthropic-graph-schema.ts:
//
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/probe-grammar-compile.mjs
//   # optional: --model claude-sonnet-4-6   (default; repeatable)
//
// The key is read from the environment by NAME only and never printed.
// Cost: one minimal messages.create call per model (max_tokens: 16).
// NOTE: a first compile of a new schema can take ~20s (grammars are cached
// for 24h from last use server-side) — the probe allows a 120s timeout.
//
// EXIT CODES: 0 = schema compiles (HTTP 200); 1 = compile rejected or other
// API error; 2 = configuration error (missing key / import failure).
//
// Requires tsx (devDependency) because it imports the TS schema module
// directly — this probes the EXACT object production attaches, not a copy.

import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../src/cee/draft/anthropic-graph-schema.ts";

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
// Default: the production draft model (anthropic.ts draftGraphWithAnthropic).
if (models.length === 0) models.push("claude-sonnet-4-6");

const schemaBytes = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA).length;
console.log(`schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA, serialized ${schemaBytes} bytes`);

let failed = false;
for (const model of models) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Return a minimal draft." }],
        output_config: {
          format: { type: "json_schema", schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    console.log(`ERR  | ${model} | ${err.message}`);
    failed = true;
    continue;
  }
  const ms = Date.now() - t0;
  if (res.status === 200) {
    await res.json().catch(() => ({}));
    console.log(`PASS | ${model} | ${schemaBytes}B | ${ms}ms | grammar compiled (HTTP 200)`);
  } else {
    const j = await res.json().catch(() => ({}));
    const detail = (j?.error?.message ?? "").slice(0, 160);
    console.log(`FAIL ${res.status} | ${model} | ${schemaBytes}B | ${ms}ms | ${detail}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
