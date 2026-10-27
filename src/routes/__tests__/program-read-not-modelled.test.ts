/**
 * A PROGRAM READ SAYS WHAT IS NOT MODELLED FROM ITS CANONICAL MODEL (graph workstream, 27 Oct). The read's `not_modelled`
 * on a program scenario was the GraphV3 scan of the projected graph: on european it said every figure was in the model
 * (the horizon is still asked), tied "£500k" to a structural zero, reported no exclusions over the model's `left_out`, and
 * listed the model's own structure as Olumi's inferences.
 *
 * Through the REAL read route with a mock store: european's saved record as stored (graph and brief), served once as the
 * program it is and once as the SAME graph with no program (the contrast keeps the scan). Expected values are written by
 * hand from the fixture's canonical records.
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
import { deriveNotModelledManifest } from '../../cee/context-integrity/not-modelled-manifest.js';

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
const figures = (m: Rec) => (m.quantities.items as Rec[]).map((i) => [i.literal, i.verdict, i.matched_node_id, i.stated_kind]);

describe('a program read: what is not modelled is the canonical model\'s', () => {
  it('european: the brief\'s figures against the person\'s records, the model\'s left_out, and Olumi\'s own figures', async () => {
    const m = await notModelledOf(saved.graph);
    expect(m.status).toBe('derived');
    // Each figure is held by the person's record whose words cover it, tied to that record only where the board draws it:
    // "6-12 months" is the expansion timing's range (a card); 8% the churn today (a card); 12% and £500k the two limits'
    // figures (not cards, so no card id), never the structural `investment` the scan chose.
    expect(figures(m)).toEqual([
      ['12 months', 'in_model', 'expansion_timing', 'figure'],
      ['8%', 'in_model', 'baseline_churn', 'figure'],
      ['12%', 'in_model', null, 'constraint'],
      ['£500k', 'in_model', null, 'constraint'],
    ]);
    expect([m.quantities.total, m.quantities.in_model, m.quantities.in_model_anchored, m.quantities.absent]).toEqual([4, 4, 2, 0]);
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
    expect(await notModelledOf(plain)).toEqual(deriveNotModelledManifest(saved.brief_text, plain));
  });
});
