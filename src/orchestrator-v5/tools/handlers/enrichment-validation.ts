/**
 * Context Architecture v2 — S6 "enrichment shadow validation" (ROADMAP 1.73).
 *
 * Design pack 02 §Seam 3: `AnalysisEnrichmentSchema` exists in
 * `@talchain/schemas` with ZERO CEE imports — the PLoT run response is
 * attached to the run_analysis fact CAST (`response as Record<string,
 * unknown>`), the platform's known-open seam (system-map hazard 2). This
 * module is the FIRST CEE import of that schema.
 *
 * Stage 1 (this slice): SHADOW — `safeParse` the response at the attach
 * point; on failure emit `v5.enrichment.schema_mismatch` and proceed
 * unchanged. Zero behaviour change on every mode; the event stream is the
 * mismatch-rate evidence stage 3 requires.
 *
 * Stage 3 (`enforce`) is deliberately NOT implemented: 02 §Seam 3 forbids
 * enforcement before (a) the schemas-pin check (✓ at build — CEE pins
 * 0.16.0; the vendored schema is `.passthrough()` so unknown producer keys
 * survive), (b) a read-only PLoT producer trace, and (c) 7 consecutive
 * days / 200 staging analyses of shadow-mode mismatch rate = 0. Until
 * then, `enforce` downgrades to shadow with a once-per-process warning.
 */

import { parseAnalysisEnrichment } from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../../../utils/telemetry.js';
import { config } from '../../../config/index.js';

/** Cap on issue records carried in one mismatch event (bounded payloads). */
const MAX_ISSUE_RECORDS = 20;

/** Once-per-process downgrade warning latch for mode='enforce'. */
let warnedEnforceDowngrade = false;

/** Test-only reset for the downgrade-warning latch. */
export function _resetEnforceDowngradeWarning(): void {
  warnedEnforceDowngrade = false;
}

export interface EnrichmentValidationIds {
  readonly requestId: string;
  readonly scenarioId: string | null;
}

/**
 * Shadow-validate a PLoT run response against `AnalysisEnrichmentSchema`
 * at the enrichment attach point. NEVER throws, NEVER mutates, NEVER
 * blocks the turn — observability only (stage 1). Mode 'off' returns
 * without parsing (byte-identical to pre-S6).
 */
export function validateEnrichmentShadow(
  response: Record<string, unknown> | null | undefined,
  ids: EnrichmentValidationIds,
): void {
  try {
    const mode = config.features.enrichmentValidation;
    if (mode === 'off') return;

    if (mode === 'enforce' && !warnedEnforceDowngrade) {
      warnedEnforceDowngrade = true;
      log.warn(
        { request_id: ids.requestId },
        'CEE_ENRICHMENT_VALIDATION=enforce requested but stage 3 is not shipped ' +
          '(02 §Seam 3 preconditions unmet) — running SHADOW behaviour',
      );
    }

    const parsed = parseAnalysisEnrichment(response);
    if (parsed.success) return;

    // {path, code} ONLY — no `message`. Zod's invalid_enum_value message
    // echoes the RECEIVED producer value ("… received '<value>'"), which the
    // design's "no content values on the mismatch event" rule forbids. code +
    // path fully localise the schema divergence for the harness-v1 consumer
    // without carrying any producer-emitted field value.
    const issues = ('error' in parsed ? parsed.error.issues : []).slice(0, MAX_ISSUE_RECORDS).map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    }));
    const issueCount = 'error' in parsed ? parsed.error.issues.length : 0;

    const keysSeen =
      response != null && typeof response === 'object' && !Array.isArray(response)
        ? Object.keys(response)
        : [];
    const meta =
      response != null && typeof response === 'object'
        ? ((response as Record<string, unknown>).meta as Record<string, unknown> | undefined)
        : undefined;
    const plotResponseId =
      (typeof (response as Record<string, unknown> | null | undefined)?.response_hash === 'string'
        ? ((response as Record<string, unknown>).response_hash as string)
        : undefined) ??
      (typeof meta?.response_hash === 'string' ? (meta.response_hash as string) : null);

    emit(TelemetryEvents.V5EnrichmentSchemaMismatch, {
      request_id: ids.requestId,
      scenario_id: ids.scenarioId,
      mode,
      // Stage-1 truth on the wire: shadow behaviour was applied regardless
      // of the configured mode (enforce is downgraded until stage 3).
      enforcement_applied: false,
      issue_count: issueCount,
      issues,
      keys_seen: keysSeen,
      plot_response_id: plotResponseId,
    });
  } catch (err) {
    // A validation fault must never affect the turn (falls-open, like the
    // existing enrichResult.warnings handling this seam will eventually
    // mirror in stage 3).
    log.debug(
      { request_id: ids.requestId, err: err instanceof Error ? err.message : String(err) },
      'enrichment shadow validation failed internally (swallowed)',
    );
  }
}
