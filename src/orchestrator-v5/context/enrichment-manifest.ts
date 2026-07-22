/**
 * Context-audit #1 (CONTEXT-SYSTEM-AUDIT-2026-07-22, keep-list inventory row
 * #2) — the enrichment→LLM silent-drop conformance surface.
 *
 * The PLoT→CEE enrichment payload is the estate's known-open seam: an untyped
 * `z.record` passthrough that the run-analysis handler persists BYTE-FOR-BYTE
 * as `result.enrichment` (run-analysis.ts §6). The analysis→LLM projection
 * (`./analysis-signals.ts` derivers + the `applyTopLevel*` overrides in
 * `./analysis-fallback.ts`) then reads a HAND-PICKED subset of that record's
 * top-level keys. A key PLoT emits but no deriver reads is invisible to the
 * coach — this exact class already produced a live false claim (scenario
 * 90385279: win% narrated as target-fit before `probability_of_joint_goal`
 * was projected). Full derivation is impossible (the seam is untyped), so this
 * module is the fail-loud substitute:
 *
 *   1. {@link ENRICHMENT_PRODUCER_MANIFEST} — every TOP-LEVEL field the
 *      PERSISTED run_analysis enrichment can carry. This is a MULTI-WRITER
 *      record, not a pure PLoT passthrough: the run-analysis handler stores
 *      the PLoT `/v2/run` body verbatim (the 64 `RunResponseV3` keys), then
 *      CEE enrichers WRITE 4 more keys onto the same record (decision_review +
 *      3 coaching-signal markers) before the analysis→LLM projection reads it,
 *      and one legacy V1-tolerance key (`results`) rounds out the boundary
 *      contract. Manifesting the CEE-injected keys is load-bearing — omitting
 *      them would false-positive the runtime tripwire on every run_analysis
 *      fact. It is NOT the CEE→UI transport keep-list and NOT
 *      `AnalysisEnrichmentSchema` (both are subsets).
 *   2. {@link ENRICHMENT_ANALYSIS_LLM_SKIP} — every manifest field the
 *      analysis→LLM projection deliberately does NOT read, each with a reason.
 *      The conformance test (see `__tests__/enrichment-manifest.conformance
 *      .test.ts`) asserts runtime-observed-reads ∪ skip == manifest EXACTLY,
 *      so a new PLoT field that is neither derived nor skipped goes RED.
 *   3. {@link emitUnknownEnrichmentKeyTelemetry} — the RUNTIME tripwire. When a
 *      persisted enrichment carries a top-level key not in the manifest, emit
 *      loud structured telemetry (key name sanitised + capped, never values).
 *      Observe-only: it NEVER throws and NEVER blocks the projection.
 *
 * ── Manifest source (derive-don't-mirror evidence) ─────────────────────────
 * Derived by READING the PLoT producer at plot-lite-service staging tip
 * `51abbc80` — the `RunResponseV3` response interface
 * (`src/types/engine-v3.ts:888-1487`), emitted by the body assembler
 * (`src/routes/v2/run.ts:3202-3586`). PLoT's own producer guard validates that
 * body against the SAME vendored `AnalysisEnrichmentSchema` (`run.ts:3588`).
 * Cross-checked against the CEE staging capture
 * `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`, whose
 * `analysis_result` block enrichment carries 40 of these 64 keys live (the
 * other 24 are request-gated: constraints, thresholds, path-decomposition,
 * auto-noise, flip-margin sidecars). Every entry below cites its
 * `engine-v3.ts` line.
 *
 * WHEN PLoT ADDS A TOP-LEVEL FIELD: the runtime tripwire fires on the first
 * live payload carrying it; add the key here (with its citation) and the
 * conformance test then forces a conscious choice — wire a deriver, or list it
 * in {@link ENRICHMENT_ANALYSIS_LLM_SKIP} with a reason. Neither ⇒ RED.
 */

import { log } from '../../utils/telemetry.js';

