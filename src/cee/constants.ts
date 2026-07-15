/**
 * CEE Shared Constants
 *
 * Re-exports canonical CIL constants from @talchain/schemas to avoid
 * circular dependencies between modules and prevent definition drift.
 */

import {
  STRENGTH_DEFAULT_SIGNATURE,
  STRENGTH_DEFAULT_THRESHOLD,
  STRENGTH_MEAN_DEFAULT_THRESHOLD,
  STRENGTH_DEFAULT_MIN_EDGES,
  EDGE_STRENGTH_LOW_THRESHOLD as _EDGE_STRENGTH_LOW_THRESHOLD,
  EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD,
} from "@talchain/schemas";

/**
 * Default strength mean value applied when LLM omits strength data.
 * Source: @talchain/schemas STRENGTH_DEFAULT_SIGNATURE.mean
 */
export const DEFAULT_STRENGTH_MEAN = STRENGTH_DEFAULT_SIGNATURE.mean;

/**
 * Default strength std value derived when LLM omits strength data.
 * Source: @talchain/schemas STRENGTH_DEFAULT_SIGNATURE.std
 */
export const DEFAULT_STRENGTH_STD = STRENGTH_DEFAULT_SIGNATURE.std;

/**
 * Threshold for dominant strength mean default detection (70%).
 * Source: @talchain/schemas STRENGTH_MEAN_DEFAULT_THRESHOLD
 */
export const STRENGTH_MEAN_DOMINANT_THRESHOLD = STRENGTH_MEAN_DEFAULT_THRESHOLD;

/**
 * Threshold for EDGE_STRENGTH_LOW warning.
 * Source: @talchain/schemas EDGE_STRENGTH_LOW_THRESHOLD
 */
export const EDGE_STRENGTH_LOW_THRESHOLD = _EDGE_STRENGTH_LOW_THRESHOLD;

/**
 * NaN-fix default std value applied in deterministic-sweep.ts when
 * edge.strength_std is NaN. Aligned with DEFAULT_STRENGTH_STD (0.125)
 * so the integrity sentinel detects both transform defaults and NaN-fix
 * repairs with a single signature.
 */
export const NAN_FIX_SIGNATURE_STD = DEFAULT_STRENGTH_STD;

/**
 * Floor for strength_std at the LLM response boundary.
 *
 * Prevents degenerate zero-variance edges from entering the pipeline.
 * Defence-in-depth: PLoT also enforces FLOOR_STRENGTH_STD downstream.
 *
 * Note: Other layers use different floors for different purposes:
 * - schema-v3.ts STRENGTH_STD_FLOOR (1e-6) — mathematical non-zero in V3 transforms
 * - graph-normalizer.ts STD_FLOOR (0.01) — ISL value-relative uncertainty
 * - validation-pipeline WEAK_GUESS_STD_FLOOR (0.15) — enforcement for weak-basis edges
 */
export const LLM_STRENGTH_STD_FLOOR = 0.001;

/**
 * Floor applied to a non-positive sigma (edge `strength.std`, node
 * `observed_state.std`) at the COMPUTE boundary — PLoTClient.run, the single
 * choke point both PLoT dispatches funnel through, and the last place the
 * graph is touched before it leaves CEE for compute.
 *
 * Named for the compute seam, NOT for ingress: ingress deliberately does not
 * repair. Rewriting sigma at ingress forks graph identity (`strength.std` is
 * in the analysis-affecting hash projection) and desyncs every hash token
 * minted off the unrepaired persisted graph. See the doctrine in
 * src/validators/numeric-bounds.ts for the full account.
 *
 * Deliberately the same number as LLM_STRENGTH_STD_FLOOR — one source of
 * truth for "the smallest sigma CEE lets into the pipeline".
 *
 * Magnitude rationale: sigma <= 0 means "no uncertainty stated", so the floor
 * must preserve "essentially certain" rather than fabricate uncertainty the
 * user never expressed. A large floor (e.g. the 0.15 weak-guess floor) would
 * silently change analysis results.
 */
export const COMPUTE_SIGMA_FLOOR = LLM_STRENGTH_STD_FLOOR;

/**
 * Nudge appended to the user message when retrying due to default strength
 * detection. Instructs the LLM to differentiate edge strengths rather than
 * using the same value for every relationship.
 */
export const STRENGTH_DEFAULT_RETRY_NUDGE =
  "IMPORTANT: Your previous output used identical edge strengths (0.5) for most relationships. " +
  "This produces uninformative analysis. Differentiate edge strength.mean values based on the " +
  "relative causal influence of each relationship. Use the full range: strong effects (0.6-0.9), " +
  "moderate (0.3-0.5), weak (0.1-0.2). Each edge should reflect your assessment of that specific " +
  "mechanism's strength. Revisit each causal relationship in this decision and assign strengths " +
  "that reflect the specific mechanism described in the brief.";

// Re-export additional thresholds from shared package for direct use
export {
  STRENGTH_DEFAULT_THRESHOLD,
  STRENGTH_DEFAULT_MIN_EDGES,
  EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD,
};
