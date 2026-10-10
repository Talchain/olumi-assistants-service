import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';

type Factor = CandidateModel['factors'][number];
const factor = (label: string, value: number | null, unit: string | null): Factor => ({
  label, baseline_value: value, unit, baseline_known: true, provenance: 'explicit', role: 'observable', plausible_max: 10000,
});
const model = (label: string, value: number, unit: string, quote: string, rivals: Factor[] = []): CandidateModel => ({
  goal: { metric: 'Outcome', value: 100, unit: 'GBP', operator: '>=', horizon_months: null, provenance: 'explicit' },
  constraints: [], options: [], factors: [{ ...factor(label, value, unit), baseline_evidence: { quote } }, ...rivals],
  outcomes: [], risks: [], links: [],
});
const capacity = (unit: string | null = 'FTE', quote = 'Our capacity is 40 story points.') =>
  model('Engineering delivery capacity', 40, 'story points', quote, [factor('Technical leadership capacity', null, unit)]);
const verified = (m: CandidateModel, brief = m.factors[0]!.baseline_evidence!.quote) => verifiedFactorLevel(m, m.factors[0]!, brief);

describe('typed frame incompatibility, authority unchanged', () => {
  it('A different count frame cannot rival an owned story-point level', () => {
    expect(verified(capacity())).toBe(true);
  });
  it('A same count frame remains a rival', () => {
    expect(verified(capacity('story points'))).toBe(false);
  });
  it('A absent frame remains a rival', () => {
    expect(verified(capacity(null))).toBe(false);
  });
  it('A unreadable declared frame remains a rival', () => {
    expect(verified(capacity('GBP widgets'))).toBe(false);
  });
  it('A unknown denominator remains a rival', () => {
    const m = model('Pro plan price', 49, 'GBP/subscriber/month', 'Our Pro price is £49 per subscriber per month.',
      [factor('Pro price driven', null, 'GBP/month')]);
    expect(verified(m)).toBe(false);
  });
  it('A same period and quantity remain rivals', () => {
    const m = model('Pro subscribers today', 250, 'subscribers/month', 'We have 250 Pro subscribers a month.',
      [factor('New Pro subscribers per month', null, 'subscribers/month')]);
    expect(verified(m)).toBe(false);
  });
  it('A a declared per-period inflow cannot rival a located stock count', () => {
    const m = model('Pro subscribers today', 250, 'subscribers', 'We have 250 Pro subscribers.',
      [factor('New Pro subscribers per month', null, 'subscribers/month')]);
    expect(verified(m)).toBe(true);
  });
  for (const horizon of ['month', 'year', 'week']) {
    it(`A an explicit future ${horizon} horizon cannot rival an owned present count`, () => {
      const m = model('Current paying subscribers', 1500, 'subscribers', 'We have 1,500 paying subscribers.');
      expect(verified({ ...m, outcomes: [{ label: `Paying subscribers at ${horizon} 12`, provenance: 'inferred' }] })).toBe(true);
    });
  }
  for (const label of ['Paying subscribers', 'Paying subscribers at month 0', 'Paying subscribers at unknown 12']) {
    it(`A no proven future frame: ${label}`, () => {
      const m = model('Current paying subscribers', 1500, 'subscribers', 'We have 1,500 paying subscribers.');
      expect(verified({ ...m, outcomes: [{ label, provenance: 'inferred' }] })).toBe(false);
    });
  }
  it('A a goal stays a rival even with an incompatible declared unit', () => {
    const m = capacity();
    expect(verified({ ...m, factors: [m.factors[0]!], goal: { ...m.goal, metric: 'Technical leadership capacity', unit: 'FTE' } })).toBe(false);
  });
  for (const label of ['Technical capacity target', 'Technical capacity limit', 'Technical capacity forecast']) {
    it(`A a role-bearing rival stays: ${label}`, () => {
      const m = capacity();
      expect(verified({ ...m, factors: [m.factors[0]!, factor(label, null, 'FTE')] })).toBe(false);
    });
  }
  for (const quote of [
    'Our capacity target is 40 story points.',
    'Our capacity limit is 40 story points.',
    'Our capacity forecast is 40 story points.',
    'Our capacity is at most 40 story points.',
    'Our supplier claims capacity is 40 story points.',
    'Capacity today is 40 story points.',
  ]) {
    it(`A incompatible rival does not supply ownership or CURRENT role: ${quote}`, () => {
      expect(verified(capacity('FTE', quote))).toBe(false);
    });
  }
  for (const next of ['Ignore 40.', 'Our capacity is not 40 story points.', 'Olumi suggested 40.', 'At most.', 'Our capacity is 40 story points.']) {
    it(`A neighbour still refuses: ${next}`, () => {
      const m = capacity();
      expect(verified(m, `${m.factors[0]!.baseline_evidence!.quote} ${next}`)).toBe(false);
    });
  }
  it('A a different currency code proves incompatibility', () => {
    const m = model('Pro plan price', 49, 'GBP/month', 'Our Pro price is £49 a month.', [factor('Pro price driven', null, 'USD/month')]);
    expect(verified(m)).toBe(true);
  });
  it('A a scale alone proves no incompatibility', () => {
    const m = model('Pro plan price', 49, 'GBP/month', 'Our Pro price is £49 a month.', [factor('Pro price driven', null, 'GBPk/month')]);
    expect(verified(m)).toBe(false);
  });
});

