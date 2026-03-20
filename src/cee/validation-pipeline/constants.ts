/**
 * Validation Pipeline — Threshold Constants
 *
 * Every tunable constant lives here. Import from this module — no magic numbers
 * anywhere else in the validation pipeline.
 *
 * Source of truth: validation_comparison_spec_v1_4.md (with EP boundaries
 * corrected to [0.5, 0.70, 0.93] per v1.4.1 revert).
 */

export const VALIDATION_CONSTANTS = {
  // ── Strength band boundaries (core ranges only) ──────────────────────────
  // Buffer zones sit between adjacent core ranges:
  //   negligible core: |mean| < 0.05
  //   buffer: 0.05 – 0.10
  //   weak core: 0.10 – 0.25
  //   buffer: 0.25 – 0.30
  //   moderate core: 0.30 – 0.55
  //   buffer: 0.55 – 0.65
  //   strong core: >= 0.65
  STRENGTH_NEGLIGIBLE_MAX: 0.05,
  STRENGTH_WEAK_CORE_MIN: 0.10,
  STRENGTH_WEAK_CORE_MAX: 0.25,
  STRENGTH_MODERATE_CORE_MIN: 0.30,
  STRENGTH_MODERATE_CORE_MAX: 0.55,
  STRENGTH_STRONG_CORE_MIN: 0.65,

  // ── Confidence band boundaries (core ranges only) ────────────────────────
  // Buffer zones:
  //   high core: std < 0.08
  //   buffer: 0.08 – 0.12
  //   moderate core: 0.12 – 0.18
  //   buffer: 0.18 – 0.22
  //   low core: >= 0.22
  CONFIDENCE_HIGH_MAX: 0.08,
  CONFIDENCE_MODERATE_MIN: 0.12,
  CONFIDENCE_MODERATE_MAX: 0.18,
  CONFIDENCE_LOW_MIN: 0.22,

  // ── EP semantic boundaries ────────────────────────────────────────────────
  // An edge is contested if pass1 and pass2_adjusted sit on opposite sides of
  // any of these three thresholds. Reverted to 0.70 from 0.75 per v1.4.1.
  EP_BOUNDARIES: [0.5, 0.70, 0.93] as const,

  // ── Raw catch-all threshold ───────────────────────────────────────────────
  // Flag if |Δmean| exceeds this, and none of rules 1–4 already triggered.
  RAW_DELTA_THRESHOLD: 0.20,

  // ── Bias correction ───────────────────────────────────────────────────────
  // If |offset| for any parameter exceeds this limit, discard that offset and
  // log WARN_EXTREME_BIAS_OFFSET instead of applying it.
  EXTREME_BIAS_OFFSET_LIMIT: 0.3,

  // ── Enforcement lints ─────────────────────────────────────────────────────
  DOMAIN_PRIOR_EP_CAP: 0.95,
  WEAK_GUESS_EP_CAP: 0.75,
  WEAK_GUESS_STD_FLOOR: 0.15,
  /** std is clamped to |mean| * this ratio when std > |mean|. */
  STD_CLAMP_RATIO: 0.8,
  /** Maximum allowed Σ|mean| for all inbound edges of a single target node. */
  BUDGET_SUM_MAX: 1.0,
  /** EP range threshold for the WARN_CLUSTERED_EP detection lint. */
  WARN_CLUSTERED_EP_RANGE: 0.05,

  // ── Distance-to-goal sentinel ────────────────────────────────────────────
  /** Sentinel for unreachable nodes. Must be a finite number because
   *  JSON.stringify(Infinity) → null, which would corrupt the response. */
  UNREACHABLE_DISTANCE: 999,

  // ── Max divergence score normalisation ────────────────────────────────────
  /** Divisor for the raw_score component: raw_score = min(1, |Δmean| / divisor). */
  MAX_DIVERGENCE_MEAN_DIVISOR: 0.5,
  /** Total number of strength band steps (used to normalise band_score). */
  STRENGTH_BAND_STEPS: 3,
  /** Total number of EP boundaries (used to normalise ep_score). */
  EP_BOUNDARY_COUNT: 3,
} as const;
