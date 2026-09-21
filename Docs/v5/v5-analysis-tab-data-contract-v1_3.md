# V5 / Analysis tab data contract

**Version:** 1.3
**Date:** 13 May 2026
**Status:** Freeze candidate pending final confirmation from both workstreams
**Purpose:** Prevent V5 CEE and Analysis tab UI from building incompatible shapes. This is a contract, not implementation guidance.
**Operates alongside:** V5 Completion Plan, Coaching UX Requirements v1, Design System v5
**Referenced by:** `V5_CURRENT_STATE.md` Phase 3 blockers/constraints

**Changes from v1.2:** `outcome` added to `target_refs.kind` union; `action_intent` changed from `string` to strict intent union; common metadata scoped to new Phase 3 block types (FactBlock/GraphPatchBlock unchanged); EvidenceBlock `factor_ref`/`target_refs` consistency rule added; `start_guided_chat` added as conditional planned intent; numeric suppression clarified (formatted metrics allowed, raw decimals not); `priority_rank` required for hero-eligible blocks; contract added as Phase 3 hard dependency.

---

## Ownership boundary

| Domain | Owner | Examples |
|---|---|---|
| CEE output shapes, field schemas, handler responses | V5 | Block type definitions, enrichment fields, action types |
| Coaching data contracts, persistence, freshness | V5 | decision_review output, coaching_state, staleness semantics |
| Panel rendering, layout, card patterns, typography | Analysis tab | Where blocks appear, how they look, interaction surfaces |
| Visual system (DS v5 tokens, three-size panel type scale) | Analysis tab | panelHeader/panelBody/panelMeta, colour tokens, card radius |
| Stale/freshness copy (exact user-facing wording) | Analysis tab | CEE emits signals; Analysis tab renders canonical copy |
| Fallback/degradation copy and behaviour | Analysis tab | CEE emits status; Analysis tab owns all degradation wording and CTA visibility |
| Hero row selection and promotion priority | Analysis tab | CEE provides ranked blocks; Analysis tab owns final selection |
| Dedupe across hero and lower sections | Analysis tab | Uses `signal_id` to suppress/collapse duplicates |
| Interaction intents the panel can trigger | Shared (defined here) | "Explain this driver", "Rerun analysis", "Run pre-mortem" |

Neither workstream may cross the boundary without the other's review.

---

## 0. Common block metadata

**Scope:** mandatory for all new Phase 3 block types (ReviewCardBlock, CoachingBlock, EvidenceBlock, ExerciseBlock). Existing FactBlock and GraphPatchBlock remain unchanged unless separately versioned.

```typescript
{
  block_id: string,                  // unique per block instance (UUID)
  signal_id: string,                 // stable signal identity for dedupe,
                                     // dismissal, stale rendering, and
                                     // hero/lower-section dedup. REQUIRED.
  created_at: string,                // ISO 8601
  source_handler: string,            // handler that produced this block
  graph_hash_at_generation?: string, // REQUIRED for analysis-derived blocks
                                     // (ReviewCardBlock, EvidenceBlock from
                                     // run_analysis/decision_review).
                                     // Optional for draft/pre-analysis blocks.
  freshness: 'fresh' | 'stale' | 'pending' | 'failed'
}
```

---

## 0.1 Target references

Blocks that reference graph entities use `target_refs` instead of plain label strings.

```typescript
target_refs: Array<{
  id: string,
  label: string,
  kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
}>
```

**Rules:**
- IDs are allowed in `target_refs` and other structured fields. IDs must never appear in `title`, `body`, `action_label`, or any other user-facing text field.
- `kind` must be from the strict union above. No `string` escape hatch. All block types use this same union.

---

## 0.2 Copy-length and formatting constraints

| Field | Max length | Rule |
|---|---|---|
| `title` | 80 characters | Single line, sentence case |
| `body` | 300 characters | Max 2 sentences |
| `action_label` | 40 characters | Sentence case, imperative verb |
| Cards per section | 3 visible | Additional cards collapsed behind disclosure (Analysis tab owns collapse logic and copy) |

CEE must enforce length limits at the composer layer. Analysis tab may truncate with ellipsis as a safety net but should not need to.

---

## 0.3 Dedupe rules

