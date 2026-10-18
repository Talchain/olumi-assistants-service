/**
 * ⭐ C5b (DL-3 ruling 18 Oct; T1 dev sizing P01 "experience score", P11 "fairness-score points"): AN UNTARGETED GOAL KEEPS A UNIT
 * ONLY WHERE ONE OF ITS OWN VERIFIED STATEMENTS WRITES IT. The drafter named a unit for an aim the user never measured, and
 * admission saved it as the goal's `goal_threshold_unit` (`admit-model.ts`, the untargeted branch). An unverified unit later
 * refuses the user's own target in another unit (A3 D4, `target_unit_mismatch`).
 *
 * Real path, synthetic wording: strict candidate schema → `buildModelFromBrief` → the `/graph/register` body → the cold read
 * (`GraphV3.parse`) → the goal node.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const GOAL = 'Weekly support capacity';
const statement = (quote: string, subject: Rec, field: string, form: string, extra: Rec = {}) => ({
  quote, speaker: 'user', subject: { to_label: null, factor_label: null, ...subject }, field, form,
  value: null, low: null, high: null, unit: null, qualifier: null, conditions: null, ...extra,
});

/** One small model: a capacity goal, one controllable factor, a status quo and one option. Only the goal and statements vary. */
function draft(goal: Rec, statements: Rec[]): Rec {
  return {
    goal: {
      metric: GOAL, operator: '>=', target_stated: false, frame: 'level', value: null, unit: null, horizon_months: null,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null, ...goal,
    },
    constraints: [],
    options: [
      { label: 'Current staffing', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Add one specialist', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Specialists', value: 5, value_kind: 'absolute', unit: 'specialists', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Specialists', role: 'controllable', baseline_known: true, baseline_value: 4, unit: 'specialists', provenance: 'explicit', plausible_max: 20 },
    ],
    risks: [],
    outcomes: [],
    links: [{ from: 'Specialists', to: GOAL, direction: 'positive', provenance: 'inferred',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [],
    unknowns: [],
    decision_question: null,
    statements,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function coldGoal(wire: Rec, brief: string): Promise<Rec> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire), status: 'completed' })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const out = await buildModelFromBrief('5c5b5c5b-0000-4000-8000-00000000c5b1', brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 1200)).toBe(true);
  const cold = GraphV3.parse(body) as unknown as { nodes: Rec[] };
  return cold.nodes.find((n) => n.kind === 'goal')!;
}

const AIM = 'We want the support week to feel calmer for the team, with 4 specialists on shift today.';

describe('an untargeted goal keeps a unit only where its own verified statement writes it', () => {
  it('RED→GREEN: no target and no unit written → the cold read holds no goal_threshold_unit', async () => {
    const goal = await coldGoal(draft({ unit: 'calm score' }, [
      statement('We want the support week to feel calmer for the team, with 4 specialists on shift today.', { kind: 'goal', label: GOAL },
        'measure', 'describes', { unit: 'calm score' }),
    ]), AIM);
    expect(goal.label).toBe(GOAL);
    expect(goal).not.toHaveProperty('goal_threshold_unit');
    expect(goal).not.toHaveProperty('goal_threshold_raw');
  });

  it('CONTRAST: the goal\'s own verified statement writes "tickets per week" after its figure → the unit is kept', async () => {
    const brief = 'Our support team handles 80 tickets per week today, and we want to do better.';
    const goal = await coldGoal(draft({ unit: 'tickets per week', baseline_known: true, baseline_value: 80 }, [
      statement('Our support team handles 80 tickets per week today, and we want to do better.', { kind: 'goal', label: GOAL },
        'level', 'point', { value: 80, unit: 'tickets per week' }),
    ]), brief);
    expect(goal.goal_threshold_unit).toBe('tickets per week');
    expect(goal).not.toHaveProperty('goal_threshold_raw');
  });

  it('CONTRAST (binding by subject): another subject\'s statement writing the same unit does not make it the goal\'s', async () => {
    const brief = 'Each specialist handles 20 tickets per week, and we want a calmer week.';
    const goal = await coldGoal(draft({ unit: 'tickets per week' }, [
      statement('Each specialist handles 20 tickets per week, and we want a calmer week.', { kind: 'factor', label: 'Specialists' },
        'level', 'point', { value: 20, unit: 'tickets per week' }),
    ]), brief);
    expect(goal).not.toHaveProperty('goal_threshold_unit');
  });

  it('CONTRAST: a TARGETED goal is unchanged — its stated target keeps its unit', async () => {
    const brief = 'We need weekly support capacity of at least 100 tickets per week.';
    const goal = await coldGoal(draft({ target_stated: true, value: 100, unit: 'tickets per week' }, [
      statement('We need weekly support capacity of at least 100 tickets per week.', { kind: 'goal', label: GOAL },
        'target', 'lower_bound', { value: 100, unit: 'tickets per week' }),
    ]), brief);
    expect(goal.goal_threshold_unit).toBe('tickets per week');
    expect(goal.goal_threshold_raw).toBe(100);
  });

  it('CONTROL: an untargeted money goal loses only the unverified unit; its labelled unit_reading (Olumi\'s) stays', async () => {
    const brief = 'We usually talk to firms that invest between £1-2 million, and we want funding soon.';
    const goal = await coldGoal(draft({ unit: '£' }, [
      statement('We usually talk to firms that invest between £1-2 million, and we want funding soon.', { kind: 'goal', label: GOAL },
        'measure', 'describes', { unit: '£' }),
    ]), brief);
    expect(goal).not.toHaveProperty('goal_threshold_unit');
    expect(goal.unit_reading).toEqual({ unit: 'GBP', source: 'olumi_reading',
      source_quote: 'We usually talk to firms that invest between £1-2 million, and we want funding soon' });
  });
});
