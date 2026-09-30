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
 * Verifier FIX_FIRST (T4), two rows families at the end:
 *   · mutant M4 (the pair read on `scale_frame` instead of the cap the threshold goes out on) survived all rows: (a)/(b)
 *     put `os.cap` 200000 beside `scale_frame` 100000 on the real handler path, so exactly one frame attests the pair;
 *   · GUARD: an option that sets a PART of the total and not the total would be scored through the draft's 0.5
 *     placeholder edges (the verifier measured P 0.695 for £18k on a £15k limit), so that target carries no baseline and
 *     the limit stays unscored, as at base. Superseded once the `sum` carrier is minted (AIQ #72 5867700610).
 *
 * Every row binds the budget node BY LABEL → id and the limit BY constraint_id.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { createRunAnalysisHandler, type ScenarioReader } from '../run-analysis.js';
import { carryLevelLimitBaselines, levelLimitBaselineNodeIds } from '../level-limit-baseline.js';
import { limitChecksForAgent } from '../../../agent-lane/limit-checks.js';
import { collectLimitLevelOwners, readRatifiedConstraints } from '../../../../orchestrator/context/constraint-feasibility.js';
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
  let thrown: unknown;
  try { await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation); } catch (err) { thrown = err; /* the capture stops the run */ }
  expect(captured, `run_analysis reached PLoT (threw: ${String(thrown)} ${JSON.stringify((thrown as { details?: unknown })?.details ?? null)})`).toBeDefined();
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

  it('R-c PER OPTION on the same run (AIQ 5900908629): the churn "%" limit CARRIES its level; the options moving churn through unsized links have their own P withheld after the run', async () => {
    const body = await wireOf(SERVED.c15);
    // Churn moves through `price → price_sensitivity → churn`, links nobody sized. #2268 dropped churn's baseline for
    // EVERY option (lock A PJ-A3); now PLoT scores every option and only those options' P is withheld (`storedRunOf` row below).
    expect(nodeOf(body.graph, CHURN_LABEL).observed_state.baseline).toBe(nodeOf(SERVED.c15, CHURN_LABEL).observed_state.value);
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

/** The options as the graph's option nodes carry them (the served carrier is the node's own `interventions`). */
const optionsOf = (graph: Json): Json[] =>
  (graph.nodes as Json[]).filter((n) => n.kind === 'option').map((n) => ({ option_id: n.id, interventions: n.interventions ?? {} }));

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
const carries = (e: ReturnType<typeof edited>) => levelLimitBaselineNodeIds(e.graph, e.limits, e.goalId, optionsOf(e.graph)).has(e.id);

describe('the proof: the limit is in the factor\'s own unit on its own cap, and the level\'s pair attests that cap', () => {
  it('PRESENT (discriminating — 0 matches every frame): a £5,000 level (0.05 = 5000 ÷ 100000) carries 0.05', () => {
    const e = edited({ os: { value: 0.05, raw_value: 5000, unit: 'GBP over 6 months', source: 'user_override' } });
    expect(carries(e)).toBe(true);
    const wire = carryLevelLimitBaselines({ nodes: e.graph.nodes, edges: e.graph.edges }, e.limits, e.goalId, optionsOf(e.graph)) as Json;
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

  it('CONTRAST (served, the earlier journey-C shape): ROOT `total_investment` carries nothing; with no option in play its churn "%" limit does', () => {
    const g = EARLIER.c10;
    const goalId = (g.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
    // A proof row: no option in play (`[]`), so R-c's parts predicate has nothing to withhold.
    const ids = levelLimitBaselineNodeIds({ nodes: g.nodes, edges: g.edges }, g.goal_constraints, goalId, []);
    expect(ids).toEqual(new Set([idOf(g, 'Monthly churn')]));
    expect(ids.has(idOf(g, 'Total investment'))).toBe(false);
  });
});

/** The served C15 graph with the budget node, option interventions, option edges and/or budget limit edited IN the persisted graph. */
function c15With(edit: { os?: Json; interventions?: Record<string, Json>; dropEdges?: Array<[string, string]>; limit?: Json }): Json {
  const graph = structuredClone(SERVED.c15);
  if (edit.os !== undefined) nodeOf(graph, BUDGET_LABEL).observed_state = edit.os;
  for (const [from, to] of edit.dropEdges ?? []) {
    const before = (graph.edges as Json[]).length;
    graph.edges = (graph.edges as Json[]).filter((e) => !(e.from === from && e.to === to));
    expect((graph.edges as Json[]).length, `edge ${from} -> ${to} was on the served graph`).toBe(before - 1);
  }
  for (const [optionId, iv] of Object.entries(edit.interventions ?? {})) {
    const opt = (graph.nodes as Json[]).find((n) => n.id === optionId && n.kind === 'option');
    expect(opt, `option ${optionId} is on the served graph`).toBeDefined();
    opt!.interventions = iv;
  }
  graph.goal_constraints = (graph.goal_constraints as Json[]).map((c) => (c.constraint_id === BUDGET_LIMIT ? { ...c, ...edit.limit } : c));
  return graph;
}
const wireOptionOf = (body: Json, optionId: string): Json => {
  const hits = (body.options as Json[]).filter((o) => (o.option_id ?? o.id) === optionId);
  expect(hits, `exactly one wire option ${optionId}`).toHaveLength(1);
  return hits[0];
};

describe('the pair is read on the cap the THRESHOLD is read on — observed_state.cap, not scale_frame (verifier FIX_FIRST T4, mutant M4)', () => {
  // The node's own cap (200000) differs from its `scale_frame` (100000): `limitTargetCaps` reads `os.cap` first, so the
  // threshold goes out on 200000, and the level must be attested on THAT cap — a pair on the scale_frame is another frame.
  it('(a) value 0.025 = £5,000 ÷ 200000 on os.cap 200000 (scale_frame 100000): the baseline IS carried (0.025) on goal_threshold_cap 200000', async () => {
    const graph = c15With({ os: { value: 0.025, raw_value: 5000, cap: 200000, unit: 'GBP over 6 months', source: 'user_override' } });
    expect(nodeOf(graph, BUDGET_LABEL).scale_frame).toBe(100000);
    const wire = nodeOf((await wireOf(graph)).graph, BUDGET_LABEL);
    expect(wire.goal_threshold_cap, 'the threshold is read on os.cap').toBe(200000);
    expect(wire.observed_state.baseline, 'the level attested on that cap is carried').toBe(0.025);
  });

  it('(b) value 0.05 = £5,000 ÷ scale_frame 100000 beside os.cap 200000: NOTHING is carried — the pair is on another frame than the threshold', async () => {
    const graph = c15With({ os: { value: 0.05, raw_value: 5000, cap: 200000, unit: 'GBP over 6 months', source: 'user_override' } });
    const wire = nodeOf((await wireOf(graph)).graph, BUDGET_LABEL);
    expect(wire.goal_threshold_cap, 'the threshold is still read on os.cap').toBe(200000);
    expect(wire.observed_state.baseline, 'a pair on scale_frame does not attest os.cap').toBeUndefined();
  });
});

describe('GUARD — a total an option moves only through its parts carries no baseline (verifier FIX_FIRST T4; superseded by the `sum` carrier, AIQ #72 5867700610)', () => {
  it('RED (the verifier\'s shape): "Additional Advertising" sets advertising spend (0.18) and NOT the total — no baseline, the limit stays unscored as at base', async () => {
    const graph = c15With({
      // The option is wired to, and sets, its PART only (readiness asks for a value on every option edge).
      interventions: { additional_advertising: { advertising_spend: structuredClone(nodeOf(SERVED.c15, 'Additional Advertising').interventions.advertising_spend) } },
      dropEdges: [['additional_advertising', 'total_initiative_spend']],
      limit: { value: 15000 },
    });
    const body = await wireOf(graph);
    // The shape, read off the wire PLoT receives: the option sets a direct parent of the total and not the total.
    const budgetId = idOf(body.graph, BUDGET_LABEL);
    const iv = wireOptionOf(body, 'additional_advertising').interventions as Json;
    expect(Object.keys(iv)).toContain('advertising_spend');
    expect(Object.keys(iv)).not.toContain(budgetId);
    expect((body.graph.edges as Json[]).some((e) => e.from === 'advertising_spend' && e.to === budgetId)).toBe(true);
    const wire = nodeOf(body.graph, BUDGET_LABEL);
    // PER OPTION since AIQ 5900908629: the total CARRIES its level, so PLoT scores every option; "Additional Advertising"
    // (£18k through 0.5 placeholder edges) has ITS P withheld after the run, never the other options'.
    expect(wire.observed_state.baseline).toBe(nodeOf(graph, BUDGET_LABEL).observed_state.value);
    expect(wire.goal_threshold_cap, 'the threshold is still read on the node\'s own cap, as at base').toBe(100000);
    expect((body.goal_constraints as Json[]).find((c) => c.constraint_id === BUDGET_LIMIT)).toMatchObject({ value: 15000, value_frame: 'level' });
    const withheld = collectLimitLevelOwners(graph, readRatifiedConstraints(graph), body.options as Json[]).placeholderMovedOptionIds;
    expect([...(withheld.get(BUDGET_LIMIT) ?? [])]).toEqual(['additional_advertising']);
  });

  it('CONTROL (served C01/C15): every option that sets a part also sets the total — the baseline is still carried', async () => {
    for (const t of TURNS) {
      const body = await wireOf(SERVED[t.key]);
      const budgetId = idOf(body.graph, BUDGET_LABEL);
      const parts = (body.graph.edges as Json[]).filter((e) => e.to === budgetId && ['factor'].includes((body.graph.nodes as Json[]).find((n) => n.id === e.from)?.kind)).map((e) => e.from as string);
      expect(parts.sort(), `${t.key}: the total's parts`).toEqual(['advertising_spend', 'feature_development_spend']);
      const movers = (body.options as Json[]).filter((o) => parts.some((p) => p in (o.interventions ?? {})));
      expect(movers.length, `${t.key}: some option moves a part`).toBeGreaterThan(0);
      for (const o of movers) expect(Object.keys(o.interventions), `${t.key}: ${o.option_id ?? o.id}`).toContain(budgetId);
      expect(nodeOf(body.graph, BUDGET_LABEL).observed_state.baseline, t.key).toBe(0);
    }
  });

  it('an option that sets a GRANDPARENT of the total (and neither a part nor the total) carries nothing; setting the total too carries', () => {
    const graph = structuredClone(SERVED.c15);
    const budgetId = idOf(graph, BUDGET_LABEL);
    (graph.nodes as Json[]).push({ id: 'agency_retainer', kind: 'factor', label: 'Agency retainer', observed_state: { value: 0.1, raw_value: 10000, unit: 'GBP over 6 months', source: 'user_override' } });
    (graph.edges as Json[]).push({ from: 'agency_retainer', to: 'advertising_spend', strength: { mean: 0.5, std: 0.125 } });
    const goalId = (graph.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
    const options = optionsOf(graph).map((o) =>
      o.option_id === 'additional_advertising' ? { ...o, interventions: { agency_retainer: 0.15 } } : o,
    );
    // PER OPTION since AIQ 5900908629: the total carries either way; the option is withheld only while it sets no total.
    const moved = (os: Json[]) => [...(collectLimitLevelOwners(graph, readRatifiedConstraints(graph), os).placeholderMovedOptionIds.get(BUDGET_LIMIT) ?? [])];
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalId, options).has(budgetId)).toBe(true);
    expect(moved(options)).toContain('additional_advertising');
    const withTotal = options.map((o) => (o.option_id === 'additional_advertising' ? { ...o, interventions: { agency_retainer: 0.15, [budgetId]: 0.18 } } : o));
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalId, withTotal).has(budgetId)).toBe(true);
    expect(moved(withTotal)).not.toContain('additional_advertising');
  });

  it('PER OPTION (AIQ 5900908629): the options no longer decide the carrier — with or without them, the budget AND churn carry', () => {
    const g = SERVED.c15;
    const goalId = (g.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
    const both = new Set([idOf(g, BUDGET_LABEL), idOf(g, CHURN_LABEL)]);
    expect(levelLimitBaselineNodeIds(g, g.goal_constraints, goalId)).toEqual(both);
    expect(levelLimitBaselineNodeIds(g, g.goal_constraints, goalId, optionsOf(g))).toEqual(both);
  });
});

/**
 * ⭐ AI QUALITY'S TWO REQUIRED ROWS FOR #2244 (#72 5869646768).
 *
 * ROW 1 — AT THE LIMIT. "50/50 Features, Price Rise and Advertising" sets the total to £30,000 against "≤ £30,000":
 * spending exactly the budget meets it. What CEE owns, and what these rows pin at 0 LLM, is the wire ISL reads it from:
 * the total goes out with its own level as the baseline, and every option that moves the budget SETS the total itself,
 * at its own figure, divided by the one cap the threshold is divided by. ISL compares an option that sets a limit's
 * target at exactly the level it sets (`GoalThresholdPlan.pinned_levels`), never through baseline + (option − this
 * draw's status quo), so the two £0 levers' spread cannot reach it.
 *
 * MEASURED, not asserted here (MG T4 rows, 28 Sep): CEE 99b165a9 real loader+handler egress → PLoT ccd602c (real
 * `/v2/run`, ISL call captured) → ISL a1fa8ae6 real `/api/v1/robustness/analyze/v2` in process (n 10,000, PLoT's own
 * seed): P(total ≤ £30,000) = 1.000 for £30,000, £18,000, £12,000, £0 and price-only, each at sd £0. The same draws
 * through the un-pinned conversion read 0.8734 for the £30,000 option (a floating-point tie at the limit), so the probe
 * sees a non-1 answer where one exists. The PLoT body that ISL response produced is the row-2 fixture.
 *
 * ROW 2 — WHOSE BASELINE (B5). The same captured PLoT bodies (`tests/fixtures/cross-service/b5-per-limit/`
 * `journey-c-082121Z.*`) through the REAL handler: C01's total is Olumi's £0 (`cee_inference`) → `estimate_only`,
 * told "checked … only against Olumi's estimates"; C15's is the user's £0 (`user_override`) → `scored`.
 */
const B5_DIR = 'tests/fixtures/cross-service/b5-per-limit';
const CAPTURED: Record<'c01' | 'c15', Json> = {
  c01: JSON.parse(readFileSync(`${B5_DIR}/journey-c-082121Z.c01.plot-response.json`, 'utf8')),
  c15: JSON.parse(readFileSync(`${B5_DIR}/journey-c-082121Z.c15.plot-response.json`, 'utf8')),
};
const AT_LIMIT_OPTION = '50/50 Features, Price Rise and Advertising';
const wireOptionByLabel = (body: Json, label: string): Json => {
  const hits = (body.options as Json[]).filter((o) => o.label === label);
  expect(hits, `exactly one wire option labelled "${label}"`).toHaveLength(1);
  return hits[0];
};

/** The run result the REAL handler stores for a persisted graph, PLoT answering with a captured `/v2/run` body. */
async function storedRunOf(graph: Json, plotBody: Json): Promise<Json> {
  const run = vi.fn(async () => structuredClone(plotBody));
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
  const outcome = await createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader })(invocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  return fact.result as unknown as Json;
}
const budgetRowOf = (result: Json): Json => {
  const rows = (result.constraint_verdict?.per_limit ?? []) as Json[];
  const hits = rows.filter((r) => r.constraint_id === BUDGET_LIMIT);
  expect(hits, `exactly one per-limit row for ${BUDGET_LIMIT}`).toHaveLength(1);
  return hits[0];
};
const budgetSayOf = (graph: Json, result: Json): string => {
  const checks = limitChecksForAgent(graph, { per_limit: result.constraint_verdict.per_limit, joint: result.constraint_verdict.joint }) ?? [];
  const hits = checks.filter((c) => c.constraint_id === BUDGET_LIMIT);
  expect(hits, 'exactly one limit check for the budget').toHaveLength(1);
  return hits[0]!.say;
};

describe('AIQ REQUIRED row 1 (#72 5869646768) — C15 at the limit: the £30,000 option sets the total at exactly the limit, on the cap the limit is read on', () => {
  it('the wire: the total\'s own level as baseline; every option that moves the budget sets the total itself; "50/50 …" at exactly £30,000', async () => {
    const body = await wireOf(SERVED.c15);
    const budgetId = idOf(body.graph, BUDGET_LABEL);
    const wire = nodeOf(body.graph, BUDGET_LABEL);
    expect(wire.observed_state.baseline, 'the baseline is the total\'s own level').toBe(wire.observed_state.value);
    expect(wire.observed_state.source).toBe('user_override');
    // One cap for the threshold and for the level an option sets on this node.
    expect(wire.goal_threshold_cap).toBe(100000);
    expect(wire.scale_frame).toBe(wire.goal_threshold_cap);
    const limit = (body.goal_constraints as Json[]).find((c) => c.constraint_id === BUDGET_LIMIT);
    expect(limit).toMatchObject({ node_id: budgetId, operator: '<=', value: 30000, value_frame: 'level', unit: 'GBP over 6 months' });

    // Each option that moves the total or a part of it SETS the total (ISL then reads it at that level: pinned_levels).
    const parts = ['advertising_spend', 'feature_development_spend'];
    const setsTotal: Record<string, unknown> = {};
    for (const o of body.options as Json[]) {
      const iv = (o.interventions ?? {}) as Json;
      if (!(budgetId in iv) && !parts.some((p) => p in iv)) continue;
      expect(Object.keys(iv), `${o.label} moves the budget, so it sets the total itself`).toContain(budgetId);
      setsTotal[o.label as string] = iv[budgetId];
    }
    expect(setsTotal).toEqual({
      'Features and Price Rise': 12000,
      'Additional Advertising': 18000,
      'Carry On as Now': 0,
      [AT_LIMIT_OPTION]: 30000,
    });
    // AT the limit: the option's figure IS the limit's figure, in the limit's unit (no rounding, no second frame).
    expect(wireOptionByLabel(body, AT_LIMIT_OPTION).interventions[budgetId]).toBe(limit!.value);
    for (const [label, level] of Object.entries(setsTotal)) expect(level as number, label).toBeLessThanOrEqual(limit!.value as number);
  });

  it('CAPTURED premise (ISL a1fa8ae6 via PLoT ccd602c, not computed here): the budget limit is certified and scored on every option, P 1 at £30,000', () => {
    const body = CAPTURED.c15;
    expect(body.constraints_status).toBe('computed');
    const rows = (body.constraint_results as Json[]).filter((r) => r.constraint_id === BUDGET_LIMIT);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.scale_provenance).toMatchObject({ range_unified: true, decision_grade: true });
    const p = Object.fromEntries((body.option_comparison as Json[]).map((o) => [o.option_label ?? o.label, o.constraint_probabilities?.[BUDGET_LIMIT]]));
    expect(p).toEqual({
      'Features and Price Rise': 1, 'Additional Advertising': 1, 'Carry On as Now': 1, 'Price Rise Only': 1, [AT_LIMIT_OPTION]: 1,
    });
  });
});

describe('AIQ REQUIRED row 2 (#72 5869646768, B5) — WHOSE baseline: Olumi\'s £0 is estimate_only, the user\'s £0 is scored', () => {
  it('C01 (spend £0 = cee_inference): the budget limit is estimate_only / level_olumi_estimate; B6 SUPERSEDES "checked … only against Olumi\'s estimates" (AIQ 5916187873)', async () => {
    const graph = SERVED.c01;
    expect(nodeOf(graph, BUDGET_LABEL).observed_state.source).toBe('cee_inference');
    const result = await storedRunOf(graph, CAPTURED.c01);
    expect(budgetRowOf(result)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'estimate_only', reason: 'level_olumi_estimate' });
    // The two options that SET the total do so at Olumi's single figure (arm (iii)); today's £0 is definitional ((c)).
    expect(budgetSayOf(graph, result)).toBe('For ‘Features and Price Rise’ and ‘Additional Advertising’ it isn’t shown: it uses a single Olumi figure for ‘Total initiative spend’.');
  });

  it('C15 (spend £0 = user_override): the budget limit is scored, "checked against the figures in your model"', async () => {
    const graph = SERVED.c15;
    expect(nodeOf(graph, BUDGET_LABEL).observed_state.source).toBe('user_override');
    const result = await storedRunOf(graph, CAPTURED.c15);
    expect(budgetRowOf(result)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'scored' });
    expect(budgetSayOf(graph, result)).toBe('‘Total initiative spend’ was checked against the figures in your model.');
  });

  it('CONTROL (DERIVED: C01 with ONLY the total\'s source made the user\'s) — the same captured run is scored, so whose level it is decides', async () => {
    const graph = structuredClone(SERVED.c01);
    nodeOf(graph, BUDGET_LABEL).observed_state.source = 'user_override';
    const result = await storedRunOf(graph, CAPTURED.c01);
    expect(budgetRowOf(result)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'scored' });
  });

  it('B6 AS SERVED (AIQ 5916187873 (c)): churn\'s level is Olumi\'s 3%, so on both runs every option\'s churn P is withheld and the row is unscored', async () => {
    const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
    for (const k of ['c01', 'c15'] as const) {
      const result = await storedRunOf(SERVED[k], CAPTURED[k]);
      expect((result.constraint_verdict.per_limit as Json[]).find((r) => r.constraint_id === CHURN_LIMIT), k).toMatchObject({ state: 'unscored' });
      const moved = collectLimitLevelOwners(SERVED[k], readRatifiedConstraints(SERVED[k]), optionsOf(SERVED[k])).placeholderMovedOptionIds.get(CHURN_LIMIT);
      expect(moved?.size, k).toBe(optionsOf(SERVED[k]).length);
    }
  });

  it('SCOPE (per option, AIQ 5900908629; on the twin where churn\'s 3% is the user\'s, so B6\'s level arm is out): churn folds over the options no placeholder moves; the placeholder-moved options\' churn P is gone from the stored result — row 2 is bound to the budget limit by id', async () => {
    const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
    for (const k of ['c01', 'c15'] as const) {
      const served = structuredClone(SERVED[k]);
      nodeOf(served, 'Monthly churn').observed_state.source = 'user';
      const result = await storedRunOf(served, CAPTURED[k]);
      const rows = result.constraint_verdict.per_limit as Json[];
      expect(rows.find((r) => r.constraint_id === CHURN_LIMIT), k).toEqual({ constraint_id: CHURN_LIMIT, state: 'scored' });
      const moved = collectLimitLevelOwners(served, readRatifiedConstraints(served), optionsOf(served)).placeholderMovedOptionIds.get(CHURN_LIMIT);
      expect(moved?.size ?? 0, k).toBeGreaterThan(0);
      // Whole-result scan: no entry for a withheld option still carries a churn P; a kept option still does (control).
      const hits: string[] = [];
      let kept = 0;
      const walk = (v: unknown) => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v === null || typeof v !== 'object') return;
        const o = v as Json;
        const id = o.option_id ?? o.id;
        const cp = o.constraint_probabilities;
        if (typeof id === 'string' && cp !== null && typeof cp === 'object' && !Array.isArray(cp) && CHURN_LIMIT in cp) {
          if (moved!.has(id)) hits.push(id); else kept += 1;
        }
        Object.values(o).forEach(walk);
      };
      walk(result);
      expect(hits, k).toEqual([]);
      expect(kept, `${k}: control — a kept option's churn P survives`).toBeGreaterThan(0);
    }
  });
});
