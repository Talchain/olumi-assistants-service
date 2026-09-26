/**
 * ⛔ THE STATED GOAL DIRECTION NEVER REACHES THE ENGINE FROM THE AGENT LANE.
 *
 * Served on CEE 20fe36f5 (25 Sep 23:45Z, OpenAI witness P-S2): "We want Pro MRR to
 * reach at least £20,000" built goal `pro_mrr` with its level-framed threshold, yet
 * the Run carried `GOAL_DIRECTION_UNATTESTED` and the reply said the "at least"
 * direction was not encoded. For a goal to REDUCE ("keep churn at or below 10%") an
 * unattested direction runs ISL's maximiser, which crowns the option that RAISES
 * churn: the recommendation is inverted.
 *
 * PLoT (b09c0f2e) reads the sense ONLY as a REQUEST-level `goal_direction`
 * (`'maximise' | 'minimise' | 'target'`, `routes/v2/run.ts` gate enum,
 * `parseGoalDirection(body.goal_direction)`), never from a node. CEE's run_analysis
 * handler writes that key only from `deriveEmittedGoalDirection` — a classifier over
 * the goal LABEL that emits `'minimise'` and nothing else. The candidate's stated
 * `goal.operator` has no GraphV3 carrier (admit-model records it as the
 * `goal_operator` loss), so the stated direction cannot reach the handler at all.
 *
 * Every assertion reads the payload PLoT RECEIVES, on the real path: strict schema
 * candidate → `buildModelFromBrief` → `/graph/register` body → the production
 * snapshot loader (`loadScenarioSnapshotForRunAnalysis`, which runs
 * `GraphV3.safeParse`) → `createRunAnalysisHandler` with PLoT faked. The goal is
 * bound by its node id.
 *
 * `it.fails` marks the SPEC this lane cannot meet inside its lease. It needs, outside
 * MG's files (measured at 20fe36f5 by a reverted prototype, all four arms GREEN):
 *   1. CARRIER — `src/schemas/cee-v3.ts` NodeV3, beside `goal_threshold_frame`
 *      (:246): declare `goal_direction`. NodeV3 strips undeclared keys, and the
 *      production loader's `GraphV3.safeParse` drops it before the handler.
 *   2. FORWARDER — `src/orchestrator-v5/tools/handlers/run-analysis.ts` (:924-929):
 *      forward the goal node's attested `goal_direction` ahead of the label-derived
 *      `deriveEmittedGoalDirection`, including `'maximise'`, and log the provenance as
 *      attested, not `derived_from_goal_label`.
 * Then admit-model stamps `>=`/`>` → maximise and `<=`/`<` → minimise on the goal node,
 * each `it.fails` becomes a plain `it`, and the "gap is real" control is inverted.
 * The CONTROLS share the same harness, so a broken harness turns a control RED rather
 * than hiding inside an expected failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import type { SessionStore } from '../../session/store.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const SCENARIO = '88888888-8888-4888-8888-888888888888';
const REQUEST_ID = 'req-mg-goal-direction';

const happyFixture = JSON.parse(
  readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8'),
) as V2RunResponseEnvelope;

/** The production contract: the candidate must pass the real strict schema. */
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

function candidate(goal: Partial<CandidateModel['goal']>): CandidateModel {
  return {
    goal: {
      metric: 'Pro MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: null, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', ...goal,
    },
    constraints: [],
    options: [
      { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Raise to £55', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 55, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: goal.metric ?? 'Pro MRR', direction: 'positive', provenance: 'inferred' }],
  } as unknown as CandidateModel;
}

/** A goal to MAXIMISE, as the served P-S2 brief stated it. */
const maximise = (operator: '>=' | '>') => candidate({ operator });
/** A goal to MINIMISE: same model, a quantity the user wants to keep down. */
const minimise = (operator: '<=' | '<', metric = 'Monthly churn rate') =>
  candidate({ metric, operator, value: 10, unit: '%' });

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run the analysis now.' }],
      session_id: SCENARIO,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      scenario_id: SCENARIO, message: 'Run the analysis now.', turn_class: 'decide', stage: 'analyse',
    }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

type Node = { id: string; kind: string; label?: string } & Record<string, unknown>;

/** Candidate → register body → production loader → handler → the body PLoT receives. */
async function plotBodyFor(model: CandidateModel): Promise<{ body: Record<string, unknown>; registered: { nodes: Node[] } }> {
  const wire = { ...model, unknowns: [] };
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
  const out = await buildModelFromBrief(SCENARIO, 'Should we raise the Pro plan price from £49?', dispatch, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);

  // The register route's ingress (`GraphStateIngressSchema`) and persistence
  // projection are passthrough, so the stored bytes are the register body.
  const store = {
    loadGraph: async () => registered,
    loadGraphAndBriefText: async () => ({ graph: registered, briefText: null }),
  } as unknown as SessionStore;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, REQUEST_ID, store);

  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = structuredClone(payload);
    return Promise.resolve(structuredClone(happyFixture));
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  let thrown: unknown;
  try {
    await createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot })(makeInvocation());
  } catch (err) {
    thrown = err;
  }
  // The body is bound at the moment PLoT is called; post-run processing of the
  // canned envelope is not under test. A refusal BEFORE PLoT fails here.
  expect(run, `PLoT was never called: ${String(thrown)}`).toHaveBeenCalledOnce();
  return { body: captured as Record<string, unknown>, registered: registered as { nodes: Node[] } };
}

