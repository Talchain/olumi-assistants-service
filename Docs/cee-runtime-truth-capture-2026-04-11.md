# CEE Runtime Truth Capture

**Date:** 11 April 2026
**Commit:** staging HEAD
**PMS:** Supabase (`PROMPTS_STORE_TYPE=supabase`, `PROMPTS_USE_STAGING=True`)

---

## 1. v100 Confirmation (Priority 1)

**v100 IS confirmed as the active staging prompt.**

Queried `GET /admin/prompts/orchestrator_default` with `X-Admin-Key` header.

| Field | Value |
|-------|-------|
| id | `orchestrator_default` |
| taskId | `orchestrator` |
| status | `production` |
| **activeVersion** | **100** |
| **stagingVersion** | **100** |
| modelConfig.staging | `claude-sonnet-4-6` |
| modelConfig.production | `claude-sonnet-4-6` |
| Total versions | 100 |
| v100 chars | 68,444 |
| v100 createdBy | `admin-ui` |
| v100 createdAt | `2026-04-10T23:01:29.287+00:00` |
| v100 changeNote | `v34d` |

### v34d Section Tags in v100 (23 total)

`ROLE`, `PRIMARY_RULES`, **`RUNTIME_CONSTRAINTS`**, `STATE_GROUNDING`, `UI_AWARENESS`, `GRAPH_SAFETY`, `RESPONSE_MODES`, `STAGE_BEHAVIOUR`, `SCIENCE`, `COACHING`, `EVIDENCE_HANDLING`, **`DECISION_LANGUAGE`**, `TOOLS`, `OUTPUT_CONTRACT`, `COACHING_PLAYS`, `SYSTEM_EVENTS`, `BANNED_TERMS`, `NUMBER_FORMAT`, `DECISION_REVIEW`, `UNTRUSTED_POLICY`, `DIAGNOSTICS`, `ANNOTATED_EXAMPLES`, `FINAL_REMINDERS`

### v34d Tag Verification

| Tag | Present in v100? | Char Position |
|-----|-----------------|---------------|
| `<RUNTIME_CONSTRAINTS>` | **YES** | char 4349 |
| `<DECISION_LANGUAGE>` | **YES** | char 29916 |
| `BIAS EVIDENCE GATE` | **NO** — not a v34d addition | — |
| `PREDICTION ELICITATION` | **NO** — not a v34d addition | — |

**Conclusion:** RUNTIME_CONSTRAINTS and DECISION_LANGUAGE were the actual v34d additions. BIAS EVIDENCE GATE and PREDICTION ELICITATION were never part of v34d — they were either planned for a future version or referenced from a different context.

---

## 2. Experimental Flag Audit (Question 1)

### BIL_ENABLED (Brief Intelligence Layer)

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.bilEnabled` / `BIL_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | Runs deterministic brief extraction (~50ms) on every turn. On frame/ideate, injects `<BRIEF_ANALYSIS>` into user message with: completeness band, detected elements (goal, options, constraints, factors), missing elements, DSK cues |
| **Files** | `turn-handler.ts:545-569`, `parallel-generate.ts:165-175`, `prompt-zones/zone2-blocks.ts:389-463`, `brief-intelligence/extract.ts` |
| **Modifies** | (a) System prompt: YES (Zone2 BIL_CONTEXT/BIL_HINT blocks) (b) Dynamic block: NO (V4 path) (d) Response: NO (f) Extra LLM: NO |
| **V4 path impact** | **IMPORTANT: BIL is wired into turn-handler.ts (V1 path) and parallel-generate.ts, NOT into pipeline-v4.ts. On the V4 streaming path, BIL extraction does NOT run.** |
| **Quality** | Positive when active — provides pre-computed brief analysis for coaching decisions |
| **Latency** | <50ms (deterministic) |
| **Recommendation** | **Keep enabled.** But note: currently only active on V1/V2 paths. V4 pipeline does not use BIL. No harm, no benefit on V4. |

### DSK_ENABLED (Decision Science Kit)

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.dskEnabled` / `DSK_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | Loads `/data/dsk/v1.json` at startup. Bundle contains cognitive bias triggers, decision science protocols. Used during BIL extraction to match triggers to brief text, producing `dsk_cues` |
| **Files** | `dsk-loader.ts:43-172`, `brief-intelligence/extract.ts:16`, `decision-review/science-claims.ts:39` |
| **Modifies** | Indirectly via BIL dsk_cues → DSK coaching items on envelope |
| **V4 path impact** | Same as BIL — DSK queries run during BIL extraction, which doesn't run on V4 |
| **Quality** | Positive (enables bias detection) |
| **Latency** | <5ms (bundle query) |
| **Recommendation** | **Keep enabled.** Prerequisite for DSK_COACHING_ENABLED. No V4 impact currently. |

