# `edit_graph` v9 — DL-7 V5 Integration Design (Read-Only)

**Date:** 2026-05-09
**Status:** read-only investigation and design — **no implementation in this
phase**
**Predecessors:** Phase 1 (Docs/edit_graph_v9_routing_truth_check.md),
Phase 2A (commit `13dd9b4d`, deployed to staging 2026-05-09)
**Gates this addresses:** DL-7 (V5 integration acceptance) — does NOT
address DL-5 (captured-payload incident closure) which remains gated on
the production payload.

---

## TL;DR

**The integration gap is narrow and well-scoped.** Successful `edit_graph`
mutations today commit as a `direct_answer` turn with `handler_id: null`
and `handler_facts: []`
([edit-graph-dispatch.ts:721-731](../src/orchestrator-v5/handlers/edit-graph-dispatch.ts:721)).
Every other V5 mutation handler (`set_factor_value`, `add_constraint`,
`adjust_edge_strength`) commits as a `handler` turn with a typed
discriminated-union fact in `handler_facts`. The fact discriminator —
defined in `@talchain/schemas/orchestrator` — has no `edit_graph` member,
so even if the dispatch path wanted to write a fact today there is no
schema for it to satisfy.

**Recommendation:** add one new `EditGraphHandlerFact` discriminator to
the schemas package, write it from a single site in
`edit-graph-dispatch.ts`, and extend the existing `recent_changes`
projector with one new branch. **Two PRs, sequenced** — see § 9.

**Cross-workstream constraint:** the `HandlerFact` discriminated union
lives in the `@talchain/schemas` vendor package, NOT in our repo's
`src/orchestrator-v5/types/handler-fact.ts`. Adding a new fact type is a
schemas-package change, not a CEE-internal change. **The schema change
MUST land in the schemas vendor first.** This workstream does NOT
authorise:

- in-repo override shims (e.g. module augmentation extending the union
  in `src/orchestrator-v5/types/handler-fact.ts`),
- CEE-only fact objects that bypass the canonical `HandlerFact` Zod
  validation step,
- any other workaround that diverges the runtime fact contract from the
  schemas-vendor source of truth.

PR B (CEE wiring) does not start until PR A (schemas-vendor) is merged
and a new `@talchain/schemas` release is available. See § 9.

---

## 1. Current `edit_graph` mutation flow (end-to-end trace)

### 1.1 Entry: V5 routing → dispatch
- [src/orchestrator/route-v2.ts:867-878](../src/orchestrator/route-v2.ts:867)
  `dispatchEditGraph({ payload, requestId, graphState, analysisState })`
- The V5 router lands here when Sonnet emits the legacy `edit_graph`
  tool call. Note that the deterministic D1 mutations
  (`set_factor_value`, `add_constraint`, `adjust_edge_strength`) take a
  different path — through `tools/handlers/*` and the registered
  handler invocation flow — and **do** emit handler facts already.

### 1.2 Inside the dispatcher
[src/orchestrator-v5/handlers/edit-graph-dispatch.ts:461-757](../src/orchestrator-v5/handlers/edit-graph-dispatch.ts:461):

1. **L467-475:** parse `graphState` to `GraphV3T`; build a
   `ConversationContext` directly from `payload` (NOT from ContextPack).
2. **L477:** `getAdapter('edit_graph')` — adapter for the LLM call.
3. **L482-595:** deterministic add-risk-template intercept (unchanged
   by this design).
4. **L600-617:** call `handleEditGraph(...)` which runs the LLM →
   parse → Zod → PLoT validation loop.
   Returns `EditGraphResult { wasRejected, appliedGraph, blocks,
   assistantText, ... }`.
5. **L645-707:** post-edit freshness derivation:
   ```ts
   const turnContext = await buildTurnContext(payload, requestId);
   const postEditGraph = editResult.appliedGraph ?? graphState;
   const currentGraphHash = computeAnalysisAffectingGraphHash(postEditGraph);
   freshness = deriveAnalysisFreshness(turnContext.prior_facts, currentGraphHash);
   emitFreshnessTelemetry(...);
   ```
   This is the only place `edit_graph` reads V5 context state. It uses
   `prior_facts` to check whether prior `run_analysis` facts are now
   stale because the graph hash changed.
