# Olumi coaching UX requirements — input to V5 architecture

**Date:** 16 April 2026
**Status:** Draft for V5 conversation (6e1135d1) and cross-workstream alignment
**Author context:** Analysis tab coaching investigation. Output of audit + debug bundle analysis + prompt review + architecture review.
**Purpose:** Define the coaching experience Olumi must deliver, so V5 can build the architecture that supports it. This is UX and content layer input, not architecture design.

---

## 1. Purpose and scope

The Analysis tab coaching investigation identified that coaching gaps are not UI problems — they're architectural. The coaching infrastructure (decision_review prompt, M1 deterministic layer, factor_sensitivity, VoI, conditional_winners, flip_thresholds) is substantially built but disconnected. The live panel renders thin content because thin content is all that reaches it.

The V5 rebuild owns the architecture that will close these gaps. This document specifies the coaching experience V5 must enable — not the architecture itself. It ensures V5 builds for the right target rather than optimising the current silhouette.

**In scope:** coaching UX principles, content requirements, surface allocation, structured block types, continuity rules, real-world context handling.

**Out of scope:** tool registry design, prompt structure, orchestrator state machine, pipeline engineering. These are V5's decisions to make, informed by this document.

---

## 2. Current coaching gaps (evidenced)

Confirmed across five debug bundles and full prompt + architecture audit:

### 2.1 Decision_review never fires on live panel

- `decision_review` prompt (latest in project) produces 11 fields: narrative_summary, story_headlines, robustness_explanation, readiness_rationale, evidence_enhancements, scenario_contexts, flip_thresholds, bias_findings, key_assumptions, decision_quality_prompts, pre_mortem, framing_check.
- In the architecture, decision_review is wired only to `generate_brief`, which is a stub ("Coming soon").
- No post-analysis turn contains decision_review output. Panel renders PLoT's shallow `decision_brief` (headline + drivers + robustness string) instead.
- Orchestrator v37's `<DECISION_REVIEW>` section tells the orchestrator how to consume review output, but no path produces it.

### 2.2 Draft_graph coaching outputs starved

- Prompt v188–v192b emits `coaching.summary`, `coaching.strengthen_items`, `widening_log`, `bias_signals`, `provenance`.
- Investigation brief dispatched confirms these fields likely don't survive the CEE pipeline. `coaching.summary` feeds assistant_text; structured fields dropped.
- Pre-analysis panel renders "AI estimate. Does this match?" templates because richer draft coaching never reaches it.

### 2.3 Structured coaching exercises handled as text

- `pre_mortem` is a structured output field in decision_review. It has grounded_in IDs, warning_signs array, mitigation, review_trigger.
- User request "Run a pre-mortem" triggers INTERPRET mode, producing free text. No structured block.
- Same pattern for outside view, devil's advocate, consider-the-opposite.

### 2.4 Real-world context dropped at draft time

- Brief says "£70k salary, 6 months, £20k MRR target".
- Graph emerges with `fac_annual_cost` [0,1] normalised. Salary number lives only in `cap=70000` metadata.
- Coaching references normalised factor names ("Annual Assistant Cost drives 12%"), not brief-anchored content ("your £70k budget rules out X").
- `widening_log` in draft_graph v192 captures what was added beyond the brief but isn't consumed.

### 2.5 No cross-phase continuity

- Pre-analysis flags "Competitor Acquisition has default confidence" (priority 70, signal_code DEFAULT_NODE_CONFIDENCE).
- Post-analysis shows "Competitor Acquisition drives 100% of outcome" and a flip risk.
- Same signal, same node, different phase. No narrative bridge. User has no sense of "you were warned about this".
- Signal_id exists in the registry spec; lifecycle tracking doesn't happen at runtime.

### 2.6 Hero metric ambiguity

