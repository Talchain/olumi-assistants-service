import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/** MC: the real registration seam admits only quote-bound count ranges on create-only construction. */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, resolveUserIdentity } = vi.hoisted(() => ({
  store: { append: vi.fn(), loadGraph: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(),
    scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn() },
  resolveUserIdentity: vi.fn(),
}));
vi.mock('../../orchestrator-v5/session/index.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()), getSessionStore: () => withScenarioRevision(store),
}));
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../orchestrator/user-identity.js')>()), resolveUserIdentity,
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { candidateToGraph } from '../../orchestrator-v5/path-b/tools/candidate-to-graph.js';

const SCENARIO = 'b63d8672-0000-4000-8000-0000000b63d8';
const BRIEF = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const RANGE = { low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction', source_quote: BRIEF };
type Rec = Record<string, any>;
function graph(): Rec {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'Monthly recurring revenue' },
      { id: 'starter_subscribers', kind: 'factor', label: 'Starter subscribers', category: 'controllable',
        observed_state: { value: 0, raw_value: 0, cap: 1000, unit: 'subscribers', source: 'cee_inference' } },
      { id: 'launch', kind: 'option', label: 'Launch starter tier', interventions: { starter_subscribers: {
        value: 0.15, raw_value: 150, unit: 'subscribers', source: 'cee_hypothesis',
        target_match: { node_id: 'starter_subscribers', match_type: 'exact_id', confidence: 'high' }, range: { ...RANGE },
      } } },
    ],
    edges: [{ from: 'starter_subscribers', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive' }],
  };
}
const cell = (g: Rec) => g.nodes.find((n: Rec) => n.id === 'launch').interventions.starter_subscribers;

async function register(incoming = graph(), brief = BRIEF, createOnly = true) {
  const app = Fastify();
  try {
    await registerRoute(app);
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: {
      graph: incoming, brief_text: brief, ...(createOnly ? { expected_graph_identity_hash: null } : {}),
    } });
  } finally { await app.close(); }
}

beforeEach(() => {
  vi.resetAllMocks();
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.loadGraph.mockResolvedValue(null);
  store.append.mockResolvedValue({ id: 'turn-mc' });
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
});

describe('MC: quote-bound count range at real graph registration', () => {
  it('RED at base: create-only registration stores the user’s count range and cold read retains it', async () => {
    const response = await register();
    expect(response.statusCode, response.body).toBe(200);
    expect(store.append).toHaveBeenCalledOnce();
    const saved = store.append.mock.calls[0]![0].graph;
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(saved))));
    expect(cell(reloaded)).toMatchObject({ raw_value: 150, range: RANGE });
    expect(cell(saved).range).toEqual(RANGE);
  });

  it.each([
    ['no stated range', 'The starter tier would win about 150 new subscribers.'],
    ['range for another quantity', 'The Pro tier would win about 150 new subscribers, between 80 and 250.'],
    ['exact count', 'The starter tier would win exactly 150 new subscribers, between 80 and 250.'],
  ])('CONTROL: %s cannot grant registration consent', async (_name, brief) => {
    const response = await register(graph(), brief);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().details.code).toBe('INTERVENTION_RANGE_APPROVAL_REQUIRED');
    expect(store.append).not.toHaveBeenCalled();
  });

  it.each([{ high: 240 }, { source: 'cee_hypothesis' }, { source_quote: 'invented quote' }])(
    'CONTROL: changed or invented range metadata still needs approval: %j', async change => {
      const incoming = graph();
      Object.assign(cell(incoming).range, change);
      expect((await register(incoming)).statusCode).toBe(409);
      expect(store.append).not.toHaveBeenCalled();
    });

  it('CONTROL: ordinary registration cannot grant range consent even with a matching brief', async () => {
    expect((await register(graph(), BRIEF, false)).statusCode).toBe(409);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('CONTROL: an existing model cannot use the create-only exception', async () => {
    const stored = graph();
    delete cell(stored).range;
    store.loadGraph.mockResolvedValue(stored);
    expect((await register()).statusCode).toBe(409);
    expect(store.append).not.toHaveBeenCalled();
  });
});

