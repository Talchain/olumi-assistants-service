/** S2: scripted drafts at the real judgeRetry/adoption boundary; not a replay of the unread served drafts. */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { isQuantityGoalCandidate } from '../../goal-target/event-by-date-model.js';

type Rec = Record<string, any>;
const briefs = [
  { name: 'founder', brief: 'We want to secure a larger fund of at least 1.3 million. Explore ways to secure funding.', metric: 'Funding secured', other: 'Funding amount', value: 1300000, unit: 'GBP' },
  { name: 'capacity', brief: 'We want capacity of at least 100 tickets per week. Explore ways to improve delivery.', metric: 'Delivery completed', other: 'Delivery capacity', value: 100, unit: 'tickets/week' },
];
function draft(row: typeof briefs[number], kind: string | null = 'event_by_date', value: number | null = null, metric = row.metric): CandidateModel {
  return {
    decision_question: row.brief,
    goal: { kind, deliverable: null, metric, operator: '>=', target_stated: value !== null, value,
      unit: value === null ? '%' : row.unit, provenance: 'inferred', frame: 'level', horizon_months: null,
      baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null },
    constraints: [], identities: [], unknowns: [],
    options: [
      { label: 'Carry on', provenance: 'inferred', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Expand outreach', provenance: 'inferred', changes: [], interventions: [
        { factor_label: 'Effort', value: 1, value_kind: 'absolute', unit: 'index', provenance: 'inferred' }] },
    ],
    factors: [{ label: 'Effort', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'index', provenance: 'inferred', plausible_max: 1 }],
    risks: [], outcomes: [],
    links: [{ from: 'Effort', to: metric, direction: 'positive', provenance: 'inferred' }],
  } as CandidateModel;
}
async function construct(brief: string, answers: CandidateModel[]) {
  let graph: Rec | undefined;
  const calls: Rec[] = [];
  let trace: Rec | undefined;
  const dispatch = async (path: string, body: any) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 's2' } };
  };
  const call = async (req: Rec) => { calls.push(req); return { text: JSON.stringify(answers[Math.min(calls.length, answers.length) - 1]), status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000052', brief, dispatch as never, call as never,
    (t: Rec) => { trace = t; }) as Rec;
  return { graph, result, calls, trace };
}
const goalOf = (graph: Rec) => graph.nodes.find((n: Rec) => n.kind === 'goal');

describe.each(briefs)('S2 one goal reading: $name', row => {
  it('D1 raw event kind with a quantity is adopted (different label isolates kind check)', async () => {
    const retry = draft(row, 'event_by_date', row.value, row.other);
    expect(isQuantityGoalCandidate(retry.goal)).toBe(true);
    const admitted = admitCandidateModel(retry, {}, row.brief);
    expect(goalOf(admitted)).toMatchObject({ label: row.other, goal_threshold_raw: row.value });
    const out = await construct(row.brief, [draft(row), retry]);
    expect(out.calls).toHaveLength(2);
    expect(out.result.ok, JSON.stringify(out.result)).toBe(true);
    expect(goalOf(out.graph!)).toMatchObject({ label: row.other, goal_threshold_raw: row.value, provenance: 'ai_inferred' });
    expect(goalOf(out.graph!).threshold_source).toBeUndefined();
  });
  it('D1+D2 founder-shaped raw event name and quantity target is adopted', async () => {
    const out = await construct(row.brief, [draft(row), draft(row, 'event_by_date', row.value)]);
    expect(out.calls).toHaveLength(2);
    expect(out.trace?.outcome).toBe('adopted');
    expect(out.result.ok, JSON.stringify(out.result)).toBe(true);
    expect(goalOf(out.graph!)).toMatchObject({ label: row.metric, goal_threshold_raw: row.value, provenance: 'ai_inferred' });
    expect(goalOf(out.graph!).threshold_source).toBeUndefined();
  });
  it('D1 contrast: a genuine event with no figure or deadline is still refused', async () => {
    const out = await construct(row.brief, [draft(row), draft(row, 'event_by_date', null, row.other)]);
    expect(out.calls).toHaveLength(2);
    expect(out.result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(out.graph).toBeUndefined();
  });
  it('D2 event name with an ordinary quantity target is adopted', async () => {
    const out = await construct(row.brief, [draft(row), draft(row, null, row.value)]);
    expect(out.calls).toHaveLength(2);
    expect(out.result.ok, JSON.stringify(out.result)).toBe(true);
    expect(goalOf(out.graph!)).toMatchObject({ label: row.metric, goal_threshold_raw: row.value, provenance: 'ai_inferred' });
    expect(goalOf(out.graph!).threshold_source).toBeUndefined();
  });
  it('D2 contrast: retaining the event name under kind null without a figure is still refused', async () => {
    const out = await construct(row.brief, [draft(row), draft(row, null)]);
    expect(out.calls).toHaveLength(2);
    expect(out.result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(out.graph).toBeUndefined();
  });
  it('negative: an unrelated figure in the same sentence does not make the event a quantity', async () => {
    const brief = `Revenue was 2m as of 2026-09-01, and ${row.brief}`;
    const first = draft(row), retry = draft(row, null);
    const out = await construct(brief, [first, retry]);
    expect(isQuantityGoalCandidate(retry.goal)).toBe(false);
    expect(out.calls).toHaveLength(2);
    expect(out.result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(out.graph).toBeUndefined();
  });
});