6. **L720-731:** commit the turn:
   ```ts
   await commitDirectAnswer(response, {
     scenario_id: payload.scenario_id,
     turn_id: payload.turn_id,
     turn_class: 'direct_answer',     // ← gap
     handler_id: null,                 // ← gap
     request_hash: computeRequestHash(payload),
     llm_calls_used: deterministicAddRiskAttempted ? 0 : 1,
     duration_ms: Date.now() - startedAt,
     handler_facts: [],                // ← gap (empty array)
     graph: editResult.appliedGraph ?? undefined,
     graph_hash: postGraphHash,
   });
   ```

### 1.3 What this means for V5 state-trust

- ✅ **Graph IS persisted atomically** with the turn row via
  `append_turn_atomic(p_graph)`. So next-turn graph state is correct.
- ✅ **Freshness IS derived correctly post-edit** — the prior
  `run_analysis` fact (if any) gets compared against the new graph hash;
  the verdict flows out as `analysis_ready.freshness` on the wire.
- ✅ **Freshness telemetry IS emitted** with the same fields the
  D1 handlers emit.
- ❌ **No mutation receipt is persisted.** `handler_facts: []` means
  next turn's `prior_facts` chain is missing this edit entirely.
- ❌ **`recent_changes` cannot surface the edit.** The projector
  filters to mutation fact types in
  [recent-changes.ts:131-150](../src/orchestrator-v5/context/recent-changes.ts:131);
  with no fact emitted, the projection is silent on `edit_graph`
  mutations.
