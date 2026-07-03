/**
 * Proposal-tally tests: hand-built tallies plus a property pass that drives
 * the REAL mergeProposals with mixed/hostile batches and asserts the
 * exact-one-bucket invariant on every outcome — doubling as a regression
 * tripwire on the merge's partition contract.
 */
import { describe, it, expect } from 'vitest';
import { mergeProposals } from '../../dual-draft/merge.js';
import { tallyFromMergeReport, checkTallyInvariant, type ProposalTally } from '../proposal-accounting.js';
import { baseGraph, riskProposal, edgeProposal, INJECTION_STRINGS } from './adversarial-fixtures.js';

describe('tallyFromMergeReport', () => {
  it('buckets a mixed real merge with per-code and per-type histograms', () => {
    const out = mergeProposals(baseGraph(), [
      riskProposal('risk_a', 'Risk A'), // applied
      { type: 'added_evidence_gap', delta: { question: 'Q1?' }, evidence_pointer: 'e' }, // deferred
      { type: 'uncertainty_flag', delta: { question: 'Q2?' }, evidence_pointer: 'e' }, // deferred
      null, // rejected: malformed
      { ...riskProposal('risk_a', 'Risk A duplicate probe'), evidence_pointer: 'e' }, // rejected: duplicate id
    ]);
    const tally = tallyFromMergeReport(out.report, out.artifacts);
    expect(tally).toEqual({
      total: 5,
      applied: 1,
      deferred: 2,
      rejected: 2,
      rejected_by_code: { malformed_proposal: 1, duplicate_node_id: 1 },
      deferred_by_type: { added_evidence_gap: 1, uncertainty_flag: 1 },
    });
    expect(checkTallyInvariant(tally)).toEqual({ ok: true, delta: 0 });
  });
});

describe('checkTallyInvariant', () => {
  it('flags a broken partition with the signed delta', () => {
    const broken: ProposalTally = {
      total: 5,
      applied: 1,
      deferred: 1,
      rejected: 1,
      rejected_by_code: {},
      deferred_by_type: {},
    };
    expect(checkTallyInvariant(broken)).toEqual({ ok: false, delta: 2 });
  });
});

describe('property: the invariant holds for every hostile batch the merge can face', () => {
  const BATCHES: Array<[string, readonly unknown[]]> = [
    ['empty', []],
    ['all garbage', [null, 42, [], 'x', { type: 'nope' }]],
    ['all valid', [riskProposal('risk_p1', 'P1'), edgeProposal('risk_churn', 'fac_price')]],
    [
      'mixed valid/artifact/garbage/duplicate',
      [
        riskProposal('risk_p2', 'P2'),
        { type: 'clarification_proposal', delta: { question: 'Which market?' }, evidence_pointer: 'e' },
        { type: 'added_risk', delta: {} },
        riskProposal('risk_p2', 'P2 duplicate'),
      ],
    ],
    [
      'injection-laden labels',
      INJECTION_STRINGS.map((s, i) => riskProposal(`risk_inj_${i}`, s)),
    ],
    [
      'over-cap flood',
      Array.from({ length: 30 }, (_, i) => riskProposal(`risk_o${i}`, `Overflow ${i}`)),
    ],
    [
      'option defers + claim rejections',
      [
        {
          type: 'added_option',
          delta: { node: { id: 'opt_p', kind: 'option', label: 'Partner route' } },
          evidence_pointer: 'e',
        },
        riskProposal('risk_claim', 'the EVPI is decisive'),
      ],
    ],
  ];

  for (const [label, batch] of BATCHES) {
    it(`${label}: total === applied + deferred + rejected`, () => {
      const out = mergeProposals(baseGraph(), batch);
      const tally = tallyFromMergeReport(out.report, out.artifacts);
      expect(checkTallyInvariant(tally).ok).toBe(true);
      expect(tally.total).toBe(batch.length);
    });
  }
});
