# Lane 26 — draft schema v8 "stringified aux fields" (2026-07-07)

Restores structured-output (grammar) enforcement for **every** production
draft. Base: `origin/staging` 1aa46892e. Branch: `claude-lane26/grammar-v8`.

## Problem

The post-v7 `ANTHROPIC_DRAFT_GRAPH_SCHEMA` (4,578 bytes serialized) is
rejected with HTTP 400 *"The compiled grammar is too large"* on **all**
current Anthropic models, so `draftGraphWithAnthropic` silently falls back
to prompt-only JSON on every draft (telemetry:
`cee.draft_graph.structured_outputs_fell_back`, `schema_bytes=4578`;
~48–50s prompt-only latency; zero grammar enforcement on the graph).

## Design basis (empirical, 15 live probes, 2026-07-07)

Full design note: session scratchpad
`scratchpad-durable-grammar-400-design-note.md` (durable copy alongside the
preserved probe scripts in `grammar-probe-durable/`). Key verified facts:

- The 400 reproduces outside CEE with a minimal request; identical on
  sonnet-4-5/4-6/5, opus-4-6/4-8, haiku-4-5 → **API-wide limit, no model
  bump fixes it**.
- **Total structural surface (object schemas × properties) is the dominant
  compile cost.** Killing all unions, all enums, or all optionality
  individually did NOT rescue the v7 schema; even deleting the entire
  coaching subtree (3,539B, 9 object schemas) still failed.
- PASS/FAIL boundary for this schema family: **PASS at 3,194B
  (v8 shape) / FAIL at 3,539B and above.** No prune keeping all six
  top-level keys as structured objects can fit.
- **Verified compiling fix (probe 14):** declare `coaching`,
  `causal_claims`, `topology_plan` as `{ type: "string" }` JSON-string
  fields (the existing `data.encoding_map` pattern) → 3,194B, HTTP 200 on
  claude-sonnet-4-6.

## What changed

| File | Change |
|------|--------|
| `src/cee/draft/anthropic-graph-schema.ts` | v8: three aux subtrees → `{ type: "string" }`; GRAMMAR BUDGET (v8) changelog in the header; nodes/edges/goal_constraints unchanged (full grammar enforcement) |
| `src/adapters/llm/normalisation.ts` | `parseStringifiedAuxFields()` — ingress JSON.parse of the three fields at the top of `normaliseDraftResponse()`, before Zod and all downstream consumers; shape-based (legacy object/array payloads untouched); double-encoded strings unwrapped; malformed/wrong-shape values **dropped** with `llm.normalisation.aux_field_parse_failed` WARN (structured log, not a new registry telemetry event) |
| `src/adapters/llm/anthropic.ts` | `STRUCTURED_OUTPUTS_AUX_STRING_REMINDER` appended to the user message **only** when structured outputs is active; the versioned system prompt (store/v187 fallback) is untouched — on the prompt-only path the model still emits objects, which ingress accepts unchanged |
| `tests/unit/anthropic-graph-schema-grammar-budget.test.ts` | Budgets re-pinned to v8 measured values; byte pin **≤3,400** with the empirical boundary documented; new assertion that the three aux fields are `type: "string"` (re-objectifying any of them fails CI) |
| `tests/unit/draft-aux-field-ingress.test.ts` | Table-driven ingress tests: valid strings, legacy objects, absent fields, double-encoded, malformed JSON, wrong-shape JSON, null/number payloads, empty structures, mixed handling, pipeline integration |
| `scripts/probe-grammar-compile.mjs` | Committed live-compile tripwire (adapted from the investigation probes): probes the **exact** schema object production attaches; `ANTHROPIC_API_KEY` read from env **by name**, never printed; usage in header. Run before merging any schema amendment. |

### Degradation contract (enforcement ≥ status quo)

On aux-field parse failure the field is **dropped**, so downstream behaves
exactly as when the LLM omits it — which is today's behaviour on the
prompt-only path:

- `coaching` absent → Stage 5 emits the canonical-empty coaching block
  (`package.ts` — `summary: null`, empty `strengthen_items`/`bias_signals`,
  `widening_log.brief_completeness: "thin"`).
- `causal_claims` absent → `ctx.causalClaims === undefined` → field omitted
  from the response (absent provenance), per Stage 5 Step 3.
- `topology_plan` absent → field omitted.