- Post-analysis donut renders readiness composite score (Structure/Evidence/Coverage/Verified) over the winner headline.
- User reads "Acquire Smaller Competitor 35%" as win probability. It's actually model quality score.
- Real win probability is also 35% — by coincidence, not by design. In other scenarios they diverge dangerously.

### 2.7 Bias findings empty

- `bias_findings: []` in both debug bundles across two different scenarios.
- Decision_review prompt has 8 calibrated bias mappings (DSK-B-001 through DSK-B-009) with structural + semantic detection rules.
- Detection never runs because decision_review never runs.

### 2.8 Factor sensitivity and EVPI under-surfaced

- ISL computes factor_sensitivity (influence, elasticity, VoI, attribution_stability, rank_flip_rate), factor_evpi per factor, conditional_winners, fragile_edges.
- Post-analysis panel shows influence % per driver and a flip-risk line. Everything else is expert-mode only or absent.
- Evidence cards show "0.0pp" for EVPI in some bundles — real data, rendered poorly.

### 2.9 Pre-analysis coaching ceiling is M1 templates

- Pre-analysis triage cards show "AI estimate. Does this match?" regardless of factor.
- No per-factor context (connectivity, downstream influence, why calibrating this matters for this decision).
- The data for per-factor context exists in `plot_enrichment.factor_sensitivity` pre-analysis (confirmed in bundles).

---

## 3. Coaching experience principles

### 3.1 Coaching meets the user where they are

The user may prefer panel, canvas, chat, or inspector. Each surface must coach in its own idiom. No surface should be a diagnostic dashboard that forces the user to chat for guidance. No surface should duplicate what another already shows.

| Surface | Coaching form | Density | Example |
|---|---|---|---|
| AI chat | Full conversations, structured exercises, challenge | Highest | "Your result depends on Task Handling Breadth. Want to pressure-test that assumption?" |
| Analysis panel | Per-section annotations on results | Medium | Evidence card shows "Drives 97% of outcome, 25% confidence — resolving could improve confidence by 3pp" |
| Graph canvas | Tooltips, markers, science icons | Light, spatial | Needs-input marker on unreviewed node; click opens one-line tooltip + action |
| Inspector | Element-focused diagnostic | Deep, scoped | Selected edge shows e-value, flip direction, rerun effect prediction |

All four surfaces read from one coaching state. The form differs. The substance stays coherent.

### 3.2 Coaching is continuous, not discrete

Users oscillate: run → stare → edit → rerun → revisit. Coaching must update with the model. Pre-baked text that expires when the user edits is worse than no coaching. Coaching signals must have lifecycle state: `pre_run_warning` → `post_run_consequence` → `post_rerun_resolution`. Resolved signals become check marks, not dropouts.

### 3.3 Coaching surfaces the real-world decision, not the abstract model

The causal graph is the rigour layer. It abstracts. But decisions happen in context: salary, timeline, stakeholders, constraints, current state. Coaching must reference what the user actually said, not just what the model contains. "Your brief mentioned scheduling and research tasks" is coaching. "Task Handling Breadth drives 97%" is telemetry.

### 3.4 Coaching pairs findings with actions

Every finding has a next step. "Your result depends on X" + "Calibrate X" + "If you don't know, try reference class forecasting". No dead-end warnings. No generic "consider reviewing".

### 3.5 Coaching voices the science without jargon

Ground every claim in model data or brief text. Translate technical terms (elasticity — "how strongly this factor moves the outcome"). Cite DSK techniques by accessible name (pre-mortem, outside view) with one-line explanation. Show evidence strength as "strong / medium" not as DSK claim IDs.

### 3.6 Coaching is honest about uncertainty

Attribution_stability "low" must surface as hedging, not suppression. Fragile results must be narrated as fragile, not papered over. Close calls must be called close calls, not resolved into false confidence. Olumi's edge is calibration — this has to be visible in the UX.

### 3.7 Coaching scales to user preference