When a block/signal is promoted into the v17 hero or another primary surface, the Analysis tab may suppress or collapse the duplicate instance in lower sections using `signal_id`.

- CEE does not control promotion or dedup. CEE provides `signal_id`, `priority_rank`, `severity`, and `target_refs` so the Analysis tab can make safe selection decisions.
- The Analysis tab owns final row-selection priority in the hero. CEE must not assume the first-ranked block always appears in the hero.
- CEE should provide enough metadata for safe selection: all common metadata fields (section 0) plus `priority_rank` where applicable.

---

## 0.4 Action intent type

All `action_intent` fields use a strict union of the intent IDs defined in section 3. No freeform strings.

```typescript
type ActionIntent =
  | 'explain_driver'
  | 'explain_result'
  | 'what_would_flip'
  | 'rerun_analysis'
  | 'gather_evidence'
  | 'create_decision_brief'
  | 'add_option'
  | 'add_risk'
  | 'confirm_factor'
  | 'edit_factor'
  | 'compare_options'
  | 'run_pre_mortem'
  | 'run_outside_view'
  | 'run_devils_advocacy'
  | 'start_guided_chat'
```

New intents require a contract update (section 8 change process).

---

## 0.5 Numeric display rules

- Formatted, user-facing metrics (e.g. "62% win probability", "3.2x more likely") are allowed in deterministic result components and FactBlock content.
- Raw internal decimals (e.g. `0.482666`, `0.31415`) are not allowed in prose fields (`title`, `body`, `action_label`) of coaching, review, evidence, or exercise blocks.
- When a block body references a numeric value, it must be formatted for human readability (rounded, with unit and context).

---

## 1. CEE output block types

V5 Phase 3 will produce structured blocks on the `analysis_result` and `coaching` fields of the OlumiResponse envelope. Each block has a `type` discriminator and a fixed field schema. All new Phase 3 blocks include the common metadata from section 0.

### 1.1 ReviewCardBlock

Produced by: `decision_review` enricher (auto-invoked after `run_analysis`, once per fresh graph hash, persisted, invalidated on graph edit).
Persistence: persisted in `v5_handler_facts` as part of the `run_analysis` fact.
Hero eligible: yes (must include `priority_rank`).

```typescript
{
  // common metadata (§0) — signal_id REQUIRED, graph_hash_at_generation REQUIRED
  type: 'review_card',
  card_kind: 'narrative' | 'bias' | 'flip_threshold' | 'evidence_priority'
           | 'pre_mortem' | 'assumption' | 'robustness' | 'scenario_context',
  title: string,
  body: string,
  severity: 'info' | 'warning' | 'critical',
  target_refs: Array<{
    id: string,
    label: string,
    kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
  }>,
  priority_rank: number,             // REQUIRED (hero eligible)
  action_intent?: ActionIntent,
  action_label?: string
}
```

### 1.2 CoachingBlock

Produced by: coaching pass (Step 5 of seven-step turn assembly), draft_graph structured output threading.
Persistence: coaching_state per scenario.
Hero eligible: yes (must include `priority_rank`).

```typescript
{
  // common metadata (§0) — signal_id REQUIRED, graph_hash_at_generation OPTIONAL
  type: 'coaching',
  coaching_kind: 'orientation' | 'widening' | 'bias_signal' | 'strengthen'
               | 'assumption_check' | 'calibration_prompt',
  title: string,
  body: string,
  source: 'draft_graph' | 'decision_review' | 'deterministic_signal',
  target_refs: Array<{
    id: string,
    label: string,
    kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
  }>,
  priority_rank: number,             // REQUIRED (hero eligible)
  action_intent?: ActionIntent,
  action_label?: string
}
```

### 1.3 EvidenceBlock

Produced by: evidence-ranking module (`rankEvidenceSources`).
Consumed by: chips, review cards, panel evidence section, v17 hero.
Hero eligible: yes (must include `priority_rank`).

```typescript
{
  // common metadata (§0) — signal_id REQUIRED, graph_hash_at_generation REQUIRED
  type: 'evidence',
  factor_label: string,
  factor_ref: {
    id: string,
    label: string,
    kind: 'factor'
  },
  target_refs: Array<{
    id: string,
    label: string,
    kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
  }>,
  current_confidence: 'high' | 'medium' | 'low',
  evidence_gap: string,
  suggested_technique: string,
  impact_if_gathered: string,
  priority_rank: number,             // REQUIRED (hero eligible)
  severity: 'info' | 'warning' | 'critical',
  action_intent?: ActionIntent,
  action_label?: string
}
```

