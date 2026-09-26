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
 *      label classifier (provenance `attested_from_goal_operator`).
 *
 * ⛔ AND WHERE THE STAMP IS NOT THE USER'S SENSE, BASE BEHAVIOUR (reviews 5844286953
 * and its mirror 5844849510). The operator is a required enum with no "not stated"
 * value: "reduce/cut X by at least N" read as `>=` (ROADMAP 1.52) or "grow revenue"
 * read as `<=` would each invert the ranking against base and end ISL's
 * `GOAL_DIRECTION_UNATTESTED` disclosure. ONE rule, both directions — a sense the
 * goal label's own reading contradicts is not attested (`labelContradictsSense`):
 *   · STAMP SITE — such a goal is NOT stamped, and its operator loss is recorded as on base;
 *   · FORWARDER — a stored stamp is set aside when the CURRENT label contradicts it
 *     (a rename), or when a CURRENT `goal_constraints` row on the goal states the
 *     other sense (a later success-target edit; the persisted stamp is never
 *     re-derived), and base's value is sent: the label's `minimise` for a
 *     reduction-worded label, no key for any other. Each set-aside is a `log.warn`.
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
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
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
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

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

/**
 * Candidate → register body → production loader → handler → the body PLoT receives.
 * `thenStored`, when given, is what happened to the stored graph between construction
 * and the Run (a success-target edit through the real writer, a label edit); the Run
 * then reads what it returns.
 */
async function plotBodyFor(
  model: CandidateModel,
  thenStored?: (registered: { nodes: Node[] }) => Promise<unknown> | unknown,
): Promise<{
  body: Record<string, unknown>;
  registered: { nodes: Node[] };
  stored: { nodes: Node[]; goal_constraints?: Record<string, unknown>[] };
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
  const stored = thenStored === undefined
    ? registered
    : await thenStored(structuredClone(registered) as { nodes: Node[] });
  const store = {
    loadGraph: async () => stored,
    loadGraphAndBriefText: async () => ({ graph: stored, briefText: null }),
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
  return {
    body: captured as Record<string, unknown>,
    registered: registered as { nodes: Node[] },
    stored: stored as { nodes: Node[]; goal_constraints?: Record<string, unknown>[] },
    directionEvents,
  };
}

const goalIn = (graph: unknown, id: string): Node | undefined =>
  ((graph as { nodes: Node[] }).nodes).find((n) => n.id === id);

/**
 * A success-target edit through the REAL writer (`goal_target_edit` → the
 * `add_constraint` handler → the persisted-base re-merge), on the stored graph.
 * Returns the graph the commit would persist.
 */
const successTargetEdit = (goalId: string, constraint_type: 'at_least' | 'at_most', raw_value: number, unit: string) =>
  async (graph: { nodes: Node[] }): Promise<unknown> => {
    const event = {
      kind: 'goal_target_edit' as const, goal_node_id: goalId, constraint_type, raw_value, unit,
      base_graph_hash: computeAnalysisAffectingGraphHash(graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]),
    };
    const result = await applyGoalTargetEdit({
      payload: { kind: 'system_event', turn_id: 'turn-mg-goal-direction-0001', scenario_id: SCENARIO, stage: 'analyse', event } as never,
      event: event as never,
      requestId: `${REQUEST_ID}-edit`,
      persistedGraph: graph,
      priorFacts: [],
    });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    return (result as { mutatedGraph: unknown }).mutatedGraph;
  };