### DSK_COACHING_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.dskCoachingEnabled` / `DSK_COACHING_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | Surfaces DSK bias alerts and technique recommendations on the response envelope as `dsk_coaching` field |
| **Files** | `dsk-coaching/assemble-coaching-items.ts:16-51`, `turn-handler.ts:558`, `envelope.ts:61,116-117` |
| **Modifies** | (d) Response post-processing: YES — adds `dsk_coaching` field to envelope |
| **V4 path impact** | Not wired into V4 pipeline — `dsk_coaching` field not assembled in `assembleV4Envelope()` |
| **Dependencies** | HARD: requires BIL_ENABLED=true AND DSK_ENABLED=true |
| **Recommendation** | **Keep enabled.** No V4 impact. When V4 is the only path, these three flags (BIL, DSK, DSK_COACHING) are effectively dead code. |

### CEE_ZONE2_REGISTRY_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.zone2Registry` / `CEE_ZONE2_REGISTRY_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | Completely replaces system prompt assembly with Zone 2 block registry. Selects a profile based on TurnContext, filters/renders blocks (STAGE_CONTEXT, GRAPH_STATE, ANALYSIS_STATE, BIL_CONTEXT, etc.), applies budget trimming if >120KB |
| **Files** | `turn-handler.ts:564-610`, `parallel-generate.ts:319-343`, `prompt-zones/zone2-blocks.ts`, `prompt-zones/assemble.ts` |
| **Modifies** | (a) System prompt: YES — REPLACES entire prompt with Zone2 assembly. (b) Dynamic block: YES — 9+ blocks. (e) Turn routing: indirect (changes message assembly) |
| **V4 path impact** | **NOT used on V4.** Zone2 assembly runs in turn-handler.ts (V1) only. V4 uses `buildDeterministicPromptV2()` which is completely independent of Zone2. |
| **Recommendation** | **Keep enabled** (no V4 impact). Legacy V1 path uses it when active. |

### GROUNDING_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.grounding` / `CEE_GROUNDING_ENABLED` or `GROUNDING_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | Enables attachment processing (PDF, TXT, CSV) on `/assist/draft-graph` and `/assist/critique-graph` routes. Extracts text up to 5k chars/file, 50k aggregate. Returns `DocPreview[]` |
| **Files** | `routes/assist.draft-graph.ts:626`, `routes/assist.critique-graph.ts:71` |
| **Modifies** | (d) Response: YES (adds `docs[]` to orchestrator context) |
| **V4 path impact** | **Grounding affects the draft-graph REST route, not the orchestrator V4 streaming path.** When the orchestrator calls `handleDraftGraph()`, grounding may have already processed attachments upstream. |
| **Latency** | +50-200ms per attachment |
| **Recommendation** | **Keep enabled.** Only activates when attachments present. |

### CEE_CLARIFIER_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.cee.clarifierEnabled` / `CEE_CLARIFIER_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | In-pipeline Stage 4 clarifier. Fires AFTER draft_graph (during repair stage), NOT before. When `clarifier_response` is provided, calls LLM to integrate answer into graph, recomputes quality, checks convergence |
| **Files** | `cee/validation/pipeline.ts:59-79`, `cee/unified-pipeline/stages/repair/clarifier.ts:21` |
| **Modifies** | (f) Additional LLM calls: YES — 1-3 round-trips per clarification round |
| **V4 path impact** | Affects the draft_graph tool handler (which V4 delegates to). When V4 calls `handleDraftGraph()`, the unified pipeline includes the clarifier stage. |
| **Latency** | +500-1500ms per clarification round |
| **Recommendation** | **Keep enabled.** Improves draft quality through iterative refinement. Only fires when clarifier_response provided. |

### CEE_PREFLIGHT_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.cee.preflightEnabled` / `CEE_PREFLIGHT_ENABLED` |
| **Default** | false |
| **Staging** | **true** (with `CEE_PREFLIGHT_STRICT=false`) |
| **What it does** | Runs before draft-graph LLM call. Policy ladder: (1) reject gibberish with 400, (2) clarify underspecified briefs if strict=true, (3) proceed with optional advisory. Deterministic — no LLM call |
| **Files** | `routes/assist.v1.draft-graph.ts:289`, `routes/assist.v1.draft-graph-stream.ts:251` |
| **Modifies** | (e) Turn routing: YES — can reject or redirect before LLM |
| **V4 path impact** | Affects the draft-graph REST route. V4 delegates to `handleDraftGraph()` which calls the unified pipeline — preflight runs as part of that pipeline. |
| **Latency** | +10-20ms (deterministic) |
| **Recommendation** | **Keep enabled with `STRICT=false`.** Catches gibberish without blocking legitimate briefs. |

