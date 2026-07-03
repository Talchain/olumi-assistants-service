/**
 * Adversarial pins — fallback-to-M1 completeness over the whole
 * EnrichmentReason union.
 *
 * Three layers of pinning:
 *   1. every RUNTIME-REACHABLE degrade reason is driven end-to-end through
 *      enrichDraftGraph (real merge + guards; only the M2 caller mocked) and
 *      must return the M1 graph by REFERENCE IDENTITY (===, the exact
 *      guarantee the dispatch byte-identity contract relies on);
 *   2. the classification table is a Record over the union, so any additive
 *      extension of EnrichmentReason breaks compilation here and forces an
 *      explicit reachability + accounting decision;
 *   3. the m2LlmCallMade accounting partition is cross-checked per member.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../../dual-draft/m2-review.js', () => ({
  reviewDraftGraph: vi.fn(),
}));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { reviewDraftGraph } from '../../dual-draft/m2-review.js';
import { enrichDraftGraph, m2LlmCallMade } from '../../dual-draft/index.js';
import type { EnrichmentInput, EnrichmentReason } from '../../dual-draft/types.js';
import { baseGraph, riskProposal } from './adversarial-fixtures.js';

function makeInput(graph: GraphV3T = baseGraph()): EnrichmentInput {
  return {
    graph,
    brief: 'Should we launch now?',
    analysisReady: null,
    requestId: 'req-fb',
    scenarioId: 'scen-1',
    turnId: 'turn-1',
    pipelineElapsedMs: 20_000,
  };
}

function mockM2(outcome: unknown) {
  (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockResolvedValue(
    outcome as Awaited<ReturnType<typeof reviewDraftGraph>>,
  );
}

/**
 * Reachability classification. A Record over the union: adding a new
 * EnrichmentReason member without classifying it is a COMPILE ERROR.
 *
 * 'unreachable-defence-in-depth' members cannot be produced through the real
 * modules from a GraphV3-valid ingress graph:
 *   - not_implemented: retained Phase-0 compatibility member, no producer;
 *   - post_merge_invalid: the merge only appends NodeV3/EdgeV3-valid items to
 *     a GraphV3-valid base, and GraphV3 has no cross-field constraints the
 *     append could break;
 *   - option_surface_changed: the merge defers option kinds (D1) and rejects
 *     option/decision edge endpoints, so the option surface is untouched by
 *     construction;
 *   - readiness_downgrade: computeStructuralReadiness depends only on the
 *     goal node and option nodes/edges — none of which the merge can touch.
 * They stay in the union as runtime backstops for future merge changes.
 */
const REACHABILITY: Record<EnrichmentReason, 'reachable' | 'unreachable-defence-in-depth'> = {
  not_implemented: 'unreachable-defence-in-depth',
  invalid_ingress_graph: 'reachable',
  applied: 'reachable',
  prompt_not_provisioned: 'reachable',
  insufficient_headroom: 'reachable',
  m2_model_not_resolved: 'reachable',
  m2_timeout: 'reachable',
  m2_llm_error: 'reachable',
  m2_parse_failed: 'reachable',
  no_proposals_applied: 'reachable',
  post_merge_invalid: 'unreachable-defence-in-depth',
  option_surface_changed: 'unreachable-defence-in-depth',
  readiness_downgrade: 'unreachable-defence-in-depth',
  internal_error: 'reachable',
};

/** Expected m2LlmCallMade classification per member (accounting partition). */
const CALL_MADE: Record<EnrichmentReason, boolean> = {
  not_implemented: false,
  invalid_ingress_graph: false,
  prompt_not_provisioned: false,
  insufficient_headroom: false,
  m2_model_not_resolved: false,
  internal_error: false,
  applied: true,
  no_proposals_applied: true,
  m2_timeout: true,
  m2_llm_error: true,
  m2_parse_failed: true,
  post_merge_invalid: true,
  option_surface_changed: true,
  readiness_downgrade: true,
};

