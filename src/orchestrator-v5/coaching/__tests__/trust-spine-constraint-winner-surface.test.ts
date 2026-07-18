/**
 * Trust-spine board #1 (CEE half) — the OTHER two winner surfaces beyond the
 * compact summary: the decision-review enricher (config-gated) and the
 * run_analysis headline (pure). Proves the recommendation framing is suppressed
 * on both when the leading option violates a hard constraint, and that the
 * flag-OFF path is byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';
import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';

// LIVE doctrine-B wire shape (object constraint_probabilities, joint 0) — the
// over-budget leader from the real staging capture.
const LIVE_WIRE_ENRICHMENT: Record<string, unknown> = {
  analysis_status: 'ok',
  constraints_status: 'computed',
  option_comparison: [
    {
      option_id: 'opt_premium',
      option_label: 'Premium Vendor',
      id: 'opt_premium',
      label: 'Premium Vendor',
      win_probability: 1,
      probability_of_joint_goal: 0,
      constraint_probabilities: { c_budget: 0 },
      status: 'computed',
    },
    {
      option_id: 'opt_budget',
      option_label: 'Budget Vendor',
      id: 'opt_budget',
      label: 'Budget Vendor',
      win_probability: 0,
      probability_of_joint_goal: 1,
      constraint_probabilities: { c_budget: 1 },
      status: 'computed',
    },
  ],
};

describe('decision-review enricher — constraint-infeasible winner (config-gated)', () => {
  let prior: string | undefined;

  async function setGate(value: string | undefined): Promise<void> {
    if (value === undefined) delete process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
    else process.env.CEE_CONSTRAINT_INFEASIBLE_GATE = value;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  }

  beforeEach(() => {
    prior = process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
  });
  afterEach(async () => {
    await setGate(prior);
  });

  it('flag ON: marks the over-budget winner infeasible + suppressed', async () => {
    await setGate('true');
    const input = buildInvokeInputForTests('brief', LIVE_WIRE_ENRICHMENT, 'opt_premium');
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_premium');
    expect(input!.winner.constraint_infeasible).toBe(true);
    expect(input!.winner.recommendation_suppressed).toBe(true);
  });

  it('flag OFF: byte-identical — winner unflagged', async () => {
    await setGate('false');
    const input = buildInvokeInputForTests('brief', LIVE_WIRE_ENRICHMENT, 'opt_premium');
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_premium');
    expect(input!.winner.constraint_infeasible).toBeUndefined();
    expect(input!.winner.recommendation_suppressed).toBeUndefined();
  });
});

describe('run_analysis headline — suppresses the confident lead when infeasible', () => {
  const baseInput: AnalysisResultHeadlineInput = {
    enrichment: {
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.7 },
        { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.3 },
      ],
    },
    leading_option_id: 'opt_a',
    status_kind: 'ok',
  };

  it('constraint_infeasible=true: withholds the headline (null → neutral template)', () => {
    const text = buildAnalysisResultHeadline({ ...baseInput, constraint_infeasible: true });
    expect(text).toBeNull();
    const descriptor = describeAnalysisHeadline({ ...baseInput, constraint_infeasible: true });
    expect(descriptor.case).toBeNull();
    expect(descriptor.reason).toBe('constraint_infeasible');
  });

  it('discriminates: without the flag the SAME envelope produces a lead headline', () => {
    const text = buildAnalysisResultHeadline({ ...baseInput, constraint_infeasible: false });
    expect(text).not.toBeNull();
    expect(text).toContain('leads');
  });
});
