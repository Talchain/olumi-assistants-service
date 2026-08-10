/**
 * ROADMAP 2.692 — THE UNCERTAINTY THIS RESULT IS MOST SENSITIVE TO.
 *
 * Pure: no I/O, no LLM, no clock, no config read — a total function of one
 * `enrichment` object, exactly like `selectLens` and `selectFragileEdge`, so it
 * can be replayed over a captured enrichment and give the same answer.
 *
 * ── ⛔ THIS MODULE HAS NO PRODUCTION CALLER, BY RULING. READ BEFORE WIRING IT ──
 *
 * There WAS a lens (`uncertainty_reduction_priority`) that consumed this
 * derivation and rendered it as coaching. It was built, reviewed, measured, and
 * then REMOVED before merge on a science ruling. This is a deliberate
 * no-consumer-yet state, not an oversight, and not a capability someone forgot
 * to plug in. **Do not add a consumer without clearing the gate below.**
 *
 * THE GATE. ISL's science-validation report states, verbatim:
 *   `docs/science-validation/REPORT.md:344-346` (ISL `staging` @ `28fe0c95`,
 *   dated 2026-07-07) — *"EVPI user-facing language remains banned pending
 *   doctrine."*
 *
 * IT IS LIVE, and that is a DERIVATION rather than a reading:
 *   (1) **Nothing lifts it.** Complete scope searched — all of ISL `docs/` and
 *       `src/`, case-insensitive, `rg --text`. The phrase family matches
 *       EXACTLY ONE FILE: the report that states the ban.
 *   (2) **Its gating condition is unmet.** The ban is "pending doctrine"; the
 *       shipped doctrine constant at the same tip is still
 *       `EVPI_LABELLING_DOCTRINE = "provisional_doctrine_v0"`
 *       (`robustness_analyzer_v2.py:211`), stamped onto every emitted row at
 *       `:7509`. A ban pending X, where X has not happened, is a live ban.
 *   (3) **An open finding points the same way.** Report finding 4: common-mode
 *       factors are structurally zero under `p_win` however strongly they drive
 *       the goal, and *"doctrine should preclude narrating such values"* —
 *       unactioned. The `status === 'resolved'` gate below materially NARROWS
 *       that exposure (proven by a biting mutant) but does not EXCLUDE it, and
 *       the standing rule is to prefer showing nothing over showing a number
 *       that cannot be justified.
 *
 * ⚠ THE COUNTER-READING, RECORDED BECAUSE IT IS THE TEMPTING ONE AND IT WAS
 *   REJECTED: the ban says "**EVPI** user-facing language", and ISL says of this
 *   very field that *"calling it EVPI was a mislabel"* — so one could argue the
 *   rename puts it out of scope. **A rename means the NAME was wrong, not that
 *   the narration constraint lapsed.** These rows still carry the EVPI labelling
 *   machinery (`status`, `noise_floor`, `noise_floor_method`,
 *   `labelling_doctrine`) and report findings 3 and 4 are about THIS quantity.
 *
 * WHAT WOULD LIFT IT: a non-provisional EVPI labelling doctrine at ISL (the
 * constant moving off `provisional_doctrine_v0`), or an explicit science
 * sign-off scoping `p_win_sensitivity` out of the ban. Either is a ruling, not a
 * lane's call. The copy and its prohibition guard are PARKED, not deleted —
 * see {@link UNCERTAINTY_PRIORITY_BODY_PENDING_DOCTRINE} — so the re-add is a
 * short, mechanical change rather than a rebuild.
 *
 * ── ⚠⚠ THE PREMISE THIS MODULE WAS BRIEFED ON WAS WRONG, AND THE CORRECTION IS
 *        THE POINT OF THIS COMMENT ──────────────────────────────────────────
 * The 2.692 design files `p_win_sensitivity` under *"Real per-factor EVPI"*, and
 * CEE's own `context/enrichment-manifest.ts` calls the four ISL top-level keys
 * "the VOI family". **ISL says otherwise, in its own words, at
 * `src/models/response_v2.py:1766-1771` (staging `28fe0c95`):**
 *
 *     "This is NOT value-of-information: holding the decision fixed, it
 *      structurally cannot capture option-switching, and it is in probability
 *      (not outcome) units, with its OWN Monte Carlo redraw (not the CRN joint
 *      population). For decision value use `decision_evpi` (whole decision) and
 *      `factor_evppi` (per-factor), both in outcome units."
 *
 * and at `robustness_analyzer_v2.py:7473-7485`: *"calling it EVPI was a
 * mislabel."*
 *
 * So a lens built from the design's framing would have told users that resolving
 * this factor **would change their decision** — a claim the producer states it
 * structurally cannot support. That is CLAUDE.md trap 13c exactly: an
 * expectation written from the implementer's reading rather than the producer's
 * semantics, which a full mutant kit would have certified with a perfect score
 * against the wrong oracle. Every claim this module licenses is therefore
 * derived from the ISL bytes above and NOT from the design brief.
 *
 * ── WHAT THE QUANTITY ACTUALLY IS ────────────────────────────────────────────
 * `p_win_delta = perfect_metric − current_metric`, where `current_metric` is the
 * metric with all uncertainties active and `perfect_metric` is the metric with
 * THIS ONE factor's uncertainty removed (fixed at its mean), the DECISION HELD
 * FIXED at the recommended option throughout
 * (`robustness_analyzer_v2.py:7455, :7313-7315`). The metric is named by
 * `metric_type` and is `p_win_recommended` **or** `p_joint_goal` when the request
 * carried goal constraints (`:7493-7495`) — which is why the copy this module
 * licenses must be METRIC-NEUTRAL: naming "the chance your front-runner wins"
 * would be false on a joint-goal run.
 *
 * Honest one-line gloss, and the only claim licensed:
 *   *the uncertainty this run's result is most sensitive to.*
 * NOT "resolving this would change your decision" — that is option-switching,
 * and it is `factor_evppi`'s question, not this one.
 *
 * ── WHY THIS FIELD AND NOT `factor_evppi` (the genuine VOI) ──────────────────
 * MEASURED over the two committed captures — the whole in-repo evidence base:
 *   `factor_evppi`     — 1 row each, **0 of 2 captures** carry a `resolved` row.
 *   `p_win_sensitivity`— 4 and 6 rows, **1 of 2 captures** carries a `resolved`
 *                        row (session-b2, `fac_energy`).
 * Building on `factor_evppi` today is building a structurally-dark capability
 * (the l47 depth finding the design itself records). `factor_evppi` remains the
 * better quantity the day it resolves; this module is deliberately shaped so
 * that adding it later is a second refusal-reason and a second row, not a
 * rewrite.
 *
 * ── THE GATE IS THE PRODUCER'S OWN, AND ITS STRENGTH IS DISCLOSED ────────────
 * `status: 'resolved' | 'below_resolution'` is ISL's own noise-floor test:
 * `below_resolution = abs(delta) < evpi_noise_floor(n)` with
 * `evpi_noise_floor(n) = 1.96 * sqrt(0.5/n)` (`:7470-7471`, `:807-817`). This
 * module NEVER re-derives it from the emitted numbers — the emitted `p_win_delta`
 * and `noise_floor` are rounded to 6dp, so a consumer re-deriving the label can
 * disagree with the producer inside ~1e-6 of the boundary. Read the LABEL.
 *
 * ISL's own science validation bounds what `resolved` means
 * (`docs/science-validation/REPORT.md:362-364`): *"`resolved` is a 95% claim …
 * ≈ 1 in 20 truly-zero factors will be labelled resolved … treat `resolved` as
 * 'distinguishable from noise at 95%', not 'real'."* The copy in
 * `lens-selector.ts` carries that hedge; it is not optional.
 *
 * ── ORDER IS THE PRODUCER'S; ABSENCE IS A VERDICT ────────────────────────────
 * ISL sorts DESCENDING by `p_win_delta` with no tie-break, stable, so ties keep
 * request order (`:7513-7516`). PLoT forwards the array **verbatim** — a
 * reference copy through `islEnrichmentPassthrough`
 * (`plot src/routes/v2/run-contract-keys.ts:36-64` @ `b9f6b5a7`), no clone, sort,
 * filter or default. This module therefore takes the producer's FIRST resolved
 * row and never re-ranks; re-sorting here would be a second opinion about
 * importance computed from a subset of the producer's inputs.
 *
 * The phase is ALL-OR-NOTHING (`:7326-7331`): the array is present in full or
 * absent, never partial. And **absence is a VERDICT, never "nothing to
 * resolve"** — it can mean the EVPI phase overran its budget, or that the
 * attribution was SUPPRESSED because correlation is active, in which case ISL
 * names it in `correlation_model.suppressed_attributions` (`:2585-2587`; PLoT's
 * egress guard restates this at `enrichment-egress-guard.ts:444-446`). The two
 * are given DIFFERENT refusal reasons below, because collapsing them would make
 * a suppression indistinguishable from a quiet run.
 *
 * ── WHAT MAY LEAVE THIS MODULE ───────────────────────────────────────────────
 * The factor IDENTITY and nothing else. No `p_win_delta`, no percentage points,
 * no `current_metric`/`perfect_metric`. `p_win_sensitivity` is not on the Tier-2
 * claim allow-list (`compose/claim-safety-cage.ts`), and CEE's own manifest
 * records the licence: *"the licensed surface for this data is a DETERMINISTIC
 * composer rendering a RANKING with no magnitudes"*
 * (`context/enrichment-manifest.ts::R_VOI_NOT_COACH_NARRATED`). A quantity absent
 * from the returned type cannot be surfaced by a later caller.
 */

