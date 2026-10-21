/** L18C: the legacy admission maps a capless operand's explicit frame without enforcing a limit (a current level plus a stated
 * per-unit addition). The rows that replayed the retired path-B converter (`candidate-to-graph.ts`, deleted 21 Oct 2026) went
 * with it: see evidence/track2-deletion-20261021/NEGATIVES-DISPOSITION.md.
 */
import { expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../../../agent-lane/admit-model.js';

type Rec = Record<string, any>;
const UNIT = 'tickets per week';
const TODAY = 'The existing team clears 80 tickets per week.';
const EFFECT = 'Each extra specialist clears about 20 tickets per week, between 10 and 30.';
const SUM = 'Total capacity is the existing capacity plus the extra capacity.';
const said = (quote: string, subject: Rec, field: string, value: number, unit: string, extra: Rec = {}): Rec => ({
  quote, subject: { to_label: null, factor_label: null, ...subject }, field, form: 'point', value, low: null, high: null,
  unit, qualifier: null, conditions: null, speaker: 'user', ...extra,
});
const factor = (label: string, value: number, unit: string, origin = 'olumi'): Rec => ({ label, role: 'observable',
  baseline_known: true, baseline_value: value, unit, origin, stance: 'stated_current', provenance: 'inferred',
  plausible_max: null, baseline_evidence: null });
const link = (from: string, to: string, amount: number, origin = 'olumi', definitional = false): Rec => ({
  from, to, direction: 'positive', provenance: 'inferred', origin, stance: 'estimate', effect_amount: amount,
  effect_per_source_change: 1, effect_provenance: origin === 'user' ? 'explicit' : 'inferred', definitional,
  basis: null, source_quote: origin === 'user' ? EFFECT : SUM,
});
function draft(statementUnit = `${UNIT} per specialist`): Rec {
  return {
    goal: { metric: 'Total capacity', kind: null, deliverable: null, operator: '>=', target_stated: true, value: 100, unit: UNIT,
      horizon_months: null, provenance: 'explicit', frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 80,
      baseline_provenance: 'explicit', baseline_origin: 'user', baseline_stance: 'stated_current', target_origin: 'user', target_stance: 'target',
      source_quote: 'Our target is 100 tickets per week.', scope: null, basis: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], unknown_concerns: [], decision_question: null,
    factors: [
      { ...factor('Existing capacity', 80, UNIT, 'user'), provenance: 'explicit', baseline_evidence: { quote: TODAY } },
      { ...factor('Extra specialists', 0, 'specialists'), role: 'controllable' },
      factor('Extra capacity', 0, UNIT),
    ],
    options: [
      { label: 'Hold', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true, added_capacity: null },
      { label: 'Grow', provenance: 'explicit', changes: [], is_status_quo: false, added_capacity: null,
        interventions: [{ factor_label: 'Extra specialists', value: 1, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit',
          origin: 'user', stance: 'hypothetical', stated_evidence: null }] },
    ],
    links: [link('Existing capacity', 'Total capacity', 1, 'olumi', true),
      link('Extra specialists', 'Extra capacity', 20, 'user'), link('Extra capacity', 'Total capacity', 1, 'olumi', true)],
    identities: [{ operation: 'sum', outcome: 'Total capacity', factors: ['Existing capacity', 'Extra capacity'],
      provenance: 'inferred', reading: null, evidence: null }],
    statements: [said(TODAY, { kind: 'factor', label: 'Existing capacity' }, 'level', 80, UNIT),
      said(TODAY, { kind: 'goal', label: 'Total capacity' }, 'level', 80, UNIT),
      said('Our target is 100 tickets per week.', { kind: 'goal', label: 'Total capacity' }, 'target', 100, UNIT),
      said('Grow adds 1 specialist.', { kind: 'option', label: 'Grow', factor_label: 'Extra specialists' }, 'level', 1, 'specialists'),
      said(EFFECT, { kind: 'link', label: 'Extra specialists', to_label: 'Extra capacity' }, 'effect', 20, statementUnit,
        { form: 'range', low: 10, high: 30, qualifier: 'about' })],
  };
}
it('L18C admission: an explicit capless frame maps known and estimated levels without enforcing a limit', () => {
  for (const baseline_known of [true, false]) {
    for (const baseline_value of [0, 80, 150]) {
      const raw = draft();
      Object.assign(raw.factors[2], { baseline_known, baseline_value, scale_frame: 125 });
      const admitted = admitCandidateModel(raw as CandidateModel, {});
      const operand = admitted.nodes.find(n => n.label === 'Extra capacity')!;
      expect(operand.scale_frame).toBe(125);
      expect(operand.observed_state).toEqual({ value: baseline_value / 125, raw_value: baseline_value,
        unit: UNIT, source: 'cee_inference', extractionType: 'inferred' });
    }
  }
});