Aux value-set enforcement was already downstream at v7 (the v7 grammar
delegated enums to Zod by design): `normalise-legacy-coaching.ts` +
canonical CoachingSchema, `validateCausalClaims` item-wise Zod drop
(`CAUSAL_CLAIM_DROPPED`), Stage 5/6 topology passthrough. v8 does not
change any of that. The core graph (nodes/edges/goal_constraints) — where
quality variance actually lives — gains grammar enforcement it currently
never gets.

## RED → GREEN proof

**RED** (commit `f51abe622`, test run against the base v7 schema):

```
❯ tests/unit/anthropic-graph-schema-grammar-budget.test.ts (7 tests | 3 failed)
AssertionError: expected 4578 to be less than or equal to 3400
AssertionError: expected 13 to be less than or equal to 8
AssertionError: aux field "coaching" must be a JSON-string field (v8):
  expected 'object' to be 'string'
Tests  3 failed | 4 passed (7)
```

**GREEN** (commit `bc9bf7370`):

```
✓ tests/unit/anthropic-graph-schema-grammar-budget.test.ts (7 tests)
✓ tests/unit/draft-aux-field-ingress.test.ts (13 tests)
# full related set (schema by-construction/compliance/alignment/fixture,
# legacy-coaching normaliser, normalise contract, null-coercion, node-kind,
# coaching-narrow): 12 files, 277 tests — all pass
```

**Live compile probe** (the committed tripwire, run against the exact v8
schema object this branch builds):

```
schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA, serialized 3194 bytes
PASS | claude-sonnet-4-6 | 3194B | 2209ms | grammar compiled (HTTP 200)
```

**Gates:** `pnpm typecheck:src` PASS; `tsc -p tsconfig.build.json --noEmit`
PASS; eslint on changed files PASS. `vitest --changed origin/staging`:
2,194 passed; the failing integration files (auth/admin/SSE/ask/limits/
feature-matrix/parity) fail **identically on base `origin/staging`**
(11 failed / 24 passed / 96 skipped on both) — pre-existing environmental
failures in a fresh worktree (no `.env`), not introduced by this change.

## Byte sizes

| Schema | Serialized | Objects | Live compile |
|--------|-----------:|--------:|--------------|
| v7 (base, staging) | 4,578B | 13 | **400** — every model |
| v7 minus entire coaching subtree (probe 8) | 3,539B | 9 | **400** |
| **v8 (this branch)** | **3,194B** | 8 (incl. root) | **200** claude-sonnet-4-6 |

## Post-merge live verification (orchestrator's job)

No flag needed — the adapter already attempts structured outputs and falls
back; once this schema deploys, enforcement starts working with the
existing fallback as the safety net. Read success from staging telemetry:

1. **Absence of `cee.draft_graph.structured_outputs_fell_back`** on new
   drafts (today it fires on every draft with `schema_bytes=4578`; post-v8
   it should not fire at all — if it does, `schema_bytes` should read 3194
   and the `error_snippet` tells you why).
2. **No** `[Anthropic] Structured Outputs rejected by API` WARN logs.
3. **Draft latency delta:** provider latency should drop well below the
   ~48–50s prompt-only baseline (structured-output drafts historically ran
   materially faster; the first draft after deploy may pay a one-off ~20s
   grammar compile, cached 24h from last use — consider one warm-up draft).
4. `meta.structured_outputs_used: true` in the draft `_diagnostic_trace` /
   LLM meta.
5. **Aux content quality:** persisted fixtures show non-empty
   `coaching`/`causal_claims` post-ingress; watch
   `llm.normalisation.aux_field_parse_failed` WARNs — a sustained rate
   means the model is emitting non-JSON strings and Option B (two-pass
   draft, both grammars verified compiling in the design note) is the
   fallback plan.

## Residual risks

- The grammar guarantees the aux fields are strings, **not** that the
  strings parse as JSON. Mitigated by the user-message reminder + tolerant
  ingress + canonical-empty degradation (never worse than status quo).
- The live prompt is store-managed (v187): the store text still describes
  the aux fields as objects. The adapter-level reminder overrides at the
  point of generation in structured mode only; if drafts show prose-in-
  string failures, update the store prompt as the next lever.
- First compile of an amended schema costs ~20s once per 24h window —
  the probe script makes this visible pre-merge.
