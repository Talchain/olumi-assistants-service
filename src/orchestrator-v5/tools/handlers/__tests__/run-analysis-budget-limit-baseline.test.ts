/**
 * ⛔ JOURNEY C'S BUDGET LIMIT IS CHECKED AGAINST THE BUDGET FACTOR'S OWN LEVEL (T4 — served journey C, MG gate run
 * `pj-20260928T082121Z`, tuple CEE 593362a · PLoT aac1970 · ISL 9b8aa34).
 *
 * SERVED: "£20k budget" (brief) and "we have £30,000 to spend" (later) both came back
 * `limit_verdicts.per_limit agent-lane:total_initiative_spend:<= = unscored / CONSTRAINT_NOT_CONVERTIBLE` — on the brief's
 * first pass AND after the user gave every figure. ISL's warning names the field:
 * `nodes[total_initiative_spend].observed_state.baseline` ("a 'level' frame requires … observed_state.baseline").
 *
 * MEASURED on the real path (`loadScenarioSnapshotForRunAnalysis` → `createRunAnalysisHandler` → the `/v2/run` body, then
 * that body through PLoT aac1970's `/v2/run` and ISL 9b8aa34's real `/api/v1/robustness/analyze/v2`):
 *   · the budget factor is NON-ROOT on the scored model — the draft wired `feature spend → total spend` and
 *     `advertising spend → total spend` (the earlier journey-C shape, `served-journey-c-budget-limit-063347Z.json`, had it
 *     ROOT, and there the same limit scored `estimate_only`);
 *   · CEE carried the factor's own cap (`goal_threshold_cap` 100000 — the threshold IS read on `[0, cap]`), but carried a
 *     baseline only for `"%"` limits, so the budget node went out with none: PLoT CONSTRAINT_TARGET_UNRELIABLE, ISL
 *     CONSTRAINT_NOT_CONVERTIBLE / `missing_target_baseline`;
 *   · with `baseline` = the node's own `value` (0 = raw 0 ÷ 100000) and NOTHING else changed on the wire, PLoT delivers the
 *     limit and ISL scores it per option (at £30k every option ≤ £30k → 1; at £15k the £18k and £30k options → 0).
 *
 * Every row binds the budget node BY LABEL → id and the limit BY constraint_id.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { createRunAnalysisHandler, type ScenarioReader } from '../run-analysis.js';
import { carryLevelLimitBaselines, levelLimitBaselineNodeIds } from '../level-limit-baseline.js';
import type { HandlerInvocation } from '../../registry.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('../../../__tests__/fixtures/served-journey-c-nonroot-budget-limit-082121Z.json', import.meta.url), 'utf8'),
) as { c01: Json; c15: Json };
const EARLIER = JSON.parse(
  readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-journey-c-budget-limit-063347Z.json', import.meta.url), 'utf8'),
) as { c10: Json };
const SCENARIO_ID = 'e4a09e31-a6e5-4113-b8ff-03ba985a63e6';
const BUDGET_LABEL = 'Total initiative spend';
const BUDGET_LIMIT = 'agent-lane:total_initiative_spend:<=';
const CHURN_LABEL = 'Monthly churn';

const idOf = (graph: Json, label: string): string => {
  const hits = (graph.nodes as Json[]).filter((n) => n.label === label);
  expect(hits, `exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0].id as string;
};
const nodeOf = (graph: Json, label: string): Json => (graph.nodes as Json[]).find((n) => n.id === idOf(graph, label))!;

/** The `/v2/run` body `run_analysis` builds for a persisted graph — the real loader and handler, PLoT captured. */
async function wireOf(graph: Json): Promise<Json> {
  let captured: Json | undefined;
  const plotClient = {
    run: vi.fn((payload: Json) => { captured = payload; return Promise.reject(new Error('captured')); }),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
  const store = createNoopSessionStore({ loadGraphResult: structuredClone(graph) });
  const scenarioReader: ScenarioReader = (id) => loadScenarioSnapshotForRunAnalysis(id, 'req-budget-limit', store);
  const invocation = {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: 'req-budget-limit',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-budget-limit', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  try { await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation); } catch { /* the capture stops the run */ }
  expect(captured, 'run_analysis reached PLoT').toBeDefined();
  return captured!;
}

const TURNS = [
  { key: 'c01' as const, what: 'the brief\'s first pass (Olumi\'s estimate, £20k)', limit: 20000, source: 'cee_inference' },
  { key: 'c15' as const, what: 'after the user gave every figure (their £0, £30k)', limit: 30000, source: 'user_override' },
];

describe('RED — served journey C: the budget limit reaches PLoT with the budget factor\'s own level as its baseline', () => {
  for (const t of TURNS) {
    it(`${t.what}: baseline = the node's own value, on the cap the threshold is read on`, async () => {
      const graph = SERVED[t.key];
      const before = JSON.stringify(graph);
      const persisted = nodeOf(graph, BUDGET_LABEL);
      // The served preconditions, read off the fixture rather than assumed.
      expect(persisted.observed_state).toMatchObject({ value: 0, raw_value: 0, source: t.source });
      expect(persisted.observed_state.baseline).toBeUndefined();
      expect(persisted.scale_frame).toBe(100000);

      const body = await wireOf(graph);
      const wire = nodeOf(body.graph, BUDGET_LABEL);
      expect(wire.observed_state.baseline, 'the budget node carries a baseline').toBe(persisted.observed_state.value);
      expect(wire.goal_threshold_cap, 'the threshold is read on the node\'s own cap').toBe(100000);
      const limit = (body.goal_constraints as Json[]).find((c) => c.constraint_id === BUDGET_LIMIT);
      expect(limit).toMatchObject({ node_id: persisted.id, operator: '<=', value: t.limit, value_frame: 'level', unit: 'GBP over 6 months' });
      expect(JSON.stringify(graph), 'the persisted graph is never touched').toBe(before);
    });
  }

  it('PRESENT control on the same run: the churn "%" limit still carries its own level (0.03)', async () => {
    const body = await wireOf(SERVED.c15);
    expect(nodeOf(body.graph, CHURN_LABEL).observed_state.baseline).toBe(0.03);
  });

  it('INVARIANT (the spec, not the symptom): a level limit whose threshold goes out on a non-root factor\'s own cap goes out with that factor\'s level', async () => {
    for (const t of TURNS) {
      const body = await wireOf(SERVED[t.key]);
      const nodes = body.graph.nodes as Json[];
      const edges = body.graph.edges as Json[];
      const kind = new Map(nodes.map((n) => [n.id, n.kind]));
      const nonRoot = (id: string) => edges.some((e) => e.to === id && kind.get(e.from) !== 'option' && kind.get(e.from) !== 'decision');
      const checked = (body.goal_constraints as Json[])
        .filter((c) => c.value_frame === 'level')
        .map((c) => nodes.find((n) => n.id === c.node_id)!)
        .filter((n) => n.kind === 'factor' && typeof n.goal_threshold_cap === 'number' && nonRoot(n.id));
      expect(checked.map((n) => n.label), `${t.key}: the population is not empty`).toContain(BUDGET_LABEL);
      for (const n of checked) expect(n.observed_state?.baseline, `${t.key}: ${n.label}`).toBe(n.observed_state?.value);
    }
  });
});

/** The served C15 graph with the budget node / limit / edges edited, for the proof's contrast rows. */
function edited(edit: { os?: Json; limit?: Json; root?: boolean }) {
  const graph = structuredClone(SERVED.c15);
  const id = idOf(graph, BUDGET_LABEL);
  const node = nodeOf(graph, BUDGET_LABEL);
  if (edit.os !== undefined) node.observed_state = edit.os;
  if (edit.root === true) {
    graph.edges = (graph.edges as Json[]).filter((e) => !(e.to === id && ['feature_development_spend', 'advertising_spend'].includes(e.from)));
  }
  const limits = (graph.goal_constraints as Json[]).map((c) => (c.constraint_id === BUDGET_LIMIT ? { ...c, ...edit.limit } : c));
  const goalId = (graph.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
  return { graph, id, limits, goalId };
}
const carries = (e: ReturnType<typeof edited>) => levelLimitBaselineNodeIds(e.graph, e.limits, e.goalId).has(e.id);

describe('the proof: the limit is in the factor\'s own unit on its own cap, and the level\'s pair attests that cap', () => {
  it('PRESENT (discriminating — 0 matches every frame): a £5,000 level (0.05 = 5000 ÷ 100000) carries 0.05', () => {
    const e = edited({ os: { value: 0.05, raw_value: 5000, unit: 'GBP over 6 months', source: 'user_override' } });
    expect(carries(e)).toBe(true);
    const wire = carryLevelLimitBaselines({ nodes: e.graph.nodes, edges: e.graph.edges }, e.limits, e.goalId) as Json;
    expect((wire.nodes as Json[]).find((n) => n.id === e.id)!.observed_state.baseline).toBe(0.05);
  });

  it('CONTRAST: a pair on ANOTHER frame (0.1 beside £5,000 on a cap of 100000) carries nothing', () => {
    expect(carries(edited({ os: { value: 0.1, raw_value: 5000, unit: 'GBP over 6 months', source: 'user_override' } }))).toBe(false);
  });

  it('CONTRAST: a level with no raw figure beside it attests no frame — carries nothing', () => {
    expect(carries(edited({ os: { value: 0.05, unit: 'GBP over 6 months', source: 'user_override' } }))).toBe(false);
  });

  it('CONTRAST: a limit in ANOTHER unit than the node\'s ("GBP per month" on "GBP over 6 months") carries nothing', () => {
    expect(carries(edited({ limit: { unit: 'GBP per month' } }))).toBe(false);
  });

  it('CONTRAST: a limit ABOVE the node\'s cap (£150,000 on 100000) carries nothing', () => {
    expect(carries(edited({ limit: { value: 150000 } }))).toBe(false);
  });

  it('CONTRAST: a DELTA limit carries nothing', () => {
    expect(carries(edited({ limit: { value_frame: 'delta' } }))).toBe(false);
  });

  it('CONTRAST: a ROOT budget node (no factor feeds it) carries nothing — ISL reads a root at its own level', () => {
    expect(carries(edited({ root: true }))).toBe(false);
  });

  it('CONTRAST (served, the earlier journey-C shape): ROOT `total_investment` carries nothing; its churn "%" limit still does', () => {
    const g = EARLIER.c10;
    const goalId = (g.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
    const ids = levelLimitBaselineNodeIds({ nodes: g.nodes, edges: g.edges }, g.goal_constraints, goalId);
    expect(ids).toEqual(new Set([idOf(g, 'Monthly churn')]));
    expect(ids.has(idOf(g, 'Total investment'))).toBe(false);
  });
});