describe('goal-value refusal belongs to its bound claim', () => {
  for (const quote of ['Our backlog is 0 jobs.']) {
    it(`B another metric target of zero does not own this CURRENT quote: ${quote}`, () => {
      const m = model('Backlog', 0, 'jobs', quote);
      expect(verified({ ...m, goal: { ...m.goal, value: 0, unit: 'FTE' } })).toBe(true);
    });
    it(`B even the same quantity at the target value needs target role: ${quote}`, () => {
      const m = model('Backlog', 0, 'jobs', quote);
      expect(verified({ ...m, goal: { ...m.goal, metric: 'Backlog', value: 0, unit: 'jobs' } })).toBe(true);
    });
  }
  // The shared cardinal grammar deliberately has no word for zero (cardinal-words.ts): "zero" is never a located amount, so
  // a drafter's word-zero quote stays withheld. Unchanged by this PR; opening it needs a source ruling (NEEDS RULING).
  it('B a word-zero quote has no located amount and stays withheld (unchanged)', () => {
    const m = model('Backlog', 0, 'jobs', 'Our backlog is zero jobs.');
    expect(verified({ ...m, goal: { ...m.goal, value: 0, unit: 'FTE' } })).toBe(false);
  });
  for (const quote of ['Our backlog target is 0 jobs.', 'Our backlog limit is 0 jobs.', 'Our backlog forecast is zero jobs.', 'Our backlog is at most 0 jobs.']) {
    it(`B a bound zero target or limit remains refused: ${quote}`, () => {
      const m = model('Backlog', 0, 'jobs', quote);
      expect(verified({ ...m, goal: { ...m.goal, metric: 'Backlog', value: 0, unit: 'jobs' } })).toBe(false);
    });
  }
  it('B a factor constraint at zero remains refused', () => {
    const m = model('Backlog', 0, 'jobs', 'Our backlog is 0 jobs.');
    expect(verified({ ...m, constraints: [{ metric: 'Backlog', value: 0, unit: 'jobs', operator: '<=', provenance: 'explicit' }] })).toBe(false);
  });
  it('B numeric equality supplies no missing receipt', () => {
    const m = model('Backlog', 0, 'jobs', 'Our backlog is 0 jobs.');
    expect(verified({ ...m, factors: [{ ...m.factors[0]!, baseline_evidence: null }], goal: { ...m.goal, value: 0 } }, 'Our backlog is 0 jobs.')).toBe(false);
  });
  it('B numeric equality supplies no ownership', () => {
    const m = model('Backlog', 0, 'jobs', 'They have 0 jobs.');
    expect(verified({ ...m, goal: { ...m.goal, value: 0 } })).toBe(false);
  });
});

describe('C preserves unresolved unit and ownership evidence', () => {
  it('C a verified first-person people statement carries exactly the declared headcount', () => {
    expect(verified(model('Team headcount', 8, 'people', 'Our team has 8 people.'))).toBe(true);
  });
  for (const [label, value, unit, quote] of [
    ['Developers hired', 3, 'hires', 'We have three developers today.'],
    ['Developers', 5, 'people', 'We have 5 developers.'],
    ['Stated tech leads', 2, 'FTE', 'We have two tech leads today.'],
    ['Team headcount', 8, 'people', 'Team headcount is 8.'],
    ['Tech leads hired', 0, 'hires', 'We have 0 tech leads today.'],
  ] as const) {
    it(`C no unverified conversion: ${quote} -> ${unit}`, () => {
      expect(verified(model(label, value, unit, quote))).toBe(false);
    });
  }
});


describe('verified zero survives only its affine carrier conversion', () => {
  const affine = (quote: string | null): CandidateModel => ({
    ...model('List price change', 0, '%', quote ?? 'Our list price change is 0%.'),
    factors: [{ ...factor('List price change', 0, '%'), baseline_evidence: quote === null ? null : { quote } }],
    options: [{ label: 'Cut price', provenance: 'ai_proposed', changes: [],
      interventions: [{ factor_label: 'List price change', value: -15, unit: '%', provenance: 'ai_proposed' }] }],
  });
  it('B affine conversion keeps a verified CURRENT zero as user credit on 100 percent of today', () => {
    const quote = 'Our list price change is 0%.'; const m = affine(quote);
    expect(verified(m, quote)).toBe(true);
    const n = admitCandidateModel(m, {}, quote).nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state).toMatchObject({ raw_value: 100, unit: '% of today', source: 'brief_extraction' });
    expect(n.observed_state?.user_material_unverified).toBeUndefined();
  });
  it('B affine conversion cannot supply a missing drafter receipt', () => {
    const n = admitCandidateModel(affine(null), {}, 'Our list price change is 0%.').nodes.find(n => n.kind === 'factor')!;
    expect(n.observed_state?.raw_value).toBe(100);
    expect(n.observed_state?.source).not.toBe('brief_extraction');
  });
  it('B affine conversion cannot turn a zero target into a verified CURRENT baseline', () => {
    const quote = 'Our list price change target is 0%.';
    const m = affine(quote);
    const admitted = admitCandidateModel({ ...m, goal: { ...m.goal, metric: 'List price change', value: 0, unit: '%' } }, {}, quote).nodes;
    // The goal and the factor share one quantity here, so the carrier is the goal node: either way, never a brief credit.
    const n = admitted.find(n => n.kind === 'factor') ?? admitted.find(n => n.kind === 'goal')!;
    expect(n.observed_state?.source).not.toBe('brief_extraction');
  });
});