/**
 * Every TOP-LEVEL key the persisted run_analysis `enrichment` can carry.
 *
 * Sections: (a) the 64 PLoT `/v2/run` `RunResponseV3` keys — citations are
 * `engine-v3.ts` line numbers at plot-lite-service tip `51abbc80`, grouped by
 * the interface's own section headers; (b) 4 CEE-injected keys written onto
 * the same record after PLoT returns; (c) 1 legacy V1 inbound-tolerance key.
 */
export const ENRICHMENT_PRODUCER_MANIFEST: ReadonlySet<string> = new Set<string>([
  // Envelope identity / status spine (:890-939)
  'request_schema_version', // :890
  'endpoint_version', // :892
  'preflight_version', // :894
  'request_id', // :897
  'analysis_status', // :906
  'status_reason', // :911
  'approximate', // :921
  'option_comparison_status', // :927
  'robustness_status', // :933
  'drivers_status', // :939
  // Multi-constraint analysis (:950-968)
  'constraints_status', // :950
  'constraint_results', // :956
  'constraint_diagnostics', // :962
  'conditional_probabilities', // :968
  // Auto-noise disclosure (:980-989)
  'auto_noise_applied', // :980
  'auto_noise_provenance', // :989
  // ISL status echo (:994-999)
  'isl_analysis_status', // :994
  'isl_status_reason', // :999
  // Science payloads (:1002-1091)
  'critiques', // :1002
  'option_comparison', // :1005
  'edge_sensitivity', // :1017
  'sensitivity_reference_option_id', // :1030
  'path_decomposition', // :1042
  'factor_sensitivity', // :1045
  'factor_stability', // :1055
  'stability_thresholds', // :1065
  'edge_e_values', // :1072
  'conditional_winners', // :1080
  'inference_warnings', // :1091
  // Coaching / confidence (:1101-1146)
  'factor_enrichments', // :1101
  'm1_coaching', // :1112
  'confidence_tier', // :1123
  'dominant_factor', // :1132
  'flip_thresholds', // :1146
  // Flip-threshold display sidecars (:1165-1232)
  'flip_thresholds_status', // :1165
  'flip_thresholds_status_reason', // :1190
  'flip_thresholds_margin_status', // :1211
  'flip_thresholds_margin_coverage', // :1228
  // Threshold analysis, request-gated (:1249-1262)
  'thresholds_status', // :1249
  'thresholds_meta', // :1252
  'threshold_analysis', // :1262
  // Identifiability (:1276)
  'identifiability', // :1276
  // M2 decision review (:1289-1337)
  'm1_review', // :1289
  'review_status', // :1298
  'review_meta', // :1304
  'review_failure_codes', // :1315
  'review_warnings', // :1321
  'review_skip_reason', // :1328
  'robustness', // :1331
  'robustness_synthesis', // :1337
  // CEE Results-panel fields (:1350-1374)
  'cee_status', // :1350
  'decision_quality', // :1356
  'insights', // :1362
  'improvement_guidance', // :1368
  'rationale', // :1374
  // Observability / artefacts / envelope trailers (:1380-1441)
  'ceeTrace', // :1380
  'processing_time_ms', // :1395
  'response_hash', // :1398
  'decision_brief', // :1407
  'review_cards', // :1418
  'fact_objects', // :1425
  '_meta', // :1432
  'downstream_calls', // :1438
  'meta', // :1441
  // ── CEE post-run additions to the SAME persisted enrichment record ────────
  // The run-analysis handler stores the PLoT body verbatim as
  // `result.enrichment` (run-analysis.ts:797), then CEE enrichers WRITE more
  // top-level keys onto it before the fact is read by the analysis→LLM
  // projection. The seam is a multi-writer record, not a pure PLoT
  // passthrough — these MUST be manifested or the runtime tripwire
  // false-positives on every run_analysis fact.
  'decision_review', // CEE-injected: turn-executor.ts:9462 (null) + coaching/decision-review-enricher.ts:339-340 (populated)
  'coaching_signal_id', // CEE-injected: coaching/coaching-signal-application.ts:150
  'coaching_signal_turn_id', // CEE-injected: coaching/coaching-signal-application.ts:151
  'coaching_signal_produced_at', // CEE-injected: coaching/coaching-signal-application.ts:152
  // ── Legacy V1 inbound-tolerance ───────────────────────────────────────────
  // Not emitted by the live PLoT /v2/run producer (RunResponseV3 has no
  // top-level `results`); emitted by the V1 bundle (plot v1/run.ts:589) and
  // typed on AnalysisEnrichmentSchema as deprecated-inbound-only
  // (@talchain/schemas boundary/enrichment). Kept for compact-path tolerance.
  'results',
]);

