/** DL ruling 8 Oct: explicit likelihood words only. */
import { describe, expect, it } from 'vitest';
import { readStatedEventRisk, readStatedLikelihoodWithoutWindow } from '../stated-event-risk.js';
import { holdStatedEventRisks } from '../../agent-lane/stated-event-risk-draft.js';

describe('fix4 explicit likelihood class', () => {
  it.each([
    ['N1', 'Within 6 months the hit to MRR is probably 10%.'],
    ['N2', 'The revenue loss is probably 10% within 6 months.'],
    ['N3', 'Churn is probably 10% within 6 months.'],
    ['N4', 'Revenue will drop, maybe 10%, within 6 months.'],
    ['N5', 'The new supplier boosts our odds 10% within a year.'],
    ['N6', 'Hiring a second supplier improves our odds 10% within a year.'],
    ['N7', 'Expect maybe a 12% markdown on stock within 3 months.'],
    ['N8', 'I guess 15% of pipeline slips within 3 months.'],
    ['N9', 'The odds are that we lose 10% of revenue within 6 months.'],
    ['N10', 'Perhaps 20% of deals will be lost, within a year.'],
    ['N11', 'A competitor price cut is likely, around 15%, within 3 months.'],
    ['N12', "There's a likelihood of a 10% shrinkage within 6 months."],
    ['N13', 'The cost overrun would be maybe 20% over the next year.'],
    ['N14', 'The discount is probably 15% within 3 months.'],
    // DL ruling 8 Oct: explicit likelihood words only. Review F2/F4/F6 now refuse.
    ['F2', "I'd say about 40% that it happens within the next year."],
    ['F4', 'Perhaps 15% within 6 months.'],
    ['F6', "The supplier could go bust; I'd estimate 20% in the next year."],
    ['served-developer', 'Our key developer might leave, maybe 10–30% in the next 6 months.'],
    ['estimate', "I'd estimate 20% in the next year."],
    ['happen', 'It may happen 10–30% in the next 6 months.'],
    ['bare-noun', 'Our odds 10% within a year.'],
    ['bare-chance', 'Chance 20% within 6 months.'],
    ['probable', 'Supplier failure is 30% probable within 6 months.'],
    ['bare-risk', '30% risk within 6 months.'],
    ['risk-the', '30% risk the supplier fails within 6 months.'],
    ['risk-of-rate', 'The risk of churn is 7% within 6 months.'],
    ['risk-that-rate', 'The risk that churn occurs is 7% within 6 months.'],
  ])('fix4-refuse-%s: %s', (_id, input) => {
    expect(readStatedEventRisk(input)).toBeUndefined();
    const noWindow = input.replace(/\b(?:within|in|over|during) (?:the )?(?:(?:next|coming|following) )?(?:(?:\d+(?:\.\d+)?|a|an|one) )?(?:months?|years?|weeks?)\b/gi, '');
    expect(readStatedLikelihoodWithoutWindow(noWindow)).toBe(false);
  });

  // F3 is an existing fail-closed one-in-N miss; its cue grammar stays unchanged.
  it('fix4-F3 existing one-in-N refusal stays unchanged', () => {
    expect(readStatedEventRisk('The odds of the supplier failing are about 1 in 4 within a year.')).toBeUndefined();
  });

  it.each([
    ['F1', "There's roughly a 25% chance of that within 6 months.", 0.25, 0.25, 6],
    ['F5', 'We think the chance is about 30% over the next 6 months.', 0.3, 0.3, 6],
    ['F7', 'Key supplier fails: 20–30% chance in the next 12 months.', 0.2, 0.3, 12],
    ['F8', "It's maybe a 1 in 5 chance within 6 months.", 0.2, 0.2, 6],
    ['F9', 'Probability of losing the anchor client: 35% within a year.', 0.35, 0.35, 12],
    ['F10', 'There is a 30 percent chance the migration slips within 6 months, costing us 10% of ARR.', 0.3, 0.3, 6],
    ['F11', 'Odds of a strike are 30% within 6 months.', 0.3, 0.3, 6],
    ['F12', 'A data breach has a 5% chance within a year.', 0.05, 0.05, 12],
    ['with-probability', 'with probability 10% within 6 months', 0.1, 0.1, 6],
    ['with-a-probability-of', 'with a probability of 10% within 6 months', 0.1, 0.1, 6],
    ['chance-after', '10% chance it happens within 6 months', 0.1, 0.1, 6],
    ['one-in', '1 in 10 chance within a year', 0.1, 0.1, 12],
    ['chance-event-colon', 'Chance of supplier failure: 20% within 6 months', 0.2, 0.2, 6],
    ['percent-probability', 'a 30 percent probability within 6 months', 0.3, 0.3, 6],
    ['likely-after', '30% likely within 6 months', 0.3, 0.3, 6],
    ['likelihood-after', '30% likelihood within 6 months', 0.3, 0.3, 6],
    ['odds-after', '30% odds within 6 months', 0.3, 0.3, 6],
    ['risk-of-after', '30% risk of an outage within 6 months', 0.3, 0.3, 6],
    ['risk-that-after', '30% risk that the supplier fails within 6 months', 0.3, 0.3, 6],
    ['chance-of-bridge', 'chance of 30% within 6 months', 0.3, 0.3, 6],
    ['probability-at-bridge', 'probability at 30% within 6 months', 0.3, 0.3, 6],
    ['likelihood-equals-bridge', 'likelihood = 30% within 6 months', 0.3, 0.3, 6],
  ])('fix4-read-%s: %s', (_id, input, low, high, months) => {
    expect(readStatedEventRisk(input)?.event_risk).toEqual({
      version: 1,
      occurrence: { p_low: low, p_high: high, basis: 'user', meaning: 'at_least_once_within_horizon' },
      horizon: { months },
    });
  });

  it.each([
    ['D2', "Supplier fails, there's a 30% chance within 6 months.", true],
    ['D2-curly', 'Supplier fails, there’s a 30% chance within 6 months.', true],
    ['D2-it', "Supplier fails, it's a 30% chance within 6 months.", true],
    ['D2-that', "Supplier fails, that's a 30% chance within 6 months.", true],
    ['D6', 'Supplier fails, probably a 10% dip in MRR within 6 months.', false],
    ['D7', 'If the supplier fails, there is a 30% chance of a delay within 6 months.', false],
    // DL ruling 8 Oct: explicit likelihood words only. Review D4 now refuses.
    ['D4', 'Release slips; Supplier fails, maybe 30% within 6 months.', false],
  ])('fix4-draft-%s: %s', (_id, input, held) => {
    const nodes = [{ id: 'supplier', kind: 'risk', label: 'Supplier fails' },
      { id: 'mrr', kind: 'outcome', label: 'MRR' }];
    const edges = [{ id: 'impact', from: 'supplier', to: 'mrr', exists_probability: 0.7,
      defaulted: true, strength: { mean: -0.3, std: 0.15 } }];
    const before = structuredClone({ nodes, edges });
    const result = holdStatedEventRisks(nodes, edges, input);
    expect({ nodes, edges }).toEqual(before);
    expect(result.refused).toEqual([]);
    if (held) {
      expect(result.held).toHaveLength(1);
      expect(result.held[0]?.risk_id).toBe('supplier');
      expect(result.nodes[0]?.event_risk).toEqual({ version: 1,
        occurrence: { p_low: 0.3, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' },
        horizon: { months: 6 } });
      expect(result.edges[0]).toEqual({ ...edges[0], exists_probability: 1 });
    } else {
      expect(result.held).toEqual([]);
      expect(result.nodes).toBe(nodes);
      expect(result.edges).toBe(edges);
    }
  });
});
