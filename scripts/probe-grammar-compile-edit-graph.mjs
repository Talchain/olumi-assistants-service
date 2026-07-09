// Live grammar-compile probe for ANTHROPIC_EDIT_GRAPH_SCHEMA.
//
// WHY
// ---
// Same rationale as scripts/probe-grammar-compile.mjs (draft_graph, Lane 26):
// Anthropic's structured-outputs grammar compiler has an UNPUBLISHED size
// limit that static byte/object-count budgets can only proxy for — a schema
// that passes every static budget in
// tests/unit/anthropic-edit-graph-schema-grammar-budget.test.ts can still
// draw 400 "The compiled grammar is too large" at runtime, silently falling
// back to prompt-only JSON on every edit_graph call. THIS probe is the
// ground truth. edit_graph's schema (v2, Tier A #1) is far smaller than the
// draft_graph family Lane 26 bisected, but the rule stands: verify live
// after any schema amendment, don't trust the byte budget alone.
//
// USAGE
// -----
// Run before merging ANY amendment to
// src/orchestrator/tools/anthropic-edit-graph-schema.ts:
//
//   ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/probe-grammar-compile-edit-graph.mjs
//   # optional: --model claude-sonnet-4-6   (default; repeatable)
//
// The key is read from the environment by NAME only and never printed.
// Cost: one minimal messages.create call per model (max_tokens: 16).
//
// EXIT CODES: 0 = schema compiles (HTTP 200); 1 = compile rejected or other
// API error; 2 = configuration error (missing key / import failure).

import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../src/orchestrator/tools/anthropic-edit-graph-schema.ts";

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
// Default: the production edit_graph model (edit-graph.ts adapter.chat via router).
if (models.length === 0) models.push("claude-sonnet-4-6");

const schemaBytes = JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA).length;
console.log(`schema: ANTHROPIC_EDIT_GRAPH_SCHEMA, serialized ${schemaBytes} bytes`);

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
        messages: [{ role: "user", content: "Return a minimal edit response." }],
        output_config: {
          format: { type: "json_schema", schema: ANTHROPIC_EDIT_GRAPH_SCHEMA },
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