**Consistency rule:** `factor_ref` must match the primary factor entry in `target_refs`. User-facing renderers should prefer `target_refs[].label` as the canonical display label. `factor_label` is a convenience field for backward compatibility; if it conflicts with `target_refs`, `target_refs` wins.

### 1.4 ExerciseBlock

Produced by: on-demand handler invocation (pre-mortem, outside view, devil's advocacy).
Not auto-invoked. Triggered by user interaction intent.
Hero eligible: no.

```typescript
{
  // common metadata (§0) — signal_id REQUIRED, graph_hash_at_generation OPTIONAL
  type: 'exercise',
  exercise_kind: 'pre_mortem' | 'outside_view' | 'devils_advocacy'
               | 'consider_opposite',
  failure_scenario?: string,
  warning_signs?: string[],
  mitigation?: string,
  reference_class?: string,
  target_element_ref?: {
    id: string,
    label: string,
    kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
  },
  counter_case?: string,
  review_trigger?: string,
  target_refs: Array<{
    id: string,
    label: string,
    kind: 'factor' | 'option' | 'edge' | 'goal' | 'risk' | 'constraint' | 'outcome'
  }>
}
```

### 1.5 FactBlock (existing, unchanged)

Template-rendered deterministic results. Already in production. No changes needed. Not subject to section 0 common metadata requirements.

### 1.6 GraphPatchBlock (existing, unchanged)

Patch proposals with accept/edit/dismiss. Already in production. No changes needed. Not subject to section 0 common metadata requirements.

---

## 2. Panel rendering locations

The Analysis tab owns where each block type renders.

### 2.1 Decision-strengthening hero (v17)

| Content | Block types consumed | Notes |
|---|---|---|
| Result context | FactBlock (win probabilities) + selected top-priority ReviewCardBlock | Analysis tab selects which review card appears |
| Key question | Selected highest-priority CoachingBlock or ReviewCardBlock | Analysis tab owns selection logic using `priority_rank` |
| Input/action rows (up to 3) | Selected EvidenceBlock + CoachingBlock entries | Hero owns final row-selection priority |
| Footer CTA | Derived from highest-priority `action_intent` | Analysis tab maps intent to CTA |

**Rules:**
- Analysis tab selects content for the hero from ranked blocks using `signal_id`, `severity`, `priority_rank`, `target_refs`, and `freshness`.
- CEE must not assume the first-ranked block always appears in the hero.
- Blocks promoted to the hero may be suppressed or collapsed in lower sections (§0.3).
- Hero promotion is deterministic and controlled by the Analysis tab state machine.

### 2.2 Post-analysis panel sections (below hero)

| Section | Block types consumed | Notes |
|---|---|---|
| Narrative summary | ReviewCardBlock where `card_kind = 'narrative'` | May be suppressed if promoted to hero |
| Key drivers | FactBlock (factor sensitivities) | Analysis tab owns bar rendering |
| Risk signals | ReviewCardBlock where `card_kind = 'flip_threshold' or 'robustness'` | `severity` maps to visual treatment |
| Bias findings | ReviewCardBlock where `card_kind = 'bias'` | `severity` maps to visual treatment |
| Evidence priorities | EvidenceBlock | Analysis tab renders confidence bar + CTA |
| Coaching prompts | ReviewCardBlock where `card_kind = 'assumption' or 'scenario_context'` | May be suppressed if promoted to hero |

### 2.3 Pre-analysis panel

| Section | Block types consumed | Notes |
|---|---|---|
| Model orientation | CoachingBlock where `source = 'draft_graph'` | Analysis tab owns layout |
| Readiness dimensions | Deterministic (Analysis tab computes from graph state) | Locked visual from Brief 5.6 |
| Improvement suggestions | CoachingBlock where `coaching_kind = 'strengthen' or 'widening'` | Analysis tab renders CTA |
| Bias signals | CoachingBlock where `coaching_kind = 'bias_signal'` | `severity` maps to visual treatment |
| Assumptions | CoachingBlock where `coaching_kind = 'assumption_check'` | Analysis tab owns rendering |

### 2.4 Chat panel

| Content type | Block types consumed | Notes |
|---|---|---|
| Coaching responses | Inline text from handler `assistant_text` | Message bubble |
| Exercise outputs | ExerciseBlock | First-class block card in chat |
| Structured suggestions | ReviewCardBlock (when surfaced via chat) | Compact card, collapsible |

### 2.5 Canvas

| Visual | Source | Notes |
|---|---|---|
| Needs-input markers | Graph readiness state (deterministic) | Analysis tab owns markers |
| Sensitivity encoding | FactBlock factor_sensitivity values | Analysis tab owns edge thickness mapping |
| Fragile markers | ReviewCardBlock `card_kind = 'flip_threshold'` | Analysis tab owns edge glow |

---

## 3. Interaction intents

| Intent ID | User action | V5 handler / action type | Status | Response shape |
|---|---|---|---|---|
| `explain_driver` | Click "Why does this matter?" on a driver row | `explain_from_structure` | Implemented | assistant_text + optional ReviewCardBlock |
| `explain_result` | Click "Explain these results" chip | `explain_results` | Implemented | assistant_text consuming decision_review |
| `what_would_flip` | Click "What could change this?" chip | `what_would_flip` | Implemented | assistant_text + flip_threshold ReviewCardBlocks |
| `rerun_analysis` | Click "Rerun analysis" chip (when stale) | `run_analysis` | Implemented | Full analysis_result + decision_review |
| `gather_evidence` | Click "Investigate" on evidence card | `explain_from_structure` + evidence context | Implemented (partial) | assistant_text with technique guidance |
| `create_decision_brief` | Click "Create brief" CTA | `generate_brief` | Planned | BriefBlock (packages cached coaching_state) |
| `add_option` | Click "Add option" or "Broaden options" CTA | `edit_graph` (add_option intent) | Planned | Graph mutation + confirmation |
| `add_risk` | Click "Add risk" CTA | `edit_graph` (add_risk intent) | Planned | Graph mutation + confirmation |
| `confirm_factor` | Click "Confirm" / "Mark verified" on factor card | `set_factor_value` or `edit_graph` | Planned | Factor update + confirmation |
| `edit_factor` | Click "Set value" on factor card | `set_factor_value` | Planned | Graph mutation + confirmation |
| `compare_options` | Click "Compare" chip | `compare_options` | Planned | assistant_text + comparison blocks |
| `start_guided_chat` | Click guided-chat CTA on coaching card | Chat prefill with structured context | Planned (conditional on Analysis tab confirmation) | Prefilled chat message |
| `run_pre_mortem` | Click "Run pre-mortem" CTA on fragile card | `run_exercise` (kind: pre_mortem) | Needs handler | ExerciseBlock |
| `run_outside_view` | Click "Outside perspective" CTA | `run_exercise` (kind: outside_view) | Needs handler | ExerciseBlock |
| `run_devils_advocacy` | Click "Challenge this" on element | `run_exercise` (kind: devils_advocacy) | Needs handler | ExerciseBlock |

**Contract rules:**
- The Analysis tab may trigger any `Implemented` intent freely.
- `Planned` intents: the Analysis tab may build the CTA but must handle the `FEATURE_NOT_ENABLED` response gracefully. Analysis tab owns degradation wording and CTA visibility.
- `Needs handler` intents: the Analysis tab must show disabled CTA or hide it entirely until V5 registers the handler and updates this table. No chat-prefill degradation for unregistered handlers.
- Neither workstream may add new intent IDs without updating this contract via the change process (section 8).

---

## 4. Visual system constraints (Analysis tab reference)

These are Analysis tab rendering rules, not CEE obligations. Documented here so V5 understands what the Analysis tab expects to do with CEE data.

### 4.1 Typography (DS v5 §2.2, locked by Brief 5.5)

- Panel content uses three sizes only: `panelHeader` (14px semibold), `panelBody` (12px regular), `panelMeta` (11px regular).
- Block `title` renders as `panelHeader`. Block `body` renders as `panelBody`. Metadata renders as `panelMeta` or is hidden.

### 4.2 Card patterns (DS v5 §22.2, locked by Brief 5.5)

- Lower-section coaching cards use `bg-panel`, full border, `rounded-lg` (12px), px-3 py-2. 3px left border accent where applicable.
- Compact hero rows may use different visual patterns (background tint, colour dot, icon, metadata treatment). The hero has its own rendering rules.
- Analysis tab owns all visual treatment decisions per surface.

### 4.3 Semantic-to-visual mapping (Analysis tab owns)

CEE emits `severity`, `card_kind`, `coaching_kind`, `confidence`. The Analysis tab decides colours, borders, icons, typography. This mapping may change without requiring a CEE update.

### 4.4 Section headers (locked by Brief 5.5)

Shared `SectionHeader` component. CEE does not control section headers; the Analysis tab derives them from block type grouping.

---

## 5. Freshness and staleness expectations

| State | CEE signals | Analysis tab responsibility |
|---|---|---|
| Fresh analysis | `analysis_freshness: 'fresh'` on envelope | Full post-analysis panel, all coaching blocks |
| Stale analysis | `analysis_freshness: 'stale_model_changed'`, `staleness_reason?: string` | Stale banner (Analysis tab owns wording). Coaching cards greyed. Rerun chip primary. |
| No analysis | `analysis_freshness: 'none'` | Pre-analysis panel only |
| decision_review pending | Block-level `freshness: 'pending'` | Deterministic content renders immediately. Coaching blocks stream in when ready. |
| decision_review failed | Block-level `freshness: 'failed'` | Panel shows deterministic content only. No blank sections. |

**Staleness copy:** The Analysis tab owns the exact user-facing wording for all freshness states. The agreed canonical stale string is: "These results may be out of date because the model has changed since the last analysis." CEE does not embed this string; it emits the signal.

---

## 6. Fallback behaviour

CEE emits status signals; the Analysis tab owns all degradation wording and CTA visibility decisions.

| Condition | Analysis tab behaviour |
|---|---|
| Block fails schema validation | Drop block, log diagnostic. Never render broken UI. |
| `target_refs` missing or empty | Render card without action CTA. Body text still displays. |
| `severity` missing | Default to `info`. |
| `freshness` is `stale` | Grey card, show staleness indicator (Analysis tab owns copy). |
| `freshness` is `failed` | Hide block. Show deterministic content only. |
| `title` exceeds 80 chars | Truncate with ellipsis at 80. Log diagnostic. |
| `body` exceeds 300 chars | Truncate with ellipsis at 300. Log diagnostic. |
| Unknown `card_kind` or `coaching_kind` | Render as generic coaching card with `info` severity. Log. |
| Unknown `exercise_kind` | Render body as plain text block. Log. |
| `action_intent` maps to `Planned` handler | Analysis-tab-owned degradation treatment. |
| `action_intent` maps to `Needs handler` | Disabled CTA or hidden. No chat prefill. |
| `action_intent` unrecognised | Hide CTA. Log diagnostic. |

---

## 7. Suppression rules (what must never be user-facing)

- No raw factor/edge/option IDs in `title`, `body`, `action_label`, or any rendered text field. IDs are permitted in `target_refs`, `block_id`, `signal_id`, and other structured machine fields.
- No raw internal decimals (e.g. `0.4826666667`) in prose fields. Formatted user-facing metrics (e.g. "62% win probability", "3.2x more likely") are allowed in deterministic result components and FactBlock content. When a coaching/review/evidence block body references a numeric value, it must be formatted for human readability (rounded, with unit and context).
- No schema field names (e.g. `win_probability`, `factor_sensitivity`, `strength.mean`).
- No internal status codes or error types.
- No debug/trace information in user-facing fields.
- No prompt section names.
- No "recommended", "winner", "winning". Use "leading option", "performs best", "comes out ahead".
- No em dashes.
- Sentence case for all titles and labels.

---

## 8. Change process

Changes to this contract require:

1. The requesting workstream proposes the change with rationale.
2. The other workstream reviews for impact.
3. Paul approves.
4. Both `V5_CURRENT_STATE.md` and this document are updated.

No unilateral changes. If CC discovers a needed shape change during implementation, stop and report.

---

*Freeze candidate v1.3. Pending final confirmation from V5 CC and Analysis tab CC. Freeze after both confirm. Phase 3 briefs must conform to this contract.*
