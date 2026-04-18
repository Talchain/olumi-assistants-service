# Slice C2 — D2 Schemas Audit

**Date:** 2026-04-18
**Branch:** `claude/v5-slice-c2`
**Verdict:** No `@talchain/schemas` bump required. 0.5.1 is sufficient for C2 with Resolution 2 (enrichment escape hatch).

---

## 1. Scope

C2 runtime requires:
- `RunAnalysisArgs` — input shape classifier → handler
- `RunAnalysisHandlerFact` — output shape persisted to `v5_handler_facts.payload`
- `V5ActionType` (`run_analysis` literal) — dispatch key + `handler_id`
- `V2RunResponseEnvelope` — PLoT response (CEE-internal TS interface, not a shared schema)
- `HandlerFact` discriminated union — the shape `HandlerOutcome.handler_facts[]` carries

---

## 2. Audit: `RunAnalysisArgsSchema` (0.5.1)

Source: `@talchain/schemas/orchestrator/handler-args.d.ts:2-11`

```ts
z.object({
  scenario_id: z.string(),
  seed: z.number().optional(),
}).strict()
```

**Coverage:** ✅ adequate for C2.

- `scenario_id` — classifier emits from turn context; handler uses to seed PLoT request.
- `seed` — optional; passed through to PLoT for reproducibility. When absent PLoT generates seed.
- `.strict()` — no accidental drift; classifier cannot smuggle extra fields.

**What's NOT in args (by design):**
- No graph — context carries graph, handler reads `invocation.context.graph`.
- No options/interventions — those live on `context.analysis_inputs`.
- No n_samples — PLoT-side config.

No workaround needed.

---

## 3. Audit: `RunAnalysisHandlerFactSchema` (0.5.1) — **Resolution 2 applies**

Source: `@talchain/schemas/orchestrator/handler-fact.d.ts:2-47`

```ts
z.object({
  fact_type: z.literal('run_analysis'),
  fact_version: z.literal(1),
  noop: z.boolean(),
  result: z.object({
    scenario_id: z.string(),
    leading_option_id: z.string().nullable(),
    win_probabilities: z.record(z.string(), z.number()).optional(),
    summary: z.string(),
    enrichment: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
}).strict()
```

**Tension (from plan § Ambiguity 2):** brief §2 says *"persist canonical PLoT result byte-for-byte; no derived shape"*. Schema has a derived wrapper (`scenario_id`, `leading_option_id`, `win_probabilities`, `summary`) with `enrichment` as an escape hatch. Brief §3 D7 says *"persisted fact payload equals validated PLoT response byte-for-byte (no transform, no derived shape)"*.

**Resolution 2 (Paul 2026-04-18):** enrichment escape hatch. Populate the four required wrapper fields minimally; stash full validated `V2RunResponseEnvelope` in `result.enrichment` byte-for-byte.

### Field derivation rules (locked)

Every field is derived by **deterministic extraction** — no LLM, no heuristic, no numeric transform beyond `Number(...)` on clearly-stringified ID values:

| Field | Source | Rule |
|---|---|---|
| `result.scenario_id` | `RunAnalysisArgs.scenario_id` | identity copy — not from PLoT response |
| `result.leading_option_id` | `V2RunResponseEnvelope.results[]` or `.option_comparison[]` | deterministic pick per §3.1 below |
| `result.win_probabilities` | same source | map of `option_label → win_probability` when populated; omitted if no result has win_probability |
| `result.summary` | handler internal | one of the two RUN_ANALYSIS_ASSISTANT_TEMPLATES strings (exact match); same string as `HandlerOutcome.assistant_text` |
| `result.enrichment` | the full validated `V2RunResponseEnvelope` object | byte-for-byte; no projection, no stripping |

### 3.1 `leading_option_id` deterministic selection rule (Refinement R2)

Input is the array-of-results from PLoT, accessed via `results[]` if present else `option_comparison[]` (PLoT client types both).

