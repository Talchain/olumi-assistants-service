/**
 * ⛔ A LEVEL-FRAMED GOAL WITH NO BASELINE CAN NEVER HAVE A GOAL FIT.
 *
 * At staging 8428207a the agent lane wrote the goal with `goal_threshold_frame:
 * 'level'` and its threshold trio, and NO `observed_state`. ISL reads the level
 * frame against `observed_state.baseline`; without it ISL refuses
 * (`missing_goal_baseline`, warning `GOAL_THRESHOLD_NOT_CONVERTIBLE`) and PLoT has
 * no `probability_of_goal` to copy. The conventional draft path already carries a
 * stated current level (`enricher.ts` `goal_baseline`, projected by
 * `transforms/schema-v3.ts`'s goal limb as `{ value: B, baseline: B, unit, source,
 * raw_value, cap }`). The agent lane now writes that same shape.
 *
 * Provenance: stated in the brief → `brief_extraction`; Olumi's estimate →
 * `cee_inference`. Absent stays absent — nothing is derived from the target.
 * Every assertion reads the goal by its id off the REGISTERED graph (the real
 * `buildModelFromBrief` → `/graph/register` payload, parsed with CEE's `GraphV3`).
 */
import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, retrySchemaPinningGoal, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const GOAL = 'monthly_recurring_revenue';

