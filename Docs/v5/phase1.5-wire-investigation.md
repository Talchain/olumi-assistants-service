# V5 Phase 1.5 — Wire Investigation (D1)

**Date:** 2026-04-19
**Branch:** `claude/v5-phase1.5-graph-threading` off `941dfc1d`
**Purpose:** Document exact field names, types, and shapes at every handoff point from the UI through the V5 orchestrator, before any code changes. The March 2026 `analysis_state` drift incident is the precedent: cross-boundary contract work fails when assumptions about wire shape are not proven from code.

---

## 1. Data path overview

```
[UI — DecisionGuideAI]
  useConversation.ts → useConversation posts to `/bff/orchestrate/v2/turn` when V5 flag on
    body = TurnBase + { message, graph_state, selected_elements?, analysis_state?, chip_metadata? }
      ↓ snake_case on the wire (confirmed)
[BFF layer — opaque proxy]
      ↓ body relayed unchanged
[CEE V5 route — src/orchestrator/route-v2.ts]
  validateIngress(req.body, requestId)  ← uses OrchestratorTurnPayloadSchema (@talchain/schemas v0.5.1)
    checks only: turn_id, scenario_id, message, turn_class, stage (5 fields)
      ↓ graph_state / analysis_state are NOT read
  runTurnExecutor(ingress.value, requestId)   ← no options passed
      ↓
[TurnExecutor — src/orchestrator-v5/turn-executor.ts]
  STEP 1 ORIENT
    assembleContextPack({ payload, priorTurns })   ← no graph, no analysis
      → ContextPack with EMPTY_GRAPH, analysis: null
  STEP 2 VALIDATE
    if (!options.graphLookup) {
      stagesCompleted.push('validate_skipped_graph_checks');    ← CURRENT TELEMETRY LEAK
      log.warn("V5 TurnExecutor graph-dependent validation skipped");
    }
```

**Verdict:** Graph + analysis are fully defined on the wire by the UI, validated at the boundary by `OrchestratorTurnPayloadSchema` as unknown passthrough fields, then silently dropped when the V5 route forwards only the validated 5-field payload into the executor. The validator is graph-unaware by inaction, not by design.

---

## 2. Field-by-field wire shape

### 2.1 UI request body

From [DecisionGuideAI/src/services/turn-request-builder.ts](../../../DecisionGuideAI/src/services/turn-request-builder.ts):

```ts
export type ConversationTurnRequest = TurnBase & {
  message: string
  graph_state: GraphStatePayload      // snake_case on the wire
  selected_elements?: SelectedElementsPayload
  analysis_state?: ExplainAnalysisStatePayload
  chip_metadata?: ChipMetadata
}

type TurnBase = {
  scenario_id: string
  client_turn_id: string
  conversation_history: ConversationTurnPair[]
  session_state?: Record<string, unknown> | null
  _turn_type?: TurnType
}

export type ExplainAnalysisStatePayload = {
  analysis_status: string
  meta: {
    response_hash: string
    [key: string]: unknown
  }
  [key: string]: unknown
}
```

### 2.2 `graph_state` shape (from the real UI fixture)

Per [tests/fixtures/golden/ui-turn-with-graph.json](../../tests/fixtures/golden/ui-turn-with-graph.json):

```json
{
  "graph_state": {
    "nodes": [
      { "id": "goal_1", "kind": "goal", "label": "Maximize Profit" },
      { "id": "opt_1", "kind": "option", "label": "Expand East" },
      { "id": "fac_1", "kind": "factor", "label": "Market Size" }
    ],
    "edges": [
      { "from": "fac_1", "to": "goal_1", "strength": { "mean": 0.8, "std": 0.1 } }
    ]
  }
}
```

