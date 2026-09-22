/**
 * Analysis admissibility, against the admitted capture.
 *
 * The verdict on the real captured candidate must be `withheld`, and the
 * controls below prove the policy is discriminating rather than a constant
 * refusal — a rule that always says no would protect nothing and block
 * everything.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type AdmittedModel } from '../admit-model.js';
import { assessAnalysisAdmissibility, DEFAULTED_LIMIT_PERCENT } from '../analysis-admissibility.js';

const d = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8'));
const widened = JSON.parse(readFileSync(new URL('widened.json', d), 'utf8'));
const admitted = admitCandidateModel(faithful, widened);

describe('assessAnalysisAdmissibility', () => {
  it('withholds analysis of the captured candidate, and names why', () => {
    const r = assessAnalysisAdmissibility(admitted);
    expect(r.verdict).toBe('withheld');
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain('goal_reachable_only_by_projection');
    expect(codes).toContain('decisive_link_withheld');
    expect(codes).toContain('user_constraint_not_enforced');
  });

  it('names the withheld relationship in the message, not just a code', () => {
    const r = assessAnalysisAdmissibility(admitted);
    const decisive = r.reasons.find((x) => x.code === 'decisive_link_withheld');
    expect(decisive).toBeDefined();
    // Bound by identity: the message must name the actual endpoints, so a
    // generic sentence cannot satisfy it.
    expect(decisive!.message).toContain('pro_plan_price');
    expect(decisive!.message).toContain('monthly_churn_rate');
  });

  it('speaks in the user’s terms — no schema vocabulary leaks into a message', () => {
    const r = assessAnalysisAdmissibility(admitted);
    for (const reason of r.reasons) {
      for (const leak of ['strength.mean', 'exists_probability', 'defaulted', 'RepairEntry', 'GraphV3']) {
        expect(reason.message, `"${leak}" must not appear in user-facing copy`).not.toContain(leak);
      }
    }
  });

  it('CONTROL: a fully authored model is READY — the policy is not a constant refusal', () => {
    const authored: AdmittedModel = {
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Price' },
      ],
      edges: [
        { from: 'price', to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      ],
      goal_constraints: [],
      loss: [],
      withheld: [],
    };
    const r = assessAnalysisAdmissibility(authored);
    expect(r.verdict).toBe('ready');
    expect(r.reasons).toHaveLength(0);
  });

  it('CONTROL: projected magnitudes ALONE only LIMIT — they do not withhold', () => {
    const projectedOnly: AdmittedModel = {
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Price' },
        { id: 'churn', kind: 'factor', label: 'Churn' },
      ],
      edges: [
        // One authored edge into the goal, so rule 1 does not fire.
        { from: 'price', to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
        { from: 'churn', to: 'price', strength: { mean: 0.5, std: 0.125 }, exists_probability: 0.8, effect_direction: 'positive', defaulted: true },
      ],
      goal_constraints: [],
      loss: [],
      withheld: [],
    };
    const r = assessAnalysisAdmissibility(projectedOnly);
    expect(r.verdict).toBe('limited');
    expect(r.reasons.map((x) => x.code)).toEqual(['majority_magnitudes_projected']);
  });

  it('the limit threshold is the documented one', () => {
    expect(DEFAULTED_LIMIT_PERCENT).toBe(50);
  });
});
