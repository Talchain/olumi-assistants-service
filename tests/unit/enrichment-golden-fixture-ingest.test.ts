/**
 * F12 — permanent handler-ingest guard for the golden happy fixture.
 *
 * `tests/fixtures/plot/v2-run-golden-happy.json` is the mocked PLoT run
 * response every run_analysis handler test ingests. The enrichment attach
 * point (`run-analysis.ts` → `validateEnrichmentShadow`) shadow-parses that
 * response against the vendored `AnalysisEnrichmentSchema`. Because shadow
 * mode defaults to `off`, a stale fixture (wrong `analysis_status` enum, an
 * old fragile-edge shape, factor_sensitivity entries missing `factor_id`)
 * silently escapes every existing test — exactly how this fixture drifted to
 * the pre-0.21 shape Codex F12 flagged.
 *
 * This guard runs the REAL on-disk fixture through the REAL ingest validator
 * (derive-don't-mirror: it imports the shipped file, so a future drift fails
 * LOUD here rather than passing green). Two controls:
 *   - NEGATIVE: the clean fixture emits ZERO `v5.enrichment.schema_mismatch`.
 *   - POSITIVE: one injected defect emits EXACTLY ONE mismatch, carrying
 *     exactly one sanitised {path, code} issue — proving the guard can SEE a
 *     mismatch (an absence assertion is vacuous without a presence control).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import { validateEnrichmentShadow } from '../../src/orchestrator-v5/tools/handlers/enrichment-validation.js';
import { _resetConfigCache } from '../../src/config/index.js';

// Read the REAL on-disk fixture at runtime (derive-don't-mirror): this is the
// exact bytes the run_analysis handler tests ingest, so a future drift fails
// THIS guard rather than passing silently.
const goldenHappyFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/plot/v2-run-golden-happy.json', import.meta.url)), 'utf-8'),
) as Record<string, unknown>;

let emitSpy: ReturnType<typeof vi.spyOn>;
let envBackup: string | undefined;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
  envBackup = process.env.CEE_ENRICHMENT_VALIDATION;
  // Force SHADOW so the seam actually parses (default is `off` = no parse).
  process.env.CEE_ENRICHMENT_VALIDATION = 'shadow';
  _resetConfigCache();
});

afterEach(() => {
  if (envBackup === undefined) {
    delete process.env.CEE_ENRICHMENT_VALIDATION;
  } else {
    process.env.CEE_ENRICHMENT_VALIDATION = envBackup;
  }
  _resetConfigCache();
  vi.restoreAllMocks();
});

function mismatchEvents(): Record<string, unknown>[] {
  return emitSpy.mock.calls
    .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5EnrichmentSchemaMismatch)
    .map((c: readonly unknown[]) => c[1] as Record<string, unknown>);
}

describe('golden happy fixture — enrichment ingest (F12)', () => {
  it('clean fixture ingests with ZERO v5.enrichment.schema_mismatch issues', () => {
    validateEnrichmentShadow(goldenHappyFixture, {
      requestId: 'req_golden_clean',
      scenarioId: 'scn_golden',
    });
    expect(mismatchEvents()).toHaveLength(0);
  });

  it('POSITIVE CONTROL: one injected defect → EXACTLY one sanitised issue', () => {
    // Deep-clone so we never mutate the shared imported fixture object.
    const defective = JSON.parse(JSON.stringify(goldenHappyFixture)) as Record<string, unknown>;
    // `completed` is the exact pre-0.21 drift F12 flagged; the enum is
    // computed|partial|failed|blocked, so this is one — and only one — mismatch.
    defective.analysis_status = 'completed';

    validateEnrichmentShadow(defective, {
      requestId: 'req_golden_defect',
      scenarioId: 'scn_golden',
    });

    const events = mismatchEvents();
    expect(events).toHaveLength(1);
    expect(events[0].issue_count).toBe(1);
    const issues = events[0].issues as Array<Record<string, unknown>>;
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('analysis_status');
    // Sanitised: {path, code} ONLY — no producer value on the wire.
    expect(Object.keys(issues[0]).sort()).toEqual(['code', 'path']);
  });
});
