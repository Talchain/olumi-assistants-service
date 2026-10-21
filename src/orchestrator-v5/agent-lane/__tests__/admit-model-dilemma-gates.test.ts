/**
 * The legacy admission (A, `admitCandidateModel`) still applies its gates on the legacy lane: on the dated-dilemma draft (an
 * unattested dated goal, figures from the user, a named third party and an unclear source), it keeps each drafted figure as
 * Olumi's inference marked unverified, and a drafted risk as Olumi's inference. Moved verbatim from the retired path-B
 * converter's test (`candidate-to-graph.test.ts`, deleted 21 Oct 2026), where it was B's contrast; A's half is a live
 * negative. SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;

const S = [
  'Our board game is meant to ship before the winter holidays.',
  'The printer told us the new card stock takes at least 5 weeks to arrive.',
  'We need 3 weeks to pack and post the pre-orders.',
  'Apparently around 40 backers would cancel if we slip.',
  'If we delay we miss the holiday sales, but if we ship with the old card stock the cards may warp.',
  'Should we delay the launch or ship with the old card stock?',
];
const BRIEF = S.join(' ');
const SHIPPED = 'Board game shipped before the holidays';
const link = (from: string, to: string, direction: string, quote: string | null = null, size: Rec = {}): Rec => ({ from, to, direction,
  origin: 'olumi', stance: 'estimate', provenance: quote === null ? 'ai_proposed' : 'explicit', effect_amount: null, effect_per_source_change: null, effect_provenance: null,
  definitional: null, basis: null, source_quote: quote, ...size });
const statement = (quote: string, label: string, speaker: 'user' | 'other' | 'unknown', value: number, unit: string, form = 'point'): Rec => ({
  quote, subject: { kind: 'factor', label, to_label: null, factor_label: null }, field: 'level', form, value, low: null, high: null, unit,
  qualifier: form === 'lower_bound' ? 'at least' : null, conditions: null, speaker });
const factor = (label: string, value: number | null, unit: string | null, provenance: string, quote: string | null = null): Rec => ({
  label, origin: 'user', stance: 'stated_current', role: 'external', baseline_known: value !== null && provenance === 'explicit', baseline_value: value,
  baseline_evidence: quote === null ? null : { quote }, unit, provenance, plausible_max: null });
const dilemmaDraft = (): Rec => ({
  goal: { kind: 'event_by_date', deliverable: 'board game shipment', metric: SHIPPED, operator: '>=', target_stated: false, value: null,
    unit: '', horizon_months: null, provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null,
    baseline_provenance: 'inferred', scope: null, quantity_frame: 'level', basis: null, source_quote: S[0] },
  constraints: [],
  options: [
    { label: 'Delay the launch', provenance: 'explicit', changes: ['Launch timing'], interventions: [], added_capacity: null, is_status_quo: null },
    { label: 'Ship with the old card stock', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
  ],
  factors: [
    { ...factor('Card stock lead time', 5, 'weeks', 'explicit', S[1]), origin: 'third_party' },
    factor('Packing time', 3, 'weeks', 'explicit', S[2]),
    { ...factor('Backer cancellations', 40, 'backers', 'explicit', S[3]), origin: 'unknown' },
    { ...factor('Launch timing', null, null, 'inferred'), role: 'controllable' },
  ],
  risks: ['Missed holiday sales', 'Warped cards'].map((label) => ({ label, provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: null })),
  outcomes: [],
  links: [link('Launch timing', 'Missed holiday sales', 'positive', S[4]), link('Card stock lead time', 'Launch timing', 'positive')],
  identities: [], unknowns: ['When do the winter holidays start for the backers?'], decision_question: S[5], unknown_concerns: [],
  statements: [statement(S[1]!, 'Card stock lead time', 'other', 5, 'weeks', 'lower_bound'), statement(S[2]!, 'Packing time', 'user', 3, 'weeks'),
    statement(S[3]!, 'Backer cancellations', 'unknown', 40, 'backers')],
});

describe('the legacy admission still applies its gates', () => {
  it('⛔ A on the dated-dilemma draft keeps the three drafted figures as unverified Olumi inferences and the drafted risk as Olumi\'s', () => {
    const a = admitCandidateModel(dilemmaDraft() as never, {}, BRIEF);
    const aNode = (label: string): Rec => a.nodes.find((n) => n.label === label) as Rec;
    for (const label of ['Packing time', 'Card stock lead time', 'Backer cancellations']) {
      expect(aNode(label).observed_state, label).toMatchObject({ source: 'cee_inference', user_material_unverified: true });
    }
    expect(aNode('Missed holiday sales').provenance).toBe('ai_inferred');
  });
});