function pricing(goal: Partial<CandidateModel['goal']> = {}): CandidateModel {
  return {
    goal: {
      metric: 'Monthly recurring revenue', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: null, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', ...goal,
    },
    constraints: [],
    options: [
      { label: 'Raise to £59', provenance: 'explicit', changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Raise to £55', provenance: 'explicit', changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 55, unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  } as CandidateModel;
}

/** The production contract: the candidate must pass the real strict schema, as the model's output would. */
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function registeredGoal(model: CandidateModel) {
  const wire = { ...model, unknowns: [] };
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
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', 'Should we raise the Pro plan price? MRR is £16,000 today; we want £20,000.', d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const parsed = GraphV3.parse(graph);
  const goal = parsed.nodes.find((n) => n.id === GOAL);
  expect(goal?.kind).toBe('goal');
  return { goal: goal as Record<string, unknown> & { observed_state?: Record<string, unknown> }, graph: parsed, out };
}

describe('the goal carries its current level, in the shape ISL reads', () => {
  it('RED: a current value STATED in the brief is the goal baseline, brief_extraction, on the threshold’s own cap', async () => {
    const { goal } = await registeredGoal(pricing({ baseline_known: true, baseline_value: 16000 }));
    // `target_derived_headroom`: cap = 20000 * 1.25 = 25000, so the target is 0.8.
    expect(goal.goal_threshold_cap).toBe(25000);
    expect(goal.observed_state).toStrictEqual({
      value: 16000 / 25000, baseline: 16000 / 25000, unit: 'GBP', source: 'brief_extraction', raw_value: 16000, cap: 25000,
    });
  });

  it('RED: an ESTIMATED current value is carried as Olumi’s — cee_inference', async () => {
    const { goal } = await registeredGoal(pricing({ baseline_known: false, baseline_value: 15000 }));
    expect(goal.observed_state).toStrictEqual({
      value: 0.6, baseline: 0.6, unit: 'GBP', source: 'cee_inference', raw_value: 15000, cap: 25000,
    });
  });

  it('RED: a stated value that the model itself inferred is not the user’s either', () => {
    const m = admitCandidateModel(pricing({ baseline_known: true, baseline_value: 16000, baseline_provenance: 'inferred' }));
    expect(m.nodes.find((n) => n.id === GOAL)?.observed_state?.source).toBe('cee_inference');
  });

  it('RED: zero is a baseline', () => {
    const m = admitCandidateModel(pricing({ baseline_known: true, baseline_value: 0 }));
    expect(m.nodes.find((n) => n.id === GOAL)?.observed_state).toStrictEqual({
      value: 0, baseline: 0, unit: 'GBP', source: 'brief_extraction', raw_value: 0, cap: 25000,
    });
  });

  it('CONTROL: no current value → no observed_state, and nothing is derived from the target', async () => {
    const { goal } = await registeredGoal(pricing());
    expect(goal).not.toHaveProperty('observed_state');
    expect(goal.goal_threshold_raw).toBe(20000);
  });

  it('CONTROL: no stated target → no frame to put a baseline on, so none is written', () => {
    const m = admitCandidateModel(pricing({ target_stated: false, value: null, baseline_known: true, baseline_value: 16000 }));
    expect(m.nodes.find((n) => n.id === GOAL)).not.toHaveProperty('observed_state');
  });

  it('CONTROL: a current level ABOVE the target (a decrease the >= frame cannot carry) is withheld, and said', () => {
    const m = admitCandidateModel(pricing({ baseline_known: true, baseline_value: 24000 }));
    expect(m.nodes.find((n) => n.id === GOAL)).not.toHaveProperty('observed_state');
    const [said] = m.loss.filter((l) => l.field_path === `nodes[${GOAL}].observed_state.baseline`);
    expect(said?.before).toBe(24000);
    expect(said?.reason).toContain('already above the target');
  });

  it('RED (disclosure): that refusal reaches the Agent through not_represented, with the repair', async () => {
    const { out } = await registeredGoal(pricing({ baseline_known: true, baseline_value: 24000 }));
    const said = (out.not_represented as string[]).filter((s) => s.includes('already above the target'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('say which and it can be corrected');
  });

  it('RED (meaning): a goal to stay AT OR BELOW a level gets no baseline — never a Goal fit for the wrong tail', async () => {
    for (const operator of ['<=', '<']) {
      const { goal, out } = await registeredGoal(pricing({ operator, value: 5, unit: '%', baseline_known: true, baseline_value: 4 }));
      expect(goal, operator).not.toHaveProperty('observed_state');
      expect((out.not_represented as string[]).filter((s) => s.includes('stay at or below')), operator).toHaveLength(1);
    }
  });

  it('CONTROL (meaning): the same figures on an "at least" goal DO carry the baseline', async () => {
    for (const operator of ['>=']) {
      const { goal } = await registeredGoal(pricing({ operator, value: 5, unit: '%', baseline_known: true, baseline_value: 4 }));
      expect(goal.observed_state, operator).toMatchObject({ baseline: 0.04, raw_value: 4, source: 'brief_extraction' });
    }
  });

  it('RED (meaning, strict >): "grow MRR ABOVE £20k; £20k now" carries no baseline to admission or to the analysis input', async () => {
    const { goal, graph, out } = await registeredGoal(pricing({ operator: '>', baseline_known: true, baseline_value: 20000 }));
    expect(goal).not.toHaveProperty('observed_state');
    const said = (out.not_represented as string[]).filter((x) => x.includes('strictly above'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('say the goal is "at least 20000"');
    // Through the Run admission: the graph the analysis receives has no goal baseline,
    // so no Goal fit can count equality as meeting a strict goal.
    const run = resolveRunAdmission(graph);
    expect(run.canonicalGraph, 'the comparison itself still runs').not.toBeNull();
    const analysed = (run.canonicalGraph as { nodes: { id: string; observed_state?: unknown }[] }).nodes.find((n) => n.id === GOAL);
    expect(analysed).toBeDefined();
    expect(analysed).not.toHaveProperty('observed_state');
  });

  it('CONTROL (equality on "at least"): £20k now against "at least £20k" reaches the analysis input as a baseline', async () => {
    const { graph } = await registeredGoal(pricing({ operator: '>=', baseline_known: true, baseline_value: 20000 }));
    const run = resolveRunAdmission(graph);
    const analysed = (run.canonicalGraph as { nodes: { id: string; observed_state?: Record<string, unknown> }[] }).nodes.find((n) => n.id === GOAL);
    expect(analysed?.observed_state).toMatchObject({ baseline: 0.8, raw_value: 20000, source: 'brief_extraction' });
  });

  it('RED (efficacy): the production schema REQUIRES the goal\u2019s current level, and the retry pins it', () => {
    const goal = (buildCandidateSchema() as { properties: { goal: { required: string[]; properties: Record<string, unknown> } } }).properties.goal;
    expect(goal.required).toEqual(expect.arrayContaining(['baseline_known', 'baseline_value', 'baseline_provenance']));
    const bad = { ...pricing(), unknowns: [] } as Record<string, unknown>;
    const { baseline_value: _dropped, ...goalWithout } = (bad.goal as Record<string, unknown>);
    expect(strict({ ...bad, goal: goalWithout }), 'a model that omits the key is refused by the strict contract').toBe(false);
    const pinned = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(pricing({ baseline_known: true, baseline_value: 16000 }).goal));
    expect(pinned({ ...pricing({ baseline_known: true, baseline_value: 16000 }), unknowns: [] })).toBe(true);
    expect(pinned({ ...pricing({ baseline_known: true, baseline_value: 17000 }), unknowns: [] }), 'the retry cannot change it').toBe(false);
  });

  it('the baseline adds no readiness blocker (round trip through the readiness authority)', async () => {
    const withIt = await registeredGoal(pricing({ baseline_known: true, baseline_value: 16000 }));
    const without = await registeredGoal(pricing());
    const codes = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();
    expect(codes(withIt.graph)).toEqual(codes(without.graph));
  });
});
