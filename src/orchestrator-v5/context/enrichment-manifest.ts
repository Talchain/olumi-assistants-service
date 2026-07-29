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
 *      the PLoT `/v2/run` body verbatim (the 68 `RunResponseV3` keys — 64
 *      derived at PLoT `51abbc80` plus the 4 ISL top-level VOI passthrough
 *      keys added at PLoT `a07b0ae`/`5dae8df` and manifested here in V7-C
 *      slice 1b), then
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
 * Sections: (a) the 68 PLoT `/v2/run` `RunResponseV3` keys — citations are
 * `engine-v3.ts` line numbers, the first 64 at plot-lite-service tip
 * `51abbc80` and the 4 ISL top-level VOI keys at tip `3d13e0ac`, grouped by
 * the interface's own section headers; (b) 4 CEE-injected keys written onto
 * the same record after PLoT returns; (c) 1 legacy V1 inbound-tolerance key.
 *
 * ⚠ THE SECTION-(a) COUNT IS A HAND-MAINTAINED MIRROR OF A PRODUCER IN
 * ANOTHER REPO, and it has already drifted once by four keys for five days
 * (see the VOI block below). Re-derive it against PLoT's `RunResponseV3` at
 * the tip you are on; do not trust this number, including this one.
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
  // ── ISL top-level VOI passthrough (:1089-1095) ────────────────────────────
  // ⚠ THE MANIFEST WAS STALE HERE, AND ITS OWN TRIPWIRE WAS THE THING SAYING
  // SO. The 64 keys above were derived at PLoT staging `51abbc80`
  // (2026-07-22). These four landed at PLoT the NEXT DAY (#258, `a07b0ae`,
  // 2026-07-23; refined by #259, `5dae8df`, 2026-07-24) — verified with
  // `git merge-base --is-ancestor`, not assumed from dates. So since 23 Jul
  // every persisted run_analysis enrichment carrying them has been firing
  // `v5.enrichment.unknown_producer_key`, exactly as designed, and nobody
  // read it. The instrument worked; the loop back to a human did not. Worth
  // more than this fix: a fail-loud mirror still needs someone downstream of
  // the noise.
  //
  // PLoT forwards them VERBATIM from the ISL envelope
  // (`ISL_TOPLEVEL_ENRICHMENT_KEYS`, src/routes/v2/run-contract-keys.ts:34-38;
  // `islEnrichmentPassthrough` spread at src/routes/v2/run.ts:3533), guard is
  // `!== undefined` so an explicit null/0 passes. Citations below are
  // `engine-v3.ts` lines at PLoT staging tip `3d13e0ac`, read directly.
  'correlation_model', // :1089
  'decision_evpi', // :1091
  'factor_evppi', // :1093
  'p_win_sensitivity', // :1095
  // ── CEE post-run additions to the SAME persisted enrichment record ────────
  // The run-analysis handler stores the PLoT body verbatim as
  // `result.enrichment` (run-analysis.ts:870), then CEE enrichers WRITE more
  // top-level keys onto it before the fact is read by the analysis→LLM
  // projection. The seam is a multi-writer record, not a pure PLoT
  // passthrough — these MUST be manifested or the runtime tripwire
  // false-positives on every run_analysis fact.
  'decision_review', // CEE-injected: turn-executor.ts:9462 (null) + coaching/decision-review-enricher.ts:339-340 (populated)
  'coaching_signal_id', // CEE-injected: coaching/coaching-signal-application.ts:150
  'coaching_signal_turn_id', // CEE-injected: coaching/coaching-signal-application.ts:151
  'coaching_signal_produced_at', // CEE-injected: coaching/coaching-signal-application.ts:152
  '_diagnostics', // CEE-injected (DEBUG only, CEE_TURN_DEBUG_ENABLED): coaching/decision-review-enricher.ts:345-348
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
/**
 * ⚠ SPLIT PER MEMBER 2026-07-27 (ROADMAP 1.276). A single shared rationale here
 * said "keep-listed to the UI transport, not the coach analysis projection" and
 * was applied to THREE members. It was true of exactly ONE of them.
 *
 * The skip list is a claim about WHY a field is not read by the analysis→LLM
 * projection, and "it goes to the UI instead" is a materially different reason
 * from "it goes nowhere". Sharing one string across members with different
 * destinies is the hand-maintained-mirror shape (CLAUDE.md trap #12) wearing a
 * rationale's clothes: the string stayed accurate for `decision_brief` and went
 * quietly false for the other two, and nothing could fail, because a rationale
 * is prose that no test compares against the keep-list.
 *
 * Membership derived at CEE `cf10c553` against the COMPLETE
 * `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` (compose.ts:491-538, 12 entries, whole
 * list reviewed — not a grep for the three names):
 *   option_comparison, factor_sensitivity, results, robustness,
 *   decision_review, option_comparison_status, conditional_probabilities,
 *   edge_e_values, inference_warnings, confidence_tier, flip_thresholds,
 *   decision_brief.
 *
 * That 12 is a DATED derivation, not the current count: the keep-list is 16 as
 * of V7-C slice 1b. The four VOI keys are also transported, but they do NOT
 * take this rationale — they carry {@link R_VOI_NOT_COACH_NARRATED}, because
 * "transported to the UI" and "deliberately withheld from the coach on a claim
 * boundary" are different reasons, and collapsing them is the exact mistake
 * this comment block exists to record.
 */
