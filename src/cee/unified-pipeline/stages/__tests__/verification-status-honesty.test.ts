/**
 * `verification_status` must MEAN something (draft-honesty lane, 2026-07-24).
 *
 * THE LIVE DEFECT (day-3 drafting matrix, build `3c544b8`): 8 of 9 SUCCESSFUL
 * drafts were stamped `verification_status: failed_degraded` with "Response does
 * not conform to expected schema". An alarm that fires on 89% of successes is
 * indistinguishable from one that never fires.
 *
 * The alarm turned out to be HONEST — the coaching block really did violate
 * `StrengthenItemActionType` / `BiasType`. So the fix is on the PRODUCER side
 * (`enforceCoachingContract`, called from Stage 5 Step 2c), not on the check.
 *
 * These tests prove the alarm DISCRIMINATES IN BOTH DIRECTIONS through the real
 * verification stage, the real `CEEDraftGraphResponseV1Schema`, and the real
 * `runStagePackage` — nothing about the check itself is stubbed:
 *
 *   → a CONFORMANT response is stamped 'passed'      (fails if the status were
 *                                                     stamped on a conformant
 *                                                     response)
 *   → a NON-CONFORMANT response is stamped           (fails if a genuinely
 *     'failed_degraded' + carries the warning         non-conformant response
 *                                                     were stamped complete)
 *
 * MUTATION: delete the `enforceCoachingContract(ctx.coaching, …)` call in
 * package.ts Step 2c → "the live off-contract coaching … 'passed'" goes RED
 * (it reverts to 'failed_degraded', i.e. reproduces the live defect exactly).
 */
import { describe, it, expect, vi } from 'vitest';

// Silence pino only. The verification pipeline, the Zod schema and every
// validator run for real — the alarm under test is NOT stubbed.
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStagePackage } from '../package.js';
import { createCorrectionCollector } from '../../../corrections.js';
import type { PipelineOutcome, StageContext } from '../../types.js';

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

/**
 * The coaching block a LIVE staging draft actually returned
 * (`scratchpad/captures/d3_moderate_2.json`, 2026-07-24T20:06Z, build
 * `3c544b8`) — `add_edge` / `quantify` / `add_factor` / `clarify_goal` action
 * types and an `availability` bias. THIS is the payload that produced
 * `failed_degraded` on the live wire.
 */
function liveOffContractCoaching() {
  return {
    summary: 'Core cost factors are covered and a status-quo option is present.',
    strengthen_items: [
      { id: 'a', label: 'Link options to the missing factors', detail: 'Those relationships are absent.', action_type: 'add_edge', bias_category: 'availability' },
      { id: 'b', label: 'Quantify the mileage threshold', detail: 'Lease contracts impose mileage caps.', action_type: 'quantify', bias_category: 'overconfidence' },
      { id: 'c', label: 'Add a tax/depreciation factor', detail: 'Depreciation changes the true cost comparison.', action_type: 'add_factor' },
      { id: 'd', label: 'Clarify whether flexibility is part of the goal', detail: 'Leasing’s advantage is the upgrade path.', action_type: 'clarify_goal', bias_category: 'anchoring' },
    ],
    widening_log: { elements_added: [], elements_considered_but_excluded: ['Insurance cost'], brief_completeness: 'partial' },
    bias_signals: [
      { type: 'availability', detail: 'Recent breakdowns dominate the framing.' },
      { type: 'anchoring', detail: 'The upfront price anchors the comparison.' },
    ],
  };
}

function makeCtx(opts: { coaching?: unknown; seed?: unknown } = {}): StageContext {
  return {
    input: {
      brief: 'Our bakery is growing. Should we buy a delivery van or lease one?',
      // `seed` is `z.string().optional()` on the response contract. A NUMBER
      // here is the deliberate non-conformance lever for the negative
      // direction — a defect the coaching guard does not and must not mask.
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    },
    requestId: 'req-verif-honesty',
    effectiveBrief: 'Our bakery is growing. Should we buy a delivery van or lease one?',
    opts: {},
    start: Date.now(),
    graph: {
      nodes: [
        // 'Continue as-is' matches the status-quo label patterns, so the
        // deterministic STATUS_QUO_ABSENT coaching injection does not fire and
        // the coaching under test is the only coaching in play.
        { id: 'opt_sq', kind: 'option', label: 'Continue as-is' },
        { id: 'opt_buy', kind: 'option', label: 'Buy the van' },
        { id: 'fac_cost', kind: 'factor', label: 'Upfront cost' },
        { id: 'goal_profit', kind: 'goal', label: 'Protect margin' },
      ],
      edges: [],
    },
    rationales: [],
    confidence: 0.7,
    coaching: opts.coaching,
    causalClaims: undefined,
    goalConstraints: undefined,
    topologyPlan: undefined,
    strpResult: undefined,
    constraintStrpResult: undefined,
    structuralMeta: undefined,
    archetype: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    collector: createCorrectionCollector(),
    nodeRenames: new Map<string, string>(),
    stageSnapshots: {},
    pipelineOutcome: basePipelineOutcome(),
  } as unknown as StageContext;
}

describe('verification_status discriminates in BOTH directions', () => {
  it('POSITIVE CONTROL — a genuinely NON-conformant response IS stamped failed_degraded', async () => {
    // Without this control, every "stamped passed" assertion below would be
    // vacuous: a check that can never fire would satisfy them all.
    const ctx = makeCtx({ coaching: undefined, seed: 1 });
    await runStagePackage(ctx);

    expect(ctx.pipelineOutcome.verification_status).toBe('failed_degraded');
    expect(ctx.pipelineOutcome.warnings).toContainEqual(
      expect.objectContaining({ stage: 'verification', degraded: true }),
    );
  });

  it('a conformant response is stamped passed, with no verification warning', async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.pipelineOutcome.verification_status).toBe('passed');
    expect(
      ctx.pipelineOutcome.warnings.filter((w: { stage?: string }) => w.stage === 'verification'),
    ).toHaveLength(0);
  });

  it('THE LIVE DEFECT — off-contract coaching from the wire is stamped passed, not failed_degraded', async () => {
    const ctx = makeCtx({ coaching: liveOffContractCoaching() });
    await runStagePackage(ctx);

    expect(ctx.pipelineOutcome.verification_status).toBe('passed');
    expect(
      ctx.pipelineOutcome.warnings.filter((w: { stage?: string }) => w.stage === 'verification'),
    ).toHaveLength(0);
  });

  it('the coaching that ships is contract-valid AND never carries a fabricated bias', async () => {
    const ctx = makeCtx({ coaching: liveOffContractCoaching() });
    await runStagePackage(ctx);

    const coaching = (ctx.coaching ?? {}) as {
      strengthen_items?: Array<Record<string, unknown>>;
      bias_signals?: Array<Record<string, unknown>>;
    };
    const CANON_ACTIONS = ['add_option', 'add_constraint', 'add_risk', 'reframe_goal'];
    const CANON_BIASES = ['anchoring', 'narrow_framing', 'status_quo_bias', 'overconfidence'];

    for (const item of coaching.strengthen_items ?? []) {
      expect(CANON_ACTIONS).toContain(item.action_type);
      if (item.bias_category !== undefined) expect(CANON_BIASES).toContain(item.bias_category);
    }
    // The unnameable `availability` signal is GONE, not renamed into the set.
    for (const sig of coaching.bias_signals ?? []) {
      expect(CANON_BIASES).toContain(sig.type);
    }
    expect((coaching.bias_signals ?? []).map((s) => s.type)).not.toContain('availability');
  });
});
