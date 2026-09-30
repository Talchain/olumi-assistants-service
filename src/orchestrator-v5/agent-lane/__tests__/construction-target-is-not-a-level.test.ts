/**
 * ⛔ THE TARGET IS NOT A LEVEL EITHER (MG handover §8 item 2.1; live arm draft 0 on CEE `f95ea20`, cut-costs).
 *
 * Served shape: the drafter gave "Saving at full GCP migration" an Olumi level of £9,000 a month — 20% of the user's
 * £45,000, i.e. exactly the gap to the user's own target — stored as `observed_state {raw_value: 9000, source:
 * cee_inference}` and shown as an Olumi assumption. A target is what the user wants, not evidence of where a quantity
 * stands. #2321 set aside an Olumi LINK SIZE equal to the gap; this is the same rule for an Olumi LEVEL: within 1% of the
 * gap, in the goal's own unit, it is set aside (the node keeps its frame, so the Run stays ready) and asked.
 * Real path: strict candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

const SCENARIO = '0a89a01e-0000-4000-8000-00000000c0c1';
const BRIEF = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Rec = Record<string, unknown>;
const SAVING = 'Saving at full GCP migration';

function cut(saving: { value: number; known?: boolean; unit?: string; provenance?: 'inferred' | 'explicit' }): Rec {
  const set = (value: number) => ({ factor_label: 'GCP workload share', value, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' });
  return {
    goal: { metric: 'Monthly spend', operator: '<=', target_stated: true, frame: 'change_rel', value: -20, unit: '%', horizon_months: null,
      provenance: 'explicit', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Stay on AWS', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Full GCP switch', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(100)] },
      { label: 'Phased GCP migration', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(50)] },
    ],
    factors: [
      { label: 'GCP workload share', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred', plausible_max: 100 },
      { label: SAVING, role: 'observable', baseline_known: saving.known ?? false, baseline_value: saving.value, unit: saving.unit ?? '£/month',
        provenance: saving.provenance ?? 'inferred', plausible_max: 45000 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'GCP workload share', to: SAVING, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: SAVING, to: 'Monthly spend', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [], unknowns: [], decision_question: null,
  };
}

async function build(wire: Rec, brief = BRIEF): Promise<{ graph: { nodes: Rec[]; edges: Rec[] }; out: Rec }> {
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
  const out = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: registered as { nodes: Rec[]; edges: Rec[] }, out };
}

const savingNode = (g: { nodes: Rec[] }): Rec => {
  const hits = g.nodes.filter((n) => n.label === SAVING);
  expect(hits, `exactly one "${SAVING}" node`).toHaveLength(1);
  return hits[0]!;
};
const asked = (out: Rec): string[] => ((out.open_questions ?? []) as string[]).filter((q) => q.includes('the gap to your target'));

describe('an Olumi LEVEL equal to the gap to the user\'s target is set aside and asked', () => {
  it('PREMISE: the goal holds £45,000 today and a 20% cut (the gap is £9,000), in £ per month', async () => {
    const { graph } = await build(cut({ value: 4500 }));
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    expect(goal.goal_threshold_frame).toBe('change_rel');
    expect((goal.observed_state as Rec).raw_value).toBe(45000);
    expect((savingNode(graph).observed_state as Rec).unit).toBe('£/month');
  });

  it('RED (live arm draft 0): Olumi\'s £9,000 "Saving at full GCP migration" → no level stored, the frame kept, one question', async () => {
    const { graph, out } = await build(cut({ value: 9000 }));
    const node = savingNode(graph);
    expect(node).not.toHaveProperty('observed_state');
    expect(node.scale_frame).toBe(45000);
    expect(asked(out)).toEqual([`Olumi estimated "${SAVING}" at 9000 £/month, which is exactly the gap to your target. A target is what you `
      + 'want, not evidence of where a figure stands, so it was not used. What figure should Olumi use for "' + SAVING + '"?']);
  });

  it('within 1% of the gap (£9,050) → the same; outside it (£9,100) → kept', async () => {
    expect(savingNode((await build(cut({ value: 9050 }))).graph)).not.toHaveProperty('observed_state');
    expect((savingNode((await build(cut({ value: 9100 }))).graph).observed_state as Rec).raw_value).toBe(9100);
  });

  it('the Run is still admitted with the level set aside (nothing blocks on it)', async () => {
    const { graph } = await build(cut({ value: 9000 }));
    const admission = resolveRunAdmission(graph) as { assessment?: { blockingIssues?: unknown[] } };
    expect(admission.assessment?.blockingIssues ?? []).toEqual([]);
  });

  it('CONTROL (an Olumi level that is not the gap): £4,500 is kept as Olumi\'s estimate, nothing asked', async () => {
    const { graph, out } = await build(cut({ value: 4500 }));
    expect(savingNode(graph).observed_state).toMatchObject({ raw_value: 4500, source: 'cee_inference' });
    expect(asked(out)).toEqual([]);
  });

  it('CONTROL (the user\'s own figure): £9,000 the user STATED in the brief is kept as theirs, nothing asked', async () => {
    const { graph, out } = await build(cut({ value: 9000, known: true, provenance: 'explicit' }),
      `${BRIEF} We expect to save £9,000 a month at full migration.`);
    expect((savingNode(graph).observed_state as Rec).raw_value).toBe(9000);
    expect((savingNode(graph).observed_state as Rec).source).not.toBe('cee_inference');
    expect(asked(out)).toEqual([]);
  });

  it('CONTROL (another unit): Olumi\'s 9000 in hours is not the goal\'s £ gap → kept', async () => {
    const { graph, out } = await build(cut({ value: 9000, unit: 'hours' }));
    expect((savingNode(graph).observed_state as Rec).raw_value).toBe(9000);
    expect(asked(out)).toEqual([]);
  });
});

/** The served r1 shape (`f074916`, 2d85ed7f): Olumi's "GCP monthly cost at full workload" = £36,000 = the target, set by an option. */
function withGcpCost(value: number): Rec {
  const w = cut({ value: 4500 }) as { factors: Rec[]; options: { label: string; interventions: Rec[] }[]; links: Rec[] };
  w.factors.push({ label: 'GCP monthly cost at full workload', role: 'observable', baseline_known: false, baseline_value: value, unit: '£/month', provenance: 'inferred', plausible_max: 45000 });
  w.options.find((o) => o.label === 'Full GCP switch')!.interventions.push({ factor_label: 'GCP monthly cost at full workload', value, value_kind: 'absolute', unit: '£/month', provenance: 'ai_proposed' });
  w.links.push({ from: 'GCP monthly cost at full workload', to: 'Monthly spend', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
  return w as unknown as Rec;
}
const GCP = 'GCP monthly cost at full workload';

describe('an Olumi LEVEL equal to the user\'s TARGET itself is set aside with the options that set it, and asked (served r1)', () => {
  it('RED (served f074916 r1): Olumi\'s £36,000 GCP cost (= £45,000 × 0.8) → no level, no option level on it, one question', async () => {
    const { graph, out } = await build(withGcpCost(36000));
    const node = graph.nodes.find((n) => n.label === GCP)!;
    expect(node).not.toHaveProperty('observed_state');
    const full = graph.nodes.find((n) => n.label === 'Full GCP switch')!;
    expect(Object.keys((full.interventions ?? {}) as Rec)).not.toContain(node.id);
    expect(((out.open_questions ?? []) as string[]).filter((q) => q.includes('your target itself'))).toEqual([`Olumi estimated "${GCP}" at 36000 £/month `
      + '(and "Full GCP switch" set it there), which is exactly your target itself. A target is what you want, not evidence of where a figure '
      + `stands, so it was not used. What figure should Olumi use for "${GCP}"?`]);
  });

  it('CONTROL: Olumi\'s £37,000 (not the target, not the gap) is kept, with the option\'s level on it', async () => {
    const { graph, out } = await build(withGcpCost(37000));
    const node = graph.nodes.find((n) => n.label === GCP)!;
    expect(node.observed_state).toMatchObject({ raw_value: 37000, source: 'cee_inference' });
    expect(Object.keys((graph.nodes.find((n) => n.label === 'Full GCP switch')!.interventions ?? {}) as Rec)).toContain(node.id);
    expect(((out.open_questions ?? []) as string[]).filter((q) => q.includes('your target itself'))).toEqual([]);
  });
});
