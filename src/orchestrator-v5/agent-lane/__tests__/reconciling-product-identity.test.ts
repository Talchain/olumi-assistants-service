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
import { describe, it, expect } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

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

async function registeredGoal(model: CandidateModel, brief = 'Should we raise the Pro plan price? MRR is £16,000 today; we want £20,000.') {
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
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const parsed = GraphV3.parse(graph);
  const goal = parsed.nodes.find((n) => n.id === GOAL);
  expect(goal?.kind).toBe('goal');
  return { goal: goal as Record<string, unknown> & { observed_state?: Record<string, unknown> }, graph: parsed, out };
}


const PAUL = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

function paulDraft(over: { identities?: unknown[]; goalLevel?: number; subscribers?: Record<string, unknown>; extraFactor?: boolean } = {}): CandidateModel {
  const base = pricing({ operator: '>', value: 85000, baseline_known: true, baseline_value: over.goalLevel ?? 75000 }) as unknown as Record<string, any>;
  return {
    ...base,
    factors: [
      ...base.factors,
      { label: 'Paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000, ...(over.subscribers ?? {}) },
      ...(over.extraFactor ? [{ label: 'Brand strength', role: 'external', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 10 }] : []),
    ],
    links: [
      ...base.links,
      { from: 'Paying subscribers', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      ...(over.extraFactor ? [{ from: 'Brand strength', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }] : []),
    ],
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

  it('CONTROL: a third parent into the goal → no identity (the product would not be the whole goal)', async () => {
    const { goal } = await registeredGoal(paulDraft({ extraFactor: true }), PAUL);
    expect(goal.nonlinear_identity ?? null).toBeNull();
  });
});