const R_UI_ARTEFACT_TRANSPORTED =
  'UI-facing artefact — genuinely keep-listed to the UI transport (P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP, compose.ts), not the coach analysis projection.';
/**
 * `review_cards`: NOT on the UI transport keep-list — but it is not orphaned
 * either, which is why it needs its own line rather than `fact_objects`'s. Its
 * consumer is server-side: `coaching/post-analysis-wrapper.ts:336` reads
 * `enrichment.review_cards` off the PERSISTED fact to mine post-analysis
 * coaching chips (its skip reasons `no_review_cards` are named at :222/:260),
 * and `compose/sanitise-enrichment.ts:598-622` scrubs its user-facing prose
 * (`what`, `why`, `items[*].suggested_evidence`). So it reaches users as
 * CHIPS, not as transported enrichment.
 */
const R_COACHING_CHIP_SOURCE =
  'Read server-side off the persisted fact by the post-analysis coaching wrapper (coaching/post-analysis-wrapper.ts) to mine chips; NOT on the UI transport keep-list, and deliberately not fed back into the coach analysis projection that would then be reasoning about its own output.';
/**
 * `fact_objects`: neither projected NOR transported, and — on the manifest
 * below — read by nothing.
 *
 * READER MANIFEST, scope = all of `src/` at `cf10c553` (CLAUDE.md trap #10: a
 * "no consumer" claim needs the manifest, not an impression). The only
 * non-test, non-comment occurrence is the optional TYPE FIELD declaration
 * `fact_objects?: unknown[]` at `orchestrator/types.ts:398`. There is no
 * property read of `.fact_objects` in production code; the two other mentions
 * are comments (`compose.ts:617`, `types/guidance-item.ts:121`, the latter
 * describing a verification that is not implemented against it).
 *
 * Stated as a fact about the CURRENT tree, not as a recommendation: a field
 * with no reader is a candidate for removal, but removing a PLoT-produced key
 * from the manifest is a producer-contract question and is not this PR's.
 */
const R_NO_CONSUMER =
  'Not read by the analysis→LLM projection AND not on the UI transport keep-list — on a complete src/ reader manifest at cf10c553 it currently reaches no consumer at all (only an optional type-field declaration at orchestrator/types.ts:398). Skipped here because there is nothing to project, not because it goes somewhere else.';
const R_INTERNAL =
  'Internal carrier / observability — stripped by compose.ts INTERNAL_ENRICHMENT_KEYS before UI transport; never coaching content.';