Users differ on coaching intensity. A lever (Minimal / Standard / Deep) controls:
- Which auto-fire tools run per analysis turn
- How many bias findings surface
- Whether the AI fires proactive nudges on idle
Expert mode stays separate (controls data density on panel, not coaching density).

---

## 4. Required coaching content

Every finding below is grounded in data already computed by ISL, PLoT M1, or derivable from graph structure. No new science, no new ML. This is a rendering and wiring requirement.

### 4.1 Pre-analysis coaching

On the panel, canvas, and chat after draft_graph completes:

**Model orientation (one-time, per draft):**
- Plain-English trade-off statement ("This decision weighs X against Y")
- Biggest assumption identified and why (highest-connectivity AI-estimated factor)
- What the draft added beyond the brief (from `widening_log`) if material
- Constraints extracted from brief, flagged if any seemed dropped

**Per-factor context (on every triage card and canvas node):**
- "Drives N downstream relationships" — deterministic from graph degree
- "AI estimate, 25% confidence" — from provenance
- "Calibrating this could shift the winner" — when factor appears in draft sensitivity preview (if available pre-run)
- If a technique fits the factor type (e.g. missing-data — reference class forecasting), suggest it by name with one-line rationale

**Structural bias detection (deterministic):**
- DOMINANT_FACTOR: one factor has >50% of inbound influence — reflective card
- SAME_LEVER_OPTIONS: options share ≥80% of intervention factors — narrow framing card
- MISSING_BASELINE: no status quo option — status quo card
- STRENGTH_CLUSTERING: edges cluster at default values — anchoring card

**Goal clarity:**
- If success target unset and decision has quantified goal — promote to Must-fix
- Explanation: "Setting a target lets Olumi tell you which option is most likely to reach it"

### 4.2 Post-analysis coaching

On the panel, canvas, and chat after run_analysis completes:

**Result narrative (replaces current hero caption):**
- Winner with plain-English framing ("leads on handling task breadth")
- Margin and stability in user terms ("leads by 37 points but this result is sensitive")
- Winner-dependency warning if any factor drives >70% of outcome with low confidence
- Translation to user-scale outcomes (from brief anchors: "you need 200 customers; leading option reaches this with 62% probability")

**Scenario contexts (for top 3 fragile edges):**
- Trigger description: "If Competitor Acquisition value is lower than assumed..."
- Consequence naming alternative winner: "...Build Dedicated Mid-Market Product Tier overtakes"
- One-click action: validate that factor / explore the scenario

**Flip thresholds (for top 3 factors where applicable):**
- "Task Handling Breadth currently assumed at 0.35 — if it's actually 0.28 or lower, Use AI Assistant wins instead"
- Unit-aware display (customers, GBP, scale value)
- One-click: rerun with flip value preview

**Evidence priorities (top 3 by VoI):**
- Factor name, influence %, confidence %, EVPI in percentage points
- Specific action: "Gather data via [method]" — method comes from DSK technique mapping
- Decision hygiene pairing: "Before looking at the data, estimate what you expect to see"

**Bias findings (max 3):**
- Structural biases grounded in critique codes
- Semantic biases grounded in brief substring (exact quote ≥12 chars)
- Framed as reflective questions, not diagnoses
- DSK citation with evidence_strength shown plainly ("strong evidence", "some evidence")

