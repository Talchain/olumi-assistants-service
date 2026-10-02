/**
 * B3 MODEL FIDELITY + ADMISSION — the served pricing graph SHAPE (Paul's 2 Oct pricing test), rebuilt by hand.
 *
 * Nothing here is a raw debug export (those are private and stay local). It is the shape the brief records
 * (`olumi-programme-docs` `output/b3-model-fidelity/BRIEF.md`): goal MRR; factors Pro plan price, paying subscribers,
 * monthly churn and the Agent-added "Pro price per seat"; options Keep £49 (the held status quo, `{}`), £59, £54,
 * the introductory offer (written with ONLY the ongoing price — byte-identical to £59) and per-seat pricing (with no
 * billable-seats factor anywhere).
 *
 * `declared` adds what the Agent SAID was missing as the typed carrier (`unresolved_targets` + the `user_questions`
 * naming it) on the option node — exactly the fields the B3 writer stores (`optionGapFields`) after an approval that
 * declares `unmodelled_mechanisms`.
 */

import { optionGapFields } from '../../../../agent-lane/unmodelled-mechanisms.js';

type Rec = Record<string, unknown>;

export const B3_IDS = {
  decision: 'should_we_raise_our_pro_plan_price',
  goal: 'mrr',
  keep: 'keep_current_price',
  p59: 'raise_price_to_59',
  p54: 'raise_price_to_54',
  intro: 'raise_pro_to_59_with_introductory_offer',
  perSeat: 'replace_flat_plan_pricing_with_per_seat_pricing',
  price: 'pro_plan_price',
  subs: 'pro_paying_subscribers',
  churn: 'monthly_churn',
  perSeatPrice: 'fac_pro_price_per_seat',
  seats: 'fac_billable_seats',
} as const;

export const B3_LABELS = {
  keep: 'Keep current price',
  p59: 'Raise price to £59',
  p54: 'Raise price to £54',
  intro: 'Raise Pro to £59 with introductory offer of 1 month free',
  perSeat: 'Replace flat-plan pricing with per-seat pricing',
} as const;

const level = (factor: string, value: number, raw: number, unit = 'GBP/month'): Rec => ({
  [factor]: { value, raw_value: raw, unit, source: 'user_specified', target_match: { node_id: factor, match_type: 'exact_id', confidence: 'high' } },
});

const edge = (from: string, to: string, mean: number, std: number, extra: Rec = {}): Rec => ({
  from, to, strength: { mean, std }, exists_probability: 1, effect_direction: mean < 0 ? 'negative' : 'positive', ...extra,
});

export interface B3ShapeOptions {
  /** Write the Agent's declared gaps onto the two option nodes (`unresolved_targets`). */
  readonly declared?: boolean;
  /** Leave the introductory offer out of the graph (rows that are about per-seat only). */
  readonly withoutIntro?: boolean;
  /** Leave per-seat out of the graph (rows that are about the free month only). */
  readonly withoutPerSeat?: boolean;
  /** Leave £54 out (B3-6: too few left once the incomplete options are excluded). */
  readonly withoutP54?: boolean;
  /** Leave £59 out. */
  readonly withoutP59?: boolean;
  /** B3-5: the missing mechanism supplied — a billable-seats factor with a value and its path to MRR — and the gap cleared. */
  readonly seatsResolved?: boolean;
}