// Reason clusters for the intentionally-not-projected fields. Grouped so the
// map stays legible while every field is still listed explicitly (a bare set
// with no reasons would be the very hand-mirror this estate keeps paying for).
const R_STATUS_SPINE =
  'Status/envelope metadata — analysis status is projected via compactAnalysis, not re-read from these; identity/version/timing fields are not decision content.';
const R_UI_SCIENCE =
  'UI Results-panel science array — rendered by DGAI, not narrated by the coach; the coach sees banded influence/robustness via the projected drivers/robustness, not these raw arrays.';
const R_FLIP_SIDECAR =
  'Flip-threshold display-classification sidecar — the flip CONTENT is projected via flip_thresholds→tipping_points; these status/margin classifiers are UI-only.';
const R_THRESHOLD =
  'Request-gated ISL native threshold endpoint output — not part of the coaching surface.';
const R_AUTONOISE =
  'ISL auto-noise provenance sidecar — surfaced in UI debug, not coach-narrated.';
const R_DECISION_REVIEW =
  'M2 decision-review surface — projected via the SEPARATE decision_review prompt path (turn-executor enrichRunAnalysisWithDecisionReview), never the analysis→LLM ContextPack.';
const R_CEE_PANEL =
  'CEE Results-panel field — LLM-derived content re-fed to the UI; feeding it back into the coach context would be circular.';
const R_UI_ARTEFACT =
  'UI-facing artefact (leader band / cards / facts) — keep-listed to the UI transport, not the coach analysis projection.';
const R_INTERNAL =
  'Internal carrier / observability — stripped by compose.ts INTERNAL_ENRICHMENT_KEYS before UI transport; never coaching content.';
const R_COACHING_SIGNAL =
  'CEE-injected coaching-signal marker for the next turn coaching-cache reader (coaching-signal-application.ts) — routing metadata, not analysis content.';
const R_LEGACY_COMPACT =
  'Legacy V1 inbound-tolerance array — not emitted by the live /v2/run producer; consumed by the shared compactAnalysis projection (results[].factor_sensitivity / results[].robustness), not the row-#2 enrichment derivers.';

/**
 * Manifest fields the analysis→LLM projection deliberately does NOT read, each
 * with a reason. Its keys ∪ the runtime-observed derived reads MUST equal
 * {@link ENRICHMENT_PRODUCER_MANIFEST} exactly (conformance test). Adding a
 * deriver for one of these ⇒ remove it here; a new PLoT field ⇒ add a deriver
 * or add it here with a reason.
 */