/** The goal's CURRENT rows, by the goal's id. */
const goalRows = (graph: { goal_constraints?: Record<string, unknown>[] }, id: string): string[] =>
  (graph.goal_constraints ?? []).filter((r) => r.node_id === id).map((r) => `${String(r.operator)} ${String(r.value)}`);

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

  // ── A GOAL STATED ONLY AS A DIRECTION (no target number) still carries its sense ─
  // "Keep churn down" names a sense and no number. The no-target branch of the goal
  // node writes no threshold trio, and the sense must be stamped there too — the same
  // stamp, not a second path. The label names no direction, so the label classifier
  // cannot supply it: only the stamp can put it on the wire.
  for (const [operator, sense] of [['<=', 'minimise'], ['>=', 'maximise']] as const) {
    it(`a NO-TARGET goal stated as ${operator} (a direction, no number) registers and sends goal_direction=${sense}`, async () => {
      const { registered, body, directionEvents } = await plotBodyFor(candidate({
        metric: 'Monthly churn rate', operator, target_stated: false, value: null, unit: '%', provenance: 'explicit',
      }));
      const stored = goalIn(registered, 'monthly_churn_rate');
      expect(stored?.kind).toBe('goal');
      // Bound to the NO-TARGET branch by identity: no threshold trio was written.
      expect(stored).not.toHaveProperty('goal_threshold_raw');
      expect(stored).not.toHaveProperty('goal_threshold');
      expect(stored?.goal_direction).toBe(sense);
      expect(body.goal_node_id).toBe('monthly_churn_rate');
      expect(goalIn(body.graph, 'monthly_churn_rate')?.goal_direction).toBe(sense);
      expect(body.goal_direction).toBe(sense);
      expect(directionEvents).toEqual([
        expect.objectContaining({
          level: 'info', event: 'cee.goal_direction.attested', goal_direction: sense,
          goal_node_id: 'monthly_churn_rate', provenance: 'attested_from_goal_operator', label_derived: null,
        }),
      ]);
    });
  }

  // ── THE LIFT: a stated "at or below" goal carries its current level AND its sense ─
  // AI Quality's acceptance row (#69 5841701921): a `<=` goal with a baseline must be
  // scored on the LOWER tail. At CEE's seam that means both halves reach PLoT in one
  // request: the goal node's `observed_state.baseline` and the request's minimise.
  it('RED (lift): a "<=" goal with a stated current level sends observed_state.baseline AND goal_direction=minimise to PLoT', async () => {
    const { registered, body, directionEvents } = await plotBodyFor(candidate({
      metric: 'Monthly churn rate', operator: '<=', value: 10, unit: '%', provenance: 'explicit',
      baseline_known: true, baseline_value: 12, baseline_provenance: 'explicit',
    }));
    expect(goalIn(registered, 'monthly_churn_rate')).toMatchObject({
      goal_direction: 'minimise',
      observed_state: { value: 0.12, baseline: 0.12, unit: '%', source: 'brief_extraction', raw_value: 12, cap: 100 },
    });
    expect(body.goal_node_id).toBe('monthly_churn_rate');
    expect(body.goal_direction).toBe('minimise');
    expect(goalIn(body.graph, 'monthly_churn_rate')?.observed_state).toMatchObject({ baseline: 0.12, raw_value: 12, source: 'brief_extraction' });
    expect(directionEvents.map((e) => [e.event, e.goal_direction])).toEqual([['cee.goal_direction.attested', 'minimise']]);
  });

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

  // ── REVIEW 5844286953 — the reviewer's table, through the production path ───────
  // A goal whose own label reads as a REDUCTION, stated "at least" / "more than", is
  // the known sign-inversion fingerprint. It must get base's label-derived `minimise`,
  // never a `maximise` stamp; and neither the "<=" path this PR exists for nor a goal
  // whose label names no reduction may move.
  //
  // ── REVIEW 5844849510 — THE MIRROR: an INCREASE-worded goal read as "<=" / "<" ──
  // The same defect class in the other direction. `admit-model.ts` stamped `minimise`
  // for any explicit `<=`/`<` with no label check, and the forwarder's guard could not
  // see it (the old label reading returned nothing for an increase label). Base sends
  // NOTHING on these (the label classifier never emits `maximise`), so ISL runs its
  // maximiser and DISCLOSES `GOAL_DIRECTION_UNATTESTED`. One rule now closes both
  // directions: a stamp is attested only when the operator's sense does not contradict
  // the goal label's own reading (`readGoalLabelSense`, built on `deriveGoalIntent`).
  type Row = {
    metric: string; operator: '>=' | '>' | '<=' | '<'; value: number; unit: string; id: string;
    /** `null` ⇒ the key is ABSENT from the body (base: ISL's unattested maximiser, disclosed). */
    sent: 'maximise' | 'minimise' | null; stamped: 'maximise' | 'minimise' | null;
    /** `null` ⇒ no `cee.goal_direction.*` record at all (base). */
    event: 'cee.goal_direction.attested' | 'cee.goal_direction.derived' | null;
  };
  const TABLE: Row[] = [
    // RED at 10fa86cf: each sent `maximise` (a stamp + a warn only).
    { metric: 'Reduce monthly churn', operator: '>=', value: 2, unit: '%', id: 'reduce_monthly_churn', sent: 'minimise', stamped: null, event: 'cee.goal_direction.derived' },
    { metric: 'Cut costs', operator: '>=', value: 10, unit: '%', id: 'cut_costs', sent: 'minimise', stamped: null, event: 'cee.goal_direction.derived' },
    { metric: 'Lower churn', operator: '>', value: 3, unit: '%', id: 'lower_churn', sent: 'minimise', stamped: null, event: 'cee.goal_direction.derived' },
    // RED at f27c2de1 (review 5844849510): each was stamped and sent `minimise`, info only.
    { metric: 'Maximise profit', operator: '<=', value: 50000, unit: 'GBP', id: 'maximise_profit', sent: null, stamped: null, event: null },
    { metric: 'Grow revenue', operator: '<=', value: 20, unit: '%', id: 'grow_revenue', sent: null, stamped: null, event: null },
    { metric: 'Increase MRR', operator: '<=', value: 30000, unit: 'GBP', id: 'increase_mrr', sent: null, stamped: null, event: null },
    { metric: 'Boost conversion', operator: '<', value: 5, unit: '%', id: 'boost_conversion', sent: null, stamped: null, event: null },
    // CONTROLS: the reason for this PR, the served P-S2 maximise, and labels with no direction word
    // (they follow the operator in BOTH senses, including the strict `<` the row above withholds).
    { metric: 'Monthly churn rate', operator: '<=', value: 10, unit: '%', id: 'monthly_churn_rate', sent: 'minimise', stamped: 'minimise', event: 'cee.goal_direction.attested' },
    { metric: 'Pro MRR', operator: '>=', value: 20000, unit: 'GBP', id: 'pro_mrr', sent: 'maximise', stamped: 'maximise', event: 'cee.goal_direction.attested' },
    { metric: 'Monthly churn rate', operator: '>=', value: 2, unit: '%', id: 'monthly_churn_rate', sent: 'maximise', stamped: 'maximise', event: 'cee.goal_direction.attested' },
    { metric: 'Conversion rate', operator: '<', value: 5, unit: '%', id: 'conversion_rate', sent: 'minimise', stamped: 'minimise', event: 'cee.goal_direction.attested' },
  ];
  for (const row of TABLE) {
    const says = row.sent === null ? 'sends NO goal_direction' : `sends ${row.sent}`;
    const how = row.stamped === null ? (row.sent === null ? 'not stamped, as base' : 'not stamped, label-derived') : `stamped ${row.stamped}`;
    it(`TABLE: "${row.metric}" ${row.operator} ${row.value} ${row.unit} ${says} (${how})`, async () => {
      const model = candidate({ metric: row.metric, operator: row.operator, value: row.value, unit: row.unit });
      const { registered, body, directionEvents } = await plotBodyFor(model);
      expect(body.goal_node_id).toBe(row.id);
      if (row.sent === null) expect('goal_direction' in body, `sent ${String(body.goal_direction)}`).toBe(false);
      else expect(body.goal_direction).toBe(row.sent);
      // STAMP SITE, bound by the goal's id and its label.
      const stored = goalIn(registered, row.id);
      expect(stored).toMatchObject({ kind: 'goal', label: row.metric });
      if (row.stamped === null) expect(stored).not.toHaveProperty('goal_direction');
      else expect(stored?.goal_direction).toBe(row.stamped);
      // An unstamped goal's operator loss is recorded, exactly as on base; a stamped one's is not.
      const operatorLoss = admitCandidateModel(model).loss
        .filter((l) => l.field_path === `nodes[${row.id}].goal_operator`).map((l) => l.before);
      expect(operatorLoss).toEqual(row.stamped === null ? [row.operator] : []);
      // At most one record, at info: nothing was set aside at the forwarder.
      expect(directionEvents).toEqual(row.event === null ? [] : [
        expect.objectContaining({ level: 'info', event: row.event, goal_direction: row.sent, goal_node_id: row.id }),
      ]);
    });
  }

  // ── The contradicted goal's stated current level: withheld, and the reason said
  // truthfully. With no stamp, nothing tells the engine which tail to score, so the
  // level cannot be used (as on base). The sentence must name the real reason — the
  // goal's own words — not "Olumi's reading, not something you stated" (it WAS stated)
  // and not an "at most N" repair (that would still contradict the words).
  for (const [operator, phrase] of [['<=', 'stay at or below 20'], ['<', 'stay below 20']] as const) {
    it(`an increase-worded "${operator}" goal with a stated current level: not stamped, the level withheld, and the reason is its own words`, () => {
      const m = admitCandidateModel(candidate({
        metric: 'Grow revenue', operator, value: 20, unit: '%', baseline_known: true, baseline_value: 12, baseline_provenance: 'explicit',
      }));
      const goal = m.nodes.find((n) => n.id === 'grow_revenue');
      expect(goal?.kind).toBe('goal');
      expect(goal).not.toHaveProperty('goal_direction');
      expect(goal).not.toHaveProperty('observed_state');
      const said = m.loss.filter((l) => l.field_path === 'nodes[grow_revenue].observed_state.baseline').map((l) => l.reason);
      expect(said).toHaveLength(1);
      expect(said[0]).toContain(phrase);
      expect(said[0]).toContain('its own words point the other way');
      expect(said[0]).not.toContain("Olumi's reading");
      expect(said[0]).not.toContain('at most');
    });
  }

  // ── FORWARDER GUARD (defence in depth): a STORED maximise beside a label that reads
  // as a reduction — a goal renamed after construction (a label is an editable
  // field; `goal_direction` is not, so the stamp survives the rename). The stamp site
  // cannot see this graph, so only the forwarder can keep base behaviour here.
  it('FORWARDER GUARD: a stored maximise stamp on a goal whose label now reads as a reduction sends the label\'s minimise, and warns', async () => {
    const { stored, body, directionEvents } = await plotBodyFor(maximise('>='), (g) => {
      const goal = goalIn(g, 'pro_mrr');
      if (goal === undefined) throw new Error('fixture: no pro_mrr goal');
      goal.label = 'Cut Pro plan churn';
      return g;
    });
    // Precondition, by identity: the stamp really is on the stored goal beside the new label.
    expect(goalIn(stored, 'pro_mrr')).toMatchObject({ kind: 'goal', label: 'Cut Pro plan churn', goal_direction: 'maximise' });
    expect(body.goal_node_id).toBe('pro_mrr');
    expect(body.goal_direction).toBe('minimise');
    expect(directionEvents).toEqual([
      expect.objectContaining({
        level: 'info', event: 'cee.goal_direction.derived', goal_direction: 'minimise',
        goal_node_id: 'pro_mrr', provenance: 'derived_from_goal_label',
      }),
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.label_disagrees', goal_direction: 'minimise',
        stamped: 'maximise', label_derived: 'minimise', label_sense: 'minimise', goal_node_id: 'pro_mrr',
      }),
    ]);
  });

  // ── FORWARDER GUARD, THE MIRROR (review 5844849510): a STORED minimise beside a label
  // that now reads as an INCREASE (a "<=" churn goal renamed to a growth goal). Base
  // sends nothing for an increase label, so the key is ABSENT and ISL keeps its
  // `GOAL_DIRECTION_UNATTESTED` disclosure; the set-aside is a warn naming the stamp.
  it('FORWARDER GUARD (mirror): a stored minimise stamp on a goal whose label now reads as an INCREASE is set aside — no key sent (base), and warns', async () => {
    const { stored, body, directionEvents } = await plotBodyFor(minimise('<='), (g) => {
      const goal = goalIn(g, 'monthly_churn_rate');
      if (goal === undefined) throw new Error('fixture: no monthly_churn_rate goal');
      goal.label = 'Grow Pro MRR';
      return g;
    });
    // Precondition, by identity: the stamp really is on the stored goal beside the new label.
    expect(goalIn(stored, 'monthly_churn_rate')).toMatchObject({ kind: 'goal', label: 'Grow Pro MRR', goal_direction: 'minimise' });
    expect(body.goal_node_id).toBe('monthly_churn_rate');
    expect('goal_direction' in body, `sent ${String(body.goal_direction)}`).toBe(false);
    expect(directionEvents).toEqual([
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.label_disagrees', goal_direction: null,
        stamped: 'minimise', label_sense: 'maximise', goal_node_id: 'monthly_churn_rate',
      }),
    ]);
  });

  it('FORWARDER CONTROL: a stored minimise on a label renamed to one with NO direction word keeps following the operator', async () => {
    const { stored, body, directionEvents } = await plotBodyFor(minimise('<='), (g) => {
      const goal = goalIn(g, 'monthly_churn_rate');
      if (goal === undefined) throw new Error('fixture: no monthly_churn_rate goal');
      goal.label = 'Pro plan churn';
      return g;
    });
    expect(goalIn(stored, 'monthly_churn_rate')).toMatchObject({ kind: 'goal', label: 'Pro plan churn', goal_direction: 'minimise' });
    expect(body.goal_direction).toBe('minimise');
    expect(directionEvents).toEqual([
      expect.objectContaining({ level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'minimise', goal_node_id: 'monthly_churn_rate' }),
    ]);
  });

  // ── NON-BLOCKING 2: the stamp is never re-derived after construction ───────────
  // A later success-target edit rewrites the goal's threshold and writes a
  // `goal_constraints` row with its own operator, and leaves `goal_direction` as it
  // was. Probed at 10fa86cf (scratchpad nb2-probe-10fa86cf.txt): a stated "<= 10%"
  // churn goal edited to "at least 5%" sent `minimise` beside a `>=` row. The stamp
  // is forwarded only when it agrees with the goal's CURRENT rows, read at request
  // time; otherwise base behaviour.
  it('NB2: a "<=" churn goal edited to "at least 5 %" does not send the stale minimise (base: the label names no direction ⇒ no key), and warns', async () => {
    const { stored, body, directionEvents } = await plotBodyFor(
      minimise('<='), successTargetEdit('monthly_churn_rate', 'at_least', 5, '%'),
    );
    // Precondition: the persisted copy is stale — the stamp survived, the goal's row says `>=`.
    expect(goalIn(stored, 'monthly_churn_rate')).toMatchObject({ goal_direction: 'minimise', goal_threshold_raw: 5 });
    expect(goalRows(stored, 'monthly_churn_rate')).toEqual(['>= 5']);
    expect(body.goal_node_id).toBe('monthly_churn_rate');
    expect('goal_direction' in body).toBe(false);
    expect(directionEvents).toEqual([
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.stamp_disagrees_with_goal_operator',
        stamped: 'minimise', goal_row_operators: ['>='], goal_node_id: 'monthly_churn_rate',
      }),
    ]);
  });

  it('NB2 mirror: a ">=" Pro MRR goal given an "at most" row does not send the stale maximise (ISL\'s disclosure stays), and warns', async () => {
    const { stored, body, directionEvents } = await plotBodyFor(
      maximise('>='), successTargetEdit('pro_mrr', 'at_most', 30000, 'GBP'),
    );
    expect(goalIn(stored, 'pro_mrr')).toMatchObject({ goal_direction: 'maximise' });
    expect(goalRows(stored, 'pro_mrr')).toEqual(['<= 30000']);
    expect(body.goal_node_id).toBe('pro_mrr');
    expect('goal_direction' in body).toBe(false);
    expect(directionEvents).toEqual([
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.stamp_disagrees_with_goal_operator',
        stamped: 'maximise', goal_row_operators: ['<='], goal_node_id: 'pro_mrr',
      }),
    ]);
  });

  for (const [label, model, edit, id, sense, rows] of [
    ['"<=" churn goal edited to "at most 8 %"', minimise('<='), successTargetEdit('monthly_churn_rate', 'at_most', 8, '%'), 'monthly_churn_rate', 'minimise', ['<= 8']],
    ['">=" Pro MRR goal edited to "at least 25000"', maximise('>='), successTargetEdit('pro_mrr', 'at_least', 25000, 'GBP'), 'pro_mrr', 'maximise', ['>= 25000']],
  ] as const) {
    it(`NB2 CONTROL: a ${label} keeps its attested ${sense} (an agreeing row is not a disagreement)`, async () => {
      const { stored, body, directionEvents } = await plotBodyFor(model, edit);
      expect(goalRows(stored, id)).toEqual([...rows]);
      expect(body.goal_node_id).toBe(id);
      expect(body.goal_direction).toBe(sense);
      expect(directionEvents).toEqual([
        expect.objectContaining({ level: 'info', event: 'cee.goal_direction.attested', goal_direction: sense, goal_node_id: id }),
      ]);
    });
  }
});