export function b3PricingGraph(opts: B3ShapeOptions = {}): Rec {
  const I = B3_IDS;
  const nodes: Rec[] = [
    { id: I.decision, kind: 'decision', label: 'Should we raise our Pro plan price?' },
    {
      id: I.goal, kind: 'goal', label: 'MRR', goal_direction: '>',
      observed_state: { value: 0.7058823529411765, raw_value: 75000, cap: 106250, unit: 'GBP/month', baseline: 0.7058823529411765, source: 'brief_extraction' },
    },
    { id: I.keep, kind: 'option', label: B3_LABELS.keep, is_baseline: true },
    { id: I.p59, kind: 'option', label: B3_LABELS.p59, interventions: level(I.price, 0.295, 59) },
    { id: I.p54, kind: 'option', label: B3_LABELS.p54, interventions: level(I.price, 0.27, 54) },
    {
      id: I.intro, kind: 'option', label: B3_LABELS.intro, interventions: level(I.price, 0.295, 59),
      ...(opts.declared === true ? optionGapFields(B3_LABELS.intro, ['free first month']) : {}),
    },
    {
      id: I.perSeat, kind: 'option', label: B3_LABELS.perSeat,
      interventions: {
        ...level(I.price, 0, 0),
        ...level(I.perSeatPrice, 0.1, 10, 'GBP/seat/month'),
      },
      ...(opts.declared === true && opts.seatsResolved !== true ? optionGapFields(B3_LABELS.perSeat, ['billable seats']) : {}),
    },
    {
      id: I.price, kind: 'factor', label: 'Pro plan price', category: 'controllable',
      observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month', declared_scale: 'unit_interval', source: 'brief_extraction' },
    },
    {
      id: I.subs, kind: 'factor', label: 'Pro paying subscribers', category: 'observable',
      observed_state: { value: 0.15, raw_value: 1500, cap: 10000, unit: 'subscribers', declared_scale: 'unit_interval', source: 'brief_extraction' },
    },
    {
      id: I.churn, kind: 'factor', label: 'Monthly churn', category: 'observable', scale_frame: 100,
      observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'cee_inference' },
    },
    {
      id: I.perSeatPrice, kind: 'factor', label: 'Pro price per seat', category: 'controllable',
      observed_state: { value: 0, raw_value: 0, cap: 100, unit: 'GBP/seat/month', declared_scale: 'unit_interval', source: 'user' },
    },
    ...(opts.seatsResolved === true
      ? [{
        id: I.seats, kind: 'factor', label: 'Billable seats', category: 'observable',
        observed_state: { value: 0.3, raw_value: 3000, cap: 10000, unit: 'seats', declared_scale: 'unit_interval', source: 'user' },
      }]
      : []),
  ];
  const edges: Rec[] = [
    edge(I.decision, I.keep, 1, 0.01),
    edge(I.decision, I.p59, 1, 0.01),
    edge(I.decision, I.p54, 1, 0.01),
    edge(I.decision, I.intro, 1, 0.01),
    edge(I.decision, I.perSeat, 1, 0.01),
    edge(I.keep, I.price, 1, 0.01, { origin: 'repair' }),
    edge(I.p59, I.price, 1, 0.01),
    edge(I.p54, I.price, 1, 0.01),
    edge(I.intro, I.price, 1, 0.01),
    edge(I.perSeat, I.price, 1, 0.01),
    edge(I.perSeat, I.perSeatPrice, 1, 0.01),
    edge(I.price, I.churn, 0.1, 0.05),
    edge(I.churn, I.subs, -0.5, 0.125),
    edge(I.subs, I.goal, 0.9, 0.2),
    edge(I.price, I.goal, 0.5, 0.125),
    edge(I.perSeatPrice, I.goal, 0.5, 0.125),
    ...(opts.seatsResolved === true
      ? [edge(I.seats, I.goal, 0.5, 0.125)]
      : []),
  ];
  const drop = new Set<string>([
    ...(opts.withoutIntro === true ? [I.intro] : []),
    // Its own factor goes with it: a controllable factor no option sets is a readiness blocker of its own.
    ...(opts.withoutPerSeat === true ? [I.perSeat, I.perSeatPrice] : []),
    ...(opts.withoutP54 === true ? [I.p54] : []),
    ...(opts.withoutP59 === true ? [I.p59] : []),
  ]);
  return {
    nodes: nodes.filter((n) => !drop.has(n.id as string)),
    edges: edges.filter((e) => !drop.has(e.from as string) && !drop.has(e.to as string)),
  };
}