describe('every reachable degrade reason returns the M1 graph by REFERENCE identity', () => {
  beforeEach(() => vi.clearAllMocks());

  const DEGRADE_DRIVERS: Array<[EnrichmentReason, () => EnrichmentInput]> = [
    [
      'invalid_ingress_graph',
      () => makeInput({ nodes: 'not-an-array' } as unknown as GraphV3T),
    ],
    ['prompt_not_provisioned', () => (mockM2({ kind: 'prompt_not_provisioned' }), makeInput())],
    ['insufficient_headroom', () => (mockM2({ kind: 'insufficient_headroom' }), makeInput())],
    [
      'm2_model_not_resolved',
      () => (mockM2({ kind: 'model_not_resolved', cause: 'model_unset', detail: 'unset' }), makeInput()),
    ],
    ['m2_timeout', () => (mockM2({ kind: 'timeout' }), makeInput())],
    ['m2_llm_error', () => (mockM2({ kind: 'llm_error', message: 'boom' }), makeInput())],
    ['m2_parse_failed', () => (mockM2({ kind: 'parse_failed', message: 'bad' }), makeInput())],
    [
      'no_proposals_applied',
      () => (mockM2({ kind: 'ok', proposals: [], latencyMs: 1, model: 'm' }), makeInput()),
    ],
  ];

  for (const [reason, arrange] of DEGRADE_DRIVERS) {
    it(`${reason}: enriched=false and outcome.graph === input.graph`, async () => {
      const input = arrange();
      const res = await enrichDraftGraph(input);
      expect(res.enriched).toBe(false);
      expect(res.reason).toBe(reason);
      expect(res.graph).toBe(input.graph); // reference identity, not just deep-equal
    });
  }

  it('internal_error (review throws): enriched=false and outcome.graph === input.graph', async () => {
    (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockRejectedValue(new Error('boom'));
    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.reason).toBe('internal_error');
    expect(res.graph).toBe(input.graph);
  });

  it('applied: enriched=true and outcome.graph is a NEW object (input never mutated)', async () => {
    mockM2({
      kind: 'ok',
      proposals: [riskProposal('risk_ok', 'A fresh risk')],
      latencyMs: 1,
      model: 'm',
    });
    const input = makeInput();
    const snapshot = structuredClone(input.graph);
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('applied');
    expect(res.graph).not.toBe(input.graph);
    expect(input.graph).toEqual(snapshot);
  });
});

describe('reason-union classification stays exhaustive and consistent', () => {
  const ALL_REASONS = Object.keys(REACHABILITY) as EnrichmentReason[];

  it('m2LlmCallMade matches the expected accounting partition for every member', () => {
    for (const reason of ALL_REASONS) {
      expect({ reason, callMade: m2LlmCallMade(reason) }).toEqual({
        reason,
        callMade: CALL_MADE[reason],
      });
    }
  });

  it('the runtime-reachable set and the defence-in-depth set partition the union', () => {
    const reachable = ALL_REASONS.filter((r) => REACHABILITY[r] === 'reachable');
    const unreachable = ALL_REASONS.filter((r) => REACHABILITY[r] !== 'reachable');
    expect(reachable.length + unreachable.length).toBe(ALL_REASONS.length);
    expect(unreachable.sort()).toEqual(
      ['not_implemented', 'option_surface_changed', 'post_merge_invalid', 'readiness_downgrade'].sort(),
    );
  });

  it('every call-made=true reason is one the M2 review could have preceded (sanity cross-check)', () => {
    // Reasons where an LLM call was made must never include the pre-call
    // short-circuits; this mirrors m2LlmCallMade's own exhaustive switch from
    // the OUTSIDE so a drifted reclassification is caught twice.
    const preCall: EnrichmentReason[] = [
      'not_implemented',
      'invalid_ingress_graph',
      'prompt_not_provisioned',
      'insufficient_headroom',
      'm2_model_not_resolved',
      'internal_error',
    ];
    for (const reason of preCall) expect(m2LlmCallMade(reason)).toBe(false);
  });
});
