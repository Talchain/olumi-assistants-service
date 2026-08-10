/**
 * ROADMAP 2.692 — THE UNCERTAINTY THIS RESULT IS MOST SENSITIVE TO.
 *
 * Pure: no I/O, no LLM, no clock, no config read — a total function of one
 * `enrichment` object, exactly like `selectLens` and `selectFragileEdge`, so it
 * can be replayed over a captured enrichment and give the same answer.
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
