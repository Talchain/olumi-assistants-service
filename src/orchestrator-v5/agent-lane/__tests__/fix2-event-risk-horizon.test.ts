import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { BUILD_INSTRUCTIONS } from '../runtime/build-model.js';

const LABEL = 'Key developer departure';
const BASIS = 'Typical annual key-staff turnover in small software teams.';
function candidate(goalMonths: number | null, occurrenceMonths: number): CandidateModel {
  return {
    goal: { metric: 'Revenue', operator: '>=', value: 20000, unit: 'GBP/month', horizon_months: goalMonths,
      provenance: 'explicit', baseline_known: true, baseline_value: 10000, baseline_provenance: 'explicit' },
    constraints: [], options: [], factors: [], outcomes: [],
    risks: [{ label: LABEL, provenance: 'explicit', unit: 'event', plausible_max: 1,
      occurrence: { p_low_pct: 10, p_high_pct: 10, horizon_months: occurrenceMonths, basis_text: BASIS } }],
    links: [{ from: LABEL, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed',
      effect_amount: -1000, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }],
  };
}
function admit(goalMonths: number | null, occurrenceMonths: number) {
  const brief = goalMonths === null
    ? 'Goal: reach Revenue of £20,000 a month. Key developer departure is a risk.'
    : `Goal: reach Revenue of £20,000 a month within ${goalMonths} months. Key developer departure is a risk.`;
  const result = admitCandidateModel(candidate(goalMonths, occurrenceMonths), {}, brief, () => true);
  return { result, risk: result.nodes.find(node => node.kind === 'risk')! };
}

describe('FIX-2 D: the goal horizon governs Olumi event occurrences', () => {
  beforeEach(() => { vi.spyOn(log, 'info').mockImplementation(() => undefined as never); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('r1 #5: a three-month estimate stays a placeholder beside a stated twelve-month goal', () => {
    const { result, risk } = admit(12, 3);
    expect(risk.event_risk).toBeUndefined();
    expect(risk.event_risk_basis_text).toBeUndefined();
    expect(result.loss).toContainEqual(expect.objectContaining({
      field_path: `nodes[${LABEL}].event_risk`, before: 3, after: null,
      reason: expect.stringMatching(/drafted occurrence is for 3 months.*goal's horizon is 12 months/),
    }));
    expect(result.loss.some(entry => entry.field_path.endsWith('.event_risk') && /Olumi.s estimate/i.test(entry.reason))).toBe(false);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({
      event: 'cee.event_risk.horizon_mismatch', risk_node_id: 'key_developer_departure',
      drafted_months: 3, goal_months: 12,
    }, 'event risk: drafted horizon differs from the goal horizon; likelihood not used');
  });

  it('admits the unchanged estimate when its own horizon matches the stated goal', () => {
    const { risk } = admit(12, 12);
    expect(risk.event_risk).toMatchObject({ occurrence: { basis: 'olumi' }, horizon: { months: 12 } });
    expect(risk.event_risk?.occurrence.p_low).toBeCloseTo(0.1 / 1.9);
    expect(risk.event_risk?.occurrence.p_high).toBeCloseTo(0.2 / 1.1);
    expect(risk.event_risk_basis_text).toBe(BASIS);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('admits the drafted six-month horizon when the goal states no horizon', () => {
    const { risk } = admit(null, 6);
    expect(risk.event_risk).toMatchObject({ occurrence: { basis: 'olumi' }, horizon: { months: 6 } });
    expect(risk.event_risk_basis_text).toBe(BASIS);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('asks for another period only when the goal states no horizon', () => {
    expect(BUILD_INSTRUCTIONS).toContain("over the goal's horizon in months (if the goal states no horizon, the period you mean)");
    expect(BUILD_INSTRUCTIONS).not.toContain("over the goal's horizon in months (or the period you mean)");
  });
});