**Key wire facts:**
- `graph_state` is the RAW GRAPH CONTENT ({ nodes, edges }) — **not** a wrapped CEE response envelope
- **No** `schema_version`, `options`, `goal_node_id`, `validation_warnings`, `causal_claims` — those live on `CEEGraphResponseV3` (the envelope); the UI does not send them
- Minimum node fields on the wire: `{ id, kind, label }`. Extras (`observed_state`, `category`, etc.) passthrough.
- Minimum edge fields on the wire: `{ from, to }` with `strength: { mean, std }` common. Extras (`exists_probability`, `effect_direction`, `edge_type`) may or may not be present.
- **Implication:** using `GraphV3` schema from [src/schemas/cee-v3.ts](../../src/schemas/cee-v3.ts) at the boundary would reject real UI payloads, because `EdgeV3` requires `exists_probability` + `effect_direction`. **A permissive content schema must be authored in CEE code.**

### 2.3 `analysis_state` shape

The UI type is intentionally permissive — `{ analysis_status: string, meta: { response_hash: string, [key: string]: unknown }, [key: string]: unknown }` — to accommodate:
- complete analysis (full `V2RunResponseEnvelope`)
- failed analysis (e.g., `analysis_status: 'failed'`)
- partial / in-flight analysis (fields missing)
- absent analysis (field entirely undefined)

