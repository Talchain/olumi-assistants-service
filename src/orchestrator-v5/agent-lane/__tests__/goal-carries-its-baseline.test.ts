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
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const GOAL = 'monthly_recurring_revenue';

function pricing(goal: Partial<CandidateModel['goal']> = {}): CandidateModel {
  return {
    goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: null, provenance: 'explicit', ...goal },
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

async function registeredGoal(model: CandidateModel) {
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify({ ...model, unknowns: [] }) })) as unknown as CallStructuredModel;
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
  return { goal: goal as Record<string, unknown> & { observed_state?: Record<string, unknown> }, graph: parsed };
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
    expect(said?.reason).toContain('direction_unsupported');
  });

  it('the baseline adds no readiness blocker (round trip through the readiness authority)', async () => {
    const withIt = await registeredGoal(pricing({ baseline_known: true, baseline_value: 16000 }));
    const without = await registeredGoal(pricing());
    const codes = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();
    expect(codes(withIt.graph)).toEqual(codes(without.graph));
  });
});