export const ENRICHMENT_ANALYSIS_LLM_SKIP: ReadonlyMap<string, string> = new Map<string, string>([
  ['request_schema_version', R_STATUS_SPINE],
  ['endpoint_version', R_STATUS_SPINE],
  ['preflight_version', R_STATUS_SPINE],
  ['request_id', R_STATUS_SPINE],
  ['analysis_status', R_STATUS_SPINE],
  ['status_reason', R_STATUS_SPINE],
  ['approximate', R_STATUS_SPINE],
  ['option_comparison_status', R_STATUS_SPINE],
  ['robustness_status', R_STATUS_SPINE],
  ['drivers_status', R_STATUS_SPINE],
  ['constraints_status', R_STATUS_SPINE],
  ['isl_analysis_status', R_STATUS_SPINE],
  ['isl_status_reason', R_STATUS_SPINE],
  ['response_hash', R_STATUS_SPINE],
  ['processing_time_ms', R_STATUS_SPINE],
  ['edge_sensitivity', R_UI_SCIENCE],
  ['edge_e_values', R_UI_SCIENCE],
  ['conditional_winners', R_UI_SCIENCE],
  ['conditional_probabilities', R_UI_SCIENCE],
  ['constraint_results', R_UI_SCIENCE],
  ['constraint_diagnostics', R_UI_SCIENCE],
  ['path_decomposition', R_UI_SCIENCE],
  ['factor_stability', R_UI_SCIENCE],
  ['stability_thresholds', R_UI_SCIENCE],
  ['inference_warnings', R_UI_SCIENCE],
  ['sensitivity_reference_option_id', R_UI_SCIENCE],
  ['dominant_factor', R_UI_SCIENCE],
  ['flip_thresholds_status', R_FLIP_SIDECAR],
  ['flip_thresholds_status_reason', R_FLIP_SIDECAR],
  ['flip_thresholds_margin_status', R_FLIP_SIDECAR],
  ['flip_thresholds_margin_coverage', R_FLIP_SIDECAR],
  ['thresholds_status', R_THRESHOLD],
  ['thresholds_meta', R_THRESHOLD],
  ['threshold_analysis', R_THRESHOLD],
  ['auto_noise_applied', R_AUTONOISE],
  ['auto_noise_provenance', R_AUTONOISE],
  ['identifiability', R_UI_SCIENCE],
  ['m1_review', R_DECISION_REVIEW],
  ['review_status', R_DECISION_REVIEW],
  ['review_meta', R_DECISION_REVIEW],
  ['review_failure_codes', R_DECISION_REVIEW],
  ['review_warnings', R_DECISION_REVIEW],
  ['review_skip_reason', R_DECISION_REVIEW],
  ['robustness_synthesis', R_DECISION_REVIEW],
  ['cee_status', R_CEE_PANEL],
  ['decision_quality', R_CEE_PANEL],
  ['insights', R_CEE_PANEL],
  ['improvement_guidance', R_CEE_PANEL],
  ['rationale', R_CEE_PANEL],
  ['factor_enrichments', R_CEE_PANEL],
  ['decision_brief', R_UI_ARTEFACT],
  ['review_cards', R_UI_ARTEFACT],
  ['fact_objects', R_UI_ARTEFACT],
  ['_meta', R_INTERNAL],
  ['meta', R_INTERNAL],
  ['downstream_calls', R_INTERNAL],
  ['ceeTrace', R_INTERNAL],
  ['decision_review', R_DECISION_REVIEW],
  ['coaching_signal_id', R_COACHING_SIGNAL],
  ['coaching_signal_turn_id', R_COACHING_SIGNAL],
  ['coaching_signal_produced_at', R_COACHING_SIGNAL],
  ['results', R_LEGACY_COMPACT],
]);

/**
 * Top-level enrichment keys the derivers TOLERATE defensively but the current
 * PLoT producer does NOT emit at top level (so they are not in the manifest):
 *
 *   - `goal_fit_basis` — `deriveGoalFitFromEnrichment` reads a top-level
 *     `goal_fit_basis` first; PLoT delivers it PER-OPTION inside
 *     `option_comparison[]` (the deriver's second source). The top-level read
 *     is forward-tolerance, not a live source.
 *   - `notes` — `deriveGoalFitFromEnrichment` scans `notes` OR `critiques` for
 *     the goal-fit basis code; PLoT emits `critiques` (in the manifest), never
 *     top-level `notes`. Defensive alias.
 *
 * The conformance test asserts (observed-reads − manifest) ⊆ this set, so a
 * NEW phantom top-level read that is not documented here goes RED.
 */
export const ENRICHMENT_DEFENSIVE_NON_EMITTED_READS: ReadonlySet<string> = new Set<string>([
  'goal_fit_basis',
  'notes',
]);

/**
 * Max length of a logged enrichment key name. Mirrors
 * `MAX_LOGGED_KEY_NAME_LENGTH` in `../routing/tool-schema.ts` (kept a local
 * constant rather than an import so this context module has no dependency on
 * the routing tool-schema surface). Pinned equal by the conformance test.
 */