// ⭐ K2 ON PATH B (DL ruling (a), 19 Oct): a create-only range that IS the graph's own construction record of the user's range for that
// exact option and factor, its quote a byte substring of brief_text (`onlyRecordedSettingRanges`). SYNTHETIC wording (a bakery).
const B_BRIEF = 'Hiring a second baker would add about 40 loaves a day, somewhere between 25 and 60.';
const B_KEY = 'factor|extra_baking||hire_baker|level';
const B_RANGE = { low: 25, high: 60, meaning: 'likely_range', source: 'brief_extraction', source_quote: B_BRIEF };
const bRecord = (over: Rec = {}, key = B_KEY, attest: Rec | undefined = { recorded_by: 'construction' }): Rec => ({
  subject_key: key, field: 'level', recorded_at: '2026-10-19T22:00:00.000Z', ...(attest === undefined ? {} : { attest }),
  statements: [{ speaker: 'user', quote: B_BRIEF, source: B_BRIEF, form: 'range', low: 25, high: 60, unit: 'loaves a day', reading: 'olumi',
    subject: { quantity: key, node_id: 'extra_baking', option_id: 'hire_baker' }, ...over }] });
function bGraph(record: Rec | null = bRecord()): Rec {
  return {
    nodes: [
      { id: 'goal_loaves', kind: 'goal', label: 'Loaves sold a day' },
      { id: 'extra_baking', kind: 'factor', label: 'Extra baking capacity', category: 'controllable',
        observed_state: { value: 0, raw_value: 0, cap: 200, unit: 'loaves a day', source: 'cee_inference' },
        ...(record === null ? {} : { user_statements: [record] }) },
      { id: 'hire_baker', kind: 'option', label: 'Hire a second baker', interventions: { extra_baking: {
        value: 0.2, raw_value: 40, unit: 'loaves a day', source: 'brief_extraction',
        target_match: { node_id: 'extra_baking', match_type: 'exact_id', confidence: 'high' }, range: { ...B_RANGE },
      } } },
    ],
    edges: [{ from: 'extra_baking', to: 'goal_loaves', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
  };
}
const bCell = (g: Rec) => g.nodes.find((n: Rec) => n.id === 'hire_baker').interventions.extra_baking;

describe('K2 on path B: a range its own construction record states, at real graph registration', () => {
  it('RED at base: create-only registration keeps the range the graph\'s construction record gives for that option and factor', async () => {
    const response = await register(bGraph(), B_BRIEF);
    expect(response.statusCode, response.body).toBe(200);
    expect(bCell(store.append.mock.calls[0]![0].graph).range).toEqual(B_RANGE);
  });

  it('⭐ REAL PATH: path B\'s own conversion of a draft registers create-only, its recorded range on the setting', async () => {
    const draft = {
      goal: { kind: null, deliverable: null, metric: 'Loaves sold a day', operator: '>=', target_stated: true, value: 300, unit: 'loaves a day',
        horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 250, baseline_provenance: 'explicit',
        scope: null, quantity_frame: 'level', basis: null },
      constraints: [], risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      options: [{ label: 'Hire a second baker', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Extra baking capacity', value: 40, value_kind: 'absolute', unit: 'loaves a day', provenance: 'explicit', stated_evidence: null }] },
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true }],
      factors: [{ label: 'Extra baking capacity', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'loaves a day', provenance: 'explicit', plausible_max: 200 }],
      links: [{ from: 'Extra baking capacity', to: 'Loaves sold a day', direction: 'positive', provenance: 'ai_proposed', effect_amount: 1,
        effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: true, basis: null, source_quote: null }],
      statements: [{ quote: B_BRIEF, subject: { kind: 'option', label: 'Hire a second baker', to_label: null, factor_label: 'Extra baking capacity' },
        field: 'level', form: 'range', value: 40, low: 25, high: 60, unit: 'loaves a day', qualifier: 'about', conditions: null, speaker: 'user' }],
    };
    const out = candidateToGraph(draft, { words: B_BRIEF, recorded_at: '2026-10-19T22:00:00.000Z' });
    if ('refused' in out) throw new Error(out.refused);
    const response = await register(out.graph as Rec, B_BRIEF);
    expect(response.statusCode, response.body).toBe(200);
    const saved = store.append.mock.calls[0]![0].graph as Rec;
    const option = (saved.nodes as Rec[]).find((n) => n.label === 'Hire a second baker')!;
    expect(Object.values(option.interventions as Rec)[0]).toMatchObject({ raw_value: 40, range: B_RANGE });
  });

  it('⭐ REAL PATH (level today): a factor\'s recorded level range registers create-only on observed_state.range', async () => {
    const LEVEL = 'We bake between 200 and 300 loaves a day now.';
    const draft = {
      goal: { kind: null, deliverable: null, metric: 'Loaves sold a day', operator: '>=', target_stated: true, value: 300, unit: 'loaves a day',
        horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 250, baseline_provenance: 'explicit',
        scope: null, quantity_frame: 'level', basis: null },
      constraints: [], risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
      options: [{ label: 'Hire a second baker', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Daily baking', value: 290, value_kind: 'absolute', unit: 'loaves a day', provenance: 'explicit', stated_evidence: null }] },
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true }],
      factors: [{ label: 'Daily baking', role: 'controllable', baseline_known: true, baseline_value: 250, unit: 'loaves a day', provenance: 'explicit', plausible_max: 600 }],
      links: [{ from: 'Daily baking', to: 'Loaves sold a day', direction: 'positive', provenance: 'ai_proposed', effect_amount: 1,
        effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: true, basis: null, source_quote: null }],
      statements: [{ quote: LEVEL, subject: { kind: 'factor', label: 'Daily baking', to_label: null, factor_label: null },
        field: 'level', form: 'range', value: null, low: 200, high: 300, unit: 'loaves a day', qualifier: null, conditions: null, speaker: 'user' }],
    };
    const out = candidateToGraph(draft, { words: LEVEL, recorded_at: '2026-10-19T22:00:00.000Z' });
    if ('refused' in out) throw new Error(out.refused);
    const response = await register(out.graph as Rec, LEVEL);
    expect(response.statusCode, response.body).toBe(200);
    const factor = ((store.append.mock.calls[0]![0].graph as Rec).nodes as Rec[]).find((n) => n.label === 'Daily baking')!;
    expect(factor.observed_state).toMatchObject({ raw_value: 250, range: { low: 200, high: 300, meaning: 'min_max', source: 'brief_extraction', source_quote: LEVEL } });
  });

  it('A UNCHANGED: A\'s request shapes give what they gave (a brief-stated range 200; an unstated one 409)', async () => {
    expect((await register(graph(), BRIEF)).statusCode).toBe(200);
    vi.mocked(store.append).mockClear();
    const refused = await register(graph(), 'The starter tier would win about 150 new subscribers.');
    expect([refused.statusCode, refused.json().details.code]).toEqual([409, 'INTERVENTION_RANGE_APPROVAL_REQUIRED']);
    expect(store.append).not.toHaveBeenCalled();
  });

  it.each([
    ['no record', bGraph(null), B_BRIEF],
    ['a record whose quote brief_text does not hold byte for byte', bGraph(), 'Hiring a second baker would add about 40 loaves a day.'],
    ['a record on another option', bGraph(bRecord({}, 'factor|extra_baking||hire_apprentice|level')), B_BRIEF],
    ['a record that is not construction\'s', bGraph(bRecord({}, B_KEY, { recorded_by: 'door' })), B_BRIEF],
    ['a record of another person\'s range', bGraph(bRecord({ speaker: undefined, said_by: 'unknown' })), B_BRIEF],
    ['a range that differs from its record', bGraph(bRecord({ high: 61 })), B_BRIEF],
  ])('CONTROL: %s still needs approval', async (_name, incoming, brief) => {
    const response = await register(incoming, brief);
    expect([response.statusCode, response.json().details?.code]).toEqual([409, 'INTERVENTION_RANGE_APPROVAL_REQUIRED']);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('CONTROL: an ordinary (not create-only) registration cannot use the record either', async () => {
    expect((await register(bGraph(), B_BRIEF, false)).statusCode).toBe(409);
    expect(store.append).not.toHaveBeenCalled();
  });
});

// L3C: strict B draft -> real registration -> saved model -> real run_analysis -> PLoT request, no provider calls.
import { buildModel } from '../../orchestrator-v5/path-b/tools/draft-tool.js';
import { constructionOperationId } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { createRunAnalysisHandler } from '../../orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { InterventionRangeSchema } from '@talchain/schemas';

const LAW = { family: 'uniform', role: 'uncertain_outcome', origin: 'olumi_illustrative', basis: 'illustrative, untested',
  quantity: 'Downtime in hours', reference: 'Migration', period: 'Migration window', conditions: ['During migration'], independent_of_model: true };
async function draftToPlot(brief: string, range?: Rec, field = 'level', role = 'observable', recorded = range) {
  const draft = {
    goal: { metric: 'Service hours', operator: '>=', target_stated: false, value: null, unit: 'hours', provenance: 'inferred', frame: 'level',
      baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', horizon_months: null, scope: null },
    factors: [{ label: 'Downtime', role, baseline_known: true, baseline_value: 0, unit: 'hours', provenance: 'explicit', plausible_max: 1 }],
    options: [{ label: 'Migrate', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Downtime', value: 0.4,
      value_kind: 'absolute', unit: 'hours', provenance: 'explicit', origin: 'user', stance: 'estimate', range }] },
      { label: 'Stay', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] }],
    links: [{ from: 'Downtime', to: 'Service hours', direction: 'negative', provenance: 'inferred',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    statements: [{ subject: { kind: 'option', label: 'Migrate', factor_label: 'Downtime' }, field, speaker: 'user', quote: brief,
      form: recorded ? 'range' : 'point', value: 0.4, low: recorded?.low ?? null, high: recorded?.high ?? null, unit: 'hours', conditions: 'During migration' }],
    constraints: [], identities: [], risks: [], outcomes: [], unknowns: [], unknown_concerns: [],
  };
  const app = Fastify();
  await registerRoute(app);
  let saved: Rec | undefined;
  store.append.mockImplementation(async (row: Rec) => { saved = row.graph; return { id: 'l3c' }; });
  const callStructured = vi.fn(async () => ({ text: JSON.stringify(draft), status: 'completed' as const }));
  try {
    const outcome = await buildModel({ callStructured, dispatch: async (path, body) => {
      if (path.endsWith('/versions')) return { status: 200, json: { versions: saved === undefined ? [] : [{ version_id: 'v-l3c', sequence: 1,
        creation: { kind: 'committed_mutation', mutation_id: 'm-l3c', source_turn_id: registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, brief)) } }] } };
      if (!path.endsWith('/graph/register')) return { status: 200, json: { graph: saved ?? null, graph_present: saved !== undefined,
        graph_hash: saved === undefined ? null : computeAnalysisAffectingGraphHash(GraphV3.parse(saved)) } };
      const response = await app.inject({ method: 'POST', url: path, payload: body as Rec });
      expect(response.statusCode, response.body).toBe(200);
      return { status: response.statusCode, json: response.json() };
    } }, { scenario_id: SCENARIO, verified_user_messages: [brief], user_turn_text: brief }, { brief });
    expect(outcome).toMatchObject({ status: 'ok', mutated: true });
    expect(callStructured).toHaveBeenCalledOnce();
    expect(saved, JSON.stringify(outcome)).toBeDefined();
  } finally { await app.close(); }
  expect(saved).toBeDefined();
  const graph = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(saved))));
  const options = graph.nodes.filter(n => n.kind === 'option');
  let sent: Rec | undefined;
  const run = vi.fn(async (payload: Rec) => { sent = payload; return JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')); });
  const handler = createRunAnalysisHandler({ plotClient: { run } as unknown as PLoTClient, scenarioReader: async () => ({
    graph, rawPersistedGraph: graph, options: options.map(o => ({ ...o, option_id: o.id })), goal_node_id: graph.nodes.find(n => n.kind === 'goal')!.id,
  }) });
  await handler({ requestId: 'req-l3c', signal: new AbortController().signal, payload: { scenario_id: SCENARIO }, context: {
    stage: 'analyse', messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: 'req-l3c',
    prior_turns: [], prior_facts: [], capabilities: {}, entity_registry: { option_ids: [], goal_id: null },
    budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, persistedGraph: null, scenarioBriefText: null,
  } } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  return { sent: sent!, graph, draft };
}

it.each([
  'Migration downtime is about 0.4 hours, between 0.2 and 0.6 hours.',
  'For the backup migration, downtime is about 0.4 hours, between 0.2 and 0.6 hours.',
])('L3C: stated uncertain effect keeps its raw range, source and separate illustrative law: %s', async brief => {
  const range = { low: 0.2, high: 0.6, meaning: 'likely_range', source: 'brief_extraction', source_quote: brief, law: LAW };
  const { sent, graph } = await draftToPlot(brief, range);
  const factor = graph.nodes.find(n => n.kind === 'factor')!;
  expect(sent.options[0].intervention_ranges).toEqual({ [factor.id]: range });
  expect(InterventionRangeSchema.parse(sent.options[0].intervention_ranges[factor.id])).toEqual(range);
  expect(graph.nodes.find(n => n.kind === 'option')!.interventions![factor.id]!.range).toEqual(range);
});

it('L3C: no stated range is the byte-equal lane-base request with no law', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  try {
    const ordinary = await draftToPlot('Migration downtime is about 0.4 hours.');
    expect(createHash('sha256').update(JSON.stringify(ordinary.sent)).digest('hex')).toBe('078864d779b6d4034afc0a62b04eef8e8a7cca805a13065f5e552ee796d24293');
    expect(ordinary.sent.options.every((o: Rec) => !Object.hasOwn(o, 'intervention_ranges'))).toBe(true);
  } finally { vi.useRealTimers(); }
});

it('L3C: a source-stated target range grants no law', async () => {
  const brief = 'We target 0.2 to 0.6 hours of downtime, centred on 0.4 hours.';
  const target = await draftToPlot(brief, { low: 0.2, high: 0.6, meaning: 'likely_range', source: 'brief_extraction', source_quote: brief, law: LAW }, 'target');
  expect(target.sent.options.every((o: Rec) => !Object.hasOwn(o, 'intervention_ranges'))).toBe(true);
});

it('L3C: no law is invented for a controllable setting; a borrowed source or different bounds cannot carry the declared law', async () => {
  const brief = 'The deadline is 7 days; the adjustable pause is about 0.4 hours, between 0.2 and 0.6 hours.';
  const raw = { low: 0.2, high: 0.6, meaning: 'likely_range', source: 'brief_extraction', source_quote: brief };
  const setting = await draftToPlot(brief, raw, 'level', 'controllable');
  expect(Object.values(setting.sent.options[0].intervention_ranges)).toEqual([{ low: 0.2, high: 0.6, meaning: 'likely_range' }]);
  for (const wrong of [{ ...raw, source_quote: 'The deadline is 7 days;', law: LAW }, { ...raw, low: 0.1, law: LAW }]) {
    const { sent } = await draftToPlot(brief, wrong, 'level', 'observable', raw);
    expect(Object.values(sent.options[0].intervention_ranges)).toEqual([{ low: 0.2, high: 0.6, meaning: 'likely_range' }]);
  }
});