**Decision (per plan correction #1):** boundary schema requires only `analysis_status: z.string()`, everything else passthrough. `meta.response_hash` is **not** mandatory — not every analysis path carries full success metadata.

### 2.4 Staleness / freshness

Searched both repos for stale flags, `is_stale`, `graph_hash`, `graph_version`, `analysis_provenance`.
- UI computes `graphHash` locally ([DecisionGuideAI/src/canvas/conversation/useConversation.ts](../../../DecisionGuideAI/src/canvas/conversation/useConversation.ts)) and tracks it via `useStaleGuard.ts` to render the "Results are stale" banner.
- **`graphHash` is NEVER sent on the wire.** It stays client-side.
- `V2RunResponseEnvelope` defines `meta.response_hash` + top-level `response_hash` — both are analysis result hashes, **not** graph provenance hashes.
- **`analysis_provenance.graph_hash` does not exist** anywhere in either repo.

**Implication:** the brief's staleness ladder collapses:
1. Provenance hash comparison — **unavailable** (no field on wire)
2. UI-sent stale flag — **unavailable** (no field on wire)
3. `'unknown'` — fallback per brief

Per plan correction (user-confirmed): `staleness_reason` ships as `null` ("no signal, inert"). Server-side `computeDeterministicGraphHash` runs so a later phase can wire provenance without re-litigating canonicalisation.

---

## 3. What changes for Phase 1.5

| Handoff point | Current state | After Phase 1.5 |
|---|---|---|
| HTTP body → route | `validateIngress` checks 5 B1 fields; `graph_state` / `analysis_state` unread | second parse `parseRequestExtensions` validates graph + analysis with permissive Zod; 422 on malformed |
| route → TurnExecutor | `runTurnExecutor(payload, requestId)` — no options | `runTurnExecutor(payload, requestId, { graphState, analysisState })` |
| TurnExecutor STEP 1 | `assembleContextPack({ payload, priorTurns })` | `assembleContextPack({ payload, priorTurns, graph, analysis })` — assembler already accepts these as optional |
| TurnExecutor STEP 2 | `graphLookup` is `undefined` → skip → `validate_skipped_graph_checks` telemetry | `graphLookup` built from `graphState` → full validator runs; new `validate_skipped_no_graph` telemetry only for frame-stage turns |
| ContextPack shape | `graph: ContextPackGraph`, `analysis: ContextPackAnalysis \| null` | SAME — no shape change (plan correction #3) |
| Routing log | `graph_node_count`, `graph_edge_count` absent | both populated from `contextPack.graph.counts`; `graph_hash` added |

**Not changed:**
- `OrchestratorTurnPayloadSchema` (vendored @talchain/schemas v0.5.1 — off-limits per brief)
- [validator.ts](../../src/orchestrator-v5/routing/validator.ts) — zero edits (adapter pattern; plan correction #5)
- `ContextPack` shape (plan correction #3)
- UI repo

---

## 4. Mismatches + how they are resolved

| Mismatch | Resolution |
|---|---|
| `OrchestratorTurnPayload` has no graph_state field, but UI sends it | Second CEE-side Zod parse on `req.body`, independent of B1 payload validation; @talchain remains untouched |
| `EdgeV3` schema requires `exists_probability`, UI fixture doesn't include it | Boundary schema is permissive: only `{ from, to }` required; extras passthrough |
| `CEEGraphResponseV3` wraps graph in envelope with `schema_version`, UI sends raw content | Boundary schema validates content, not envelope (plan correction #2) |
| `V2RunResponseEnvelope` is TypeScript-only (no Zod), analysis may arrive partial | Boundary schema requires only `analysis_status`; passthrough rest (plan correction #1) |
| UI sends no graph_hash / stale flag on wire | Staleness ships as `null` + server-computed hash reserved for later phases |

None of these are cross-boundary contract breakers. All are resolvable at the CEE boundary with a permissive Zod pair, no changes to UI or @talchain.

---

## 5. Evidence — file:line references

**Wire entry points:**
- V5 route registration: [src/server.ts:355](../../src/server.ts#L355)
- V5 route handler: [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) (pre-flight extracted 2026-04-22 to [route-v2-preflight.ts](../../src/orchestrator/route-v2-preflight.ts); see [Docs/v5/route-v2-branch-audit.md](route-v2-branch-audit.md))
- B1 ingress: [src/validators/b1.ts:61-85](../../src/validators/b1.ts#L61-L85)

**Executor + context pack:**
- TurnExecutor entry: [src/orchestrator-v5/turn-executor.ts:146-150](../../src/orchestrator-v5/turn-executor.ts#L146-L150)
- ContextPack assembler input (already accepts graph + analysis): [src/orchestrator-v5/context/context-pack-assembler.ts:105-112](../../src/orchestrator-v5/context/context-pack-assembler.ts#L105-L112)
- `validate_skipped_graph_checks` emission: [src/orchestrator-v5/turn-executor.ts:264-270](../../src/orchestrator-v5/turn-executor.ts#L264-L270)

**Validator + error codes (all exist, zero new code):**
- `validateToolCall`: [src/orchestrator-v5/routing/validator.ts:176-180](../../src/orchestrator-v5/routing/validator.ts#L176-L180)
- Error code union: [src/orchestrator-v5/routing/validator.ts:107-114](../../src/orchestrator-v5/routing/validator.ts#L107-L114)
- `GraphLookup` interface: [src/orchestrator-v5/routing/validator.ts:63-68](../../src/orchestrator-v5/routing/validator.ts#L63-L68)

**Types to reuse (not invent):**
- `GraphV3T`: [src/schemas/cee-v3.ts:402-408](../../src/schemas/cee-v3.ts#L402-L408)
- `V2RunResponseEnvelope`: [src/orchestrator/types.ts:296-326](../../src/orchestrator/types.ts#L296-L326)
- `compactAnalysis(envelope) → AnalysisResponseSummary`: [src/orchestrator/context/analysis-compact.ts](../../src/orchestrator/context/analysis-compact.ts)
- `stableStringify` for deterministic hashing: [src/orchestrator/context/stable-stringify.ts](../../src/orchestrator/context/stable-stringify.ts)

**Fixtures:**
- Real UI payload: [tests/fixtures/golden/ui-turn-with-graph.json](../../tests/fixtures/golden/ui-turn-with-graph.json)
- Real analysis payload: [tests/fixtures/golden/ui-analysis-state-real.json](../../tests/fixtures/golden/ui-analysis-state-real.json)

---

## 6. Manual verification needed before merge

- Confirm with UI that `graph_state.options` (if ever sent) arrives as `OptionV3` array — no fixture currently demonstrates it. Current Phase 1.5 boundary schema accepts `options: z.array(z.unknown()).optional()` to avoid blocking on shape.
- Confirm one live call against staging (flag on) returns expected graph_node_count > 0 in the routing log after merge.
