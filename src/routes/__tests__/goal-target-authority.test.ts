/**
 * S2 C4: a drafted figure is the goal's target only inside a sentence the AI bound as THAT goal's target (TL 6208664188 rules
 * 1–4; DL-3 09:05Z DRASTIC CUT). Offline native build → admission → register. Rows from Founder-fix's banked counterexamples
 * (b09fc99a), on the shape the drafter is sent (`statements` is required in what is sent). Live evidence, 8 drafter calls on
 * ab3df4cb (recovery/laneA/target-probe): the AI bound every budget/headcount to its own subject; the recorded hiring draft is
 * a positive row below. 0 provider calls.
 */
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../orchestrator-v5/drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { buildModelFromBrief } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';
import { readGoalRecord } from '../../orchestrator-v5/goal-target/goal-record.js';

type Rec = Record<string, any>;
const SID = '00000000-0000-4000-8000-000000000052';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });
const cases = [
  { name: 'headcount', brief: 'We have 3 engineers. We want to complete the PoC and explore ways to grow the product.', value: 3, unit: 'engineers', retryMetric: 'PoC engineers', sentence: 'We have 3 engineers.', factor: 'Engineers available' },
  { name: 'budget', brief: 'We have a budget of £40,000. We want to complete the PoC and explore ways to grow the product.', value: 40000, unit: 'GBP', retryMetric: 'PoC budget', sentence: 'We have a budget of £40,000.', factor: 'Available budget' },
] as const;

type Statement = Rec;
/** The minimal scripted model from the closed #3270 test, with the `statements` the sent schema requires. */
function draft(brief: string, metric: string, value: number | null, unit: string, kind: string | null = 'event_by_date', statements: Statement[] = []): CandidateModel {
  return {
    decision_question: brief,
    goal: { kind, deliverable: null, metric, operator: '>=', target_stated: value !== null, value,
      unit: value === null ? '%' : unit, provenance: 'explicit', frame: 'level', horizon_months: null,
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
    statements,
  } as unknown as CandidateModel;
}
const statement = (kind: string, label: string, field: string, form: string, value: number, unit: string, quote: string): Statement => ({
  quote, subject: { kind, label, to_label: null, factor_label: null }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
async function construct(brief: string, drafts: CandidateModel[]) {
  let stored: Rec | null = null;
  const writes: Rec[] = [];
  let writtenBrief: unknown;
  storeRef.value = {
    append: vi.fn(async (w: Rec) => { stored = structuredClone(w.graph); writes.push(w); return { id: w.turn_id }; }),
    loadGraph: async () => stored,
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify();
  await registerRoute(app); await app.ready(); closed.push(() => app.close());
  const dispatch = async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) {
      writtenBrief = body.brief_text;
      const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body });
      return { status: r.statusCode, json: r.json() };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: stored ?? { nodes: [], edges: [] }, graph_hash: 's2' } };
  };
  let calls = 0;
  const call = async () => ({ text: JSON.stringify(drafts[Math.min(calls++, drafts.length - 1)]), status: 'completed' as const });
  const result = await buildModelFromBrief(SID, brief, dispatch as never, call) as Rec;
  return { result, graph: stored as Rec | null, writes, calls, writtenBrief };
}
const goalNode = (graph: Rec | null): Rec => {
  const goals = graph?.nodes.filter((n: Rec) => n.kind === 'goal') ?? [];
  expect(goals).toHaveLength(1);
  return goals[0];
};
const goalRecord = (graph: Rec | null) => readGoalRecord(graph, goalNode(graph).id);
const saidUnbound = (result: Rec): boolean => (result.not_represented ?? []).some((l: unknown) => String(l).startsWith('No target was set for '));

