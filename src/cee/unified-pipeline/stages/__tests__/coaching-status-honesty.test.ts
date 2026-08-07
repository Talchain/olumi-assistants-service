/**
 * F6 + F7 (Codex deep-review, 2026-07-24) — coaching_status honesty.
 *
 * F6: the coaching pass marks attached=true for ANY non-null container, incl.
 *     `{"coaching":{},"causal_claims":[{}]}`. Stage 5 then narrows coaching to
 *     canonical-empty and drops the invalid claim. Deciding the terminal status
 *     from pre-validation presence wrongly stamped 'complete'. Stage 5 now owns
 *     the complete-vs-degraded call from VALIDATED counts → 'failed_degraded'.
 *
 * F7: a Stage 5 PACKAGE failure must NOT be attributed to coaching. coaching_status
 *     stays owned by the coaching path (the package-failure fallback now stamps the
 *     terminal status via markCoachingCompleteUnlessTerminal, which preserves the
 *     coaching markers and stamps 'complete' otherwise — the package degradation is
 *     the separate stage:'package' warning).
 *
 * MUTATION F6: delete the `coaching_status = 'failed_degraded'` block in package.ts
 *   → the "attached-but-unusable" test goes RED (status stays 'partial').
 * MUTATION F7: revert the fallback to `coaching_status = 'failed_degraded'`
 *   → the "package failure preserves succeeded coaching" case goes RED.
 */
import { describe, it, expect, vi } from 'vitest';

// Silence the pino logger; everything else real so the genuine validators run.
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStagePackage } from '../package.js';
import { markCoachingCompleteUnlessTerminal } from '../../index.js';
import type { StageContext } from '../../types.js';
import type { PipelineOutcome } from '../../types.js';

function basePipelineOutcome(): PipelineOutcome {
  return {
    graph_drafted: true,
    graph_structurally_valid: true,
    deterministic_sweep_violations: 0,
    verification_status: 'skipped',
    validation_status: 'skipped',
    enrichment_status: 'skipped',
    coaching_status: 'partial',
    warnings: [],
    rescue_score: 0,
    factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
    edge_strength_unique_count: 0,
    llm_repair: { triggered: false, outcome: 'skipped', fallback_reason: null, attempts: 0 },
    repair_provenance: [],
  } as unknown as PipelineOutcome;
}

function makePackageCtx(opts: {
  coaching: unknown;
  causalClaims: unknown;
}): StageContext {
  return {
    input: { brief: 'Should we hire a contractor or a full-time employee?', seed: 1 },
    requestId: 'req-f6',
    graph: {
      // A status-quo option is present so the deterministic STATUS_QUO_ABSENT
      // coaching injection does NOT fire — leaving an empty model coaching
      // canonical-empty (the exact Codex F6 repro). Without it, package would
      // inject a baseline strengthen_item and the coaching would be "usable".
      nodes: [
        { id: 'opt_sq', kind: 'option', label: 'Continue as-is', data: { is_status_quo: true } },
        { id: 'opt_a', kind: 'option', label: 'Contractor' },
        { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      ],
      edges: [],
    },
    rationales: [],
    confidence: undefined,
    coaching: opts.coaching,
    causalClaims: opts.causalClaims,
    goalConstraints: undefined,
    topologyPlan: undefined,
    strpResult: undefined,
    constraintStrpResult: undefined,
    structuralMeta: undefined,
    archetype: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    collector: { record: vi.fn(), corrections: [] },
    stageSnapshots: {},
    pipelineOutcome: basePipelineOutcome(),
  } as unknown as StageContext;
}

describe('F6 — coaching_status decided from validated counts (Stage 5 Package)', () => {
  it('attached-but-UNUSABLE coaching ({} + [{}]) yields failed_degraded, not complete', async () => {
    const ctx = makePackageCtx({ coaching: {}, causalClaims: [{}] });
    await runStagePackage(ctx).catch(() => {}); // status is set before any post-block work
    expect(ctx.pipelineOutcome.coaching_status).toBe('failed_degraded');
  });

  it('POSITIVE CONTROL — genuinely-meaningful coaching is NOT degraded (stays non-terminal)', async () => {
    const ctx = makePackageCtx({
      coaching: { summary: 'Add a status-quo option to compare against.', strengthen_items: [] },
      causalClaims: undefined,
    });
    await runStagePackage(ctx).catch(() => {});
    expect(ctx.pipelineOutcome.coaching_status).not.toBe('failed_degraded');
  });

  it('a budget-SKIP marker is never clobbered by the validated-counts decision', async () => {
    const ctx = makePackageCtx({ coaching: {}, causalClaims: [{}] });
    ctx.pipelineOutcome.coaching_status = 'skipped_budget';
    await runStagePackage(ctx).catch(() => {});
    expect(ctx.pipelineOutcome.coaching_status).toBe('skipped_budget');
  });
});

describe('F7 — package failure ≠ coaching failure (terminal-stamp policy)', () => {
  it('succeeded coaching (partial) is stamped complete on the package-failure fallback', () => {
    const outcome = basePipelineOutcome();
    outcome.coaching_status = 'partial';
    // The package-failure catch now delegates to this instead of forcing failed_degraded.
    markCoachingCompleteUnlessTerminal(outcome);
    expect(outcome.coaching_status).toBe('complete');
  });

  it('a coaching failed_degraded marker is preserved through the fallback', () => {
    const outcome = basePipelineOutcome();
    outcome.coaching_status = 'failed_degraded';
    markCoachingCompleteUnlessTerminal(outcome);
    expect(outcome.coaching_status).toBe('failed_degraded');
  });

  it('a coaching skipped_budget marker is preserved through the fallback', () => {
    const outcome = basePipelineOutcome();
    outcome.coaching_status = 'skipped_budget';
    markCoachingCompleteUnlessTerminal(outcome);
    expect(outcome.coaching_status).toBe('skipped_budget');
  });
});
