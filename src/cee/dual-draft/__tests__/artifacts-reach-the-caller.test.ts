/**
 * Dual-draft DEFER ARTEFACTS must reach enrichDraftGraph's CALLER (RED-first).
 *
 * Defect this pins (measured at the served staging SHA
 * 9b98fcd0a3152b21ad71d97bf3d6f23fbf0afbe7):
 *   - mergeProposals computes `MergeOutcome.artifacts` — the non-mutating
 *     epistemic artefacts (added_evidence_gap, uncertainty_flag,
 *     clarification_proposal, plus the D1 added_option defer);
 *   - `EnrichmentOutcome` carried only {enriched, reason, graph}, so index.ts
 *     dropped `outcome.artifacts` on the floor;
 *   - the sole non-test reader of the artefact channel was telemetry.ts:48 —
 *     and that reads `report.artifacts`, a COUNT, never the content.
 * Net: every artefact the reviewer produced was computed, counted, discarded.
 *
 * Assertions bind by IDENTITY — the exact `question` text, the exact `type`
 * and the exact `evidence_pointer` — never by a count or a shape predicate a
 * different artefact could satisfy. A count assertion is what the pre-existing
 * telemetry test already does, and it is exactly what could not detect this.
 *
 * Only the M2 review caller is mocked; merge + guards run REAL, so the
 * artefacts asserted here are the ones the real deterministic merge builds.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../m2-review.js', () => ({
  reviewDraftGraph: vi.fn(),
}));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { reviewDraftGraph } from '../m2-review.js';
import { enrichDraftGraph } from '../index.js';
import type { EnrichmentInput } from '../types.js';

function baseGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as GraphV3T;
}

function makeInput(graph: GraphV3T = baseGraph()): EnrichmentInput {
  return {
    graph,
    brief: 'Should we launch now?',
    analysisReady: null,
    requestId: 'req-artifacts',
    scenarioId: 'scen-artifacts',
    turnId: 'turn-artifacts',
    pipelineElapsedMs: 20_000,
  };
}

function mockM2(outcome: unknown) {
  (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockResolvedValue(
    outcome as Awaited<ReturnType<typeof reviewDraftGraph>>,
  );
}

// IDENTITY anchors. Shared between the mocked M2 proposal and the assertion so
// the two cannot drift, while the assertion remains an exact-string equality —
// any other artefact the merge might produce fails it.
const GAP_QUESTION = 'What is the current churn baseline?';
const GAP_POINTER = 'draft: risk_churn unquantified';
const GAP_RATIONALE = 'The churn risk carries no measured baseline.';

const OPTION_LABEL = 'Partner with a distributor';
const OPTION_POINTER = 'brief: partnership mentioned';

// A genuinely mergeable proposal, so the stage reaches reason='applied' rather
// than the no_proposals_applied degrade.
const APPLIED_RISK = {
  type: 'added_risk',
  delta: { node: { id: 'risk_regulatory', kind: 'risk', label: 'Regulatory delay' } },
  evidence_pointer: 'brief: approval timeline',
};

const EVIDENCE_GAP = {
  type: 'added_evidence_gap',
  delta: { question: GAP_QUESTION },
  evidence_pointer: GAP_POINTER,
  rationale: GAP_RATIONALE,
};

const DEFERRED_OPTION = {
  type: 'added_option',
  delta: { node: { id: 'opt_partner', kind: 'option', label: OPTION_LABEL } },
  evidence_pointer: OPTION_POINTER,
};

function okM2(proposals: readonly unknown[]) {
  return { kind: 'ok', proposals, latencyMs: 5_000, model: 'test-model' };
}

describe('enrichDraftGraph — defer artefacts reach the caller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries an added_evidence_gap artefact out of the stage with its EXACT question, type and evidence_pointer', async () => {
    mockM2(okM2([APPLIED_RISK, EVIDENCE_GAP]));
    const res = await enrichDraftGraph(makeInput());

    // Precondition: the merge succeeded, so this is the success return path.
    expect(res.reason).toBe('applied');
    expect(res.enriched).toBe(true);

    // The channel exists and is an array (not undefined, not a count).
    expect(Array.isArray(res.artifacts)).toBe(true);

    // IDENTITY: locate the artefact by its exact question text, then assert the
    // rest of its identity. `find` (not `[0]`) so the assertion cannot pass by
    // landing on some other artefact at index 0.
    const gap = res.artifacts.find((a) => a.question === GAP_QUESTION);
    expect(gap).toBeDefined();
    expect(gap?.type).toBe('added_evidence_gap');
    expect(gap?.evidence_pointer).toBe(GAP_POINTER);
    expect(gap?.rationale).toBe(GAP_RATIONALE);

    // Exactly one artefact: the applied risk must NOT also appear here.
    expect(res.artifacts).toHaveLength(1);
  });

  it('carries the D1 added_option defer artefact out of the stage, naming the proposed option', async () => {
    mockM2(okM2([APPLIED_RISK, DEFERRED_OPTION]));
    const res = await enrichDraftGraph(makeInput());

    expect(res.reason).toBe('applied');
    const deferred = res.artifacts.find((a) => a.type === 'added_option');
    expect(deferred).toBeDefined();
    expect(deferred?.question).toContain(OPTION_LABEL);
    expect(deferred?.evidence_pointer).toBe(OPTION_POINTER);
    // D1 policy: the option was deferred, never merged.
    expect(res.graph.nodes.some((n) => n.id === 'opt_partner')).toBe(false);
  });

  it('carries BOTH artefact families in one turn, each identifiable by its own exact question', async () => {
    mockM2(okM2([APPLIED_RISK, EVIDENCE_GAP, DEFERRED_OPTION]));
    const res = await enrichDraftGraph(makeInput());

    expect(res.reason).toBe('applied');
    expect(res.artifacts).toHaveLength(2);
    const byQuestion = new Map(res.artifacts.map((a) => [a.question, a.type]));
    expect(byQuestion.get(GAP_QUESTION)).toBe('added_evidence_gap');
    expect([...byQuestion.keys()].some((q) => q.includes(OPTION_LABEL))).toBe(true);
  });

  it('a degrade path returns an EMPTY ARRAY, never undefined (m2 timeout)', async () => {
    mockM2({ kind: 'timeout', latencyMs: 25_000 });
    const res = await enrichDraftGraph(makeInput());

    expect(res.reason).toBe('m2_timeout');
    expect(res.artifacts).not.toBeUndefined();
    expect(Array.isArray(res.artifacts)).toBe(true);
    expect(res.artifacts).toHaveLength(0);
  });

  it('the pre-M2 degrade path (invalid ingress graph) also returns an EMPTY ARRAY', async () => {
    const res = await enrichDraftGraph(makeInput({ nodes: 'not-an-array' } as unknown as GraphV3T));

    expect(res.reason).toBe('invalid_ingress_graph');
    expect(reviewDraftGraph).not.toHaveBeenCalled();
    expect(res.artifacts).not.toBeUndefined();
    expect(Array.isArray(res.artifacts)).toBe(true);
    expect(res.artifacts).toHaveLength(0);
  });

  it('the internal_error backstop also returns an EMPTY ARRAY', async () => {
    (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockRejectedValue(new Error('boom'));
    const res = await enrichDraftGraph(makeInput());

    expect(res.reason).toBe('internal_error');
    expect(res.artifacts).not.toBeUndefined();
    expect(Array.isArray(res.artifacts)).toBe(true);
    expect(res.artifacts).toHaveLength(0);
  });
});
