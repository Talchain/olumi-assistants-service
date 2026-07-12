/**
 * Context Architecture v2 — S6 "enrichment shadow validation" (ROADMAP 1.73).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/
 *   - 02 §Seam 3 — AnalysisEnrichmentSchema has ZERO CEE imports today; the
 *     PLoT response is attached to the run_analysis fact CAST, not parsed
 *     (the platform's known-open seam, system-map hazard 2). Stage 1
 *     (this slice): `safeParse` in SHADOW mode — on failure emit
 *     `v5.enrichment.schema_mismatch` {issues[], keys_seen,
 *     plot_response_id} and PROCEED UNCHANGED. Produces the mismatch-rate
 *     evidence stage 3 requires.
 *   - 05 §S6 — env `CEE_ENRICHMENT_VALIDATION=off|shadow|enforce`, default
 *     `off`. RED: malformed fixture → mismatch event, turn unaffected.
 *
 * Stage-3 (`enforce`) is NOT shipped here — 02 §Seam 3 forbids enforcement
 * before preconditions (a)–(c) (schemas-pin check ✓ at build: CEE pins
 * 0.16.0 and the vendored schema is `.passthrough()`; producer trace +
 * 7-day shadow evidence pending). An `enforce` setting therefore DOWNGRADES
 * to shadow behaviour with a warning — pinned below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import { validateEnrichmentShadow } from '../../src/orchestrator-v5/tools/handlers/enrichment-validation.js';
import { _resetConfigCache } from '../../src/config/index.js';

let emitSpy: ReturnType<typeof vi.spyOn>;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
  envBackup.CEE_ENRICHMENT_VALIDATION = process.env.CEE_ENRICHMENT_VALIDATION;
});

afterEach(() => {
  if (envBackup.CEE_ENRICHMENT_VALIDATION === undefined) {
    delete process.env.CEE_ENRICHMENT_VALIDATION;
  } else {
    process.env.CEE_ENRICHMENT_VALIDATION = envBackup.CEE_ENRICHMENT_VALIDATION;
  }
  _resetConfigCache();
  vi.restoreAllMocks();
});

function setMode(mode: string | undefined): void {
  if (mode === undefined) {
    delete process.env.CEE_ENRICHMENT_VALIDATION;
  } else {
    process.env.CEE_ENRICHMENT_VALIDATION = mode;
  }
  _resetConfigCache();
}

function mismatchEvents(): Record<string, unknown>[] {
  return emitSpy.mock.calls
    .filter((c) => c[0] === TelemetryEvents.V5EnrichmentSchemaMismatch)
    .map((c) => c[1] as Record<string, unknown>);
}

/** Fails AnalysisEnrichmentSchema: analysis_status must be an enum string. */
const MALFORMED_RESPONSE: Record<string, unknown> = {
  analysis_status: 12345,
  factor_sensitivity: 'not-an-array',
  response_hash: 'hash_fixture_1',
  meta: { seed_used: 1, n_samples: 100, response_hash: 'meta_hash_1' },
  results: [],
};

/**
 * Passes: the vendored 0.16.0 schema is `.passthrough()` with optional keys.
 * (`analysis_status` enum is 'computed'|'partial'|'failed'|'blocked' — an
 * earlier draft of this fixture used 'completed' and failed the parse, which
 * is precisely the drift class this shadow layer exists to surface.)
 */
const WELL_FORMED_RESPONSE: Record<string, unknown> = {
  analysis_status: 'computed',
  option_comparison: [],
  response_hash: 'hash_fixture_2',
  results: [],
};

describe('validateEnrichmentShadow (CEE_ENRICHMENT_VALIDATION)', () => {
  it('default (off): no parse, no event — byte-identical to pre-S6', () => {
    setMode(undefined);
    validateEnrichmentShadow(MALFORMED_RESPONSE, { requestId: 'req_off', scenarioId: 'scn_1' });
    expect(mismatchEvents()).toHaveLength(0);
  });

  it('shadow: malformed response → v5.enrichment.schema_mismatch with issues/keys_seen/plot_response_id', () => {
    setMode('shadow');
    validateEnrichmentShadow(MALFORMED_RESPONSE, { requestId: 'req_shadow', scenarioId: 'scn_2' });

    const events = mismatchEvents();
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.request_id).toBe('req_shadow');
    expect(ev.scenario_id).toBe('scn_2');
    expect(ev.mode).toBe('shadow');
    expect(ev.plot_response_id).toBe('hash_fixture_1');
    expect(ev.keys_seen).toEqual(Object.keys(MALFORMED_RESPONSE));
    const issues = ev.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBeGreaterThan(0);
    // Issue records are bounded, structured, and CONTENT-FREE: {path, code}
    // only. `message` was dropped (review finding) because Zod's
    // invalid_enum_value message echoes the RECEIVED producer value
    // ("… received '<value>'"), which the design's "no content values on the
    // mismatch event" rule forbids — path+code fully localise the divergence.
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'path']);
    }
    expect(ev.issue_count).toBe(issues.length);
  });

  it('shadow: well-formed response → no event', () => {
    setMode('shadow');
    validateEnrichmentShadow(WELL_FORMED_RESPONSE, { requestId: 'req_ok', scenarioId: 'scn_3' });
    expect(mismatchEvents()).toHaveLength(0);
  });

  it('shadow: never throws, even on hostile input (turn unaffected)', () => {
    setMode('shadow');
    expect(() =>
      validateEnrichmentShadow(null as unknown as Record<string, unknown>, {
        requestId: 'req_null',
        scenarioId: null,
      }),
    ).not.toThrow();
    // null input is a mismatch (the seam contract expects an object).
    expect(mismatchEvents()).toHaveLength(1);
  });

  it('enforce: DOWNGRADES to shadow (stage-3 preconditions unmet) — event carries the configured mode, turn unaffected', () => {
    setMode('enforce');
    expect(() =>
      validateEnrichmentShadow(MALFORMED_RESPONSE, { requestId: 'req_enf', scenarioId: 'scn_4' }),
    ).not.toThrow();
    const events = mismatchEvents();
    expect(events).toHaveLength(1);
    expect(events[0].mode).toBe('enforce');
    // Downgrade disclosure: the event says shadow behaviour was applied.
    expect(events[0].enforcement_applied).toBe(false);
  });

  it('issues are capped at 20 entries (bounded event payloads)', () => {
    setMode('shadow');
    // 30 wrong-typed known keys → >20 issues if uncapped... the schema has
    // fewer typed keys than that, so build many array-entry failures instead.
    const manyBadEntries = {
      factor_sensitivity: Array.from({ length: 30 }, () => 'bad'),
      response_hash: 'hash_many',
    };
    validateEnrichmentShadow(manyBadEntries, { requestId: 'req_cap', scenarioId: null });
    const events = mismatchEvents();
    expect(events).toHaveLength(1);
    const issues = events[0].issues as unknown[];
    expect(issues.length).toBeLessThanOrEqual(20);
    expect(events[0].issue_count).toBe(30);
  });
});