### CEE_BRIEF_DETECTION_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.briefDetectionEnabled` / `CEE_BRIEF_DETECTION_ENABLED` |
| **Default** | false |
| **Staging** | **true** |
| **What it does** | On first turn (no graph), if message looks like a decision brief, routes directly to `draft_graph` deterministically. Skips LLM intent classification. |
| **Files** | `turn-handler.ts:263`, `pipeline/pipeline.ts:309`, `pipeline/pipeline-stream.ts:169` |
| **Modifies** | (e) Turn routing: YES — deterministic brief → draft_graph |
| **V4 path impact** | **NOT used on V4.** Brief detection is in `classifyIntentWithContext()` which runs in the V1/V2 intent gate. V4 pipeline receives the tool call from the LLM, not from intent classification. |
| **Latency** | Saves ~100-300ms (skips intent LLM call) |
| **Recommendation** | **Keep enabled** (no V4 impact). Beneficial on V1/V2 paths. |

### CRITIQUE_ENABLED

| Aspect | Detail |
|--------|--------|
| **Config** | `config.features.critique` / `CRITIQUE_ENABLED` |
| **Default** | true |
| **Staging** | **true** |
| **What it does** | Enables `/assist/critique-graph` endpoint. Accepts graph + brief + optional attachments, invokes LLM with `critique_graph` prompt, returns critique envelope with findings. |
| **Files** | `routes/assist.critique-graph.ts:44` |
| **Modifies** | Endpoint availability only. Separate from orchestrator pipeline. |
| **V4 path impact** | **None.** Critique is a standalone endpoint, not part of the orchestrator pipeline. |
| **Latency** | +500-2000ms per critique request (separate LLM call) |
| **Recommendation** | **Keep enabled.** On-demand only, no pipeline impact. |

### Summary: V4 Impact Matrix

| Flag | Active on V4 Path? | Action |
|------|-------------------|--------|
| BIL_ENABLED | **NO** (V1/V2 only) | Keep — no harm |
| DSK_ENABLED | **NO** (via BIL) | Keep — no harm |
| DSK_COACHING_ENABLED | **NO** (V1/V2 only) | Keep — no harm |
| CEE_ZONE2_REGISTRY_ENABLED | **NO** (V1 only) | Keep — no harm |
| GROUNDING_ENABLED | Indirect (draft-graph route) | Keep |
| CEE_CLARIFIER_ENABLED | **YES** (via handleDraftGraph) | Keep |
| CEE_PREFLIGHT_ENABLED | **YES** (via draft-graph pipeline) | Keep |
| CEE_BRIEF_DETECTION_ENABLED | **NO** (V1/V2 intent gate) | Keep — no harm |
| CRITIQUE_ENABLED | **NO** (standalone endpoint) | Keep |

**Key insight:** Of 9 experimental flags, only 2 (CLARIFIER, PREFLIGHT) actually affect the V4 pipeline. The other 7 are V1/V2-path features that have zero impact when `CEE_PIPELINE_V4_ENABLED=true`.

---

## 3. Dynamic Block Annotated Template (Question 2)

### Assembly Function

`src/orchestrator/deterministic/prompt-builder-v2.ts:177-322` — `buildStateSection(ctx)`

The dynamic block is **completely independent of all experimental flags**. No flag checks exist in `buildStateSection()` or `buildDeterministicPromptV2()`.

### Field Reference

