# Lane 30 — make the LLM's analysis context TRUTHFUL about goal-fit (+ #369 audit closure)

**Branch:** `claude-lane30/goalfit-truthful-context` (base: `origin/staging` @ `2385371d1`, which includes #369 widened projection and #370 brief field)
**Scope owned:** `src/orchestrator-v5/context/**`, `src/orchestrator-v5/format/**`, one additive internal field in `src/orchestrator/context/analysis-compact.ts` (`FlipThreshold.factor_id`, mirrors the existing `FragileEdge.from_id` precedent).
**Not touched:** prompt content (Brief I), `zero_reason` carriage (doctrine open — documented below), edit/draft lanes' files, compose keep-lists, telemetry registry (no new event names).

## The live defect (verified 2026-07-08 ~01:00, scenario 90385279)

Evidence: `acceptance-evidence/coaching/20260708-0100-coaching-proof-scenario-90385279.json` (+ log evidence alongside).

Asked *"how does each option look against my 25% target?"*, the orchestrator
LLM answered with WIN probabilities framed as target-fit ("leads comfortably
at 89%") when the delivered `probability_of_joint_goal` was **29.3%**. Root
cause: the ContextPack carried only a GLOBAL goal-fit provenance sentence
("goal fit was scored from the modelled outcome distribution") — the
per-option values PLoT has delivered since #204
(`option_comparison[].probability_of_joint_goal` + `goal_fit_basis`; live
shape captured at `acceptance-evidence/goal-fit/20260707-2204-analyse-turn-scenario-1909b083.json`)
never reached the LLM, so it filled the gap with the only percents it had:
win probabilities. Claim-integrity class.

## Fixes (one commit each, staged execution)

### 1. Per-option goal-fit (`00c94137e`)

- `analysis-signals.ts`: `OptionGoalFitSignal` + `deriveOptionGoalFitsFromEnrichment`
  — finite [0,1] values only, option identity required, deduped, capped at 12.
- `analysis-fallback.ts`: attached via `reconcileAnalysisSummaryWithEnrichment`,
  the single seam shared by the prior-facts fallback AND the turn-executor
  body-`analysis_state` ingress path — both project identically by construction.
- `context-pack-assembler.ts`: `ContextPackAnalysisOption.goal_fit_probability`
  (raw), resolved by STRUCTURAL `option_id` first (relabelled options still
  match), label only for id-less signals; shared by leading/runner-up/options
  so one option can never show a value in one slot and not another.
- `format-analysis-for-context.ts` (display-safe, doctrine A2):
  - per-option `target_fit` integer-percent strings (the established win%
    pattern), clearly distinguished from `win_probability`;
  - `goal_fit` prose is now **never silent** — three disclosed states:
    1. values present → definition sentence stated ONCE
       (`TARGET_FIT_DEFINITION`: win% = "beats the alternatives most often",
       target_fit = "meets your target") + the modelled-basis caveat;
    2. provenance scored but no values → basis phrase + explicit
       values-missing disclosure;
    3. nothing attests scoring → `GOAL_FIT_NOT_SCORED_LINE`
       ("target-fit not scored: … win probabilities show how often each
       option leads, not whether it meets your target").
- RED-first: divergent fixture (win 0.89 vs goal-fit 0.293) — the formatted
  section must contain the goal-fit percent and must NOT attribute the win
  percent to the target.

### 2. #369 audit P1 — tipping/VOI lever-suppression bypass (`8aad793bc`)

`projectAnalysis` filtered `top_drivers` + `fragile_edges` by the
intervention-controlled factor set, but sections 5 (`flip_thresholds`) and
7 (`evidence_gaps`) did NOT — and both signal types dropped `factor_id` at
derivation, making a structural filter impossible. A lever suppressed from
the driver list could still surface as a tipping point or an evidence gap.

- Both signal types now carry `factor_id` (TRUE ids only — never a label
  promoted to an id); `FlipThreshold` gains an INTERNAL `factor_id`
  (populated by `deriveFlipThresholds`) so the per-option fallback path is
  filterable too.
- New shared `filterLeverControlledFactorEntries`: structural `factor_id`
  authority only; FAIL-CLOSED on unattributable entries when levers exist;
  no-op on an empty set; projected shapes unchanged (ids never serialise).
- Suppression logs under the EXISTING
  `v5.intervention_controlled_driver_suppressed` event with a
  section-specific `source` (frozen telemetry registry respected).

### 3. Confidence tier + per-option outcome bands (`6a8e9045c`)

- `confidence_tier` (top-level ordinal token, attested values
  `strong|fair|needs_work`, already on the compose transport keep-list) →
  projected raw, rendered as prose (`"analysis confidence needs work"`;
  unknown tokens humanised, never echoed raw).
- Per-option `outcome_mean` → banded `outcome_band` (shared influence-band
  vocabulary + sign; near-zero → "roughly neutral modelled outcome";
  presentation bands, not science). Derived from the enrichment rows ONLY —
  `OptionSummary.outcome_mean` is deliberately not read because its upstream
  0-default is indistinguishable from an honest zero.

### 4. Runtime char-budget guard (`a0409528a`)

`DISPLAY_ANALYSIS_CHAR_BUDGET` (4000 chars, 2-space-indented serialisation)
was test-asserted only. Now runtime-enforced in `formatAnalysisForContext`:
graceful keep-priority truncation (drop order: VOI → tipping → fragile edges
→ top_drivers → options tail-trim to min 2 → options wholesale; the leading
pair, margin, robustness, `goal_fit`, `confidence_tier` and `status` are
never dropped — goal-fit truthfulness outranks breadth), ALWAYS disclosed
via `truncation_note`. Nothing is sliced mid-string.

## Record corrections issued (fix 5)

Recorded at the top of `LANE21-analysis-context-pack-2026-07-08.md` and as a
comment on merged PR #369:

1. Stage C's "live failure mode" (unusable no-identity `option_comparison[]`)
   was demonstrated on a synthetic fixture only; the in-repo live capture has
   full option identity on every entry. The gate stands as defensive coding;
   its motivating scenario is unattested on live data.
2. The "full-analysis coverage" title overstated: `confidence_tier`,
   per-option outcome bands, per-option goal-fit VALUES and `zero_reason`
   were all absent from the Lane 21 projection.

## Out of scope / deliberate stops

- **`zero_reason` carriage** — doctrine open. PLoT emits
  `zero_reason: 'intervention_override'` on option-pinned levers;
  CEE's headline detector reads it (`analysis-result-headline.ts`) but the
  ContextPack projection does not carry it. Whether the LLM should SEE
  "this factor was zeroed because an option pins it" is a claim-doctrine
  decision (it borders on lever-identity disclosure) — documented here, not
  implemented.
- **Prompt content** (how the LLM is INSTRUCTED to use target_fit) is
  Brief I's lane; this lane only makes the received context truthful.
- The per-option goal-fit resolver reads `OptionSummary.probability_of_goal`
  as its first source. Today no producer populates it (compactAnalysis reads
  the flat `probability_of_goal` key, which the live shape does not carry —
  it carries `probability_of_joint_goal`); the signal path is the live
  carrier. Teaching `compactAnalysis` to read `probability_of_joint_goal`
  would change the shared V4 shape and was deliberately not done here.

## Gates (per commit + final)

- `pnpm typecheck:src` (tsc -p tsconfig.build.json) — clean after every fix.
- FULL-tsconfig ratchet (`scripts/ci/typecheck-ratchet.sh`) — 462/462
  baseline held after every fix (no new test-file type errors).
- Targeted suites (`src/orchestrator-v5/context/__tests__` +
  `src/orchestrator-v5/format/__tests__`): 662 → 669 → 681 → 686, all green.
- `tests/unit/orchestrator/context/analysis-compact.test.ts` 42/42 after the
  `FlipThreshold.factor_id` addition.
- Final: `pnpm test:required` — result recorded in the PR body.
- RED-first evidence: fix 1 — 8 failing tests before implementation;
  fix 2 — 8; fix 3 — 11; fix 4 — 4.