**Decision quality prompts (max 3):**
- Named technique (pre-mortem, outside view, 10-10-10, disconfirmation, opportunity cost, devil's advocacy)
- Applies-because sentence tying to current analysis state
- One-click invocation producing structured block

**Trust narrative:**
- Robustness framed in plain terms ("The recommendation holds across most variations of your assumptions" vs "This result is sensitive")
- What's contributing to uncertainty (defaulted values, missing evidence, fragile edges)
- What would strengthen it

### 4.3 Structured exercise blocks

Not text. Not embedded in assistant_text. Typed blocks the panel and chat can render as first-class UI:

**PreMortemBlock:**
```
{
  failure_scenario: "Specific 'failed because...' reference to factors/edges",
  warning_signs: ["Observable indicator 1", "2", "3"],
  mitigation: "One concrete risk-reduction step",
  grounded_in: ["edge_id or factor_id", ...],
  review_trigger: "Reconvene if [condition] within [timeframe]"
}
```

**OutsideViewBlock:**
```
{
  reference_class: "Class of similar decisions",
  base_rate_prompt: "What was the distribution of outcomes for that class?",
  specific_factors_consideration: ["Factor adjustments only based on documented evidence"]
}
```

**ChallengeBlock:**
```
{
  target_element: "factor_id | edge_id",
  devils_advocate_case: "Strongest argument against current assumption",
  counter_evidence_prompts: ["What would make you change your mind about X?"]
}
```

Each block has its own render component. User can mark completed, add notes, have the AI reference it in subsequent coaching.

### 4.4 Continuity breadcrumbs

When a pre-analysis signal persists through run_analysis:
- Post-analysis card shows subtle "flagged pre-analysis" breadcrumb
- If the signal's consequence is now visible: "You flagged this — it's now the dominant driver"
- If the user resolved it: check mark, "resolved"
- If a new user edit invalidates a previous warning: the warning transitions to `resolved` state

This is lifecycle tracking, not additional content. Implementable through signal_id persistence in coaching state.

---

## 5. Surface allocation rules

Consolidates Signal Registry v3 with one revision: **panel is also a coaching surface, not just a data surface.**

### 5.1 One canonical home per signal

Every coaching signal has one primary surface. Secondary surfaces show references, not duplication.

| Signal type | Primary surface | Secondary |
|---|---|---|
| Structural blockers | Panel (Must fix) | Banner, graph marker |
| Calibration recommendations | Panel (Review next) + canvas marker | Chat on expansion |
| Bias findings | Panel (Review next, as reflective card) | Chat for discussion |
| Evidence priorities | Panel (Improve confidence) | Canvas edge thickness |
| Fragile edges / flip thresholds | Panel (post-analysis) | Canvas edge glow |
| Pre-mortem / outside view blocks | Chat as first-class block | Panel "completed" state |
| Real-world context grounding | Chat (in coaching prose) | Panel (annotated values) |
| Truth/provenance detail | Model tab | Inspector |
| Full relationship audit | Model tab | Not panel |

### 5.2 Panel coaches by annotation, chat coaches by conversation

Panel coaching is concise, per-card, scoped to what the card shows. One coaching line attached to the specific data. Chat coaching is conversational, cross-cutting, can invoke exercises.

A panel card renders:
- The data (factor name, influence, confidence, provenance)
- One coaching line tied to that data ("Calibrating this could shift the winner — try reference class forecasting")
- One action (set value / ask AI / open inspector)

Chat references the panel without repeating it:
- "I see you flagged Task Handling Breadth as the biggest uncertainty. Shall we work through what we don't know about it?"

### 5.3 Canvas coaches by attention-direction

Canvas carries:
- Needs-input markers on unreviewed AI-inferred nodes
- Sensitivity thickness on edges post-analysis
- Fragile markers on edges above flip-risk threshold
- Science icons (evidence gap, assumption, weak connection, narrow framing, etc.) with one-line tooltips
- Click-through to inspector for detail, to chat for discussion

Max 3 visual markers per node. Tooltips max one coaching line + 2 actions. No full coaching cards on the canvas.

### 5.4 Inspector coaches by element diagnosis

Inspector on a selected node/edge renders:
- The full data for that element
- Coaching scoped to that element only (why this factor matters, what its uncertainty means, how to reduce it)
- Links to related chat context / rerun-with-this-change preview

### 5.5 De-duplication enforcement

A coaching narration appears on its primary surface. Never on two surfaces simultaneously as prose. Secondary surfaces show data references or lightweight tooltips only. Enforced by signal_id tracking in coaching state.

---

## 6. Decision context layer

A schema sitting alongside the causal graph, capturing real-world grounding that the graph can't cleanly hold. Populated at draft time. Threaded through every coaching call.

### 6.1 What it contains

```
decision_context: {
  domain_anchors: {
    monetary_figures: [{ value, currency, label, source_quote }],
    timeline: { duration, deadline, source_quote },
    team_size: { current, context, source_quote },
    current_state: { description, source_quote },
    named_entities: [{ name, type, relevance, source_quote }]
  },
  goal_translation: {
    user_scale_metric: "200 mid-market customers",
    user_scale_target: 200,
    probability_interpretation: "probability of reaching 200 customers"
  },
  stakeholder_context: {
    decision_makers: [...],
    known_preferences: [...],
    constraints_mentioned: [...]
  },
  external_factors_flagged: [
    "Brief mentions competitor — may warrant research",
    "Timeline tight — planning fallacy risk"
  ],
  hygiene_notes: [
    { observation, suggested_technique, rationale }
  ]
}
```

### 6.2 Why it matters

Enables coaching to say:
- "Your £70k salary budget rules out Option X" (domain_anchor)
- "You need to hit £20k MRR — leading option reaches it with 62% probability" (goal_translation)
- "Your brief mentions a specific competitor — research could strengthen this" (hygiene_note)

Instead of:
- "Annual Assistant Cost drives 12% of outcome"
- "Winner has 62% win probability"
- "Competitive Pressure is external"

### 6.3 Who populates it

Draft_graph already emits data relevant to this in `widening_log`, constraint extraction, and brief parsing. A deterministic post-draft extractor can populate the decision_context from these fields plus brief regex. No new LLM call required for population.

### 6.4 Who reads it

Every LLM coaching call takes it as input:
- Post-draft orientation (if we auto-invoke review_draft-equivalent via draft_graph structured output threading)
- Post-analysis coaching (whichever mechanism V5 chooses)
- Pre-mortem / outside view / challenge block generators
- Brief assembly (generate_brief)

---

## 7. Coaching state layer

A persistent per-scenario state that the orchestrator, UI panel, canvas, and inspector all read from. Invalidated surgically on graph change, not wholesale.

### 7.1 What it contains

```
coaching_state: {
  scenario_id,
  graph_hash,
  analysis_hash,
  decision_context: { ... },     // §6
  signals: [
    {
      signal_id,
      type, severity, scope,
      lifecycle: 'pre_run_warning' | 'post_run_consequence' | 'post_rerun_resolution' | 'resolved' | 'dismissed',
      target: { type, id },
      rendered_forms: {
        panel: "...",
        chat: "...",
        canvas_tooltip: "..."
      },
      linked_signal_ids: [...]    // continuity tracking
    }
  ],
  completed_exercises: [
    { exercise_type, completed_at, grounded_in, output_block_id }
  ],
  cached_tool_outputs: {
    draft_coaching: { ... },
    analysis_review: { ... },
    brief: { ... }
  },
  resolved_findings: [...]
}
```

### 7.2 Invalidation rules

- Graph edit affecting factor X — signals scoped to factor X revalidated, others preserved
- New run_analysis — post_run signals recomputed, pre_run signals transition if relevant
- Brief generated — packages state, doesn't invalidate
- Graph structural change (add/remove node) — full revalidation of signals

### 7.3 Who owns it

Server-side (CEE or Supabase-backed per scenario). UI reads via the orchestrate endpoint. No client-side reconstruction.

---

## 8. Tool invocation model — functional requirements

V5 chooses how, but the coaching UX requires these functional capabilities. Whether they're separate tools, a single decision_review merged into run_analysis, or decomposed into specialised prompts is an architecture decision.

### 8.1 Must fire automatically

When an analysis completes, the following must produce output by the time the panel renders:
- Result narrative + story headlines + robustness explanation
- Scenario contexts for top fragile edges
- Flip thresholds where computable
- Evidence priorities with DSK hygiene pairings
- Bias findings (structural always; semantic when brief substring supports)
- Winner-dependency warning if applicable

After draft_graph completes:
- Model orientation + biggest assumption + widening_log narration
- Structural bias detection (deterministic)
- Per-factor context (deterministic + draft coaching fields)

### 8.2 Must fire on user invocation

Producing typed structured blocks, not free text:
- Pre-mortem
- Outside view / reference class forecasting
- Devil's advocacy on selected element
- Consider-the-opposite on current recommendation
- Research topic (already exists; keep)

### 8.3 Must fire on explicit user action

- Decision brief assembly (packages cached state — no new LLM call needed if coaching state is complete)
- Compare scenarios (separate from coaching pass)

### 8.4 Cost and latency envelope

Coaching must not block the user. If the architecture choice adds >5s to post-analysis latency, the coaching must stream or render progressively. Panel should show deterministic content immediately and enrich with LLM content as it arrives.

---

## 9. Acceptance criteria for V5 architecture

V5 is coaching-complete when:

### 9.1 Data flow

- [ ] Draft_graph structured outputs (coaching, widening_log, bias_signals, provenance) reach orchestrator context
- [ ] decision_context schema populated at draft time, accessible to every coaching call
- [ ] coaching_state persists across turns with correct invalidation
- [ ] Signal_id lifecycle tracking works across draft — analysis — rerun
- [ ] ISL outputs (factor_sensitivity with attribution_stability, factor_evpi, conditional_winners, fragile_edges, inference_warnings) reach the panel, not just expert mode

### 9.2 Coaching production

- [ ] Post-analysis produces narrative_summary, story_headlines, robustness_explanation, scenario_contexts, flip_thresholds (when present), evidence_enhancements with DSK hygiene, bias_findings (structural + semantic), decision_quality_prompts on every run_analysis turn
- [ ] Pre-analysis produces per-factor context, structural bias cards, trade-off statement, biggest-assumption identification on every draft_graph turn
- [ ] Pre-mortem, outside view, devil's advocacy produce typed structured blocks on invocation
- [ ] Real-world context from the brief surfaces in coaching prose

### 9.3 UX delivery

- [ ] Panel coaching is per-card, concise, tied to displayed data; not duplicated from chat
- [ ] Chat references panel without repeating; invokes exercises on user request
- [ ] Canvas carries needs-input markers, sensitivity encoding, fragile markers, science icons
- [ ] Inspector shows element-scoped coaching
- [ ] Hero metric unambiguous: donut shows win probability, readiness shown separately (or not on post-analysis)
- [ ] Continuity breadcrumbs link pre-analysis warnings to post-analysis consequences

### 9.4 Content quality

- [ ] No coaching card says "AI estimate. Does this match?" as its entire content
- [ ] No three cards share identical "a shift could change the recommendation" copy
- [ ] Bias findings populate when brief or model structure supports them
- [ ] "Gather data on [X]" is replaced with specific DSK technique + hygiene pairing
- [ ] Silent model_adjustments surfaced as trust-maintaining coaching

---

## 10. Recommendations to V5 architecture

These are not prescriptions — V5 owns the architectural decisions. Recorded as analyst recommendations informed by this investigation.

### 10.1 Auto-invoke decision_review-equivalent after run_analysis

The functional requirements in §8.1 are not achievable by deterministic M1 alone. LLM enrichment after every run is the simplest path to the coaching experience §4 specifies. Alternatives (decomposing decision_review into smaller tools, merging review into run_analysis, lazy-invoking on panel mount) have pros and cons but all satisfy the same requirement: **LLM coaching output must be present when the panel renders post-analysis**.

The cost trade-off (one extra LLM call per analysis run at roughly £0.02–0.05) is small relative to the coaching value.

### 10.2 Thread draft_graph structured outputs through the pipeline

Current CEE pipeline likely drops `strengthen_items`, `widening_log`, `bias_signals`, `provenance` from draft_graph response. These fields are already emitted by the prompt. Threading them into orchestrator context + coaching_state is pipeline engineering, not new LLM work.

### 10.3 Build decision_context as a first-class schema

Not a prose field. A typed object. Populated deterministically from draft_graph + brief regex at draft time. Serialised into every coaching call's prompt context. Persisted in coaching_state.

### 10.4 Promote pre-mortem, outside view, challenge to first-class tools

Each produces a typed block, not prose in assistant_text. Invocable from chat (chip, command), panel (CTA on fragile card), or canvas (right-click node).

### 10.5 Signal lifecycle tracking as orchestration primitive

Signal_id threading across turns is not optional. Implement at orchestrator level: every signal has a lifecycle field, every turn updates it, every surface renders based on current state. Enables continuity breadcrumbs (§4.4) and correct de-duplication (§5.5).

### 10.6 Deterministic first, LLM enriches

M1 deterministic coaching produces baseline content instantly. LLM coaching enriches it. UI renders deterministic content on first paint, replaces or augments with LLM content when it arrives. Never a blank panel waiting on an LLM call.

### 10.7 Ship generate_brief as packager, not generator

Once coaching_state holds the full decision_review output per run, generate_brief packages the cached state into a BriefBlock deliverable. No new LLM call. Removes "Coming soon". Makes the brief fast.

### 10.8 Coaching intensity setting as a post-PoC lever

Not urgent. Flag as product requirement for post-pilot. Would control auto-fire density, proactive chat frequency, bias finding thresholds.

---

## 11. Boundaries with this investigation

This document concludes the coaching investigation on the Analysis tab conversation. Handoff points:

### 11.1 V5 conversation (6e1135d1) owns

- Architecture decisions (A/B/C/D on decision_review invocation)
- Tool registry design
- Orchestrator prompt structure
- Pipeline engineering
- coaching-context-builder.ts completion
- coaching_state persistence design
- Signal lifecycle implementation
- Boundary contract extensions for decision_context and coaching_state
- LLM call budget per turn

### 11.2 This conversation will resume for

- Panel UI rendering of coaching_state once V5 publishes the contract
- Canvas coaching visual wiring
- Inspector coaching rendering
- Hero metric disambiguation in UI
- Continuity breadcrumb UI patterns
- Structured exercise block UI components

### 11.3 Neither conversation owns (flag to Paul)

- decision_review prompt content edits (if required)
- DSK technique catalogue expansion
- Science review with Neil Bramley
- Cost envelope approval for auto-invoking LLM review

---

## 12. Open questions for V5 to resolve

Offered as input, not answers:

1. **Decision_review decomposition or monolith?** Single LLM call producing all 11 fields vs. decomposed tools (interpret_result, surface_concerns, prioritise_evidence, run_pre_mortem, etc.). Cost, latency, caching differ.

2. **Auto-invoke after run_analysis, lazy on panel mount, or progressive streaming?** All three satisfy §8.1 but have different UX implications.

3. **SCIENCE_CLAIMS injection mechanism.** Confirmed present in decision_review prompt; need CEE-side injection logic verified or built.

4. **coaching_state storage: memory cache, Supabase, both?** Affects rehydration on resume.

5. **What happens to orchestrator v37's `<DECISION_REVIEW>` consumption section once review is auto-invoked?** May need prompt edit to handle always-present review output.

6. **pre_mortem tool arch: dedicated prompt + handler, or part of decision_review invoked on demand?**

7. **Relationship to Modified Option C scope (94c97914).** If V5 ships consolidation-by-deletion first, coaching layer changes may need to wait. Or can be added to Slice E (Decision review/polish) in the vertical-slice plan.

---

*This document is a frozen reference for V5 architecture work. Updates only via explicit Paul approval.*
