/**
 * Context-audit #1 (F1) — INTEGRATION pin for the runtime tripwire.
 *
 * The conformance test exercises `emitUnknownEnrichmentKeyTelemetry` directly
 * with an injected logger; that leaves the PRODUCTION CALL SITE
 * (`buildAnalysisFromPriorFacts`, analysis-fallback.ts) unpinned — deleting it
 * keeps every other test green. This test drives the real
 * `buildAnalysisFromPriorFacts` with a prior run_analysis fact carrying an
 * unknown enrichment key, spies the module `log.warn`, and asserts the
 * `v5.enrichment.unknown_producer_key` event fires. Removing the call site
 * turns it RED (mutation-verified).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';
import { log } from '../../../utils/telemetry.js';

const TRIPWIRE_EVENT = 'v5.enrichment.unknown_producer_key';

/**
 * Minimal selectable run_analysis fact. `selectRunAnalysisFact` requires
 * `fact_type: 'run_analysis'`, `noop === false`, and a missing/canonical
 * analysis_status (none here ⇒ legacy-accepted); `buildAnalysisFromPriorFacts`
 * then reads `result.enrichment`.
 */
function runAnalysisFactWithEnrichment(enrichment: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: { enrichment },
  } as unknown as HandlerFact;
}

/** Warn-call payloads (first arg) whose `event` is the tripwire event. */
function tripwirePayloads(calls: unknown[][]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const args of calls) {
    const payload = args[0] as { event?: string } | undefined;
    if (payload?.event === TRIPWIRE_EVENT) out.push(payload as Record<string, unknown>);
  }
  return out;
}

describe('runtime tripwire — production call site (context-audit #1 F1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildAnalysisFromPriorFacts emits the tripwire for an unknown enrichment key', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    buildAnalysisFromPriorFacts([
      runAnalysisFactWithEnrichment({ option_comparison: [], unknown_test_key_zzz: 1 }),
    ]);

    const fired = tripwirePayloads(warnSpy.mock.calls as unknown[][]);
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0].unknown_keys).toContain('unknown_test_key_zzz');
  });

  it('does NOT emit the tripwire when every enrichment key is manifested', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    buildAnalysisFromPriorFacts([
      runAnalysisFactWithEnrichment({ option_comparison: [], robustness: null }),
    ]);

    expect(tripwirePayloads(warnSpy.mock.calls as unknown[][])).toHaveLength(0);
  });
});