| Case | Rule | `leading_option_id` |
|---|---|---|
| Empty array | no leading option | `null` |
| Single result | that's the leading option | extract `option_id` (or `option_label` if `option_id` missing) from the single entry |
| Multiple results, all zero `win_probability` | tied at zero → no leading | `null` |
| Multiple results, strictly one max `win_probability` | unambiguous leader | that entry's `option_id` |
| Multiple results, tied maximum | no unique leader → no interpretation | `null` |
| Any result missing `win_probability` | cannot compute | `null` (log warn; don't throw) |

Tie threshold: **strict equality** on win_probability. No epsilon (to avoid interpretation of "close enough").

### 3.2 Strictness sanity check

Both the outer and inner `result` objects are `.strict()` — no extra fields accepted. The handler's fact-construction code produces EXACTLY the five fields documented; Zod-parses at construction time (fail-fast); throws `HANDLER_RESULT_INVALID` on violation.

The PLoT response's full shape goes into `enrichment` as `Record<string, unknown>` — which accepts ANY JSON-serialisable object. This is the only escape hatch and it's intentional: CEE doesn't interpret, just persists.

---

## 4. Audit: `V5ActionType` / `V5ActionTypeSchema`

Source: `@talchain/schemas/orchestrator/action-types.d.ts` → re-export of `ActionTypeLiteral` from `boundary/enums.d.ts:12`.

```ts
["run_analysis", "set_factor_value", "add_constraint", "adjust_edge_strength",
 "explain_result", "compare_options", "what_would_flip"]
```

**Coverage:** ✅ `"run_analysis"` is present. Classifier emits it; dispatch validates via `V5ActionTypeSchema.safeParse`; registry keys on it; commit stores it in `v5_conversation_turns.handler_id` and `v5_handler_facts.action_type`. End-to-end, one literal.

---

## 5. Audit: `V2RunResponseEnvelope` (CEE-internal)

Source: [`src/orchestrator/types.ts:296-326`](src/orchestrator/types.ts#L296-L326) — TS interface, not a Zod schema shared across services.

```ts
export interface V2RunResponseEnvelope {
  meta: { seed_used: number; n_samples: number; response_hash: string; [k: string]: unknown };
  results: unknown[];
  fact_objects?: unknown[];
  review_cards?: unknown[];
  robustness?: { level: string; fragile_edges?: unknown[]; [k: string]: unknown };
  decision_brief?: unknown;
  factor_sensitivity?: unknown[];
  constraint_analysis?: { joint_probability?: number; per_constraint?: unknown[]; [k: string]: unknown };
  response_hash?: string;
  [k: string]: unknown;
}
```

Also PLoT returns an alternative shape (`option_comparison[]` in place of `results[]`) per `V2RunResponseMinimal` at [`plot-client.ts:50`](src/orchestrator/plot-client.ts#L50). The client's minimal Zod validator already accepts either.

**Coverage:** ✅ handler-side. For C2 the handler does NOT need a fresh Zod validator — the PLoT client has already rejected malformed responses by the time the handler receives them. What the handler does:
- Reads `results` or `option_comparison` (whichever is populated) via a tiny helper
- Extracts `option_id` / `option_label` / `win_probability` per record (typed `unknown` → the handler treats each as optional)
- Defensive: if extraction fails (e.g. no option_id/option_label on any record) → handler uses `option_label` fallback, then `null` for `leading_option_id`
- Stashes the whole validated envelope in `result.enrichment`

The boundary validation that matters for C2 is **`RunAnalysisHandlerFactSchema.safeParse`** on the constructed fact (§3). If that fails, `HANDLER_RESULT_INVALID`. If it passes, the fact is wire-safe.

**Not introducing a new Zod schema for V2RunResponseEnvelope** — would be scope creep, brief forbids. PLoT client's existing minimal validator is already the boundary.

---

## 6. Audit: `HandlerFactSchema` discriminated union

Source: `@talchain/schemas/orchestrator/handler-fact.d.ts:365-715`

Discriminator: `fact_type`. `RunAnalysisHandlerFactSchema` is the first arm. `HandlerOutcome.handler_facts` is typed `readonly HandlerFact[]`, so the handler's emitted fact must narrow to one of the seven arms.

**Coverage:** ✅ adequate. C2 emits a single-element array with the `run_analysis` arm.

Downstream the `serialiseHandlerFacts` adapter at [`session/supabase-store.ts:220-229`](src/orchestrator-v5/session/supabase-store.ts#L220-L229) maps each fact to the RPC JSONB shape:

```ts
{ handler_id: fact.fact_type, action_type: fact.fact_type, noop: fact.noop, payload: { fact_type, fact_version, result } }
```

Note that the serialiser uses `fact.fact_type` as **both** `handler_id` and `action_type`. For `run_analysis` that means both DB columns get `"run_analysis"`. Consistent with the phase-0 mapping table.

---

## 7. Audit: `AnalysisResultBlock` / UI-facing block

**Not in C2 scope.** Brief §8 lists UI block work under D1/D2. C2 handler emits `assistant_text` + `handler_facts[]` only. No new UI block. The response's `blocks: []` comes from `composeDirectAnswerResponse` (empty array). Any UI block work lives in a later tranche.

---

## 8. Decision matrix

| Schema | Needs bump? | Needs workaround? | Status |
|---|---|---|---|
| `RunAnalysisArgsSchema` | No | No | ✅ shipped in 0.5.1 |
| `RunAnalysisHandlerFactSchema` | No | **Yes — Resolution 2** | ✅ workaround documented §3 |
| `V5ActionTypeSchema` | No | No | ✅ shipped |
| `V2RunResponseEnvelope` | n/a (CEE-internal) | No | ✅ existing minimal validator adequate |
| `HandlerFactSchema` | No | No | ✅ shipped |
| `AnalysisResultBlock` | n/a | n/a | outside C2 scope |

**Outcome: no bump. Proceed to D3.**

---

## 9. Future considerations (logged, not in scope)

- If a later tranche wants to persist full raw PLoT response as the canonical fact shape (brief's "byte-for-byte no derived shape" reading), that would require a `0.5.2+` bump introducing a new `result` shape (`z.any()` or a `V2RunResponseEnvelopeSchema`). Not C2's concern.
- The four "derived" fields (`scenario_id`, `leading_option_id`, `win_probabilities`, `summary`) are indexable/query-convenient at the DB level — Supabase can filter on them cheaply without parsing enrichment JSON. The current schema is not pure overhead; it's intentional ergonomics. The brief's "no derived shape" is plausibly about *not adding NEW derived fields in CEE*, which Resolution 2 honours.
