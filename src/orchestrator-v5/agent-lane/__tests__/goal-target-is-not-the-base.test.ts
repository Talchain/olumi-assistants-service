/**
 * ⛔ A TARGET IS NOT A CURRENT LEVEL (R3 #72 5885498117; DL 5885526452 (3); AIQ 5885470243).
 *
 * At staging `c0c45f0d` a brief that states ONLY a target ("We are aiming for £20,000 MRR") was admitted with that
 * target as the goal's CURRENT level (`observed_state` raw 20000, `brief_extraction`) whenever the drafter wrote it as
 * `baseline_value`: the baseline was grounded because the user wrote "£20,000", but they wrote it as the target. The
 * goal then sat exactly on its own threshold and P(goal) read a status quo nobody stated.
 *
 * Rule: a baseline EQUAL to the goal's own target is the user's only if the brief writes that figure MORE times than
 * the target uses it (≥ 2). Every row reads the goal by id off the REGISTERED graph (real `buildModelFromBrief` →
 * `/graph/register`, parsed with CEE's `GraphV3`), exactly as `goal-carries-its-baseline.test.ts` does.
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


const TARGET_ONLY = pricing({ baseline_known: true, baseline_value: 20000 });

describe('a figure the user wrote only as the TARGET never becomes the goal\'s current level', () => {
  it('RED: "aiming for £20,000 MRR", drafted as baseline_value 20000 → no observed_state; the threshold stays', async () => {
    const { goal } = await registeredGoal(TARGET_ONLY, 'Should we raise the Pro plan price? We are aiming for £20,000 MRR.');
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_threshold_raw).toBe(20000);
  });

  it('RED: the same in the k-form ("aiming for £20k") — one reading of the figure, never a second spelling', async () => {
    const { goal } = await registeredGoal(TARGET_ONLY, 'Should we raise the Pro plan price? We are aiming for £20k MRR.');
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_threshold_raw).toBe(20000);
  });

  it('RED: a HELD strict floor ("MRR above £20,000"), drafted with baseline_value 20000 → no observed_state either', async () => {
    const { goal } = await registeredGoal(
      pricing({ operator: '>', baseline_known: true, baseline_value: 20000 }),
      'Should we raise the Pro plan price? We want MRR above £20,000.',
    );
    expect(goal.observed_state).toBeUndefined();
  });

  it('RED: the brief says "£16,000 today; we want £20,000" but the drafter COPIES the target → the target is refused as the base', async () => {
    // The exact shape goal-carries-its-baseline's old equality CONTROL admitted (its default brief); that row now states
    // the equality it is named for.
    const { goal } = await registeredGoal(TARGET_ONLY, 'Should we raise the Pro plan price? MRR is £16,000 today; we want £20,000.');
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_threshold_raw).toBe(20000);
  });

  it('CONTROL: "£16,000 today, aiming for £20,000" keeps the true base, 16000, as the user\'s', async () => {
    const { goal } = await registeredGoal(
      pricing({ baseline_known: true, baseline_value: 16000 }),
      'Should we raise the Pro plan price? MRR is about £16,000 today and we are aiming for £20,000.',
    );
    expect(goal.observed_state).toMatchObject({ raw_value: 16000, source: 'brief_extraction' });
  });

  // AIQ 5885651301: Paul's own briefs are the controls (the strict chain's served witness, #72 5882267370).
  const PAUL = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
    + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
  const paulGoal = (today: number) => pricing({ operator: '>', value: 85000, baseline_known: true, baseline_value: today });

  it('CONTROL (Paul): "£75k MRR … above £85k" keeps today\'s £75k as the user\'s base', async () => {
    const { goal } = await registeredGoal(paulGoal(75000), PAUL);
    expect(goal.observed_state).toMatchObject({ raw_value: 75000, source: 'brief_extraction' });
  });

  it('CONTROL (Paul, equality): "£85k MRR … above £85k" writes the figure twice, so today\'s £85k is still the base', async () => {
    const { goal } = await registeredGoal(paulGoal(85000), PAUL.replace('£75k MRR', '£85k MRR'));
    expect(goal.observed_state).toMatchObject({ raw_value: 85000, source: 'brief_extraction' });
  });

  it('CONTROL: a current level stated EQUAL to the target (written twice) is still the user\'s base', async () => {
    const { goal } = await registeredGoal(
      TARGET_ONLY,
      'Should we raise the Pro plan price? MRR is £20,000 today and we want it to stay at least £20,000.',
    );
    expect(goal.observed_state).toMatchObject({ raw_value: 20000, source: 'brief_extraction' });
  });
});
