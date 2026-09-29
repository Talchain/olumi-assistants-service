/**
 * ⛔ THE TARGET IS NOT AN EFFECT (R3 #72 5899493499 / 5899535464; served cut-costs on CEE `0a89a01`, 2 of 3 drafts).
 *
 * Served: the drafter sized "GCP workload share → Monthly spend" as £9,000 a month at a full switch — 20% of the user's
 * £45,000, i.e. the user's own target — run 0 as "−£9,000 per 100%", run 2 as "−£90 per 1%". The full switch then sat
 * exactly on the threshold and its chance was a coin toss. Olumi's estimate on a link into the goal whose largest option
 * move shifts the goal by the gap to its target (±1%) is set aside for the frame-aware placeholder, and asked.
 * Real path: strict candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '0a89a01e-0000-4000-8000-00000000c0c0';
const BRIEF = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Rec = Record<string, unknown>;

function cut(effect: { amount: number; per: number; provenance?: 'ai_proposed' | 'explicit' }, shareUnit: '%' | 'fraction' = '%'): Rec {
  const full = shareUnit === '%' ? 100 : 1;
  const set = (value: number) => ({ factor_label: 'GCP workload share', value, value_kind: 'absolute', unit: shareUnit, provenance: 'ai_proposed' });
  return {
    goal: { metric: 'Monthly spend', operator: '<=', target_stated: true, frame: 'change_rel', value: -20, unit: '%', horizon_months: null,
      provenance: 'explicit', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Stay on AWS', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Full GCP switch', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(full)] },
      { label: 'Phased GCP migration', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(full / 2)] },
    ],
    factors: [
      { label: 'GCP workload share', role: 'controllable', baseline_known: true, baseline_value: 0, unit: shareUnit, provenance: 'inferred', plausible_max: full },
    ],
    risks: [], outcomes: [],
    links: [{ from: 'GCP workload share', to: 'Monthly spend', direction: 'negative', provenance: 'inferred',
      effect_amount: effect.amount, effect_per_source_change: effect.per, effect_provenance: effect.provenance ?? 'ai_proposed' }],
    identities: [], unknowns: [], decision_question: null,
  };
}

async function build(wire: Rec): Promise<{ graph: { nodes: Rec[]; edges: Rec[] }; out: Rec }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: registered as { nodes: Rec[]; edges: Rec[] }, out };
}

const goalEdge = (g: { nodes: Rec[]; edges: Rec[] }): Rec => {
  const goal = g.nodes.find((n) => n.kind === 'goal')!;
  return g.edges.find((e) => e.from === 'gcp_workload_share' && e.to === goal.id)!;
};
const magnitudeOf = (e: Rec): unknown => (e.provenance as Rec | undefined)?.magnitude;
const asked = (out: Rec): string[] => ((out.open_questions ?? []) as string[]).filter((q) => q.includes('at the largest change an option makes'));

describe('an Olumi estimate sized FROM the user\'s target is set aside and asked', () => {
  it('PREMISE: the goal holds £45,000 today and a 20% cut (the gap is £9,000)', async () => {
    const { graph } = await build(cut({ amount: -4500, per: 100 }));
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    expect(goal.goal_threshold_frame).toBe('change_rel');
    expect((goal.observed_state as Rec).raw_value).toBe(45000);
  });

  it('ROW 1 (served run 0): "−£9,000 per 100%" → the placeholder stands in, and the user is asked', async () => {
    const { graph, out } = await build(cut({ amount: -9000, per: 100 }));
    expect(magnitudeOf(goalEdge(graph))).toBe('olumi_placeholder');
    expect(asked(out)).toHaveLength(1);
    expect(asked(out)).toEqual(['Olumi estimated that raising "GCP workload share" by 100 points lowers "Monthly spend" by 9000 GBP per month; at the '
      + 'largest change an option makes, that moves "Monthly spend" by exactly the gap to your target. A target is what you want, not evidence of '
      + 'what an option does, so it was not used: a placeholder sized to keep "Monthly spend" within its range stands in for it. How much does '
      + '"GCP workload share" change "Monthly spend"?']);
  });

  it('ROW 2 (served run 2): "−£90 per 1%" → the same', async () => {
    const { graph, out } = await build(cut({ amount: -90, per: 1 }));
    expect(magnitudeOf(goalEdge(graph))).toBe('olumi_placeholder');
    expect(asked(out)).toHaveLength(1);
  });

  it('CONTROL (an estimate that is not the gap): "−£4,500 per 100%" is kept as Olumi\'s estimate, nothing asked', async () => {
    const { graph, out } = await build(cut({ amount: -4500, per: 100 }));
    expect(magnitudeOf(goalEdge(graph))).toBe('olumi_estimate');
    expect(asked(out)).toEqual([]);
  });

  it('CONTROL (the user\'s own size): "−£9,000 per 100%" stated by the user is kept as theirs', async () => {
    const { graph, out } = await build(cut({ amount: -9000, per: 100, provenance: 'explicit' }));
    expect(magnitudeOf(goalEdge(graph))).toBe('user_stated');
    expect(asked(out)).toEqual([]);
  });
});