describe.each(cases)('$name remains a human fact on its own subject', row => {
  it('ADV0 first pass: a drafted goal figure with no sentence the AI bound as its target is not the goal’s target', async () => {
    const out = await construct(row.brief, [draft(row.brief, 'Complete the PoC', row.value, row.unit)]);
    expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
    expect(out.writes).toHaveLength(1);
    expect(out.writtenBrief).toBe(row.brief);
    expect(goalRecord(out.graph)?.target?.raw).toBeUndefined();
    expect(goalNode(out.graph).threshold_source).toBeUndefined();
  });
  it('ADV0 live reading: the AI bound the figure to its own factor, so it is never also the goal’s target', async () => {
    const out = await construct(row.brief, [draft(row.brief, 'Complete the PoC', row.value, row.unit, 'event_by_date',
      [statement('factor', row.factor, 'level', 'point', row.value, row.unit, row.sentence)])]);
    expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
    expect(goalRecord(out.graph)?.target?.raw).toBeUndefined();
    expect(saidUnbound(out.result), 'the unused figure is said, never dropped silently').toBe(true);
  });
  it('ADV0 competing reading (TL 09:18Z rule 2): the AI read the same sentence as its factor\u2019s level AND the goal\u2019s target, so it is not the user\u2019s target', async () => {
    const out = await construct(row.brief, [draft(row.brief, 'Complete the PoC', row.value, row.unit, 'event_by_date', [
      statement('factor', row.factor, 'level', 'point', row.value, row.unit, row.sentence),
      statement('goal', 'Complete the PoC', 'target', 'lower_bound', row.value, row.unit, row.sentence)])]);
    expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
    expect(goalRecord(out.graph)?.target?.raw).toBeUndefined();
    expect(saidUnbound(out.result), 'the unused figure is said, so the card can offer Olumi\u2019s reading').toBe(true);
  });
  it('ADV3 renamed retry: the same background fact never becomes a user-authored goal target', async () => {
    const out = await construct(row.brief, [
      draft(row.brief, 'Complete the PoC', null, row.unit),
      draft(row.brief, row.retryMetric, row.value, row.unit, null),
    ]);
    expect(out.calls).toBe(2);
    expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
    expect(out.writtenBrief).toBe(row.brief);
    expect(goalRecord(out.graph)?.target?.raw).toBeUndefined();
  });
});

it('a figure the brief writes as another quantity is not the user’s target, though the AI bound a sentence with it', async () => {
  // "250,000" is the user's count of users; the sentence the AI bound as the users goal's target writes £250,000. Membership
  // anywhere in the brief read the count's 250,000 as the user's target; it is read only inside the bound sentence.
  const brief = 'We have 250,000 users today. We need to raise at least £250,000 this year.';
  const out = await construct(brief, [draft(brief, 'Users', 250000, 'users', null,
    [statement('goal', 'Users', 'target', 'lower_bound', 250000, 'users', 'We need to raise at least £250,000 this year.')])]);
  expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
  expect(goalNode(out.graph).threshold_source, 'not stamped as the user’s target').toBeUndefined();
});

it('positive: a typed funding target the AI bound to the goal remains the user’s target on the native registered model', async () => {
  const brief = 'We need to secure angel funding of at least £250,000. Explore ways to secure funding.';
  const out = await construct(brief, [draft(brief, 'Funding secured', 250000, 'GBP', null,
    [statement('goal', 'Funding secured', 'target', 'lower_bound', 250000, 'GBP', 'We need to secure angel funding of at least £250,000.')])]);
  expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
  expect(out.writes).toHaveLength(1);
  expect(goalRecord(out.graph)?.target).toMatchObject({ raw: 250000, source: 'brief_extraction' });
  expect(saidUnbound(out.result)).toBe(false);
});

it('positive, the live drafter’s own hiring draft (ab3df4cb): "increase productivity by at least 10%" stays the user’s target', async () => {
  const brief = 'Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we\'re lacking leadership. Our budget is £200,000, but we\'d like to spend less.';
  const live = JSON.parse(readFileSync(new URL('./fixtures/live-drafter-hiring-ab3df4cb.json', import.meta.url), 'utf8')) as CandidateModel;
  const out = await construct(brief, [live]);
  expect(out.result, JSON.stringify(out.result).slice(0, 2000)).toMatchObject({ ok: true, mutated: true });
  expect(goalRecord(out.graph)?.target).toMatchObject({ raw: 10, source: 'brief_extraction' });
  expect(saidUnbound(out.result)).toBe(false);
});
