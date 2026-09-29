# Olumi V5 Architecture and Design Specification v3.2

**Date:** 19 April 2026
**Status:** Plan of record
**Supersedes:** V5 Architecture and Design Specification v3.1, v3, v2, V5 Deterministic Components Design v1. Superseded documents must not be edited; this is the combined authoritative source
**Related:** V5 Implementation Plan v2.3.1, Boundary Contract v1.1, AI Architecture v4.1, CC Development Standards v3, CQE Design v1.1
**Authors:** Claude (drafting), Paul (review + approval)

**Changes from v3.1:**
- §4: non-action turn classification gains normative inference source order (coaching_context → heuristic → default)
- §6 check #4: out-of-range scale check gains PoC default-scale registry; converts partial check to full check immediately
- §13.1: routing log schema adds `tool_call_present`, `intent_class_source`, `coaching_mode_source`, `graph_lookup_outcome`
- §18 (new): status legend (Shipped / Locked design / PoC shortcut / Production upgrade path) applied to four areas

**Changes from v3:** §11.1 schema gains optional `value_origin` field. Test matrix updated: "reduce by a third" maps to `operator: decrement`. Pattern count noted as 13. Contract freeze status table reflects QuantityExtractionResult v1.1.

---

## 1. Architecture decision

**Decision:** Controller-first hybrid. Deterministic controller with Sonnet 4.6 tool-use routing. F.6 enforced structurally via tool-use schemas. The LLM proposes, deterministic code validates and executes. Option A (narrow classifier) formally retired. Option E (fine-tuned small models) as future upgrade path.

**Rationale:** Seven independent research reports converge on this pattern. V4's failure was not "single LLM call was too much work" but "single LLM call with no structural enforcement." The narrow classifier optimises for the 15-25% unambiguous traffic and penalises the 75-85% majority. The correct architecture routes obvious cases deterministically, handles everything else with a capable LLM constrained by tool-use schemas, and enforces F.6 at every boundary structurally.

