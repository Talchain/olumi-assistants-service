# Slice B — schemas audit (`@talchain/schemas@0.5.1`)

**Date:** 2026-04-18
**Deliverable:** D2
**Verdict:** **Coverage confirmed — no bump needed.** Proceed to D3.

---

## Audit against runtime needs

| Schema | Exported? | Shape matches Slice B need? | Notes |
|---|---|---|---|
| `SessionTurnSchema` | ✅ | ✅ | 11 fields (`id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash, response_emitted, llm_calls_used, duration_ms, created_at`) — exact 1:1 match with `v5_conversation_turns` DDL. Biconditional refinement `turn_class='handler' ⇔ handler_id non-null` mirrors SQL CHECK. Supabase read path can `.parse()` select results directly. |
| `SessionCacheEntrySchema` | ✅ | ✅ | Extends `SessionTurn` with `stale: boolean` + `stale_reason: string \| null`. Exactly the in-memory LRU shape Slice B's cache needs. Biconditional refinement applies to cache entries too. |
| `HandlerFactSchema` | ✅ | ✅ (for Slice B) | 7-variant discriminated union on `fact_type`. Slice B persists an empty handler_facts array (only `direct_answer` / `clarify` turns), so no write-side use. **Observation for Slice C:** wire shape (`fact_type`, `fact_version`, `noop`, `result`) differs from `v5_handler_facts` RPC JSONB shape (`handler_id`, `action_type`, `noop`, `payload`). Slice C's handler commit path will need an adapter when it starts persisting facts. Slice B does NOT require schemas changes to work around this. |
| `GraphInvalidationSchema` | ✅ | ⚠️ By design | Schema exposes `scope: 'factor' \| 'structural' \| 'manual'`. Brief §Deliverable 3 specifies an **internal** `InvalidationScope: 'factor' \| 'edge' \| 'structural'`. These are different by intent: schema is the cross-service wire contract (PLoT→CEE); Slice B's `InvalidationScope` is internal to CEE's cache layer. No wire boundary is crossed in Slice B (no PLoT-originated invalidations yet). The two will coexist; Slice C+ may need a mapper if edge-scoped invalidations are ever serialised. |

---

## Source-code imports (exports confirmed available)

```ts
// node_modules/@talchain/schemas/dist/orchestrator/index.d.ts
export { SessionTurnSchema, SessionCacheEntrySchema, GraphInvalidationSchema, ConversationTurnClassSchema } from './session.js';
export type { SessionTurn, SessionCacheEntry, GraphInvalidation, ConversationTurnClass } from './session.js';
export { HandlerFactSchema, … } from './handler-fact.js';
export type { HandlerFact, … } from './handler-fact.js';
```

All imported via `@talchain/schemas/orchestrator` — same path CEE already uses for `TurnContextSchema`, `Budgets`.

---

## Slice B use map

- **`SessionTurn`** — return type of `SessionStore.readRecent(scenarioId)` and supabase-store row deserialisation
- **`SessionCacheEntry`** — LRU cache value type
- **`HandlerFact`** — imported for type completeness; Slice B writes `[]` to `append_turn_atomic`
- **`GraphInvalidation`** — available but not yet used (Slice B invalidates internally via locally-defined `InvalidationScope`)

---

## Observations for later slices (non-blocking)

1. **Handler-fact RPC-vs-schema shape mismatch.** When Slice C implements handlers that emit facts, commit.ts will need a `serialiseHandlerFact(fact) → { handler_id, action_type, noop, payload }` adapter before passing to the `p_handler_facts` RPC parameter. This was observable in Phase 0 but deferred; surfacing now for Slice C handover.
2. **Internal vs wire invalidation types.** Slice B's internal `InvalidationScope` is intentionally wider/narrower than `GraphInvalidationSchema` (adds `edge`, drops `manual`). If Slice C+ adds a cross-service invalidation trigger, add a mapper at that boundary rather than forcing the internal type into the schema shape — the schema represents what other services emit, not how we internally invalidate.

---

## Decisive outcome

**Proceed** to D3 (session store implementation). No schema bump. No halt.