- ❌ **State-query guard
  ([routing/state-query-guard.ts](../src/orchestrator-v5/routing/state-query-guard.ts))
  cannot answer "what did you change?"** for `edit_graph` mutations,
  and falls back to honest copy ("I haven't applied anything in this
  session.") even when an edit just landed — a misleading no-op denial.

This is the **DL-7 receipt gap** the War Room recorded as Decision 1.

### 1.4 Why graph-hash alone cannot cover it (War Room Decision 1)

A future state-query consumer could in principle compare graph hashes
between turns and infer "the model changed". But:

- It cannot answer **what** changed (no operation summary, no target
  label).
- It cannot preserve **rationale** or **impact** (dropped at the
  hash boundary).
- It cannot supply a **safe user-facing summary** without the
  `recent_changes` projector regenerating one from the diff
  (re-narration risks raw-id leakage and contract drift).
- It cannot answer **was the prior analysis stale?** with the
  authority of a turn-linked fact (graph hashes only track the
  current state).

War Room Decision 1: a turn-linked structured receipt is required;
graph-hash is supporting evidence, not the source of truth.

---

## 2. Existing V5 fact + receipt patterns (precedents)

### 2.1 `HandlerFact` discriminated union (canonical)

Location: `@talchain/schemas/orchestrator/handler-fact.d.ts` (vendor
package, **not** in this repo).

Members today (verified by grep on the vendored `.d.ts`):

| `fact_type` | Result shape highlights |
|---|---|
| `run_analysis` | `scenario_id`, `leading_option_id`, `summary`, `enrichment?`, `graph_hash_at_run?`, `computed_at?` |
| `explain_result` (deprecated alias) | `narrative`, `referenced_option_ids` |
| `explain_results` | `precondition_unmet`, `option_count`, `answer_source`, `fallback_reason?`, `staleness_prefixed?` |
| `explain_from_structure` | `option_count`, `answer_source`, `fallback_reason?` |
| `compare_options` | `options[{option_id,label,win_probability?,attributes?}]`, `narrative?` |
| `what_would_flip` | (similar shape) |
| **`set_factor_value`** | **`{ target_id, status: 'applied'\|'noop', before, after }`** |
| **`add_constraint`** | **`{ target_id, status: 'applied'\|'noop', before, after }`** |
| **`adjust_edge_strength`** | **`{ target_id, status: 'applied'\|'noop', before, after }`** |

All facts share top-level `fact_type`, `fact_version: 1`, `noop: bool`,
`result: <type-specific>`. The three D1 mutation facts share an
identical result shape: `{ target_id, status, before, after }`.

**`edit_graph` is conspicuously absent from this union.** That is the
schema-level half of the receipt gap.

### 2.2 `HandlerFactWithTurn` (FK-pinned wrapper)

[src/orchestrator-v5/types/handler-fact.ts:38-47](../src/orchestrator-v5/types/handler-fact.ts:38):

```ts
export interface HandlerFactWithTurn {
  readonly fact: HandlerFact;
  readonly turn_id: string;
  readonly fact_created_at: string;  // DB-stamped
}
```

Used by the proposed-change idempotency lookback path; we don't need to
change this shape — adding a new `fact_type` member to `HandlerFact`
flows through automatically.

### 2.3 How D1 mutation handlers emit a fact (precedent for the receipt shape)

[src/orchestrator-v5/tools/handlers/set-factor-value.ts:331-343](../src/orchestrator-v5/tools/handlers/set-factor-value.ts:331):

```ts
const fact: SetFactorValueHandlerFact = {
  fact_type: 'set_factor_value',
  fact_version: 1,
  noop,
  result: {
    target_id: targetId,
    status: noop ? 'noop' : 'applied',
    before: before as Record<string, unknown>,
    after: after as Record<string, unknown>,
  },
};

const factCheck = SetFactorValueHandlerFactSchema.safeParse(fact);
if (!factCheck.success) throw new HandlerResultInvalidError(...);

return {
  assistant_text: assistantText,
  handler_facts: [factCheck.data],  // ← single fact per turn
  llm_calls_used: 0,
  mutated_graph: result.mutatedGraph,
};
```

**Key invariants the precedent establishes:**

1. **Schema-validated at emission.** Always `safeParse` before returning
   so a contract drift fails loudly at the handler, not silently at
   commit.
2. **Single fact per turn.** Even compound mutations emit one fact
   (the discriminator + result carry the full payload; the receipt
   doesn't fragment).
3. **`status: 'noop'` is a valid outcome.** Used when the proposal
   matched the existing state. Doesn't fragment the schema; the
   `recent_changes` projector filters noops at line 134.
4. **`before` / `after` carry the structural delta.** Permissive
   `Record<string, unknown>` so the handler doesn't have to prove an
   exact graph-shape contract at this layer; downstream projectors
   read the keys they need defensively.

### 2.4 How `recent_changes` is assembled

[src/orchestrator-v5/context/recent-changes.ts:111-150](../src/orchestrator-v5/context/recent-changes.ts:111):

- `projectRecentChanges(priorFacts)` walks newest-first, filters to
  successful mutations only (`fact.noop === false`), maps each to a
  `RecentMutation { action, summary, target_label }` via
  `summariseMutation`, caps at 3.
- `summariseMutation` is a small switch on `fact.fact_type`:
  - `add_constraint` → `summariseAddConstraint` (reads
    `before`/`after`)
  - `set_factor_value` → `summariseSetFactorValue` (reads
    `before`/`after`)
  - `adjust_edge_strength` → returns a generic summary because edge
    facts don't carry node labels
  - default → `null` (skip)

To support `edit_graph` we add **one branch** to `summariseMutation`
plus one summarising helper. No public-API change to
`projectRecentChanges`.

### 2.5 How state-query turns retrieve and surface receipts

[src/orchestrator-v5/routing/state-query-guard.ts](../src/orchestrator-v5/routing/state-query-guard.ts):

- Pre-route guard. Matches user message against a tight allowlist of
  state-query phrases (`"what changed?"`, `"what update did you
  make?"`, etc.).
- If matched AND `recent_changes` non-empty → `direct_answer` dispatch
  with deterministic copy that **quotes the most recent change's
  `summary` verbatim** so the answer is grounded in the persisted
  fact, not regenerated.
- If matched AND `recent_changes` empty → honest no-op copy.

If we make `edit_graph` emit a fact and add the `summariseMutation`
branch, the state-query guard works for `edit_graph` mutations
**without further changes**. That's the simplicity payoff.

### 2.6 Display-safe text rules

[src/orchestrator/shared/output-safety.ts:214](../src/orchestrator/shared/output-safety.ts:214)
defines `sanitiseUserFacingText(text, graph)` — used by both V4 and V5
for entity-ID leak protection. We must use this on any user-facing
field the new fact emits (e.g. `safe_summary`).

---

## 3. Recommended accepted-edit receipt shape

### 3.1 New `EditGraphHandlerFact` (discriminated-union member)

Proposed Zod schema (to be defined in
`@talchain/schemas/orchestrator/handler-fact.ts` — vendor package):

```ts
export const EditGraphHandlerFactSchema = z.object({
  fact_type: z.literal('edit_graph'),
  fact_version: z.literal(1),
  noop: z.boolean(),
  result: z.object({
    // Disambiguates the kind of edit so recent_changes can pick a
    // user-facing summary without re-narrating the diff.
    edit_kind: z.enum([
      'parameter_update',
      'option_configuration',
      'structural',
    ]),
    // 'applied' on a successful PLoT-accepted edit; 'noop' when the
    // LLM returned operations that compiled to no change (rare but
    // possible — e.g. update_node with identical value).
    status: z.enum(['applied', 'noop']),
    // Number of patch operations actually applied. >= 1 for 'applied',
    // 0 for 'noop'. Recent-changes uses this for "renamed 1 factor"
    // vs "renamed 3 factors" wording.
    operations_count: z.number().int().min(0),
    // Stable display-safe identifiers of touched entities, AFTER
    // sanitisation through resolveLabel(). Empty array when the edit
    // was structural-only without a single clear target. Used by the
    // recent_changes projector for `target_label` and by the state-
    // query guard. NEVER raw entity IDs.
    affected_entities: z.array(z.object({
      kind: z.enum(['factor', 'option', 'edge', 'goal', 'constraint']),
      // Display-safe label resolved from the post-edit graph. Empty
      // string when the entity has no label (defensive; production
      // graphs always carry one).
      label: z.string(),
    })).max(8),  // hard cap; bigger edits collapse to a generic summary
    // Hash diff for verification. Supporting evidence per War Room
    // Decision 1 — NOT the user-facing source of truth.
    graph_hash_before: z.string().nullable(),
    graph_hash_after: z.string().nullable(),
    // Decision-language summary, scrubbed by sanitiseUserFacingText
    // against the post-edit graph. THIS is the user-facing source of
    // truth for "what changed?". 80 char hard cap (matches
    // RECENT_CHANGES_SUMMARY_MAX_CHARS).
    safe_summary: z.string().min(1).max(80),
    // Whether this edit makes prior analysis stale. Set from the same
    // freshness derivation that today emits telemetry — just persisted
    // with the fact instead of derived again next turn.
    rerun_recommended: z.boolean(),
  }).strict(),
}).strict();

export type EditGraphHandlerFact = z.infer<typeof EditGraphHandlerFactSchema>;
```

### 3.2 Data classification

| Field | Class | Why |
|---|---|---|
| `fact_type`, `fact_version`, `noop`, `status` | **diagnostic** | Schema discriminator + lifecycle. Not user-facing. |
| `edit_kind` | **diagnostic + recent_changes** | Drives the projector branch. Not directly user-facing. |
| `operations_count` | **recent_changes** | Used for plural wording. |
| `affected_entities[]` | **recent_changes** | `label` is display-safe (already sanitised); `kind` is product-domain vocabulary. |
| `graph_hash_before` / `graph_hash_after` | **diagnostic only** | NEVER user-facing per Decision 1. Verification + replay only. |
| `safe_summary` | **user-facing** | Sanitised at emission; quoted verbatim by state-query guard. |
| `rerun_recommended` | **recent_changes + UI** | Drives chip emission and the staleness narrative pattern (cf. `STALENESS_NARRATIVE` at [set-factor-value.ts:65](../src/orchestrator-v5/tools/handlers/set-factor-value.ts:65)). |

### 3.3 What's deliberately NOT on this fact

- **The patch-operation list.** Verbose, schema-drift risk, and the
  fact is a receipt, not an audit log. Operations live on the wire
  `graph_patch` block (already produced by `handleEditGraph`).
- **Rationale text from the LLM.** Phase 2A coaching defaults give us
  `"Proposed graph edit."` — adequate for state-query. If a future
  workstream wants to surface LLM rationale, that's a separate fact
  field with its own jargon-guard test.
- **Pre/post node-or-edge snapshots.** Diff would be huge and
  un-discriminated; the `affected_entities` projection is the
  bounded substitute.

---

## 4. `prior_facts` / freshness contract test (DL-7 Decision 2)

### 4.1 Goal
Per War Room Decision 2: prove the `prior_facts` /
`HandlerFactWithTurn` shape used by `edit_graph` freshness derivation
remains stable, **without** requiring `ContextPack` or `recent_changes`
field-shape drift to make the assertion pass.

### 4.2 Proposed test

Location: `src/orchestrator-v5/handlers/__tests__/edit-graph-prior-facts-contract.test.ts`
(new file in this branch's surface — does NOT touch
`build-turn-context.ts` or fact types).

```ts
describe('edit_graph freshness derivation: prior_facts contract', () => {
  it('builds a successful edit-graph turn, derives stale freshness from prior_facts', async () => {
    // 1. Fixture: graph G0 with one prior run_analysis fact stamped at
    //    graph_hash_at_run = hash(G0).
    const priorRunAnalysisFact: RunAnalysisHandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: TEST_SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Option A leads.',
        graph_hash_at_run: hashG0,
        computed_at: '2026-05-09T10:00:00Z',
      },
    };

    // 2. Mock SessionStore so buildTurnContext returns prior_facts =
    //    [priorRunAnalysisFact]. THIS exercises the contract surface.
    mockSessionStore({ readFactsFor: async () => [priorRunAnalysisFact] });

    // 3. Run dispatchEditGraph with a payload that mutates G0 → G1.
    const { editResult, freshness } = await dispatchEditGraphForTest({...});

    // 4. Assertions on the contract:
    //    a. buildTurnContext returned prior_facts with the expected
    //       fact in the expected shape (read via deriveAnalysisFreshness).
    expect(freshness.selected_fact_index).toBe(0);
    //    b. graph hash diverged → freshness is 'stale'.
    expect(freshness.freshness).toBe('stale');
    expect(freshness.reason).toBe('graph_hash_diverged');
    //    c. computed_at is the prior fact's, not Date.now() (proves
    //       freshness is reading the fact, not synthesising).
    expect(freshness.computed_at).toBe('2026-05-09T10:00:00Z');

    // 5. ContextPack / recent_changes invariant:
    //    None of the imports below were needed to make the test pass.
    //    If a future change makes them necessary, this test must be
    //    paired with an explicit War-Room note.
    //
    //    (Negative-import comment, NOT runtime code.)
    //    Forbidden imports for this test:
    //      - ContextPack types
    //      - recent_changes projector
    //      - context-pack-assembler
    //
    //    Verified statically by ESLint config or by a `grep -E ...`
    //    in CI; see the test file's header comment.
  });
});
```

### 4.3 What this test does NOT prove

- That `edit_graph` emits a handler fact (that's a separate test in
  the implementation tranche).
- That `recent_changes` surfaces the edit (separate projector test).
- That `ContextPack.recent_changes` reaches the routing prompt
  correctly (V5 ContextPack workstream's surface, not ours).

---

## 5. `recent_changes` integration — recommended option

### 5.1 Three options considered

**Option A: Consume the new `EditGraphHandlerFact` directly.**
Add one branch to `summariseMutation` that reads
`fact.result.safe_summary` verbatim (already sanitised at emission)
and a derived `target_label` from `affected_entities[0].label`.

**Option B: Wrap in an existing turn-fact wrapper.**
There is no such wrapper today; `recent_changes` reads from
`prior_facts: HandlerFact[]` directly. This option would require
adding a new layer.

**Option C: Derive a receipt at projection time from persisted turn
data (graph hash diff + handler_id).**
Requires `recent_changes` to reach into the graph, regenerate a
summary deterministically, and avoid raw-id leakage. Adds complexity
and risks contract drift between the regenerator and the actual
edit performed.

### 5.2 Recommendation: **Option A.**

**Rationale:**
- Mirrors the existing pattern for `add_constraint` / `set_factor_value`
  / `adjust_edge_strength` — one switch case, one helper, no new
  abstraction.
- The fact is the contract; the projector is mechanical.
- `safe_summary` is sanitised once at the dispatcher (where the graph
  is in scope for `sanitiseUserFacingText`), avoiding the projector
  needing graph access (it doesn't have it today; adding the
  dependency would broaden scope).
- State-query guard works automatically.

### 5.3 New projector branch

```ts
// In src/orchestrator-v5/context/recent-changes.ts:
// — new RecentChangeAction enum member: 'graph_edited'
// — new branch in summariseMutation:
if (fact.fact_type === 'edit_graph') {
  return summariseEditGraph(fact.result);
}

function summariseEditGraph(
  result: EditGraphHandlerFact['result'],
): RecentMutation | null {
  // Defensive: if the dispatcher emitted a noop fact, drop it (matches
  // the noop filter at line 134, but defensive in case the union grows).
  if (result.status === 'noop') return null;
  return {
    action: 'graph_edited',
    summary: cap(result.safe_summary),
    target_label: result.affected_entities[0]?.label ?? 'the decision model',
  };
}
```

**Cost:** ~15 lines added to `recent-changes.ts`. **One new
discriminator value** in `RecentChangeAction`.

---

## 6. V5 end-to-end acceptance path design

One acceptance test demonstrating the full round trip. New file:
`src/orchestrator-v5/handlers/__tests__/edit-graph-recent-changes-e2e.test.ts`.

### 6.1 Scenario

User sequence (single test):

1. **Turn 1** — user: "Build a model for choosing a delivery partner."
   System: drafts a graph with two options, several factors.
2. **Turn 2** — user: "Run analysis." System: emits
   `run_analysis` fact with `graph_hash_at_run = hash(G1)`.
3. **Turn 3** — user: "Add 'price-sensitive customers' as a risk
   factor." V5 routing → `edit_graph` (LLM-driven, not D1). Mutation
   succeeds; PLoT validates.
   - **Assertion 3a:** dispatch commit was `turn_class: 'handler'`
     with `handler_id: 'edit_graph'` (not `direct_answer` / `null`).
   - **Assertion 3b:** `handler_facts: [<EditGraphHandlerFact>]`
     with `status: 'applied'`, `noop: false`, `edit_kind:
     'structural'`, `operations_count >= 1`,
     `safe_summary` non-empty and jargon-free,
     `affected_entities` includes a factor labelled "Price-sensitive
     customers" (or sanitised equivalent),
     `rerun_recommended: true`.
   - **Assertion 3c:** wire response `analysis_ready.freshness ===
     'stale'` and `analysis_ready.freshness_reason ===
     'graph_hash_diverged'`.
4. **Turn 4** — user: "What did you change?" V5 routing pre-route →
   state-query guard hits.
   - **Assertion 4a:** `direct_answer` dispatch produced by the
     state-query guard (no LLM call, telemetry confirms).
   - **Assertion 4b:** `assistant_text` contains the verbatim
     `safe_summary` from Turn 3's fact.
   - **Assertion 4c:** `assistant_text` contains zero raw entity IDs
     (jargon guard pattern from
     [edit-graph-bare-array-safe-envelope.test.ts A6](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts)).
5. **Turn 5** — user: "OK, run the analysis again." V5 routes to
   `run_analysis`.
   - **Assertion 5a:** `run_analysis` operates on the post-edit graph
     (`prior_facts` chain selects the *new* `run_analysis` fact;
     freshness becomes `fresh` for any subsequent state-query).
6. **Turn 6** — user: "Why did the leading option change?" V5 routes
   to `explain_results`.
   - **Assertion 6a:** explain handler reads from the post-edit graph
     and from the new `run_analysis` fact (no stale-state regression).

### 6.2 What this test demonstrates for DL-7 closure

Closure-criterion mapping:

| DL-7 criterion | Demonstrated by |
|---|---|
| 1. Documented receipt source of truth | Assertion 3b (fact shape pinned in test) |
| 2. Mutation creates turn-linked fact | Assertion 3a + 3b |
| 3. `recent_changes` surfaces edit safely | Assertion 4b + 4c |
| 4. Hash is supporting evidence only | Assertion 4b (text is `safe_summary`, not hash) |
| 5. `prior_facts` contract test | Section 4 above (separate file) |
| 6. No ContextPack file touched | Verified by branch's diff (closure-criterion #6) |

---

## 7. File impact + stop conditions

### 7.1 Likely implementation files

| File | Change | Layer | Risk |
|---|---|---|---|
| `@talchain/schemas/.../handler-fact.ts` | **Add `EditGraphHandlerFactSchema`** to the discriminated union | **vendor package — STOP CONDITION** | medium |
| `src/orchestrator-v5/handlers/edit-graph-dispatch.ts` | Build + emit fact at L720 commit; flip `turn_class: 'handler'`, `handler_id: 'edit_graph'` | this branch | low |
| `src/orchestrator/tools/edit-graph.ts` | (Optional) thread `affected_entities` and `safe_summary` derivation up through `EditGraphResult` | this branch | low |
| `src/orchestrator-v5/context/recent-changes.ts` | Add `graph_edited` branch + `summariseEditGraph` helper | **V5-owned** | low |
| `src/orchestrator-v5/handlers/__tests__/edit-graph-recent-changes-e2e.test.ts` | New E2E test | tests | low |
| `src/orchestrator-v5/handlers/__tests__/edit-graph-prior-facts-contract.test.ts` | New contract test | tests | low |
| `tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts` | (Possibly) extend D2 to also assert `handler_facts` is non-empty | tests | low |

### 7.2 Stop conditions (from Phase 1 brief, restated for this tranche)

- 🛑 **`@talchain/schemas` is a vendor package, not in our repo.** Adding
  `EditGraphHandlerFactSchema` to the discriminated union requires a
  schemas-vendor PR, not a CEE-internal edit. **The required path is**
  to raise a schemas-vendor PR first (PR A in § 9), merge it, cut a
  new `@talchain/schemas` release, and only then start the CEE wiring
  (PR B in § 9). **In-repo override shims and CEE-only fact objects
  are NOT acceptable workarounds** — they would diverge the runtime
  fact contract from the schemas-vendor source of truth and undermine
  every downstream consumer that imports the canonical `HandlerFact`
  type. If the schemas-vendor route is blocked, **STOP AND REPORT**;
  do not implement around it.
- 🛑 **`src/orchestrator-v5/context/recent-changes.ts`** — owned by
  V5 Context Management workstream per DL-7. The proposed change
  there is mechanical (one switch case + helper) and additive, but
  still needs War Room sign-off because it adds a new
  `RecentChangeAction` enum member. **PAUSE AND REPORT** if the V5
  workstream owner objects.
- 🛑 **`src/orchestrator-v5/build-turn-context.ts`,
  `src/orchestrator-v5/context/context-pack-assembler.ts`,
  `src/orchestrator-v5/types/handler-fact.ts`,
  `src/orchestrator-v5/session/store.ts`** — must NOT be touched.
  The design above does not require touching these. If an
  implementation discovers a hard dependency, **STOP AND REPORT**.
- 🛑 **No prompt edits, PMS rows, env, migrations, packages,
  model-routing, UI, PLoT, replay, CQE, validator** — same fence as
  Phase 2A.

### 7.3 Cross-workstream coordination

- **V5 Context Management workstream (PR #152)** has already merged.
  No further coordination needed for that workstream's currently-open
  scope.
- **`@talchain/schemas` vendor** — this is the principal stop condition.
  Confirm with the vendor-package owner whether an
  `edit_graph` `HandlerFact` member is in scope for the next schemas
  release. The sequence is **vendor PR (PR A) → vendor release → bump
  in our `package.json` → CEE wiring (PR B)**. There is no acceptable
  shortcut around this ordering.

---

## 8. Relationship to DL-5

**DL-5 remains open and untouched.** This DL-7 design does NOT close
the captured-payload incident.

Why:

- The DL-7 receipt gap and the DL-5 production parse/validation
  failure are **different problems on different surfaces**. DL-5 is
  about an LLM output shape that today's parser fails on (or
  succeeds-but-renders-poorly per Phase 2A's finding). DL-7 is about
  a missing fact emission downstream of a successful mutation.
- The synthetic gold case used to drive Phase 2A still cannot
  reproduce the original DL-5 failure pattern; that's why A7 remains
  `it.todo`.
- Implementing DL-7 will improve the *user-facing* experience for
  bare-array edits that succeed (and for the LLM-driven `edit_graph`
  path generally) — but it will not retroactively close the original
  incident's "what did the parser actually fail on?" question.

**Do not bundle the captured-payload work into this tranche** unless
the payload becomes available before implementation starts. If it
arrives, A7 should be converted to an executable test in the **same
PR or earlier** so the receipt-gap fix and the incident-closure fix
land with mutual confirmation.

---

## 9. PR shape — two PRs, sequenced (locked)

### 9.1 The required sequence

**PR A — Schemas-vendor `EditGraphHandlerFact` first** (in
`@talchain/schemas`):
- New schema member added to the canonical `HandlerFact` discriminated
  union.
- Vendor-package release (e.g. 0.12.0).
- No CEE-side changes in PR A.
- **Must be merged and a new `@talchain/schemas` release available
  before PR B starts.** No exceptions.

**PR B — CEE-side wiring AFTER schema approval** (in
`olumi-assistants-service`, this branch's natural next step, **gated
on PR A**):
- Bump `@talchain/schemas` dep to the released version.
- Emit fact from `edit-graph-dispatch.ts`.
- Add `recent_changes` projector branch.
- Add prior_facts contract test.
- Add E2E acceptance test.
- Update DL-7 in `Docs/edit_graph_v9_deferred_items.md` with closure
  evidence.

### 9.2 Why this ordering is locked

- **Schemas vendor is the source of truth for the fact contract.**
  Every consumer (CEE, replay harness, downstream services that
  import `@talchain/schemas/orchestrator`) must agree on the
  discriminated-union members. Adding a member through any path
  other than the schemas-vendor PR fragments the contract.
- **No in-repo override shims.** Module-augmenting the union in
  `src/orchestrator-v5/types/handler-fact.ts` (or anywhere else)
  would diverge the runtime fact contract from the schemas-vendor
  source of truth. Explicitly NOT acceptable.
- **No CEE-only fact objects.** Emitting an `EditGraphHandlerFact`-
  shaped object from CEE without a corresponding canonical schema
  bypasses Zod validation at the boundary and creates an undefined
  contract for downstream consumers. Explicitly NOT acceptable.
- **No bundling.** Forcing schemas-vendor changes through this
  repo's review bypasses schemas-package governance; any rollback
  removes both halves at once but the schema may have downstream
  consumers we don't see. Bisectability also suffers when schema
  and consumer changes share one commit.
- **Independent reviewability.** PR A is "is this the right fact
  shape?" — answerable by schemas owners + War Room without needing
  CEE context. PR B is "is the wiring correct?" — needs CEE + V5
  reviewers.

### 9.3 If PR A is blocked or refused

**Stop and report.** Do not proceed to any in-repo workaround. The
War Room decides whether to (a) escalate the schemas-vendor change,
or (b) defer DL-7 closure until the schemas package can accept the
new member. There is no third path from this design.

---

## Summary table

| Question | Finding |
|---|---|
| Diagnosis of current V5 integration gap | `edit_graph` commits with `handler_id: null`, `handler_facts: []`, `turn_class: 'direct_answer'`. No `EditGraphHandlerFact` exists in the schemas union. |
| Recommended mutation fact / receipt contract | New `EditGraphHandlerFactSchema` with `{ edit_kind, status, operations_count, affected_entities[], graph_hash_before/after, safe_summary, rerun_recommended }`. |
| Recommended `recent_changes` path | **Option A** — consume the new fact directly via one new branch in `summariseMutation`. |
| `prior_facts` contract test design | New test in `handlers/__tests__/`, asserts freshness derivation reads correctly from prior_facts WITHOUT touching ContextPack/recent_changes shapes. |
| E2E acceptance design | Single test, six turns, asserts handler-fact emission → recent_changes surfacing → state-query verbatim quoting. |
| Likely implementation files | Schemas vendor + 2-3 CEE files + 2 new test files. |
| Risks / stop conditions | Schemas vendor PR is the principal stop condition. `recent_changes` change needs V5 owner sign-off. ContextPack files NOT touched. |
| One PR or two? | **Two**, sequenced (schemas first, CEE second). |

---

## Provenance

- Author: Claude Code (Opus 4.7), invoked by Paul.
- Method: read-only file reads, grep, no modifications outside this
  Doc and DL-2 dates.
- No code, prompts, env, packages, migrations, model-routing,
  ContextPack, recent_changes, or schemas-vendor changes made during
  this design phase.