**Key research findings:**
- 2-call router + executor is the production standard (Klarna, Shopify, Sierra, RouteLLM)
- Constrained decoding solves F.6 structurally (100% schema conformance)
- Coaching mode classification is safety-critical (Bastani PNAS 2025: -17% skill degradation from unguarded answer-giving, users can't self-detect)
- Full graph in context beats schema-linking for <50 nodes (Maamari, BIRD leaderboard)
- Tool use preserves reasoning quality vs strict JSON (CRANE arXiv 2502.09061)

**Design principle:** Stay deterministic and in-process for the PoC. Benchmark the few places where semantics outgrow string rules. Defer heavier infrastructure until Olumi's own logs justify it. Every production upgrade has an evidence-based trigger, not a date.

---

## 2. Why V5 exists

V4's documented failures:

1. ~40 overlapping mechanisms in one orchestrator prompt (v36/v37, ~60K tokens)
2. Silent semantic transforms undetected for months (analysis_state, 6 dark features, stripped numbers)
3. XML contamination in prompts, required v33e rewrite
4. F.6 violations through prompt drift (UI doing semantic transforms, CEE interpreting numbers)
5. Entity resolution failures on real user messages
6. 80/20 AI-to-user authorship ratio (opposite of coaching promise)
7. Pipeline failures from building on top of an XML-producing prompt contract
8. No structural enforcement: only prompt discipline, which failed silently

The single most important lesson: **contracts without enforcement change nothing.** V5 enforces structurally at every boundary.

---

## 3. Four-layer architecture

### Layer 0: deterministic gate (zero LLM cost, instant)

1. **System events** route directly to handlers (full enumeration in §8)
2. **Chip clicks** route directly via chip action payload
3. **Quantity pre-processing** (§11.1): custom CQE regex parses directional modifiers and quantities. compromise-numbers as numeric back-stop. Pre-parsed quantities included in ContextPack as structured input. The LLM receives them, does not compute them
4. **Compound intent detection** (§11.2): regex heuristic with noun-conjunct stop-list. When detected, sets `compound_detected: true`. Execute the action appearing first (positional priority), surface remainder as next-step chip
5. **Context pack assembly:** typed, versioned artefact (ContextPack v2). Assembled fresh every turn from canonical state. Details in §10

### Layer 1: Sonnet 4.6 with tool use (one call per turn)

Sonnet receives the ContextPack and produces two outputs:

- **Natural text:** pre-action orientation on execute turns; full coaching response on coach/converse/advise turns
- **Tool call:** structured routing proposal via `olumi_action`, validated before execution. Tool call is a proposal, not a mutation

Tool use guarantees syntactic validity (well-formed JSON matching schema). It does NOT guarantee semantic validity, business-rule validity, or safe arithmetic separation. The §6 validator exists precisely because syntactic conformance is insufficient.

**Text ownership:** on execute turns, Sonnet's text is pre-action orientation only. It must never narrate outcomes it has not seen. On coach/converse/advise turns (estimated 60-70% of traffic; to be validated from production telemetry), Sonnet's natural text IS the final coaching response.

### Layer 2: deterministic validation + handler execution (zero LLM cost)

Sonnet's tool call is a proposal. The §6 validator checks before dispatching to the handler registry. Handlers invoke PLoT/ISL, persist facts atomically. The LLM never touches numbers, never mutates state.

### Layer 3: response composition + conditional coaching

**Response composer** owns final user-visible text on tool turns. Assembles from: handler outcome (authoritative), Sonnet's pre-action orientation (context), coaching pass output (when signals fire).

**Non-action turn compose step:** on coach/converse/advise turns, a lightweight deterministic post-check runs on Sonnet's natural text before it reaches the user. Checks: forbidden language scan, em dash removal, question count validation, internal ID stripping. Cost: <1ms, pure string operations. This is the Layer D harness running in production.

---

## 4. Seven-step turn assembly

Explicit ordering. No step may narrate outcomes from a later step.

```
1. ORIENT    → Sonnet emits pre-action text + tool call
                Text describes context, not outcomes

2. VALIDATE  → §6 validator checks the tool call proposal
                On failure → typed error, no handler invocation

3. EXECUTE   → Handler runs against canonical state
                Produces HandlerOutcome (authoritative)

4. CONFIRM   → Response composer builds confirmation from HandlerOutcome

5. COACH     → Coaching pass evaluates signal registry triggers
                against handler outcome. Deterministic signals only
                Appends coaching to response if warranted
                At most one coaching signal per turn

6. COMPOSE   → Response composer assembles final response:
                Sonnet orientation (step 1) +
                handler confirmation (step 4) +
                coaching (step 5, if any) +
                suggested actions / chips

7. COMMIT    → Persist turn + facts via append_turn_atomic
                Log routing data per §13
```

**Rules:**
- Step 1 text is composed before the handler runs. It cannot reference handler results
- Step 4 text is composed from handler output only
- Step 5 coaching is composed from signal evaluation against handler outcome only
- Coaching does not fire on failed handler turns
- Handler confirmation always comes first; coaching second

**Non-action turns (coach/converse/advise):** Steps 2-4 are skipped. Step 1 produces the full coaching response (Sonnet is the coaching engine; science-to-scenario pattern matching lives here, not in Step 5). Step 5 is a deterministic text quality check (Layer D). Step 7 persists and logs.

**Non-action turn classification contract:** when Sonnet emits no tool call, the runtime infers `intent_class` and `coaching_mode` from available signals using the source order below. Inferred values are logged in the routing log alongside `tool_call_present: false`, `intent_class_source`, and `coaching_mode_source`. `advise` on text-only turns is a response posture, not a tool-emitted classification.

**Inference source order (deterministic, no LLM call):**

1. **Coaching context** — when `ContextPack.coaching.coaching_mode` is present and the coaching context builder has been validated against GTX (per §3 thresholds), trust it as primary signal:
   - `coaching_mode` from context — use directly
   - `intent_class`: derived as `coach` if mode is `coach`, otherwise `converse`
   - Source: `coaching_context`

2. **Heuristic from ContextPack state** — when coaching context is null or unvalidated:
   - If `coaching.triggered_plays` is non-empty → `intent_class: coach, coaching_mode: coach`
   - Else if `analysis.status === "ready"` AND user message ends with `?` → `intent_class: converse, coaching_mode: advise`
   - Else if `system_event` indicates greeting/meta → `intent_class: converse, coaching_mode: none`
   - Source: `heuristic`

3. **Default** — fallback when neither rule above fires:
   - `intent_class: converse, coaching_mode: none`
   - Source: `default`

The full algorithm with edge cases is specified in Component 2 design (forthcoming). This subsection establishes the contract; the design provides implementation detail. No second LLM call is permitted in any source.

---

## 5. Tool-use schema

### Canonical enums

```typescript
type IntentClass = "execute" | "coach" | "converse" | "clarify";
type CoachingMode = "coach" | "advise" | "execute" | "none";
type ResolutionStatus = "resolved" | "ambiguous" | "unresolved" | "multiple_candidates";
type ResolutionMethod = "explicit_id" | "label_match" | "contextual" | "pronoun";
type AmbiguityType = "intent" | "entity" | "parameter" | "scope";
type ParameterSource = "explicit" | "inferred" | "default";
type EntityKind = "goal" | "option" | "factor" | "edge" | "constraint" | "outcome" | "risk";
type ParameterOperator = "set" | "add" | "multiply" | "increment" | "decrement";
```

### Tool definition: `olumi_action`

```typescript
{
  intent_class: IntentClass,
  coaching_mode: CoachingMode,

  action?: {
    handler_id: string,
    target_entity: {
      id: string | null,
      label: string,
      kind: EntityKind,
      resolution_status: ResolutionStatus,
      resolution_method: ResolutionMethod,
      candidates?: Array<{ id: string, label: string, kind: EntityKind }>,
    },
    parameters: Record<string, unknown>,
    parameter_operator: ParameterOperator | null,
    parameter_source: ParameterSource,
  },

  clarification?: {
    question: string,
    ambiguity_type: AmbiguityType,
    options?: string[],
  },

  context_used: ContextPackField[],
  compound_detected: boolean,
  deferred_intents?: string[],
}
```

### Schema rules

- `execute` → `action` required, `clarification` absent
- `clarify` → `clarification` required, `action` absent
- `converse` or `coach` → both absent. No tool call emitted. System infers intent from absence of tool call
- `resolution_status !== "resolved"` → system clarifies, never executes
- `compound_detected === true` → only primary action in `action`; remainder in `deferred_intents`
- `parameter_operator` contains the operation; `parameters` contains the raw user value. Deterministic layer computes against current state

### Coaching mode definitions

- **Execute:** action with factual confirmation. Eligible for post-action coaching from signal registry
- **Advise:** model-grounded guidance without action. High expertise, time-pressured, low-ambiguity
- **Coach:** scaffold thinking. Answer first, then scaffold. Bastani safety gate. Olumi move pattern
- **None:** conversational, greeting, meta-question. Not eligible for coaching triggers

---

## 6. Validation contract

The deterministic validator runs between Sonnet's tool call and handler execution.

### Checks (ordered)

1. **Handler exists:** `handler_id` maps to a registered handler. Fail → `HANDLER_NOT_FOUND`

2. **Entity kind matches handler:** handler declares accepted `EntityKind` values. Mismatch → `ENTITY_KIND_MISMATCH`

3. **Target entity exists and is plausible:**
   - `target_entity.id` exists in current graph. Missing → `ENTITY_NOT_FOUND`
   - When `resolution_method === "label_match"`: validator runs Dice similarity against all nodes of declared kind. If a closer match exists (score > chosen match by ≥0.15), flag `ENTITY_RESOLUTION_SUSPICIOUS` → clarify with both candidates
   - **Partial label overlap check:** when another node shares a primary keyword with the matched entity (e.g. "Delivery Speed" and "Delivery Velocity"), flag `ENTITY_RESOLUTION_SUSPICIOUS` regardless of Sonnet's confidence. **The validator is authoritative for entity resolution safety; the prompt mirrors this logic but if they diverge, the validator wins.** Clarification triggers only when another candidate remains plausible, not merely because a shared stem exists
   - When `resolution_status !== "resolved"` → route to clarification, never execute

4. **Parameter bounds:** handler declares constraints (numeric ranges, allowed enums, required fields). Out-of-bounds → `PARAMETER_INVALID` with specific violation. **Out-of-range scale check:** when `parameter_operator === "set"` (or `decrement`/`increment`/`add` resolving to a value outside scale), reject values outside the target factor's scale with expected range in the error. Scale resolution order:
   1. Explicit `scale.min` / `scale.max` on the graph node — use directly
   2. PoC default-scale registry (below) keyed by factor unit/category — use as fallback
   3. Neither available — skip check; routing prompt catches obvious cases as best-effort

**PoC default-scale registry:**

| Factor unit/category | scale.min | scale.max |
|---|---|---|
| `ratio` (0-1 fractions) | 0 | 1 |
| `percentage` | 0 | 100 |
| `percentage_points` | -100 | 100 |
| `currency` (GBP, USD, EUR) | 0 | null (no upper) |
| `duration` (months, weeks, days, years, hours) | 0 | null |
| `count` (people, items, headcount) | 0 | null |
| `edge_strength` | -1 | 1 |
| unit absent | (skip check) | (skip check) |

Registry lives in `@olumi/contracts/orchestrator` as `DEFAULT_FACTOR_SCALES`. Production upgrade: PLoT-derived scales from factor metadata (logged as `repairs_applied`) replace the registry without changing validator logic.

5. **No arithmetic in proposal:** parameters contain raw user values and operators. If validator detects a computed result (value not in user message or parsed quantities) → `PARAMETER_COMPUTED`

6. **Preconditions met:** handler declares required state. Unmet → `PRECONDITION_UNMET` with specific fix path (RECOVER mode)

### On validation failure

Return typed error to response composer. Never execute a handler with invalid input. Never silently substitute defaults. Every validation failure produces a user-visible outcome with chips per §7.

---

## 7. Failure states

Every failure mode has a declared controller state. No ad-hoc fallbacks. No blank turns. Every failure path includes a chip.

| Failure | Detection | State | User-visible outcome |
|---|---|---|---|
| Unresolved entity | `resolution_status !== "resolved"` | CLARIFY | "Which factor do you mean? [candidates]" |
| Suspicious entity match | Validator check #3 | CLARIFY | "Did you mean [X] or [Y]?" |
| Invalid tool output | Zod parse failure | REPAIR_ONCE | One repair attempt. Fail → ABORT |
| Handler precondition failure | Validator check #6 | RECOVER | "[Missing item]. [Fix path as chip]" |
| Stale analysis | Graph changed since last run | FLAG_STALE | "Results may not reflect your changes. [Rerun]" |
| PLoT/ISL outage | HTTP error/timeout | CIRCUIT_BREAK | "Analysis unavailable. [Retry]" |
| Repair failure | Zod failure after one retry | ABORT | Typed error with request ID |
| Compound partial | Only primary executed | CHIP_REMAINDER | Confirm primary + "[Next: secondary]" chip |
| LLM timeout | Budget exceeded | BUDGET_EXCEEDED | "Taking longer than usual. [Retry]" |
| Handler error | Handler throws typed error | HANDLER_ERROR | Error-specific message per handler type |
| Entity not found | Validator check #3 | ENTITY_NOT_FOUND | "Can't find [label]. [suggestions]" |
| Parameter invalid | Validator check #4 | PARAMETER_INVALID | "[Violation]. [Expected format]" |
| Computed parameter | Validator check #5 | PARAMETER_COMPUTED | Re-route to deterministic computation |
| Out-of-range value | Validator check #4 scale | PARAMETER_INVALID | "[Factor] uses [scale]. Did you mean [suggestion]?" |

**Actionable failure responses:** every validation failure and handler error uses per-code templates with `safeLabel()` helper (no internal IDs in user text), sanitised interpolated values (no raw Zod fragments), and a curated chip list (not raw handler registry).

---

## 8. System event enumeration

Layer 0 handles all system events deterministically. No system event reaches the LLM.

| Event type | Source | Action |
|---|---|---|
| `patch_accepted` | User accepts proposed change | Execute patch, acknowledge |
| `patch_dismissed` | User dismisses proposed change | Clear proposal state, acknowledge |
| `direct_graph_edit` | User edits graph on canvas | Update state, invalidate analysis if structural |
| `direct_analysis_run` | User clicks Play button | Invoke `run_analysis` handler directly |
| `chip_click` | User clicks suggested action | Route to handler per chip payload |
| `undo` / `redo` | User undoes/redoes | Revert/reapply state |
| `stage_transition` | Lifecycle stage changes | Update stage, adjust eligible actions |
| `selection_change` | User selects graph element | Update inspector context |
| `settings_change` | User modifies settings | Apply, acknowledge if material |
| `response_received` | Async PLoT/ISL result | Route to handler for processing |

Unrecognised event types: log `UNHANDLED_EVENT`, do not trigger LLM call. Table extended explicitly when new types are added.

---

## 9. Coaching architecture

### 9.1 Coaching mode classification

Per-turn classification via `coaching_mode` field. Four states defined in §5.

**Safety gate (Bastani PNAS 2025):** misclassifying coach-as-execute degrades user skill by 17%. Users cannot self-detect. Execute-when-should-coach and coach-when-should-execute measured independently with asymmetric harm tracking.

### 9.2 Coaching pass precedence

Step 5 of the turn assembly. Separate from and after handler execution.

1. Handler confirmation always first
2. At most one coaching signal per turn
3. No coaching on failed handler turns
4. Post-analysis narration precedence: decision_review present → review IS the coaching

### 9.3 Coaching triggers

Two coaching mechanisms, operating at different steps in the turn assembly:

**Step 5 coaching (action turns only): signal registry triggers.** Deterministic. Validated per §3 thresholds. Provide structured signals (`triggered_plays`) in ContextPack. Template-driven output. This is the only coaching mechanism that fires after handler execution.

**Step 1 coaching (non-action turns): routing prompt science-to-scenario matching.** On coach/converse/advise turns, Sonnet is the coaching engine. The routing prompt's SCIENCE_AND_COACHING section identifies coaching opportunities directly from ContextPack data and scientific knowledge. This is Sonnet's ORIENT output, not a Step 5 activity. Patterns include:
- Fragile or close result → consider-the-opposite, what-would-flip
- User dismisses a risk the model flags → pre-mortem
- Unchanged defaults on high-sensitivity factors → calibration
- All evidence pointing one way → consider-the-opposite
- Narrow confidence range on uncertain estimates → range elicitation
- Options sharing the same causal mechanism → option-generation
- User anchoring on first information → sensitivity-analysis
- Pre-commitment or strong signal → scenario-comparison

As the coaching context builder matures, it should emit signal registry entries for these patterns. Until then, the routing prompt is the coaching engine for non-action turns.

### 9.4 Coaching quality standard (Olumi move)

| Step | What it does | Detection method |
|---|---|---|
| Ground | Cite what triggered it | Deterministic: signal citation marker present |
| Quantify | Attach model evidence | LLM judge: is evidence correctly referenced? |
| Propose | Offer specific action | Deterministic: action chip present |
| Verify | Check understanding | LLM judge: appropriate follow-up? |

**Compliance levels:**
- Structured coaching (GuidanceItems, ReviewCardBlocks per AI Architecture v4.1): all four steps mandatory
- Conversational coaching (chat responses): Ground + Propose minimum; Quantify when data available

**PoC target:** ≥80% Olumi move compliance (Ground + Propose present per coaching turn)

**PoC exception:** `pre_mortem` and `dominant_factor_low_confidence` use LLM-generated coaching. All other signals use template-with-slots.

### 9.5 Coaching quality measurement

**Hybrid deterministic + LLM judge** (§15.2 for full detail):
- Deterministic checks for Ground (signal citation) and Propose (chip present)
- Sonnet judge for Quantify (evidence quality) and Verify (understanding check)
- Opus reserved for ~1% red-team calibration samples

**Cost:** ~£2/month at PoC (300 evals/month at 10% sampling)

### 9.6 Bias detection

**Bias evidence gate (enforced in routing prompt):** no named bias label without specific behavioural evidence from ContextPack. Describe patterns behaviourally, not diagnostically. Offer structured exercises (consider-the-opposite) rather than labelling.

**GTX bias sentinels:** GTX-021 (confirmation) plus 7 new examples for GTX v2.2:

| Bias | GTX ID | Core test |
|---|---|---|
| Confirmation | GTX-021 | User seeks validation |
| Anchoring | GTX-B01 | User fixates on initial estimate |
| Sunk-cost | GTX-B02 | User cites past investment |
| Availability | GTX-B03 | User generalises from vivid example |
| Survivorship | GTX-B04 | User draws from visible successes only |
| Overconfidence | GTX-B05 | User certain without evidence |
| Status-quo | GTX-B06 | User resists change despite model favouring it |
| Framing | GTX-B07 | Same situation, different frame |

Each sentinel expands to 10+ invariance/directional variants for production via CheckList methodology (Ribeiro et al. 2020).

---

## 10. Context pack design

Assembled fresh every turn from canonical state. Each turn is an independent assembly.

### Field ownership

| Field | Canonical owner | Source |
|---|---|---|
| `graph.*` | PLoT | CEE context assembler |
| `analysis.*` | PLoT (V2RunResponse) | CEE context assembler |
| `parsed_quantities` | Layer 0 (CQE) | CEE context assembler |
| `conversation.*` | Session store | CEE context assembler |
| `coaching.*` | Coaching context builder | CEE context assembler |
| `compound_detected` | Layer 0 | CEE context assembler |
| `system_event` | UI | CEE context assembler |
| `stage` | UI | CEE context assembler |

**Canonical source rule:** `ContextPack.graph` is assembled from canonical scenario state held in the CEE, not assumed to be fully present on the UI wire payload. The UI sends graph edits; the CEE maintains the authoritative graph and assembles the ContextPack from it.

### Schema

```typescript
interface ContextPack {
  version: "2.0",
  scenario_id: string,
  stage: "frame" | "ideate" | "evaluate" | "decide",

  graph: {
    nodes: Array<{ id, label, type, kind: EntityKind,
                    value?, value_source?, confidence?,
                    scale?: { min?: number, max?: number } }>,
    edges: Array<{ from_id, to_id, strength_mean, strength_std,
                   exists_probability, effect_direction }>,
    options: Array<{ id, label, is_baseline, interventions }>,
    goals: Array<{ id, label, target? }>,
    constraints: Array<{ id, label, type, threshold? }>,
    node_count, edge_count, option_count,
  },

  analysis: {
    status: "not_run" | "ready" | "stale",
    leading_option?: { id, label, probability },
    runner_up?: { id, label, probability },
    robustness_band?: "fragile" | "moderate" | "stable" | "highly_stable",
    top_drivers?: Array<{ id, label, sensitivity }>,
    fragile_edges?: Array<{ from_label, to_label }>,
    staleness_reason?: string,
  } | null,

  parsed_quantities: QuantityExtractionResult[],

  conversation: {
    recent_turns: Array<{ role, text, tool_call?, turn_id }>,
    turn_count, last_tool_used,
    pending_confirmation: { patch_id, description } | null,
  },

  coaching: {
    coaching_mode, primary_move, triggered_plays: string[],
    calibration_target?: { id, label } | null,
    critical_gap?: string | null,
  } | null,

  compound_detected: boolean,
  system_event: { type, payload } | null,
}
```

### Contract freeze status

These schemas are load-bearing across services and must not change without explicit version bump and cross-team coordination:

| Schema | Status | Referenced by |
|---|---|---|
| `ContextPack` (§10) | Frozen for PoC | CEE context assembler, routing prompt, harness |
| `QuantityExtractionResult` (§11.1) | v1.1 (additive `value_origin` field, 19 April 2026) | CQE module, routing prompt, harness |
| `RoutingLog` (§13.1) | Frozen for PoC | CEE logger, Supabase schema, harness |
| Tool-use enums (§5) | Frozen for PoC | Routing prompt, validator, harness |

---

## 11. Deterministic components

### 11.1 Quantity extraction (CQE) — Phase 2 critical path

**The problem:** users say "reduce by a third", "roughly double", "at least 80%". The LLM must not do arithmetic (F.6). Pre-parsed quantities must arrive as structured input before Sonnet sees the message.

**The finding:** no off-the-shelf tool (Duckling, compromise-numbers, Quantulum3) preserves directional modifiers. Olumi must own this layer.

**PoC design:** Custom CQE regex module as primary deterministic path, with compromise-numbers as numeric back-stop. Both in-process Node.js. Zero infrastructure, zero API cost, full F.6 compliance.

**Shared schema contract (v1.1):**

```typescript
interface QuantityExtractionResult {
  raw_text: string;
  value: number | null;
  unit: string | null;
  direction: "up" | "down" | "set" | "unknown" | null;
  multiplier: number | null;
  operator: ParameterOperator | null;
  comparator: "at_least" | "at_most" | "between" | null;
  range_min: number | null;
  range_max: number | null;
  approximate: boolean;
  source: "cqe" | "compromise" | "unparsed";
  value_origin?: "literal" | "lexical_quantifier" | "word_fraction" | "suffix_expansion" | "word_number" | "parsed_numeric";
}
```

`value_origin` (optional, added v1.1) declares how the value was derived. Routing prompt and validator use this to choose clarification strategy: confidently for `lexical_quantifier` (e.g. "couple → 2"), cautiously when value is null, trustingly for `literal`. Backward-compatible: consumers may ignore the field.

This schema is referenced by both the CQE module and the routing prompt. The prompt's PARAMETERS section teaches Sonnet to consume `parsed_quantities` in this exact shape.

**Test matrix (canonical patterns, full set in CQE Design v1):**

| Pattern | Key output fields |
|---|---|
| "set X to 0.9" | value: 0.9, operator: set, direction: set, value_origin: literal |
| "reduce by a third" | value: 0.333, operator: decrement, direction: down, value_origin: word_fraction |
| "roughly double" | multiplier: 2.0, operator: multiply, approximate: true |
| "increase by about 10%" | value: 0.10, operator: increment, direction: up, unit: percentage, approximate: true |
| "increase by 5 percentage points" | value: 5, unit: percentage_points, operator: increment, direction: up |
| "the budget is £150k" | value: 150000, unit: GBP, operator: set, value_origin: suffix_expansion |
| "between 5 and 10" | range_min: 5, range_max: 10, comparator: between |
| "from 200k to 150k" | value: 150000, range_min: 200000, range_max: 150000, operator: set |
| "4 months" | value: 4, unit: months |
| "at least 3 senior developers" | value: 3, comparator: at_least |
| "70% confidence" | value: 0.70, unit: percentage |
| "a couple of factors" | value: 2, approximate: true, value_origin: lexical_quantifier |
| "a few options" | value: null, approximate: true, value_origin: lexical_quantifier |

Note on "reduce by a third": maps to `operator: decrement` (subtract one-third, leaving two-thirds) rather than `operator: multiply` (which reads as "multiply by one-third, leaving one-third"). Both are valid encodings since the deterministic layer computes the final value, but `decrement` is unambiguous for typical business usage.

**Pattern set:** 13 ordered regex patterns plus a word-number lexicon pre-pass and compromise-numbers backstop. Full algorithm, rule table, and 50+ test fixtures specified in CQE Design v1.

**Failure mode:** when CQE can't match, raw message passes through with `source: "unparsed"`. Sonnet interprets intent but does not compute arithmetic. Missed parse is recoverable; wrong computation is not.

**Dependency chain:** Routing prompt locked → QuantityExtractionResult schema locked → CQE brief dispatched → CC implements → Harness fixtures updated with schema-conformant parsed_quantities.

**Production upgrade:** Haiku as selective fallback when telemetry shows creative phrasings the deterministic path misses. JSON-schema validation + fail-closed. Only deploy when measured miss rate exceeds threshold.

### 11.2 Compound intent detection — Phase 2

**PoC design:** keep and iterate current regex heuristic with:
1. Noun-conjunct stop-list (~20 entries): "research and development", "sales and marketing", "profit and loss", etc.
2. Imperative-verb anchor requirement: compound only fires when both sides of "and"/"then"/"also" have an action verb
3. Telemetry: log every positive match with `compound_pattern_matched`

**Accuracy target:** false-positive rate <15% on GTX examples + 10 negative examples.

**Upgrade trigger:** stop-list exceeds ~30 terms or measured FP rate exceeds 15%. Upgrade to wink-nlp (Universal POS tags, 650k tokens/sec, ~10KB gzipped, zero network). wink-nlp distinguishes VERB+CCONJ+VERB (compound) from NOUN+CCONJ+NOUN (single action).

**Why not spaCy:** accuracy gain doesn't justify Python sidecar at PoC volumes.

### 11.3 Entity resolution — Phase 3 experiment, production upgrade

**PoC: keep Dice.** Bigram Dice works for exact and partial label matches on 10-50 node graphs. Validator's plausibility check prevents silent wrong resolution.

**Where Dice fails:** semantic synonyms. "The speed thing" → "Delivery Speed" (weak ~0.35), "dev pace" → "Engineering Velocity" (zero). These are real user patterns from GTX.

**Prompt mitigation (v6):** partial label overlap rule. When two nodes share a primary keyword that could plausibly be what the user meant, clarify rather than resolve. Validator independently checks for partial overlap.

**Phase 3 bake-off:**

| Option | Latency | Cost/month (100k turns/day) |
|---|---|---|
| Dice (current) | <1ms | £0 |
| Voyage voyage-3.5-lite | ~15ms | £0 (free tier) |
| OpenAI text-embedding-3-small | ~15ms | ~£0.50 |
| Transformers.js + e5-small | ~15-20ms | £0 (in-process) |

**Production decision:** ship cheapest option that materially improves top-1 accuracy over Dice. Hosted APIs dramatically cheaper than self-hosting. Voyage natural choice (Anthropic partnership, free tier).

**Hybrid scoring:** `α·cosine + (1−α)·Dice` where Dice serves as fast pre-filter and tiebreaker.

**Upgrade trigger:** entity resolution errors exceed 5% on production traffic, or informal-reference failures appear in transcript reviews.

---

## 12. Handler registry

| Handler | Phase | Status | PLoT call | Invalidates analysis | Entity kinds |
|---|---|---|---|---|---|
| `run_analysis` | C2 | Shipped | `/v2/run` | No (produces analysis) | N/A (global) |
| `set_factor_value` | D1 | Shipped | No | Yes, scoped | `factor` |
| `add_constraint` | D1 | Shipped | No | Yes, scoped | `factor`, `outcome`, `goal`, `risk` |
| `adjust_edge_strength` | D1 | Shipped | No | Yes, scoped | `edge` |
| `draft_graph` | V4 re-use | Wrapped | CEE internal | Yes, full | N/A (global) |
| `edit_graph` | V4 re-use | Wrapped | CEE internal | Yes, scoped | All kinds |
| `explain_results` | E1 | Planned | CEE internal LLM | No | N/A (global) |
| `compare_options` | E1 | Planned | CEE internal LLM | No | `option` |
| `generate_brief` | E1 | Planned | PLoT assembleBrief() | No | N/A (global) |

**Handler contract:** every handler declares accepted EntityKind values, parameter schema (Zod, registered in the CEE handler registry), required preconditions, analysis invalidation scope, and confirmation template. The §6 validator uses the handler's Zod schema for check #4 parameter validation.

**V4 pipeline scope:** `draft_graph` and `edit_graph` V4 implementations run as-is within V5. V5 provides routing boundary (tool-use schema), validation boundary (§6), and persistence boundary (append_turn_atomic). No re-implementation in PoC.

---

## 13. Logging and evaluation

### 13.1 Routing log schema

Every turn produces a log entry. Structural, not optional.

```typescript
interface RoutingLog {
  log_id, turn_id, scenario_id, timestamp,

  // Input
  context_pack_version, raw_user_message: string | null,
  redacted: boolean, parsed_quantities,
  compound_detected, graph_node_count, graph_edge_count, stage,
  graph_lookup_outcome: "hit" | "stale" | "absent" | "error",

  // Sonnet output
  sonnet_text_hash, tool_call: object | null,
  tool_call_present: boolean,
  intent_class, coaching_mode, handler_id,
  intent_class_source: "tool_call" | "coaching_context" | "heuristic" | "default",
  coaching_mode_source: "tool_call" | "coaching_context" | "heuristic" | "default",
  target_entity_id, resolution_status, resolution_method,

  // Validation
  validation_passed, validation_failure_reason,

  // Downstream
  handler_executed, handler_outcome: "success" | "error" | null,
  user_next_action, user_accepted: boolean | null,
  coaching_delivered, coaching_signal_id,

  // Label quality
  label_tier: "validated" | "accepted" | "unreviewed",
}
```

**Source field semantics:**
- `tool_call`: value emitted directly by Sonnet via `olumi_action`
- `coaching_context`: derived from validated `ContextPack.coaching.coaching_mode`
- `heuristic`: derived from ContextPack state per §4 inference rules
- `default`: fallback when no signal applies

**`graph_lookup_outcome`:** `hit` = graph present and current; `stale` = present but staleness flagged; `absent` = no graph in ContextPack; `error` = graph fetch/assembly failed. Captures Phase 1.5 graph-threading bug class for first-class debugging.

**Label tier rules:** `validated` = human-reviewed or GTX-matched gold; only validated enters fine-tuning. `accepted` = user behaviour acceptance (no undo within 2 turns), not yet human-reviewed; candidate for review. `unreviewed` = raw Sonnet output, never enters training directly.

**Redaction policy:** `redacted: true` when PII consent flag is false. `raw_user_message` is null when redacted; structured fields (tool call, intent, entity) are always logged regardless.

### 13.2 Routing log persistence

**Current: JSONL.** Supabase Postgres migration in Phase 4 when handlers ship and log volume justifies it.

**Supabase schema (ready for Phase 4):** indexed columns (intent_class, coaching_mode, validation_passed, handler_id, created_at) and JSONB for full log payload. Volume: 100 turns/day → 6MB/month. 10k turns/day → 6GB/month. Use Pro ($25/month) from day one to avoid Free tier idle pauses.

### 13.3 PoC shortcut telemetry

| Signal | Action threshold |
|---|---|
| `compound_truncation_rate` | >20% → revisit compound rule |
| `entity_clarification_rate` | >30% → investigate resolution quality |
| `coaching_mode_override_rate` | >10% → review classification |
| `repair_attempt_rate` | >5% → investigate prompt quality |

### 13.4 Evaluation harness

Four-layer evaluation (implemented as v5-evaluation-harness-v2.py):

| Layer | What | Method | Judge |
|---|---|---|---|
| A | Schema conformance | Deterministic | Code |
| B | Routing accuracy vs GTX | Per-field comparison | Code |
| C | Coaching quality | LLM rubric (7 dimensions) | Opus 4.6 |
| D | Behavioural compliance | Text checks | Code + regex |

**Scoring:** per-field, per-category, per-stage. Asymmetric error weights (wrong entity = 10x, coach-as-execute = 7x, generic coaching = 2.5x). Confusion matrix for coaching mode. Validator catch-rate analysis. Stochastic instability flags.

**Three suite modes:** smoke (10 cases, no judge, ~£0.50), gate (all fixtures, 3 runs, judge, ~£5-8), shadow (production traces, no threshold).

**Gate-mode pass/fail:** gate fails if any §14 target is breached by >5% absolute. Reviewer can override with documented justification.

**GitHub Actions integration:** `eval-on-pr.yml` triggers on `src/routing/**` or `prompts/**` changes. `eval-nightly.yml` runs against staging.

### 13.5 Transcript review

**PoC:** Supabase Studio saved filters. Zero build cost.

**Upgrade trigger:** volume exceeds ~5k traces/month, or third reviewer joins. At that point: Braintrust free tier (1M spans) or Langfuse Cloud Hobby ($29/month).

---

## 14. PoC evaluation targets

### Per-field routing evaluation

| Metric | Target |
|---|---|
| Intent accuracy | ≥90% |
| Coaching mode accuracy | ≥85% |
| Entity resolution accuracy | ≥90% |
| Parameter extraction accuracy | ≥85% |
| Compound detection | ≥90% |
| Latency p95 (LLM call) | <2.5 seconds |
| Latency p95 (end-to-end) | <4 seconds |

**v6 prompt baseline (from testing):** Layer A 100%, Layer B 99%+ on core GTX, Layer D ~93%.

### Coaching quality evaluation

| Metric | Target |
|---|---|
| Olumi move compliance (Ground + Propose) | ≥80% |
| Coaching acceptance rate | Baseline during PoC |
| Signal trigger correctness | Per-signal, per §3 thresholds |

**Coaching acceptance rate is not coaching quality.** Human transcript review remains in the evaluation loop.

---

## 15. Target architecture (post-PoC)

When GTX data and real traffic justify it, Layer 1 splits:

- **L1a:** ModernBERT-base encoder (~5ms CPU, 92-95% accuracy)
- **L1b:** Conformal prediction (MAPIE/crepes, APS at 90% coverage, 500-1000 held-out calibration examples)
- **L1c:** e5-small or Voyage embeddings for entity resolution
- **L1d:** Sonnet only for genuinely ambiguous cases

### Fine-tuning pipeline

| Component | Choice |
|---|---|
| Base model | ModernBERT-base (150M params) |
| Training | Full fine-tune (not LoRA; model is small enough), AdamW, lr=2e-5, 10-20 epochs, 5 seeds |
| Calibration | Class-conditional APS via MAPIE/crepes |
| Export | ONNX opset 17, INT8 dynamic quantisation |
| Hosting | Render CPU Pro (~£85/month) or HF Inference Endpoints CPU x4 (~£98/month) |
| Integration | Separate FastAPI microservice on Render private network (1-5ms intra-datacentre) |

Timeline: 3-4 weeks from 300 labelled examples.

### Upgrade triggers

| Trigger | Action |
|---|---|
| Inference spend exceeds £5k/month | Evaluate encoder tier ROI |
| GTX reaches 300+ examples per class | Fine-tune ModernBERT |
| Entity resolution errors exceed 5% | Add retrieval tier |
| Self-hosting break-even | ~£10k/month API spend |

### Cost at scale (100k turns/day)

| Architecture | Monthly cost |
|---|---|
| Single-call Sonnet every turn | ~£30,000 |
| Tiered (encoder + Sonnet escalation) | ~£15,000-20,000 |
| Full deterministic + encoder + Sonnet fallback | ~£3,500-6,000 |

---

## 16. PoC cost summary

| Component | PoC monthly |
|---|---|
| CQE + compromise (in-process) | £0 |
| Compound detection (in-process) | £0 |
| Entity resolution (Dice, in-process) | £0 |
| Routing logs (JSONL, in-process) | £0 |
| Supabase Pro (Phase 4 migration) | £25 (when migrated) |
| GitHub Actions (eval harness) | £0 |
| Coaching judge (Sonnet, 10% sampling) | ~£2 |
| Sonnet routing (every turn) | ~£30 |
| **Total (PoC)** | **~£32** |

---

## 17. Status legend

This document mixes operational reality, locked design, PoC shortcuts, and production upgrade paths. Each tagged item below uses one of four statuses:

| Tag | Meaning |
|---|---|
| **Shipped** | Implemented, tested, in production code path |
| **Locked design** | Specification approved; implementation in flight or pending |
| **PoC shortcut** | Acceptable simplification for PoC; production upgrade path defined |
| **Production upgrade path** | Future work; trigger conditions specified |

Areas explicitly tagged in v3.2:

| Area | Status | Notes |
|---|---|---|
| Non-action turn classification (§4) | Locked design | Algorithm normative; Component 2 design provides implementation detail |
| Out-of-range validator enforcement (§6 check #4) | PoC shortcut → Locked design | Default-scale registry converts partial check to full check; PLoT-derived scales are production upgrade |
| Transcript review tooling (§13.5) | PoC shortcut | Manual review for PoC; automated tooling post-pilot |
| Supabase migration for routing logs (§13.2) | Production upgrade path | JSONL for PoC; Supabase Phase 4 |
| Coaching context builder validation (§3) | Locked design (validation pending) | Must validate against GTX before consumption per §3 thresholds |
| ModernBERT encoder tier (§15) | Production upgrade path | Trigger: inference >£5k/month or GTX ≥300 examples per class |
| Entity resolution semantic upgrade (§11.3) | Production upgrade path | Dice for PoC; bake-off Phase 3 |

Untagged sections are operational/Shipped or self-contained design decisions.

---

## 18. What this document does not cover

- Prompt content — routing prompt v6 (separate PMS artefact)
- GTX examples — GTX v2.1 (frozen evaluation data)
- Execution plan — V5 Implementation Plan v2.3.1
- Cross-service boundary enforcement — Boundary Contract v1.1
- UI rendering — Design System v5
- PLoT/ISL compute contracts — V3 Platform Contract v4
- CC brief standards — CC Development Standards v3
- Signal registry content — AI Architecture v3 Signal Registry Addendum v3

---

## Appendix A: Changes from v2

### Merged from Deterministic Components Design v1

| Section | Content merged |
|---|---|
| §11 | Deterministic components (CQE, compound detection, entity resolution) |
| §13.4 | Evaluation harness design from testing work |
| §15 | Fine-tuning pipeline details |
| §16 | Cost summary |

### Changes from prompt testing (v4→v6 benchmark)

| Section | Change | Source |
|---|---|---|
| §3 Layer 3 | Added non-action-turn compose step | Forbidden language violations in ~7% of responses |
| §4 | Added non-action turn flow (steps 2-4 skipped) | Architecture clarification |
| §6 check #3 | Added partial label overlap check | ADV-001: "Delivery Speed" vs "Delivery Velocity" |
| §6 check #4 | Added out-of-range scale check with scale metadata dependency | GTX-034: value 500 on 0-1 factor |
| §7 | Added out-of-range failure state | Phase 1.5 compose-layer brief |
| §9.3 | Science-to-scenario coaching triggers | Prompt v6 SCIENCE_AND_COACHING |

### Changes from ChatGPT review of v3

| Section | Change | Source |
|---|---|---|
| §4 Step 5 | Coaching pass is deterministic signal registry only; science-to-scenario lives in Step 1 ORIENT | §4 vs §9.3 contradiction |
| §4 | Added non-action turn classification contract | Missing contract for text-only turns |
| §6 check #3 | Validator declared authoritative over prompt for entity resolution | Governance gap |
| §6 check #4 | Out-of-range check depends on explicit `scale` metadata; skips when absent | Missing schema support |
| §9.3 | Separated Step 5 (deterministic) from Step 1 (Sonnet) coaching | Consistency with §4 fix |
| §10 | Added `scale` field to graph node schema | Required by §6 check #4 |
| §10 | Added canonical-source rule for graph assembly | Phase 1.5 bug history |
| §10 | Added contract freeze status table for shared schemas | Governance |
| §12 | Split Status into Phase + Status columns | Clarity |
| §12 | Fixed `add_constraint` entity kinds to `goal`, `constraint` | Inconsistency with prompt |
| §12 | Added parameter schema (Zod) reference | Missing link for §6 check #4 |
| §12 | Marked D1 handlers (`set_factor_value`, `add_constraint`, `adjust_edge_strength`) as Shipped; previous "Planned" status was stale (slice delivered via `feat(v5/d1)` commit series, with A3.1 follow-up tasks 1–5 and two rounds of review nits; latest D1-touching commit `8f0dc939`) | Doc drift surfaced by D1 audit |
| §12 | Expanded `add_constraint` accepted entity kinds from `goal`, `constraint` to `factor`, `outcome`, `goal`, `risk` to match live allowlist (A3.1 Task 5 added `risk` targets) | Doc drift vs `src/orchestrator-v5/tools/handlers/add-constraint.ts` |
| §13.1 | Fixed label-tier definitions (validated = human-reviewed or GTX gold) | Overlap between tiers |
| §13.1 | Added redaction policy | GDPR-sensitive field undefined |
| §13.2 | Fixed logging persistence: JSONL now, Supabase Phase 4 | Contradictory statements |
| §13.4 | Added gate-mode pass/fail threshold (>5% breach) | Missing governance |

---

*End of v3*