export const MAX_LOGGED_ENRICHMENT_KEY_LENGTH = 64;

/**
 * Cap + sanitise a PRODUCER-AUTHORED enrichment key name for telemetry. The
 * enrichment record is the untyped `z.record` passthrough, so an unknown key
 * name is an upstream/model-influenced string of unbounded length: keep only
 * `[A-Za-z0-9_.-]` (every other char → `_`), cap the body at
 * {@link MAX_LOGGED_ENRICHMENT_KEY_LENGTH}, and append a `~` marker whenever
 * the original was truncated OR had any character replaced — so the raw string
 * can never be emitted verbatim. Deterministic; output ≤ length + 1.
 *
 * Byte-for-byte the same rule as `sanitiseLoggedKeyName`
 * (`../routing/tool-schema.ts`); replicated (not imported) to keep the routing
 * boundary out of this module's dependency graph.
 */
export function sanitiseEnrichmentKeyName(key: string): string {
  const replaced = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  const capped = replaced.slice(0, MAX_LOGGED_ENRICHMENT_KEY_LENGTH);
  const wasTruncated = replaced.length > MAX_LOGGED_ENRICHMENT_KEY_LENGTH;
  const wasReplaced = replaced !== key;
  return wasTruncated || wasReplaced ? `${capped}~` : capped;
}

/**
 * Pure discriminator: the SANITISED names of the enrichment's top-level keys
 * that are not in {@link ENRICHMENT_PRODUCER_MANIFEST}. Deduped by sanitised
 * name; order follows `Object.keys`. Returns `[]` for a non-object input.
 * Never reads or returns any VALUE — key names only.
 */
export function findUnknownEnrichmentKeys(enrichment: unknown): string[] {
  if (enrichment === null || typeof enrichment !== 'object' || Array.isArray(enrichment)) {
    return [];
  }
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(enrichment as Record<string, unknown>)) {
    if (ENRICHMENT_PRODUCER_MANIFEST.has(key)) continue;
    const sanitised = sanitiseEnrichmentKeyName(key);
    if (seen.has(sanitised)) continue;
    seen.add(sanitised);
    unknown.push(sanitised);
  }
  return unknown;
}

/** Max unknown key names carried in one telemetry event (flood guard). */
const UNKNOWN_ENRICHMENT_KEY_LOG_CAP = 20;

/** Minimal logger surface the tripwire needs — satisfied by the pino `log`. */
export interface EnrichmentTripwireLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

/**
 * RUNTIME tripwire (context-audit #1). Emit one loud, structured warn event
 * when a persisted PLoT enrichment carries top-level key(s) not in
 * {@link ENRICHMENT_PRODUCER_MANIFEST} — the signal that the analysis→LLM
 * projection has gone blind to a new upstream field.
 *
 * Contract: OBSERVE-ONLY. It logs sanitised KEY NAMES (never values), caps the
 * list, and is wrapped so a telemetry fault can never break analysis
 * projection — unknown keys degrade the coach's coverage, they must never
 * degrade the turn. No flag gates it; it is unconditional.
 *
 * `logger` is injectable for testing; defaults to the process `log`.
 */
export function emitUnknownEnrichmentKeyTelemetry(
  enrichment: unknown,
  logger: EnrichmentTripwireLogger = log,
): void {
  try {
    const unknown = findUnknownEnrichmentKeys(enrichment);
    if (unknown.length === 0) return;
    logger.warn(
      {
        event: 'v5.enrichment.unknown_producer_key',
        unknown_key_count: unknown.length,
        unknown_keys: unknown.slice(0, UNKNOWN_ENRICHMENT_KEY_LOG_CAP),
        manifest_size: ENRICHMENT_PRODUCER_MANIFEST.size,
      },
      'v5 enrichment: PLoT emitted top-level key(s) not in the CEE producer manifest — the analysis→LLM projection cannot see them until a deriver or explicit skip is added (context-audit #1)',
    );
  } catch {
    // Observe-only: a telemetry fault must never break analysis projection.
  }
}
