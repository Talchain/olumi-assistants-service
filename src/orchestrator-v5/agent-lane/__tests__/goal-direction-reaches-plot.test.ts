/**
 * ⭐ THE STATED GOAL DIRECTION REACHES THE ENGINE FROM THE AGENT LANE.
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
 * `parseGoalDirection(body.goal_direction)`), never from a node. Before this change
 * CEE's run_analysis handler wrote that key only from `deriveEmittedGoalDirection` — a
 * classifier over the goal LABEL that emits `'minimise'` and nothing else — and the
 * candidate's stated `goal.operator` had no GraphV3 carrier.
 *
 * THE FIX, three seams, each proven load-bearing by a mutant:
 *   1. ADMISSION STAMP — `admit-model.ts` `attestedGoalDirection`: on the USER'S goal
 *      (`provenance: 'explicit'`) `>=`/`>` → `maximise`, `<=`/`<` → `minimise`.
 *   2. CARRIER — `cee-v3.ts` NodeV3 declares `goal_direction`, so the production
 *      loader's `GraphV3.safeParse` keeps it.
 *   3. FORWARDER — `run-analysis.ts` sends the goal node's attested sense ahead of the
 *      label classifier (provenance `attested_from_goal_operator`); the attested sense
 *      wins a disagreement, which is logged.
 *
 * Every assertion reads the payload PLoT RECEIVES, on the real path: strict schema
 * candidate → `buildModelFromBrief` → `/graph/register` body → the production
 * snapshot loader (`loadScenarioSnapshotForRunAnalysis`, which runs
 * `GraphV3.safeParse`) → `createRunAnalysisHandler` with PLoT faked. The goal is
 * bound by its node id.
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
import { log } from '../../../utils/telemetry.js';

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
const minimise = (operator: '<=' | '<', metric = 'Monthly churn rate', provenance = 'explicit') =>
  candidate({ metric, operator, value: 10, unit: '%', provenance });

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
type DirectionEvent = { level: 'info' | 'warn' } & Record<string, unknown>;

/** Candidate → register body → production loader → handler → the body PLoT receives. */
async function plotBodyFor(model: CandidateModel): Promise<{
  body: Record<string, unknown>;
  registered: { nodes: Node[] };
  directionEvents: DirectionEvent[];
}> {
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
  // The handler's own goal_direction records, read at the logger (the forwarder's
  // only disclosure channel), filtered by event name so no other log line is bound.
  const infoSpy = vi.spyOn(log, 'info');
  const warnSpy = vi.spyOn(log, 'warn');
  let thrown: unknown;
  try {
    await createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot })(makeInvocation());
  } catch (err) {
    thrown = err;
  }
  const directionEvents: DirectionEvent[] = [];
  for (const [level, spy] of [['info', infoSpy], ['warn', warnSpy]] as const) {
    for (const [first] of spy.mock.calls as unknown[][]) {
      const rec = first as Record<string, unknown> | undefined;
      if (typeof rec?.event === 'string' && rec.event.startsWith('cee.goal_direction.')) directionEvents.push({ level, ...rec });
    }
  }
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  // The body is bound at the moment PLoT is called; post-run processing of the
  // canned envelope is not under test. A refusal BEFORE PLoT fails here.
  expect(run, `PLoT was never called: ${String(thrown)}`).toHaveBeenCalledOnce();
  return { body: captured as Record<string, unknown>, registered: registered as { nodes: Node[] }, directionEvents };
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
    // The label classifier is still live, and this probe observes `goal_direction`
    // on this exact path whatever sends it. The stated `<=` agrees with the label.
    const { body } = await plotBodyFor(minimise('<=', 'Reduce monthly churn'));
    expect(body.goal_node_id).toBe('reduce_monthly_churn');
    expect(body.goal_direction).toBe('minimise');
  });

  it('CARRIER: the stated SENSE is on the goal node from registration to the PLoT graph; the raw operator is not', async () => {
    const { registered, body } = await plotBodyFor(minimise('<='));
    const stored = goalIn(registered, 'monthly_churn_rate');
    expect(stored).toBeDefined();
    // Bound by identity: the goal node, the one sense key, the stated value.
    expect(Object.keys(stored ?? {}).filter((k) => /direction|operator|sense/.test(k))).toEqual(['goal_direction']);
    expect(stored?.goal_direction).toBe('minimise');
    // …and it survives the production loader's GraphV3.safeParse into the graph PLoT gets.
    expect(goalIn(body.graph, 'monthly_churn_rate')?.goal_direction).toBe('minimise');
  });

  it('CONTROL (inexpressible today): the strict schema cannot say "no direction was stated"', () => {
    const { operator: _dropped, ...goalWithout } = maximise('>=').goal;
    expect(strict({ ...maximise('>='), goal: goalWithout, unknowns: [] })).toBe(false);
    expect(strict({ ...maximise('>='), goal: { ...goalWithout, operator: null }, unknowns: [] })).toBe(false);
  });

  // ── SPEC: the user's stated operator becomes PLoT's request-level sense ────
  for (const operator of ['<=', '<'] as const) {
    it(`SPEC: a goal to stay ${operator} a level sends goal_direction=minimise (goal monthly_churn_rate)`, async () => {
      const { body, directionEvents } = await plotBodyFor(minimise(operator));
      expect(body.goal_node_id).toBe('monthly_churn_rate');
      expect(body.goal_direction).toBe('minimise');
      // Recorded as ATTESTED, not as derived from the label (the label names no direction).
      expect(directionEvents).toEqual([
        expect.objectContaining({
          level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'minimise',
          goal_node_id: 'monthly_churn_rate', provenance: 'attested_from_goal_operator', label_derived: null,
        }),
      ]);
    });
  }

  for (const operator of ['>=', '>'] as const) {
    it(`SPEC: a goal to reach ${operator} a level sends goal_direction=maximise (goal pro_mrr)`, async () => {
      const { body, directionEvents } = await plotBodyFor(maximise(operator));
      expect(body.goal_node_id).toBe('pro_mrr');
      expect(body.goal_direction).toBe('maximise');
      expect(directionEvents).toEqual([
        expect.objectContaining({
          level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'maximise',
          goal_node_id: 'pro_mrr', provenance: 'attested_from_goal_operator',
        }),
      ]);
    });
  }

  // ── AN INFERRED GOAL IS NOT THE USER'S: nothing attested, label fallback only ─
  for (const provenance of ['inferred', 'ai_proposed'] as const) {
    it(`an ${provenance} goal is not stamped and sends nothing attested (label names no direction ⇒ no key)`, async () => {
      const { registered, body, directionEvents } = await plotBodyFor(minimise('<=', 'Monthly churn rate', provenance));
      expect(body.goal_node_id).toBe('monthly_churn_rate');
      expect(goalIn(registered, 'monthly_churn_rate')).not.toHaveProperty('goal_direction');
      expect('goal_direction' in body).toBe(false);
      expect(directionEvents).toEqual([]);
    });

    it(`an ${provenance} goal whose LABEL names a reduction still gets the label's minimise, recorded as derived`, async () => {
      // The discriminating twin: the fallback is live on an unattested goal, so the
      // "no key" above is the stamp being withheld, not the forwarder being dead.
      const { registered, body, directionEvents } = await plotBodyFor(minimise('<=', 'Reduce monthly churn', provenance));
      expect(goalIn(registered, 'reduce_monthly_churn')).not.toHaveProperty('goal_direction');
      expect(body.goal_direction).toBe('minimise');
      expect(directionEvents).toEqual([
        expect.objectContaining({
          level: 'info', event: 'cee.goal_direction.derived', goal_direction: 'minimise',
          goal_node_id: 'reduce_monthly_churn', provenance: 'derived_from_goal_label',
        }),
      ]);
    });
  }

  // ── DISAGREEMENT: the user's stated sense wins, and the disagreement is recorded ─
  it('a label that reads "reduce" with a stated ">=" sends maximise, and records the disagreement', async () => {
    const { registered, body, directionEvents } = await plotBodyFor(
      candidate({ metric: 'Reduce monthly churn', operator: '>=', value: 10, unit: '%' }),
    );
    expect(body.goal_node_id).toBe('reduce_monthly_churn');
    expect(body.goal_direction).toBe('maximise');
    expect(directionEvents).toEqual([
      expect.objectContaining({
        level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'maximise',
        provenance: 'attested_from_goal_operator', label_derived: 'minimise',
      }),
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.label_disagrees', goal_direction: 'maximise',
        label_derived: 'minimise', goal_node_id: 'reduce_monthly_churn',
      }),
    ]);
    // Available to a disclosure surface from the stored graph alone: the stated
    // sense sits beside the label that reads the other way.
    expect(goalIn(registered, 'reduce_monthly_churn')).toMatchObject({
      label: 'Reduce monthly churn', goal_direction: 'maximise',
    });
  });
});