/** Why no factor was named. Closed enum — the telemetry payload's reason tag. */
export type UncertaintyPriorityRefusal =
  /** ISL suppressed the attribution because correlation is active. */
  | 'suppressed_under_correlation'
  /** The producer emitted no `p_win_sensitivity` array (not computed / budget). */
  | 'no_p_win_sensitivity'
  /** Rows exist, none passed the producer's own noise-floor test. */
  | 'no_resolved_row'
  /** The resolved row carries no usable `factor_id` to bind a claim to. */
  | 'no_factor_identity';

/**
 * The one named factor. IDENTITY-BEARING and deliberately QUANTITY-FREE.
 * `metricType` is carried because the copy must not name a metric the run did
 * not compute — it is a closed producer label, not a magnitude.
 */
export interface UncertaintyPrioritySelection {
  readonly factorId: string;
  /** ISL's own `metric_type`; `null` when the producer omitted it. */
  readonly metricType: string | null;
}

/** The decision, BOTH ARMS — one value so the caller emits one event either way. */
export interface UncertaintyPriorityDecision {
  readonly selected: UncertaintyPrioritySelection | null;
  readonly refusalReason: UncertaintyPriorityRefusal | null;
  /** Rows the producer emitted (0 when the array is absent). Structured only. */
  readonly rowCount: number;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** ISL's own suppression manifest, read defensively. */
function isSuppressedUnderCorrelation(enrichment: Record<string, unknown>): boolean {
  const model = readRecord(enrichment.correlation_model);
  if (model === null) return false;
  const suppressed = model.suppressed_attributions;
  if (!Array.isArray(suppressed)) return false;
  return suppressed.some((s) => s === 'p_win_sensitivity');
}

/**
 * The factor whose uncertainty this run's result is most sensitive to, or a
 * REFUSAL. Total: every input shape returns a decision, and `selected === null`
 * always carries a reason.
 */
export function selectUncertaintyPriority(enrichmentInput: unknown): UncertaintyPriorityDecision {
  const enrichment = readRecord(enrichmentInput);
  if (enrichment === null) {
    return { selected: null, refusalReason: 'no_p_win_sensitivity', rowCount: 0 };
  }

  const rows = enrichment.p_win_sensitivity;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Absence is a VERDICT. Name the suppression case separately so a
    // correlation-suppressed run is never reported as a quiet one.
    return {
      selected: null,
      refusalReason: isSuppressedUnderCorrelation(enrichment)
        ? 'suppressed_under_correlation'
        : 'no_p_win_sensitivity',
      rowCount: 0,
    };
  }

