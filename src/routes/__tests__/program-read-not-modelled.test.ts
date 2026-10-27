/**
 * A PROGRAM READ SAYS WHAT IS NOT MODELLED FROM ITS CANONICAL MODEL (graph workstream, 27 Oct). The read's `not_modelled`
 * on a program scenario was the GraphV3 scan of the projected graph: on european it said every figure was in the model
 * (the horizon is still asked), tied "£500k" to a structural zero, reported no exclusions over the model's `left_out`, and
 * listed the model's own structure as Olumi's inferences.
 *
 * Through the REAL read route with a mock store: european's saved record as stored (graph and brief), served once as the
 * program it is and once as the SAME graph with no program (the contrast keeps the scan). Expected values are written by
 * hand from the fixture's canonical records.
 *
 * DL 27 Oct, option 2: a program's brief figures are the person's own canonical quantities, one item per person-authored
 * quantity whose quote is verbatim in the brief (text = the quote, at its place, no `kind`); the regex scan never runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = '7e3ba3e4-ff07-4521-81e5-e557fa02924d';

vi.mock('../../config/index.js', async (load) => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (load) => {
  const actual = await load<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const store = { append: vi.fn(), loadGraph: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(),
  readMostRecentPendingActions: vi.fn(), readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(),
  readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn(), readLatestAnswerOffers: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({
  ...(await load<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...(await load<Record<string, unknown>>()), resolveUserIdentity }));

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { deriveNotModelledManifest, deriveProgramNotModelledManifest, extractStatedQuantities } from '../../cee/context-integrity/not-modelled-manifest.js';

type Rec = Record<string, any>;
const saved = JSON.parse(readFileSync(new URL('./fixtures/european-7e3ba3e4.saved.json', import.meta.url), 'utf8')) as { brief_text: string; graph: Rec };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  store.loadGraph.mockResolvedValue(null);
  store.readRecent.mockResolvedValue([]);
  store.readLatestAnswerOffers.mockResolvedValue(null);
  for (const read of [store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

async function notModelledOf(graph: Rec): Promise<Rec> {
  store.readExistingScenario.mockResolvedValue({ userId: null, graph: JSON.parse(JSON.stringify(graph)), briefText: saved.brief_text, analysisInvalidatedAt: null, revision: 1 });
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { fresh: true } });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as Rec).not_modelled;
}

// The person's own sentences in european's canonical model, as the fixture stores them (hand-copied, never read at runtime).
const Q = {
  timing: 'Should we expand into the European market in the next 6-12 months?',
  base: 'Our current customer base is 400.',
  target: 'The target is 800.',
  churn: 'Monthly churn is at 8%.',
  churnLimit: "If it goes beyond 12%, we're in danger of losing money.",
  budget: 'The investment budget is up to £500k.',
};
// What the regex scan alone finds in this brief (the contrast below pins the same four on a non-program read).
const REGEX_ONLY = ['12 months', '8%', '12%', '£500k'];

describe('a program read: what is not modelled is the canonical model\'s', () => {
  it('anti-vacuity: each quote is verbatim in the brief, and the regex really finds the four figures', () => {
    for (const q of Object.values(Q)) expect(saved.brief_text.indexOf(q), q).toBeGreaterThanOrEqual(0);
    expect(extractStatedQuantities(saved.brief_text).map((f) => f.literal)).toEqual(REGEX_ONLY);
  });

  it('european: the person\'s quoted figures, at their place, no kind; the model\'s left_out; Olumi\'s own figures', async () => {
    const m = await notModelledOf(saved.graph);
    expect(m.status).toBe('derived');
    // One item per person quantity whose quote is in the brief, in brief order, each the person's own sentence. In the
    // model because each holds a figure; tied to its record only where the board draws it (customer_target and the two
    // limits' figures are not cards). The limits' figures are constraints.
    const b = saved.brief_text;
    expect((m.quantities.items as Rec[]).map((i) => [i.literal, i.char_offset, i.verdict, i.matched_node_id, i.stated_kind])).toEqual([
      [Q.timing, b.indexOf(Q.timing), 'in_model', 'expansion_timing', 'figure'],
      [Q.base, b.indexOf(Q.base), 'in_model', 'current_customers', 'figure'],
      [Q.target, b.indexOf(Q.target), 'in_model', null, 'figure'],
      [Q.churn, b.indexOf(Q.churn), 'in_model', 'baseline_churn', 'figure'],
      [Q.churnLimit, b.indexOf(Q.churnLimit), 'in_model', null, 'constraint'],
      [Q.budget, b.indexOf(Q.budget), 'in_model', null, 'constraint'],
    ]);
    expect((m.quantities.items as Rec[]).filter((i) => 'kind' in i)).toEqual([]);
    // No number the regex alone would have found is an item of its own.
    const literals = (m.quantities.items as Rec[]).map((i) => i.literal);
    for (const r of REGEX_ONLY) expect(literals, r).not.toContain(r);
    expect([m.quantities.total, m.quantities.in_model, m.quantities.in_model_anchored, m.quantities.absent]).toEqual([6, 6, 3, 0]);
    expect(m.declared_exclusions).toEqual({ status: 'reported', items: [
      'Actual profitability and cash runway are not calculated; the stated churn threshold is retained as a guardrail, not a profitability test.',
    ] });
    // Olumi's only figure is the limited pilot's £100,000, an option's setting (on the option card, not a card of its own),
    // so no card is listed as Olumi's: never the model's structure (`percentage_scale`, `initial_acquisition_spend`) or the
    // person's own timing, which the scan listed.
    expect(m.inferred_factors).toEqual({ status: 'derived', items: [] });
  });

  it('CONTRAST: the SAME graph with no program keeps the GraphV3 scan, as before', async () => {
    const { living_model: _program, ...plain } = saved.graph;
    const m = await notModelledOf(plain);
    expect(m).toEqual(deriveNotModelledManifest(saved.brief_text, plain));
    // Hand-pinned, so a change to the scan itself (or a program path reaching a non-program read) is RED here too.
    expect((m.quantities.items as Rec[]).map((i) => [i.literal, i.kind, i.char_offset, i.verdict])).toEqual([
      ['12 months', 'count', 56, 'in_model'],
      ['8%', 'percent', 140, 'prose_only'],
      ['12%', 'percent', 162, 'in_model'],
      ['£500k', 'money', 231, 'in_model'],
    ]);
  });
});

describe('deriveProgramNotModelledManifest: which canonical quantities become items', () => {
  const brief = 'We sell 40 loaves a day. Rent is £900 a month. Olumi guessed 30% margin.';
  const q = (id: string, author: string, quote: string | null, status: string, value: number | null) =>
    ({ id, label: id, author, quote, status, value, low: null, high: null });
  const records = {
    quantities: [
      q('rent', 'person', 'Rent is £900 a month.', 'asked', null),          // the person's words, no figure held → absent
      q('loaves', 'person', 'We sell 40 loaves a day.', 'known', 40),       // held, drawn → in_model, tied to its card
      q('loaves_again', 'person', 'We sell 40 loaves a day.', 'known', 40), // same words, same place → the same item
      q('margin', 'olumi', 'Olumi guessed 30% margin.', 'estimated', 0.3),  // Olumi's, not the person's → never an item
      q('paraphrase', 'person', 'we sell forty loaves', 'known', 40),       // not verbatim in the brief → never an item
      q('unquoted', 'person', null, 'known', 7),                            // no quote → never an item
    ],
    limits: [],
    goals: [],
    left_out: [],
  };

  it('one item per person quote found verbatim, in brief order, absent when its quantity holds no figure', () => {
    const m = deriveProgramNotModelledManifest(brief, records, new Set(['loaves']), []);
    expect(m.quantities!.items.map((i) => [i.literal, i.char_offset, i.verdict, i.matched_node_id, 'kind' in i])).toEqual([
      ['We sell 40 loaves a day.', 0, 'in_model', 'loaves', false],
      ['Rent is £900 a month.', 25, 'absent', null, false],
    ]);
    expect([m.quantities!.total, m.quantities!.in_model, m.quantities!.absent]).toEqual([2, 1, 1]);
  });

  it('one sentence quoted by a held AND an asked quantity is not modelled yet, never "in the model" (C2)', () => {
    const mixed = { ...records, quantities: [
      q('staff', 'person', 'We sell 40 loaves a day.', 'known', 40),
      q('days', 'person', 'We sell 40 loaves a day.', 'asked', null),
    ] };
    for (const order of [mixed.quantities, [...mixed.quantities].reverse()]) {
      const m = deriveProgramNotModelledManifest(brief, { ...mixed, quantities: order }, new Set(['staff']), []);
      expect(m.quantities!.items.map((i) => [i.literal, i.verdict, i.matched_node_id])).toEqual([['We sell 40 loaves a day.', 'absent', null]]);
      expect([m.quantities!.total, m.quantities!.in_model, m.quantities!.in_model_anchored, m.quantities!.absent]).toEqual([1, 0, 0, 1]);
    }
  });
});