const goalIn = (graph: unknown, id: string): Node | undefined =>
  ((graph as { nodes: Node[] }).nodes).find((n) => n.id === id);

describe('the stated goal direction reaches the PLoT /v2/run body', () => {
  // ── CONTROLS: the harness reaches PLoT on the real path ────────────────────
  it('CONTROL (harness): the maximise goal reaches PLoT by id, with its CEE-minted frame intact', async () => {
    const { body } = await plotBodyFor(maximise('>='));
    expect(body.goal_node_id).toBe('pro_mrr');
    // Contrast control for "stripped on the way": a CEE-minted goal field that
    // NodeV3 DECLARES survives the whole path to the PLoT body.
    expect(goalIn(body.graph, 'pro_mrr')).toMatchObject({ kind: 'goal', goal_threshold_frame: 'level', goal_threshold_raw: 20000 });
  });

  it('CONTROL (harness): the minimise goal reaches PLoT by id, with its CEE-minted frame intact', async () => {
    const { body } = await plotBodyFor(minimise('<='));
    expect(body.goal_node_id).toBe('monthly_churn_rate');
    expect(goalIn(body.graph, 'monthly_churn_rate')).toMatchObject({ kind: 'goal', goal_threshold_frame: 'level', goal_threshold_raw: 10 });
  });

  it('POSITIVE CONTROL (the probe can see the key): a goal LABEL naming a reduction reaches PLoT as minimise', async () => {
    // The only producer today: the run_analysis label classifier. Proves this
    // probe observes `goal_direction` on this exact path when anything sends it.
    const { body } = await plotBodyFor(minimise('<=', 'Reduce monthly churn'));
    expect(body.goal_node_id).toBe('reduce_monthly_churn');
    expect(body.goal_direction).toBe('minimise');
  });

  it('CONTROL (the gap is real; inverts when the carrier lands): the stated operator is not carried on the goal node', async () => {
    const { registered } = await plotBodyFor(minimise('<='));
    const goal = goalIn(registered, 'monthly_churn_rate');
    expect(goal).toBeDefined();
    expect(Object.keys(goal ?? {}).filter((k) => /direction|operator|sense/.test(k))).toEqual([]);
  });

  it('CONTROL (inexpressible today): the strict schema cannot say "no direction was stated"', () => {
    const { operator: _dropped, ...goalWithout } = maximise('>=').goal;
    expect(strict({ ...maximise('>='), goal: goalWithout, unknowns: [] })).toBe(false);
    expect(strict({ ...maximise('>='), goal: { ...goalWithout, operator: null }, unknowns: [] })).toBe(false);
  });

  // ── SPEC (RED at 20fe36f5; needs the cross-lane carrier + forwarder) ───────
  for (const operator of ['<=', '<'] as const) {
    it.fails(`SPEC: a goal to stay ${operator} a level sends goal_direction=minimise (goal monthly_churn_rate)`, async () => {
      const { body } = await plotBodyFor(minimise(operator));
      expect(body.goal_node_id).toBe('monthly_churn_rate');
      expect(body.goal_direction).toBe('minimise');
    });
  }

  for (const operator of ['>=', '>'] as const) {
    it.fails(`SPEC: a goal to reach ${operator} a level sends goal_direction=maximise (goal pro_mrr)`, async () => {
      const { body } = await plotBodyFor(maximise(operator));
      expect(body.goal_node_id).toBe('pro_mrr');
      expect(body.goal_direction).toBe('maximise');
    });
  }
});
