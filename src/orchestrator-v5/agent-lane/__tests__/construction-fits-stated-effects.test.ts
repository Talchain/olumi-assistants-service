/**
 * ⭐ CONSTRUCTION FITS A USER-STATED SIZE BY WIDENING ITS TARGET (DL 5897504696; AIQ 5897383982, 5895140735). Served MRR
 * run 4 (`5f6b85e5`, 57997d1): the drafter stated "£49 per subscriber" as the subscribers → MRR link on a 106,250 MRR
 * frame (β 2.31), so the Run clamped the user's effect and withheld the chance. THE PATH: the REAL `buildModelFromBrief`
 * (drafter faked with run 4's shape) → `/graph/register` → the saved graph. 0 LLM.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, any>;
const MRR = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

function draft(stated: boolean): Rec {
  return {
    goal: { metric: 'MRR', operator: '>', target_stated: true, frame: 'level', value: 85000, unit: '£/month', horizon_months: 12, provenance: 'explicit',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 5, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: '£/month', provenance: 'explicit' }] },
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: '£/month', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£/month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'inferred', plausible_max: 100 },
    ],
    risks: [], outcomes: [], unknowns: [],
    links: [
      { from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Paying subscribers', to: 'MRR', direction: 'positive', provenance: 'explicit',
        ...(stated ? { effect_amount: 49, effect_per_source_change: 1, effect_provenance: 'explicit' } : { effect_amount: null, effect_per_source_change: null, effect_provenance: null }) },
      { from: 'Monthly churn', to: 'MRR', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
  };
}

async function build(candidate: unknown): Promise<Rec> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const result = await buildModelFromBrief('7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', MRR, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return GraphV3.parse(JSON.parse(stored!)) as unknown as Rec;
}
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const linkInto = (g: Rec, label: string): Rec => {
  const from = g.nodes.find((n: Rec) => n.label === label).id;
  return g.edges.find((e: Rec) => e.from === from && e.to === goal(g).id);
};

describe('construction fits a user-stated size by widening its target', () => {
  it('⭐ RED (run 4 shape, real build): "£49 per subscriber" → the saved MRR frame is widened and the stated link is in contract', async () => {
    const g = await build(draft(true));
    expect(linkInto(g, 'Paying subscribers').provenance?.magnitude, 'PRECONDITION: the link carries the stated size').toBe('user_stated');
    expect(Math.abs(linkInto(g, 'Paying subscribers').strength.mean)).toBeLessThanOrEqual(1);
    expect(goal(g).goal_threshold_cap_provenance).toBe('stated_effect_fit');
    expect(goal(g).observed_state.raw_value).toBe(75000);
  });
  it('CONTROL (no stated size): the frame is exactly as before', async () => {
    const g = await build(draft(false));
    expect(goal(g).goal_threshold_cap_provenance).not.toBe('stated_effect_fit');
  });
});