  // PRODUCER ORDER, consumed not re-derived: the first row ISL's own noise-floor
  // test marked `resolved`. Never `Math.max` over the magnitudes — that would be
  // this module re-ranking the producer (and would read the rounded wire values
  // the label was NOT derived from).
  for (const raw of rows) {
    const row = readRecord(raw);
    if (row === null) continue;
    if (row.status !== 'resolved') continue;
    const factorId = nonEmptyString(row.factor_id);
    if (factorId === null) {
      // A resolved row we cannot bind a claim to by IDENTITY. Fail closed on
      // THIS row rather than falling through to a weaker one: the producer put
      // it first, so a lower row is not "the most sensitive uncertainty".
      return { selected: null, refusalReason: 'no_factor_identity', rowCount: rows.length };
    }
    return {
      selected: { factorId, metricType: nonEmptyString(row.metric_type) },
      refusalReason: null,
      rowCount: rows.length,
    };
  }

  return { selected: null, refusalReason: 'no_resolved_row', rowCount: rows.length };
}

// ============================================================================
// PARKED USER-FACING COPY — reviewed, corrected, and NOT WIRED
// ============================================================================

/**
 * ⛔ NOT RENDERED ANYWHERE. Parked pending the science gate in this module's
 * header. Kept in the tree rather than deleted because it is the expensive part
 * of the work and it is CORRECT: it survived an adversarial review that found
 * three substantive defects in its predecessor, and it is held to its claims
 * MECHANICALLY by `compose/__tests__/uncertainty-copy-claim-shapes.test.ts`,
 * which pins every prohibited construction against the ISL citation that makes
 * it prohibited. That guard binds to THESE constants, so the copy cannot rot
 * while it waits.
 *
 * Every clause is bounded by the producer's own semantics, and the five things
 * it must NOT say are as load-bearing as what it does say:
 *   (a) NOT "this would change your decision" / "which option wins" — ISL:
 *       "holding the decision fixed, it structurally cannot capture
 *       option-switching" (`response_v2.py:1766-1771`).
 *   (b) NOT "value of information" or "worth X" — ISL: "calling it EVPI was a
 *       mislabel" (`robustness_analyzer_v2.py:7473-7485`). The genuine VOI
 *       quantities are `decision_evpi` / `factor_evppi`, in outcome units.
 *   (c) NO MAGNITUDE, and no naming of WHICH metric moved: `metric_type` is
 *       `p_win_recommended` OR `p_joint_goal`, so "the chance your front-runner
 *       wins" would be FALSE on a goal-constrained run. Metric-neutral.
 *   (d) NOT "of everything uncertain here" — FALSE SCOPE, and a fact about the
 *       sweep's INPUT: it ranks only `request.parameter_uncertainties`. Edge and
 *       structural uncertainty run in BOTH arms and are never ranked.
 *   (e) NOT "its own measurement noise" — the floor is `1.96*sqrt(0.5/n)`, a
 *       function of the SAMPLE COUNT alone and identical for every factor in the
 *       run. It is the RUN's floor, not the factor's.
 *
 * ⚠⚠ ALL FIVE WERE DERIVED CORRECTLY AND THE FIRST DRAFT STILL VIOLATED (a) IN
 * SUBSTANCE, avoiding every banned WORD: *"the picture steadies more than it
 * would from anything else you could look into"* is a comparative
 * value-of-information claim wearing plain English. It was caught by adversarial
 * review, not by the comment that had stated the prohibition correctly — which
 * is why the prohibitions are mechanical now. **A COMMENT IS NOT A GUARD.**
 * (Trap 13c one level up: a correct oracle, and an expectation that slipped past
 * it because nothing was checking.)
 *
 * The hedge in the final sentence is ISL's own — its science validation says
 * *"treat `resolved` as 'distinguishable from noise at 95%', not 'real'"*
 * (`REPORT.md:362-364`); roughly one in twenty truly-zero factors is labelled
 * resolved. It is not a caveat to be tidied away, and the guard asserts the body
 * fits `BODY_MAX` precisely so truncation can never eat it — which it caught on
 * day one, at 303 characters against a cap of 300. A truncated hedge is worse
 * than no hedge.
 */
export const UNCERTAINTY_PRIORITY_TITLE_PENDING_DOCTRINE =
  'Strengthen your model: pin down the assumption this run is most sensitive to';

/** @see {@link UNCERTAINTY_PRIORITY_TITLE_PENDING_DOCTRINE} — parked, not wired. */
export const UNCERTAINTY_PRIORITY_BODY_PENDING_DOCTRINE =
  "Of the parameter uncertainties this run measured, the headline number moves most with one: pinning down what you believe about it would steady that number most. This ranks how far the number moves, not what you should do. It cleared the run's noise floor — a strong hint, not a settled fact.";
