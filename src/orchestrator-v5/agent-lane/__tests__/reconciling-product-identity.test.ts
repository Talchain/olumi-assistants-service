/**
 * ⛔ A GOAL WHOSE STATED LEVEL IS THE PRODUCT OF ITS TWO STATED PARTS IS WORKED OUT AS ONE (R3 #72 5886596030).
 *
 * Measured on served CEE `30ee11b`, Paul's own brief ("£49 … 1,500 paying subscribers and £75k MRR … above £85k"):
 * only 2 of 5 drafts DECLARED MRR = price × subscribers. The other 3 drew two default-strength links, so £59 reached a
 * median £77.3k (arithmetic: 1,500 × £59 = £88.5k), every option read P(goal) = 0, and the reply said the target "is
 * not met under any current option". Sums are minted from a goal's parents; products came ONLY from the drafter.
 *
 * Rule: when the drafter declares no identity for the goal, the goal's user-stated level o and EXACTLY TWO factor
 * parents with user-stated levels a, b reconcile within ISL's own 5% (|o − a·b| ≤ 5% of |o|), the product is
 * declared as Olumi's reading (`provenance: inferred` → `stated_in_brief: false`). Every row reads the REGISTERED graph.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { withGoalProductUnconfirmed, withReconcilingProductIdentity } from '../reconciling-product.js';

const GOAL = 'monthly_recurring_revenue';

function pricing(goal: Partial<CandidateModel['goal']> = {}): CandidateModel {
  return {
    goal: {
      metric: 'Monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 20000, unit: 'GBP', horizon_months: null, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null, ...goal,
    },
    constraints: [],
    options: [
      { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Raise to £55', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 55, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [],
  } as unknown as CandidateModel;
}

/** The production contract: the candidate must pass the real strict schema, as the model's output would. */
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function registeredGoal(model: CandidateModel, brief = 'Should we raise the Pro plan price? MRR is £16,000 today; we want £20,000.', build: typeof buildModelFromBrief = buildModelFromBrief) {
  const wire = { ...model, unknowns: [], decision_question: null };
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await build('77777777-7777-4777-8777-777777777777', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const parsed = GraphV3.parse(graph);
  const goal = parsed.nodes.find((n) => n.id === GOAL);
  expect(goal?.kind).toBe('goal');
  return { goal: goal as Record<string, unknown> & { observed_state?: Record<string, unknown> }, graph: parsed, out };
}


const PAUL = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

type Part = { label: string; unit: string; level: number; role?: string };
function paulDraft(over: {
  identities?: unknown[]; goalLevel?: number; goalUnit?: string; priceUnit?: string; subscribers?: Record<string, unknown>;
  extraFactor?: boolean; parts?: readonly [Part, Part];
} = {}): CandidateModel {
  const base = pricing({ operator: '>', value: 85000, unit: over.goalUnit ?? 'GBP/month', baseline_known: true, baseline_value: over.goalLevel ?? 75000 }) as unknown as Record<string, any>;
  const factor = (p: Part) => ({ label: p.label, role: p.role ?? 'observable', baseline_known: true, baseline_value: p.level, unit: p.unit, provenance: 'explicit', plausible_max: p.level * 4 });
  const link = (from: string) => ({ from, to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
  const parts = over.parts;
  return {
    ...base,
    options: parts
      ? base.options.map((o: Record<string, any>) => ({ ...o, interventions: o.interventions.map((i: Record<string, any>) => ({ ...i, factor_label: parts[0].label, unit: parts[0].unit })) }))
      : base.options,
    factors: parts
      ? [factor({ ...parts[0], role: 'controllable' }), factor(parts[1])]
      : [
          { ...base.factors[0], unit: over.priceUnit ?? 'GBP per subscriber per month' },
          { label: 'Paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000, ...(over.subscribers ?? {}) },
          ...(over.extraFactor ? [{ label: 'Brand strength', role: 'external', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 10 }] : []),
        ],
    links: parts
      ? [link(parts[0].label), link(parts[1].label)]
      : [link('Pro plan price'), link('Paying subscribers'), ...(over.extraFactor ? [link('Brand strength')] : [])],
    identities: over.identities ?? [],
  } as unknown as CandidateModel;
}
const PRODUCT = { operation: 'product', factor_ids: ['pro_plan_price', 'paying_subscribers'], stated_in_brief: false };

describe('a goal whose stated level reconciles with its two stated parts is declared their product', () => {
  it('RED: Paul\'s draft with NO identity (3/5 served) → MRR = price × subscribers, Olumi\'s reading', async () => {
    const { goal } = await registeredGoal(paulDraft(), PAUL);
    expect(goal.nonlinear_identity).toStrictEqual(PRODUCT);
  });

  it('CONTROL: a draft that already declares it is untouched (2/5 served)', async () => {
    const declared = [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }];
    const { goal } = await registeredGoal(paulDraft({ identities: declared }), PAUL);
    expect(goal.nonlinear_identity).toStrictEqual(PRODUCT);
  });

  it('CONTROL: parts that do NOT reconcile (49 × 1,500 = 73,500 vs £60k, 18% off) → no identity', async () => {
    const { goal } = await registeredGoal(paulDraft({ goalLevel: 60000 }), PAUL.replace('£75k MRR', '£60k MRR'));
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  it('CONTROL: an operand the user never stated (Olumi\'s estimate) → no identity', async () => {
    const { goal } = await registeredGoal(
      paulDraft({ subscribers: { provenance: 'inferred' } }),
      'Should we raise our Pro plan price from £49 to £59 a month? We have £75k MRR and want MRR above £85k within a year.',
    );
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  // MG 5886660362: the 2/5 drafts that already declare it come out BYTE-IDENTICAL. The mint returns the SAME candidate
  // object whenever it does not mint, so everything downstream of it is exactly today's path.
  it('BYTE-IDENTICAL: every case that does not mint returns the very same candidate object', () => {
    const declared = paulDraft({ identities: [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }] });
    expect(withReconcilingProductIdentity(declared, PAUL)).toBe(declared);
    const off = paulDraft({ goalLevel: 60000 });
    expect(withReconcilingProductIdentity(off, PAUL.replace('£75k MRR', '£60k MRR'))).toBe(off);
    const three = paulDraft({ extraFactor: true });
    expect(withReconcilingProductIdentity(three, PAUL)).toBe(three);
    const minted = paulDraft();
    expect(withReconcilingProductIdentity(minted, PAUL)).not.toBe(minted);
  });

  it('NO DENOMINATOR ("GBP/month", served 3/4): the reading is still kept, as Olumi\'s, awaiting the user\'s Yes (FORK (iii), R3 5891486222)', async () => {
    const d = paulDraft({ priceUnit: 'GBP/month' });
    expect(withReconcilingProductIdentity(d, PAUL)).not.toBe(d);
    const { goal } = await registeredGoal(d, PAUL);
    expect(goal.nonlinear_identity).toStrictEqual(PRODUCT);
  });

  // ⛔ FORK (iii): a product the DRAFTER declares on the goal is the drafter's reading, never the user's statement: inside
  // the card's domain it is kept but demoted to Olumi's (stated_in_brief: false), whatever the drafter tagged it.
  it('DEMOTED: a drafter-declared EXPLICIT goal product on Paul\'s plain brief → Olumi\'s reading (stated_in_brief: false)', async () => {
    const declared = [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'explicit' }];
    const { goal } = await registeredGoal(paulDraft({ identities: declared }), PAUL);
    expect(goal.nonlinear_identity).toStrictEqual(PRODUCT);
  });
  it('CONTROL: a drafter-declared explicit product OUTSIDE the domain (18% off) is left as the drafter tagged it', async () => {
    const declared = [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'explicit' }];
    const d = paulDraft({ identities: declared, goalLevel: 60000 });
    expect(withGoalProductUnconfirmed(d, PAUL.replace('£75k MRR', '£60k MRR'))).toBe(d);
  });
  it('CONTROL: an already-inferred declaration comes back as the very same object', () => {
    const d = paulDraft({ identities: [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }] });
    expect(withGoalProductUnconfirmed(d, PAUL)).toBe(d);
  });

  it('SERVED shape (draft 2 at 30ee11b): "£/subscriber/month" × "subscribers" composes → minted', async () => {
    const { goal } = await registeredGoal(paulDraft({ priceUnit: '£/subscriber/month' }), PAUL);
    expect(goal.nonlinear_identity).toStrictEqual(PRODUCT);
  });

  // ⛔ AIQ 5886846493 (a HARD condition) + DL 5886781042: numbers that match are not enough; the UNITS must compose.
  it('NEGATIVE (AIQ): "3 engineers × £25k budget ≈ £75k MRR" — exact numbers, but a period-less £ × a count is not £/month', async () => {
    const draft = paulDraft({ parts: [{ label: 'Budget per engineer', unit: 'GBP', level: 25000 }, { label: 'Engineers', unit: 'engineers', level: 3 }] });
    const { goal } = await registeredGoal(draft, 'We have 3 engineers and a £25,000 budget per engineer. MRR is £75,000 and we want MRR above £85k.');
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  it('NEGATIVE (DL): a denominator that names another count ("£ per seat per month" × "subscribers") → no identity', async () => {
    const { goal } = await registeredGoal(paulDraft({ priceUnit: '£ per seat per month' }), PAUL);
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  it('NEGATIVE (PR Review on 9fdc3f96): a SECOND denominator ("GBP per subscriber per seat per month" × "subscribers") → no identity', async () => {
    // price × subscribers is then GBP per seat per month, not the goal's GBP per month.
    const d = paulDraft({ priceUnit: 'GBP per subscriber per seat per month' });
    expect(withReconcilingProductIdentity(d, PAUL)).toBe(d);
    const { goal } = await registeredGoal(d, PAUL);
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  it('NEGATIVE (PR Review on 98be677f): a REPEATED period ("GBP per subscriber per month per month" × "subscribers") → no identity', async () => {
    // price × subscribers is then GBP per month², not the goal's GBP per month.
    const d = paulDraft({ priceUnit: 'GBP per subscriber per month per month' });
    expect(withReconcilingProductIdentity(d, PAUL)).toBe(d);
    const { goal } = await registeredGoal(d, PAUL);
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  // The CLASS, not the example (one row per unit shape; the price is Paul's £49, the count his 1,500).
  it.each([
    ['GBP per subscriber per month', 'subscribers', 'GBP/month', true],
    ['£/subscriber/month', 'paying subscribers', 'GBP/month', true],
    ['GBP per month per subscriber', 'subscribers', 'GBP/month', true],
    ['GBP per subscriber per month', 'subscribers', 'GBP recurring revenue per month', true],
    ['GBP per subscriber per seat per month', 'subscribers', 'GBP/month', false],
    ['GBP/seat/subscriber/month', 'subscribers', 'GBP/month', false],
    // AIQ 5891385320 (3): per-N-month composes (£ per subscriber-month × subscribers IS £/month): the card's domain, so the
    // reading is kept as Olumi's; it was "don't compose" and got neither the card nor the withhold.
    ['GBP per subscriber-month', 'subscribers', 'GBP/month', true],
    ['GBP per subscriber per month', 'subscriber seats', 'GBP/month', false],
    ['GBP per subscriber per month', 'subscribers', 'GBP per subscriber per month', false],
    ['GBP per subscriber per month per year', 'subscribers', 'GBP/month', false],
    ['GBP per 1000 subscribers per month', 'subscribers', 'GBP/month', false],
    ['GBP per user per month', 'subscribers', 'GBP/month', false],
    ['GBP per subscriber', 'subscribers', 'GBP/month', false],
    ['GBP per subscriber per year', 'subscribers', 'GBP/month', false],
    ['USD per subscriber per month', 'subscribers', 'GBP/month', false],
    // PR Review on 98be677f: ONE period at most, in the rate and in the goal.
    ['GBP per subscriber per month per month', 'subscribers', 'GBP/month', false],
    ['GBP monthly per subscriber per month', 'subscribers', 'GBP/month', false],
    ['GBP per subscriber per month', 'subscribers', 'GBP/month/month', false],
    // A period the reader does not know is a second NOUN denominator, never a period: under-claims.
    ['GBP per subscriber per week', 'subscribers', 'GBP per week', false],
    // AIQ 5887464051: an ARR goal is a YEAR period; a monthly rate × a count is money per month.
    ['GBP per subscriber per month', 'subscribers', 'GBP ARR', false],
    ['£/subscriber/month', 'subscribers', 'GBP/year', false],
  ] as const)('unit class: %s × %s → goal %s mints = %s', (priceUnit, count, goalUnit, mints) => {
    const d = paulDraft({ priceUnit, goalUnit, subscribers: { unit: count } });
    const out = withReconcilingProductIdentity(d, PAUL);
    expect(out === d).toBe(!mints);
    if (mints) expect(out.identities).toStrictEqual([{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }]);
  });

  it('NEGATIVE (DL): a same-shape numeric coincidence the brief states as an UNRELATED relation → no identity', async () => {
    // £49 × 1,500 = £73,500 ≈ £75k, but the brief is about support tickets, and "tickets per month" is a rate, not a count.
    const draft = paulDraft({ parts: [{ label: 'Cost per support ticket', unit: 'GBP per ticket', level: 49 }, { label: 'Support tickets', unit: 'tickets per month', level: 1500 }] });
    const { goal } = await registeredGoal(draft, 'Each support ticket costs us £49 to handle and we get 1,500 tickets a month. MRR is £75k and we want MRR above £85k.');
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });

  it('BYTE-IDENTICAL (whole graph, MG + DL): with the mint switched off, a declared draft and a non-minting draft register the SAME graph', async () => {
    const declared = paulDraft({ identities: [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }] });
    const engineers = paulDraft({ parts: [{ label: 'Budget per engineer', unit: 'GBP', level: 25000 }, { label: 'Engineers', unit: 'engineers', level: 3 }] });
    const ENG = 'We have 3 engineers and a £25,000 budget per engineer. MRR is £75,000 and we want MRR above £85k.';
    const on = { declared: (await registeredGoal(declared, PAUL)).graph, engineers: (await registeredGoal(engineers, ENG)).graph, mint: (await registeredGoal(paulDraft(), PAUL)).graph };
    vi.resetModules();
    vi.doMock('../reconciling-product.js', () => ({ withReconcilingProductIdentity: (c: unknown) => c, withGoalProductUnconfirmed: (c: unknown) => c }));
    try {
      const off = (await import('../runtime/build-model.js')).buildModelFromBrief;
      expect((await registeredGoal(declared, PAUL, off)).graph).toStrictEqual(on.declared);
      expect((await registeredGoal(engineers, ENG, off)).graph).toStrictEqual(on.engineers);
      // Positive control on the comparator: where the mint fires, the graphs DO differ.
      expect((await registeredGoal(paulDraft(), PAUL, off)).graph).not.toStrictEqual(on.mint);
    } finally {
      vi.doUnmock('../reconciling-product.js');
      vi.resetModules();
    }
  });

  it('CONTROL: a third parent into the goal → no identity (the product would not be the whole goal)', async () => {
    const { goal } = await registeredGoal(paulDraft({ extraFactor: true }), PAUL);
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });
});