| Field | Condition | Format | LLM Coaching Signal |
|-------|-----------|--------|---------------------|
| Stage | Always | `Stage: **{stage}**` | Current lifecycle phase |
| Model summary | node_count > 0 | `Model: {n} nodes, {e} edges, {o} options` | Graph maturity |
| Model empty | node_count === 0 | `Model: not yet created` | Needs drafting |
| Goal | goal_label exists | `Goal: {label}` | Decision framing |
| Option labels | option_labels.length > 0 | `Options: {labels, joined}` | Current alternatives |
| Factors | entities with kind=factor | `Factors: {label} ({id}, {category}, value: {v} {unit}), ...` | What's modelled |
| Options (detailed) | entities with kind=option | `Options: {label} ({id}), ...` | Option IDs for tool calls |
| Analysis winner | analysis_summary.winner | `Winner: {name} ({prob}%)` | Leading option |
| Runner-up | analysis_summary.runner_up | `Runner-up: {name} ({prob}%)` | Alternative |
| Robustness | robustness_band | `Robustness: {band}` | Result stability |
| Constraint tensions | tensions.length > 0 | `Constraint tensions: {joined by '; '}` | Constraint conflicts |
| Key drivers | factor_sensitivity (top 3) | `- {label} — influence {%} — confidence: {band}` | What matters most |
| Fragile edges | fragile_edges (top 3) | `- {label} — switch probability {%}` | Weak links |
| Robustness detail | edge_e_values | `- {label} — e-value {v} ({fragile/robust})` | Edge reliability |
| Conditional results | conditional_winners | `- Under {scenario}: {winner} ({%})` | Flip conditions |
| Inference warnings | warnings (max 5) | `- {warning text}` | Data quality |
| Signals | any signal true | `Signals: {parts, joined}` | Coaching triggers |
| Blockers | blockers.length > 0 | `Blockers: {reasons, joined}` | Action blockers |
| Conversation | turn_count > 0 | `Conversation: {n} messages` | Session depth |
| Pending confirmation | pending_confirmation set | `Pending confirmation: {text}` | Awaiting user |
| Disambiguation | hints.length > 0 | Separate section with `---` separator | Ambiguous references |

### Example: FRAME (no graph, no analysis)

```
## Current Decision State
Stage: **frame**
Model: not yet created
```

**67 chars, ~20 tokens**

### Example: IDEATE (graph, no analysis)

```
## Current Decision State
Stage: **ideate**
Model: 8 nodes, 10 edges, 2 options
Goal: Best hiring strategy
Options: Hire tech lead, Hire two developers
Factors: Cost per developer (f-1, Expense, value: 150000 USD), Time to productivity (f-2, Timeline, value: 6 months), Team stability (f-3, Risk), Technical depth (f-4, Capability, value: 8 scale 1-10)
Options: Hire tech lead (opt-1), Hire two developers (opt-2)

Signals: 2 default values, 1 weak edge
Conversation: 3 messages
```

**~573 chars, ~165 tokens**

### Example: EVALUATE (graph + fresh analysis)

```
## Current Decision State
Stage: **evaluate**
Model: 8 nodes, 10 edges, 2 options
Goal: Best hiring strategy
Options: Hire tech lead, Hire two developers
Factors: Cost per developer (f-1, Expense, value: 150000 USD), Time to productivity (f-2, Timeline, value: 6 months), Team stability (f-3, Risk), Technical depth (f-4, Capability, value: 8 scale 1-10)
Options: Hire tech lead (opt-1), Hire two developers (opt-2)

**Analysis Results:**
Winner: Hire tech lead (72%)
Runner-up: Hire two developers (28%)
Robustness: Medium

### Key drivers
- Cost per developer — influence 42% — confidence: High
- Time to productivity — influence 28% — confidence: Medium
- Technical depth — influence 18% — confidence: Medium

### Fragile relationships
- Cost per developer → Team stability — switch probability 18%
- Market disruption → Technical depth — switch probability 12%

### Robustness detail
- Cost → Stability — e-value 2.40 (fragile)
- Disruption → Depth — e-value 1.80 (fragile)
- Productivity → Goal — e-value 5.60 (robust)

### Conditional results
- Under Cost drops by 30%: Hire tech lead (88%)
- Under Timeline extends to 12 months: Hire two developers (55%)

### Inference warnings
- Team stability inferred from historical data; consider validating with stakeholders
- Market disruption uses external projection; consider scenario analysis

Signals: close call (tight margin), dominant factor: Cost per developer, 1 default value, 1 high-uncertainty factor
Conversation: 8 messages
```

**~1,486 chars, ~430 tokens**

---

## 4. Full Assembled Prompt — EVALUATE Turn (Question 3)

### Composition

| Component | Chars | Est. Tokens | Source |
|-----------|-------|-------------|--------|
| v100 static block | 68,444 | ~17,100 | Supabase PMS → `loadPrompt('orchestrator', {useStaging: true})` |
| RUNTIME_TOOL_USE_SUFFIX | 343 | ~85 | `prompt-audit.ts:129-134` |
| Separator (`\n\n---\n\n`) | 7 | ~2 | `pipeline-v4.ts:310` |
| Dynamic block (EVALUATE) | 1,486 | ~430 | `buildStateSection(ctx)` |
| **Total** | **70,280** | **~17,570** | |

