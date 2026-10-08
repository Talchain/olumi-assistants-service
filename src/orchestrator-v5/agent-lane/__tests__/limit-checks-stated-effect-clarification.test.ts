import { describe, expect, it } from 'vitest';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';
import type { LinkEffectClarificationPending } from '../link-effect-clarification.js';
import { limitChecksForAgent } from '../limit-checks.js';
import { savedRunContextFacts } from '../saved-run-context-facts.js';

const SID = '550e8400-e29b-41d4-a716-4466554400e1';
const QUOTE = 'Our current churn is 4%, and we predict it will at least increase 1% with this price increase.';
const QUESTION = 'Does “at least increase 1%” mean at least one percentage point, or a relative increase of at least 1%?';
const CARRIED_ASK = `You said “${QUOTE}”. ${QUESTION}`;
const pending = (from = 'price', to = 'churn'): LinkEffectClarificationPending => ({
  id: 'pending-price-churn', scenario_id: SID, chip_id: 'link-clarification',
  action: {
    kind: 'elicit_link_effect_clarification', from_id: from, to_id: to,
    from_label: 'Pro plan price', to_label: 'Monthly churn', quote: QUOTE, question: QUESTION,
    refusal: 'unit_mismatch',
  },
  preconditions: {}, expires_at_turn_count: 6,
  emitted_at_iso: '2026-10-08T00:26:00.000Z', expires_at_iso: '2026-10-09T00:26:00.000Z',
});

function graph(sized: boolean, chained = false) {
  const link = (from: string, to: string, unit: string) => ({
    from, to, strength: { mean: 0.1, std: 0.05 },
    provenance: sized ? {
      source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { strength_mean: 0.1, amount_unit: unit },
    } : { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' },
  });
  return {
    nodes: [
      { id: 'price', kind: 'factor', label: 'Pro plan price', unit: 'GBP' },
      { id: 'churn', kind: 'factor', label: 'Monthly churn', unit: '%', observed_state: { raw_value: 4, unit: '%', source: 'user_override' } },
      { id: 'advertising', kind: 'factor', label: 'Advertising spend', unit: 'GBP' },
      { id: 'visits', kind: 'factor', label: 'Daily visits', unit: 'visits', observed_state: { raw_value: 100, unit: 'visits', source: 'user_override' } },
      ...(chained ? [{ id: 'sensitivity', kind: 'factor', label: 'Price sensitivity', unit: '%' }] : []),
      { id: 'raise', kind: 'option', label: 'Raise prices', interventions: { price: { value: 1, source: 'user_specified' } } },
      { id: 'advertise', kind: 'option', label: 'Advertise', interventions: { advertising: { value: 1, source: 'user_specified' } } },
    ],
    edges: [
      ...(chained ? [link('price', 'sensitivity', '%'), link('sensitivity', 'churn', '%')] : [link('price', 'churn', '%')]),
      link('advertising', 'visits', 'visits'),
    ],
    goal_constraints: [
      { constraint_id: 'churn-limit', node_id: 'churn', label: 'Monthly churn', operator: '<=', value: 6, unit: '%', provenance: 'explicit', value_frame: 'level' },
      { constraint_id: 'visits-limit', node_id: 'visits', label: 'Daily visits', operator: '>=', value: 80, unit: 'visits', provenance: 'explicit', value_frame: 'level' },
    ],
  };
}

const verdicts: StoredLimitVerdicts = {
  per_limit: [
    { constraint_id: 'churn-limit', state: 'estimate_only', reason: 'level_olumi_estimate' },
    { constraint_id: 'visits-limit', state: 'estimate_only', reason: 'level_olumi_estimate' },
  ],
  joint: { state: 'withheld' },
};

describe('RC2 post-Run asks retain stated effects with their open clarification', () => {
  it.each([false, true])('RED: a %s sized link asks the carried question; another link retains its exact answer row', sized => {
    const g = graph(sized);
    const before = limitChecksForAgent(g, verdicts)!;
    const after = limitChecksForAgent(g, verdicts, undefined, [pending()])!;
    expect(before.find(row => row.constraint_id === 'churn-limit')!.ask).toContain('How much does ‘Pro plan price’ change ‘Monthly churn’?');
    expect(after.find(row => row.constraint_id === 'churn-limit')!.ask).toContain(CARRIED_ASK);
    expect(after.find(row => row.constraint_id === 'churn-limit')!.ask).not.toContain('How much does');
    expect(after.find(row => row.constraint_id === 'visits-limit')).toEqual(before.find(row => row.constraint_id === 'visits-limit'));
  });

  it('RED: the sole clarification on an unsized path replaces the broad part-to-target ask', () => {
    const rows = limitChecksForAgent(graph(false, true), verdicts, undefined, [pending('sensitivity', 'churn')])!;
    expect(rows.find(row => row.constraint_id === 'churn-limit')!.ask).toContain(CARRIED_ASK);
    expect(rows.find(row => row.constraint_id === 'churn-limit')!.ask).not.toContain('How much does');
  });

  it('CONTROL: a clarification for another link and an empty carrier change no answer-row bytes', () => {
    const g = graph(false);
    const before = JSON.stringify(limitChecksForAgent(g, verdicts));
    expect(JSON.stringify(limitChecksForAgent(g, verdicts, undefined, []))).toBe(before);
    expect(JSON.stringify(limitChecksForAgent(g, verdicts, undefined, [pending('unknown', 'churn')]))).toBe(before);
  });

  it('RED: saved Run facts receive the same clarification carrier', () => {
    const hash = 'a'.repeat(16);
    const facts = savedRunContextFacts(SID, {
      graph_hash: hash,
      analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-08T00:27:00.000Z' } },
      analysis_result: { type: 'analysis_result', computed_against_hash: hash },
      raw: graph(false), limit_verdicts: verdicts,
    }, { leader_may_be_named: false }, [pending()]);
    const rows = (facts.limit_checks as { limits: Array<{ constraint_id: string; ask?: string }> }).limits;
    expect(rows.find(row => row.constraint_id === 'churn-limit')!.ask).toContain(CARRIED_ASK);
    expect(rows.find(row => row.constraint_id === 'churn-limit')!.ask).not.toContain('How much does');
  });
});