/**
 * The VOI family (V7-C slice 1b). Deliberately NOT projected into the coach
 * context, and the reason is not "it goes to the UI instead" — it is a claim
 * boundary.
 *
 * `factor_evppi` and `decision_evpi` are in OUTCOME units (`units: 'outcome'`)
 * and `p_win_sensitivity` is in percentage points. The coach narrates in prose,
 * and prose has no unit discipline: handing an LLM a ranked list of
 * outcome-unit magnitudes is handing it the material for exactly the "worth X"
 * and "by N pp" sentences the estate's no-EVPI-display doctrine exists to stop.
 * The licensed surface for this data is a DETERMINISTIC composer rendering a
 * RANKING with no magnitudes, and it lives in the UI.
 *
 * So this is a skip with a stated boundary, not a gap: adding a deriver here
 * is a doctrine decision (and a Paul ruling), not a wiring task.
 */
const R_VOI_NOT_COACH_NARRATED =
  'Value-of-information family — transported to the UI (P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP) for a deterministic ranking surface with NO magnitudes, and deliberately withheld from the analysis→LLM projection: the values are outcome-unit / percentage-point magnitudes, and narrating them in prose is the "worth X" / "by N pp" claim class the no-EVPI-display doctrine forbids. Adding a deriver is a doctrine ruling, not a wiring gap.';
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
  // Three members that used to share ONE rationale claiming all three were
  // "keep-listed to the UI transport". Only the first is. See the rationale
  // constants above for the derivation and the reader manifest.
  ['decision_brief', R_UI_ARTEFACT_TRANSPORTED],
  ['review_cards', R_COACHING_CHIP_SOURCE],
  ['fact_objects', R_NO_CONSUMER],
  ['_meta', R_INTERNAL],
  ['meta', R_INTERNAL],
  ['downstream_calls', R_INTERNAL],
  ['ceeTrace', R_INTERNAL],
  ['decision_review', R_DECISION_REVIEW],
  ['coaching_signal_id', R_COACHING_SIGNAL],
  ['coaching_signal_turn_id', R_COACHING_SIGNAL],
  ['coaching_signal_produced_at', R_COACHING_SIGNAL],
  ['_diagnostics', R_INTERNAL],
  ['results', R_LEGACY_COMPACT],
  // V7-C slice 1b — transported to the UI, never narrated by the coach.
  ['correlation_model', R_VOI_NOT_COACH_NARRATED],
  ['decision_evpi', R_VOI_NOT_COACH_NARRATED],
  ['factor_evppi', R_VOI_NOT_COACH_NARRATED],
  ['p_win_sensitivity', R_VOI_NOT_COACH_NARRATED],
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
 *   - `graph` — `deriveTopFragileEdgesFromTopLevel` (analysis-fallback.ts)
 *     reads `enrichment.graph` via `readGraph()` to label fragile edges, but
 *     ONLY when `robustness.fragile_edges` is non-empty (a CONDITIONAL read).
 *     PLoT emits no top-level `graph` (fixture-confirmed absent; it appears
 *     only NESTED, where compose's INTERNAL_ENRICHMENT_KEYS strips it), so
 *     this is a defensive read, not a live source.
 *
 * SCOPE of the conformance check (honest limitation): the observed read-set is
 * derived by running the derivers over TWO probes — an EMPTY enrichment
 * (catches unconditional reads) and a POPULATED fixture-shaped enrichment
 * (catches reads gated on populated staging shapes, e.g. `graph`). It asserts
 * (observed-reads − manifest) ⊆ this set, so a phantom read on those paths
 * goes RED. A read gated on a shape NEITHER probe carries could still escape;
 * the runtime tripwire is the backstop for anything that reaches production.
 */
export const ENRICHMENT_DEFENSIVE_NON_EMITTED_READS: ReadonlySet<string> = new Set<string>([
  'goal_fit_basis',
  'notes',
  'graph',
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
