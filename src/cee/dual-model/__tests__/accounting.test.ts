/**
 * Accounting-helper tests: exact parity with dual-draft/telemetry.ts
 * histogram semantics, and an exhaustive per-reason LLM-call table that
 * breaks (at compile time) if the frozen EnrichmentReason union is ever
 * additively extended without reclassification here.
 */
import { describe, it, expect } from 'vitest';
import type { EnrichmentReason } from '../../dual-draft/types.js';
import type { MergeFailure } from '../../dual-draft/merge.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import {
  failureHistogram,
  summariseMergeReport,
  combineAccounting,
  countLlmCalls,
  m2LlmCallMade,
} from '../accounting.js';
import { toStageResult } from '../contracts.js';
import { baseGraph, riskProposal } from './adversarial-fixtures.js';

function failure(code: MergeFailure['reason_code'], index = 0): MergeFailure {
  return { proposal_index: index, proposal_type: 'added_risk', reason_code: code, reason: 'r' };
}

describe('failureHistogram — parity with emitMergeReport semantics', () => {
  it('counts by reason_code exactly like dual-draft/telemetry.ts', () => {
    const failures = [
      failure('malformed_proposal', 0),
      failure('malformed_proposal', 1),
      failure('edge_creates_cycle', 2),
    ];
    expect(failureHistogram(failures)).toEqual({
      malformed_proposal: 2,
      edge_creates_cycle: 1,
    });
  });

  it('empty failures → empty histogram', () => {
    expect(failureHistogram([])).toEqual({});
  });
});

describe('summariseMergeReport — real-merge round trip', () => {
  it('accounts a mixed real merge outcome with the total invariant intact', () => {
    const out = mergeProposals(baseGraph(), [
      riskProposal('risk_a', 'Risk A'),
      { type: 'added_evidence_gap', delta: { question: 'Q?' }, evidence_pointer: 'e' },
      null, // malformed
    ]);
    const acc = summariseMergeReport(out.report);
    expect(acc).toEqual({
      items_total: 3,
      applied: 1,
      deferred: 1,
      failed: 1,
      failure_codes: { malformed_proposal: 1 },
    });
    expect(acc.applied + acc.deferred + acc.failed).toBe(acc.items_total);
  });
});

describe('combineAccounting', () => {
  it('sums counts and merges histograms by key', () => {
    const a = { items_total: 3, applied: 1, deferred: 1, failed: 1, failure_codes: { x: 1 } };
    const b = { items_total: 2, applied: 0, deferred: 0, failed: 2, failure_codes: { x: 1, y: 1 } };
    expect(combineAccounting(a, b)).toEqual({
      items_total: 5,
      applied: 1,
      deferred: 1,
      failed: 3,
      failure_codes: { x: 2, y: 1 },
    });
  });

  it('zero parts → zero accounting', () => {
    expect(combineAccounting()).toEqual({
      items_total: 0,
      applied: 0,
      deferred: 0,
      failed: 0,
      failure_codes: {},
    });
  });
});

describe('countLlmCalls — exhaustive over the frozen reason union', () => {
  // Record over the union: an additive EnrichmentReason extension without a
  // row here is a COMPILE error, forcing explicit reclassification.
  const EXPECTED_CALLS: Record<EnrichmentReason, 0 | 1> = {
    not_implemented: 0,
    invalid_ingress_graph: 0,
    prompt_not_provisioned: 0,
    insufficient_headroom: 0,
    m2_model_not_resolved: 0,
    internal_error: 0,
    applied: 1,
    no_proposals_applied: 1,
    m2_timeout: 1,
    m2_llm_error: 1,
    m2_parse_failed: 1,
    post_merge_invalid: 1,
    option_surface_changed: 1,
    readiness_downgrade: 1,
  };

  it('every reason contributes exactly its canonical m2LlmCallMade count', () => {
    for (const [reason, expected] of Object.entries(EXPECTED_CALLS) as Array<[EnrichmentReason, 0 | 1]>) {
      expect(countLlmCalls([reason])).toBe(expected);
      expect(Number(m2LlmCallMade(reason))).toBe(expected);
    }
  });

  it('sums across a multi-stage reason sequence', () => {
    const total = Object.values(EXPECTED_CALLS).reduce<number>((sum, n) => sum + n, 0);
    expect(countLlmCalls(Object.keys(EXPECTED_CALLS) as EnrichmentReason[])).toBe(total);
    expect(countLlmCalls([])).toBe(0);
  });
});

describe('toStageResult — adapter fidelity', () => {
  it('maps enriched/reason/graph without cloning the graph', () => {
    const g = baseGraph();
    const res = toStageResult({ enriched: false, reason: 'm2_timeout', graph: g });
    expect(res).toEqual({ changed: false, reason: 'm2_timeout', graph: g });
    expect(res.graph).toBe(g);
  });
});