Full assembled prompt saved to: `docs/assembled-prompt-evaluate-turn.txt`

### Contradiction Analysis

#### Does OUTPUT_CONTRACT appear in v100?

**YES.** `<OUTPUT_CONTRACT>` is present in v100 (68,444 chars). It's a 6,144-char section that instructs the LLM to wrap ALL responses in XML envelopes:

```
<diagnostics>[...]</diagnostics>
<response>
  <assistant_text>[...]</assistant_text>
  <blocks>[...]</blocks>
  <suggested_actions>[...]</suggested_actions>
</response>
```

With rules like:
- "The message must begin with `<diagnostics>`. No leading text."
- "No content outside `<diagnostics>` and `<response>`."
- "All free-text content must use XML escaping"

#### Does RUNTIME_TOOL_USE_SUFFIX contradict OUTPUT_CONTRACT?

**YES — DIRECT CONTRADICTION.**

The suffix says:
> `[Runtime context: This system uses native tool calling. Respond in plain text. No XML envelopes, no JSON wrappers, no code blocks.]`

OUTPUT_CONTRACT says:
> "The message must begin with `<diagnostics>`. No leading text."
> "No content outside `<diagnostics>` and `<response>`."

These are irreconcilable instructions. The LLM must choose between:
1. Following OUTPUT_CONTRACT: wrap everything in XML envelopes
2. Following RUNTIME_TOOL_USE_SUFFIX: respond in plain text, no XML

**Current behaviour:** The suffix wins because it appears AFTER the main prompt (recency bias in LLMs). But the 6,144 chars of OUTPUT_CONTRACT are wasted tokens (~1,500 tokens) that actively confuse the model.

#### Are there other contradictions?

| Contradiction | Location | Severity |
|---------------|----------|----------|
| OUTPUT_CONTRACT demands XML envelopes; suffix forbids them | v100:OUTPUT_CONTRACT vs prompt-audit.ts:129 | **HIGH** — ~1,500 wasted tokens + model confusion |
| OUTPUT_CONTRACT references `<diagnostics>` reasoning block; V4 has no diagnostics | v100:OUTPUT_CONTRACT | Medium — dead instruction |
| OUTPUT_CONTRACT references `<blocks>` XML format; V4 uses native tool results | v100:OUTPUT_CONTRACT | Medium — format mismatch |
| OUTPUT_CONTRACT references `<suggested_actions>` XML; V4 uses chip-builder | v100:OUTPUT_CONTRACT | Medium — format mismatch |

**Recommendation:** Remove `<OUTPUT_CONTRACT>...</OUTPUT_CONTRACT>` from v100/v101. This saves ~1,500 tokens per turn (~$0.009/turn at Sonnet pricing) and eliminates the primary source of model confusion.

---

## 5. Code Changes

### Priority 2: add-option.ts is_baseline fix

**File:** `src/orchestrator/deterministic/actions/add-option.ts:126`

**Change:** Added `is_baseline: false` to new option node creation.

```diff
  value: {
    id: nodeId,
    kind: 'option',
    label,
+   is_baseline: false,
    data: { interventions },
  },
```

### Priority 3: data/prompts.json updated with v100

Updated `data/prompts.json`:
- `activeVersion: 100` (was 1)
- `stagingVersion: 100` (was null)
- Added v100 version entry (68,444 chars, changeNote: "v34d — synced from Supabase PMS")
- v1 preserved for history

---

## Summary: Top Findings

1. **v100 confirmed live** — `activeVersion: 100`, `stagingVersion: 100`, 68,444 chars, 23 section tags
2. **RUNTIME_CONSTRAINTS and DECISION_LANGUAGE present** in v100 (v34d additions confirmed)
3. **BIAS EVIDENCE GATE and PREDICTION ELICITATION do NOT exist** in v34d — they were never added
4. **OUTPUT_CONTRACT still present** in v100 — 6,144 chars of dead XML envelope instructions directly contradicting RUNTIME_TOOL_USE_SUFFIX. Wasting ~1,500 tokens/turn.
5. **7 of 9 experimental flags have zero V4 impact** — BIL, DSK, DSK_COACHING, Zone2, Brief Detection, Grounding, Critique are V1/V2-path only
6. **Only CLARIFIER and PREFLIGHT affect V4** — both via the draft_graph tool handler
7. **Dynamic block is flag-independent** — pure deterministic assembly from TurnContext, no experimental flag checks
8. **Total system prompt: ~17,570 tokens** — of which ~1,500 are wasted on OUTPUT_CONTRACT

*End of report.*
