/**
 * ⭐ WHAT THE USER SAYS A FACTOR OF A PRODUCT DOES AT A PRICE — ONE typed fact, ONE proposal, ONE approval
 * (rulings: AIQ #70 5854577702 + 5854580520, DL 5854587915, MG interface 5854594598; shape AIQ 5854607789 + Runtime
 * 5854612859).
 *
 * FIXTURE: the served graph behind AI Conversation's U3 receipt on CEE 79c299a (`served-u3-receipt-79c299a.json`), built
 * from Paul's brief. Goal `mrr` carries the product `pro_plan_price × pro_paying_subscribers`; today's subscribers are
 * 250 and Olumi's (`cee_inference`); the options set £59 (`raise_pro_price_with_ai`), £49 and £54 on the price; the churn
 * LIMIT is `agent-lane:monthly_churn:<=` 10. The user then types "We have 250 Pro subscribers; at £59 about 30 would leave."
 *
 * THE PATH: the Agent's real `dispatchTool` → `createAgentCapabilities` (proposal held in the real `ProposalStore`) →
 * `authorise_change` → `/graph/register` (a fake store enforcing the register's contract gate and CAS, revision = the
 * REAL analysis hash) → the REAL writers and the REAL `run_analysis` handler (PLoT faked) on the stored bytes. Every
 * assertion binds by node id and the literal interface; the file imports no module this slice adds, so it runs at base.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, toolsFor, MUTATION_TOOLS, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import { userWordsOf } from '../stated-by-user.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { normaliseGraphNodeKindField } from '../../graph-registration/normalise-node-kind.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { applyOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { ALLOWED_NODE_FIELD_ROOTS } from '../../graph-management/field-safety.js';
import {
  collectLeaderEstimatedTargetIds,
  collectUnmeasuredConstraintTargetIds,
  deriveConstraintVerdict,
  readRatifiedConstraints,
} from '../../../orchestrator/context/constraint-feasibility.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const TOOL = 'propose_stated_response';
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d1';
const GOAL = 'mrr';
const OPERAND = 'pro_paying_subscribers';
const PRICE = 'pro_plan_price';
const AT_59 = 'raise_pro_price_with_ai';
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months, should we increase the Pro plan price from £49 to £59 per month? '
  + 'We want to keep monthly churn under 10%.';
const SAID = 'We have 250 Pro subscribers; at £59 about 30 would leave.';
/** What the user TYPED in this conversation, bound as the route binds it (`ctx.user_text`). */
const WORDS = userWordsOf([BRIEF], SAID);

/** The interface, exactly (AIQ 5854607789 + Runtime 5854612859): level = the count REMAINING at that price. */
const FACT = {
  operand_node_id: OPERAND,
  today: { value: 250, unit: 'subscribers', by: 'user' },
  at: [{ price_node_id: PRICE, price: 59, level: 220, by: 'user' }],
};

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: Record<string, unknown>[]; goal_constraints?: unknown[] } & Record<string, unknown>;

const served = (JSON.parse(readFileSync(new URL('./fixtures/served-u3-receipt-79c299a.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodeOf = (g: Graph, id: string): Node => g.nodes.find((n) => n.id === id)!;
/** The same model where the brief itself stated today's 250 (the operand's count is ALREADY the user's). */
const usersTodayGraph = (): Graph => {
  const g = clone(served);
  const os = nodeOf(g, OPERAND).observed_state!;
  os.source = 'brief_extraction';
  delete os.extractionType;
  return g;
};

const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');

/**
 * A scenario store that behaves like the read and register routes: the read returns the stored graph with its REAL
 * analysis hash (`computeAnalysisAffectingGraphHash`, what `authorise_change` binds a proposal to) and an identity hash;
 * a register whose expectations are not the stored graph's is refused `GRAPH_STALE` and writes nothing.
 */
function scenarioStore(initial: Graph, opts: { beforeRegister?: (s: { mutate: (f: (g: Graph) => void) => void }) => void } = {}) {
  let graph = clone(initial);
  const registers: Record<string, unknown>[] = [];
  const mutate = (f: (g: Graph) => void): void => { const g = clone(graph); f(g); graph = g; };
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: { value: identityOf(graph) } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string; expected_graph_identity_hash?: string };
      registers.push(b as unknown as Record<string, unknown>);
      opts.beforeRegister?.({ mutate });
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if ((b.expected_graph_hash !== undefined && b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never))
        || (b.expected_graph_identity_hash !== undefined && b.expected_graph_identity_hash !== identityOf(graph))) {
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      graph = b.graph;
      return { status: 200, json: { graph_hash: computeAnalysisAffectingGraphHash(graph as never), model_version: { version_number: registers.length + 1, version_id: `v${registers.length}`, mutation_id: `m${registers.length}` } } };
    }
    return { status: 500, json: {} };
  };
  return { dispatch, registers, mutate, graph: () => graph };
}

function setup(initial: Graph = served, opts: Parameters<typeof scenarioStore>[1] = {}, said: string = WORDS) {
  const store = scenarioStore(initial, opts);
  const proposals = new ProposalStore();
  const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-stated-response', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { ...store, proposals, caps, call };
}

/** What the Agent passes for SAID: typed fields only. */
const T = { operand_label: 'Pro paying subscribers', today: { value: 250, unit: 'subscribers' }, at: [{ price: 59, lost: 30 }] };

/** The real `run_analysis` handler over a stored graph, PLoT faked; returns the request PLoT received and the run fact. */
async function runOn(graph: Graph): Promise<{ request: { graph: Graph; goal_constraints?: unknown }; fact: Record<string, unknown> | undefined }> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: GOAL,
    goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  return { request: run.mock.calls[0]![0] as unknown as { graph: Graph }, fact: (outcome as { fact?: Record<string, unknown> }).fact };
}

/** Every node's `observed_state`, anywhere, that carries the fact — it must never be written there. */
const inObservedState = (g: Graph): string[] =>
  g.nodes.filter((n) => n.observed_state !== undefined && JSON.stringify(n.observed_state).includes('operand_node_id')).map((n) => n.id);

async function proposeAndApprove(s: ReturnType<typeof setup>, args: Record<string, unknown> = T) {
  const proposed = await s.call(TOOL, args);
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
  return { proposed, applied };
}

describe('the tool is declared, mutating, and approved by one chip', () => {
  it('propose_stated_response is an Agent tool, a MUTATION tool (never offered in preview), and its approval is one chip', () => {
    expect(toolsFor('full').map((t) => t.name)).toContain(TOOL);
    expect(MUTATION_TOOLS).toContain(TOOL);
    expect(toolsFor('preview').map((t) => t.name)).not.toContain(TOOL);
    const chips = approvalChipsFor([{ name: TOOL, ok: true, mutated: false, proposal_id: 'prop_0123456789abcdef' }]);
    expect(chips[0]).toMatchObject({ id: approvalChipIdFor('prop_0123456789abcdef'), label: 'Record what you said', message: 'Yes, record that.' });
  });

  it('the node field is never AI-editable (an update_node naming it is refused by field safety)', () => {
    expect(ALLOWED_NODE_FIELD_ROOTS.has('stated_response')).toBe(false);
    expect(ALLOWED_NODE_FIELD_ROOTS.has('label'), 'CONTROL: the probe reads the real allowlist').toBe(true);
  });
});

describe('row 1 — both stated → ONE proposal → ONE approval → the committed fact IS the interface, bound by id, by the user', () => {
  it('RED: "We have 250 Pro subscribers; at £59 about 30 would leave." records exactly the interface on the goal carrying the identity', async () => {
    const s = setup();
    expect(nodeOf(s.graph(), OPERAND).observed_state, 'PREMISE: today is Olumi\'s estimate').toMatchObject({ raw_value: 250, source: 'cee_inference' });
    expect(nodeOf(s.graph(), GOAL).nonlinear_identity, 'PREMISE: MRR is the product').toMatchObject({ operation: 'product', factor_ids: [PRICE, OPERAND] });

    const proposed = await s.call(TOOL, T);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.mutated).toBe(false);
    expect(s.registers, 'a proposal writes nothing').toHaveLength(0);
    expect(s.proposals.outstanding(SCENARIO, null).map((p) => p.proposal_id), 'ONE held proposal').toEqual([proposed.proposal_id]);
    expect(String(proposed.public_label)).toContain('250 subscribers today');
    expect(String(proposed.public_label)).toContain('at £59/month, 220 stay (30 leave)');

    const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(s.registers, 'ONE approval → ONE registration').toHaveLength(1);

    const stored = s.graph();
    // Exactly the interface — no extra key, no graph hash — on the node carrying `nonlinear_identity`, bound by id.
    expect(nodeOf(stored, GOAL).stated_response).toStrictEqual(FACT);
    expect(stored.nodes.filter((n) => n.stated_response !== undefined).map((n) => n.id)).toEqual([GOAL]);
    expect(JSON.stringify(nodeOf(stored, GOAL).stated_response)).not.toMatch(/hash/);
    // Not observed_state: a conditional level is not today.
    expect(inObservedState(stored)).toEqual([]);
    expect(nodeOf(stored, GOAL).observed_state).toStrictEqual(nodeOf(served, GOAL).observed_state);
    // AIQ (b): the SAME approval made today's count the user's — the value path's stamp, the level itself unchanged.
    const os = nodeOf(stored, OPERAND).observed_state!;
    expect(os).toMatchObject({ raw_value: 250, value: 0.125, unit: 'subscribers', source: USER_EDIT_SOURCE });
    expect(os).not.toHaveProperty('extractionType');
    // The declaration survives the turn-path parse (`GraphV3`, which strips every undeclared key).
    const parsed = GraphV3.safeParse(stored);
    expect(parsed.success).toBe(true);
    expect((parsed.data!.nodes.find((n) => n.id === GOAL) as Record<string, unknown>).stated_response).toStrictEqual(FACT);
    // A retry is the first result, never a second write.
    const again = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(again).toMatchObject({ already_applied: true });
    expect(s.registers).toHaveLength(1);
  });

  it('RED: "remaining" is accepted as the user put it ("220 would stay") and stores the same level', async () => {
    const s = setup(served, {}, userWordsOf([BRIEF], 'We have 250 Pro subscribers; at £59 about 220 would stay.'));
    const { applied } = await proposeAndApprove(s, { ...T, at: [{ price: 59, remaining: 220 }] });
    expect(applied).toMatchObject({ ok: true, applied: true });
    expect(nodeOf(s.graph(), GOAL).stated_response).toStrictEqual(FACT);
  });

  it('RED: a different stated count than Olumi\'s estimate is written as the user\'s through the value path\'s own normaliser', async () => {
    const s = setup(served, {}, userWordsOf([BRIEF], 'We have 300 Pro subscribers; at £59 about 30 would leave.'));
    const { applied } = await proposeAndApprove(s, { ...T, today: { value: 300, unit: 'subscribers' } });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true });
    expect(nodeOf(s.graph(), GOAL).stated_response).toStrictEqual({ ...FACT, today: { ...FACT.today, value: 300 }, at: [{ ...FACT.at[0], level: 270 }] });
    // 250 ↔ 0.125 is the frame the factor carries: 300 is 0.15 on it.
    expect(nodeOf(s.graph(), OPERAND).observed_state).toMatchObject({ raw_value: 300, value: 0.15, source: USER_EDIT_SOURCE });
  });
});

describe('row 2 — today NOT stated while the model holds Olumi\'s estimate → refused, and the Agent asks for today\'s count', () => {
  const ONLY_RESPONSE = userWordsOf([BRIEF], 'At £59 about 30 would leave.');

  it('RED: today left out → refused, nothing held, and the ask names the count', async () => {
    const s = setup(served, {}, ONLY_RESPONSE);
    const r = await s.call(TOOL, { operand_label: 'Pro paying subscribers', at: [{ price: 59, lost: 30 }] });
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'today_unstated' });
    expect(String(r.detail)).toContain('How many Pro paying subscribers do you have today?');
    expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(s.registers).toHaveLength(0);
  });

  it('RED: today passed as Olumi\'s own 250 (never typed by the user) → refused as not the user\'s, with the same ask', async () => {
    const s = setup(served, {}, ONLY_RESPONSE);
    const r = await s.call(TOOL, T);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_in_users_words' });
    expect(String(r.detail)).toContain('How many Pro paying subscribers do you have today?');
    expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('CONTRAST: when the model ALREADY holds today\'s count as the user\'s, leaving it out is fine and nothing is re-written on it', async () => {
    const s = setup(usersTodayGraph(), {}, ONLY_RESPONSE);
    const { applied } = await proposeAndApprove(s, { operand_label: 'Pro paying subscribers', at: [{ price: 59, lost: 30 }] });
    expect(applied).toMatchObject({ ok: true, applied: true });
    expect(nodeOf(s.graph(), GOAL).stated_response).toStrictEqual(FACT);
    expect(nodeOf(s.graph(), OPERAND)).toStrictEqual(nodeOf(usersTodayGraph(), OPERAND));
  });
});

describe('row 3 — a response figure the user did not write → refused (grounding on the user\'s own typed words)', () => {
  it.each([
    ['a count the user never wrote (40)', WORDS, { ...T, at: [{ price: 59, lost: 40 }] }],
    ['a remaining the Agent worked out (220 from "30 would leave")', WORDS, { ...T, at: [{ price: 59, remaining: 220 }] }],
    ['a percentage read as a count ("30%")', userWordsOf([], 'We have 250 Pro subscribers; at £59 about 30% would leave.'), T],
    ['a price in another currency ("$59")', userWordsOf([], 'We have 250 Pro subscribers; at $59 about 30 would leave.'), T],
  ])('RED: %s', async (_name, said, args) => {
    const s = setup(served, {}, said);
    const r = await s.call(TOOL, args);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_in_users_words' });
    expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(s.registers).toHaveLength(0);
  });

  it('RED: both lost AND remaining, or neither → refused (one of them, as the user put it)', async () => {
    const s = setup();
    expect(await s.call(TOOL, { ...T, at: [{ price: 59, lost: 30, remaining: 220 }] })).toMatchObject({ ok: false, refusal: 'response_unstated' });
    expect(await s.call(TOOL, { ...T, at: [{ price: 59 }] })).toMatchObject({ ok: false, refusal: 'response_unstated' });
  });

  it('RED: a price no option sets → refused (the reader binds each price to a current option\'s price)', async () => {
    const s = setup(served, {}, userWordsOf([BRIEF], 'We have 250 Pro subscribers; at £69 about 30 would leave.'));
    expect(await s.call(TOOL, { ...T, at: [{ price: 69, lost: 30 }] })).toMatchObject({ ok: false, refusal: 'no_option_at_price' });
  });

  it('RED: a factor that is not one of the product\'s → refused', async () => {
    const s = setup();
    expect(await s.call(TOOL, { ...T, operand_label: 'Monthly new Pro subscribers' })).toMatchObject({ ok: false, refusal: 'not_a_product_factor' });
  });
});

describe('row 4 — the stated response touches ONE field: structure, edges, levels, the churn limit and its verdict are byte-identical', () => {
  const verdictOf = (g: Graph, leader: string) => {
    const ratified = readRatifiedConstraints(g);
    // One fixed engine answer: the leader's churn limit scored 0.4, joint 0.3.
    const envelope = { results: [{ option_id: leader, constraint_probabilities: { [CHURN_LIMIT]: 0.4 }, probability_of_joint_goal: 0.3 }] };
    const estimated = collectLeaderEstimatedTargetIds(g, ratified, leader);
    return {
      ratified, estimated: [...estimated], unmeasured: [...collectUnmeasuredConstraintTargetIds(g.goal_constraints, g)],
      verdict: deriveConstraintVerdict(envelope, ratified, leader, undefined, estimated),
    };
  };

  it('RED: with today\'s count already the user\'s, the ONLY stored change is `stated_response` on the goal — and the engine request is byte-identical', async () => {
    const before = usersTodayGraph();
    const s = setup(before);
    const { applied } = await proposeAndApprove(s);
    expect(applied).toMatchObject({ ok: true, applied: true });
    const after = s.graph();

    // The whole stored graph, minus the one field, equals the graph before — every node, edge, level and the limit.
    const { stated_response: fact, ...goalWithout } = nodeOf(after, GOAL);
    expect(fact).toStrictEqual(FACT);
    expect({ ...after, nodes: after.nodes.map((n) => (n.id === GOAL ? goalWithout : n)) }).toStrictEqual(before);
    expect(after.edges).toStrictEqual(before.edges);
    expect(after.goal_constraints).toStrictEqual(before.goal_constraints);
    expect(computeAnalysisAffectingGraphHash(after as never)).toBe(computeAnalysisAffectingGraphHash(before as never));

    // The churn limit's verdict, on the same engine answer, for every option as leader.
    for (const leader of before.nodes.filter((n) => n.kind === 'option').map((n) => n.id)) {
      expect(verdictOf(after, leader)).toStrictEqual(verdictOf(before, leader));
    }
    expect(verdictOf(before, AT_59).ratified.map((c) => c.constraint_id), 'CONTROL: the probe reads the churn limit').toEqual([CHURN_LIMIT]);

    // What the engine receives, byte for byte, through the production parse (`loadScenarioSnapshotForRunAnalysis` parses GraphV3).
    const engineBefore = await runOn(GraphV3.parse(before) as unknown as Graph);
    const engineAfter = await runOn(GraphV3.parse(after) as unknown as Graph);
    expect(JSON.stringify(engineAfter.request)).toBe(JSON.stringify(engineBefore.request));
  });

  it('RED: with Olumi\'s estimate for today, the only other change is the operand\'s author (the value path\'s stamp) — its level and every edge unchanged', async () => {
    const s = setup(served);
    await proposeAndApprove(s);
    const after = s.graph();
    const operandBefore = nodeOf(served, OPERAND);
    const operandAfter = nodeOf(after, OPERAND);
    expect(operandAfter.observed_state).toMatchObject(
      Object.fromEntries(['value', 'raw_value', 'unit'].map((k) => [k, operandBefore.observed_state![k]])),
    );
    expect(after.edges).toStrictEqual(served.edges);
    expect(after.goal_constraints).toStrictEqual(served.goal_constraints);
    for (const n of served.nodes.filter((x) => x.id !== GOAL && x.id !== OPERAND)) expect(nodeOf(after, n.id)).toStrictEqual(n);
    expect(computeAnalysisAffectingGraphHash(after as never)).toBe(computeAnalysisAffectingGraphHash(served as never));
  });
});

describe('row 5 — the fact never reaches the engine (the CEE → PLoT run request)', () => {
  it('RED: the stored fact survives the production parse, and the PLoT request carries no trace of it', async () => {
    const s = setup(usersTodayGraph());
    await proposeAndApprove(s);
    const parsed = GraphV3.parse(s.graph()) as unknown as Graph;
    // POSITIVE CONTROL: the graph handed to `run_analysis` DOES carry it — so its absence below is the strip, not the parse.
    expect(nodeOf(parsed, GOAL).stated_response).toStrictEqual(FACT);
    const { request } = await runOn(parsed);
    expect(request.graph.nodes.map((n) => n.id), 'CONTROL: the request carries the goal node').toContain(GOAL);
    expect(request.graph.nodes.filter((n) => Object.hasOwn(n, 'stated_response')).map((n) => n.id)).toEqual([]);
    expect(JSON.stringify(request)).not.toContain('operand_node_id');
    expect(nodeOf(request.graph, GOAL).nonlinear_identity, 'CONTRAST: the identity itself still rides').toBeDefined();
  });
});

describe('row 6 — a stale PROPOSAL writes nothing', () => {
  it('RED: the model moved (an analysis-affecting edit) between proposal and approval → superseded, no registration', async () => {
    const s = setup();
    const proposed = await s.call(TOOL, T);
    s.mutate((g) => { (nodeOf(g, 'monthly_churn').observed_state as Record<string, unknown>).value = 0.08; });
    const before = clone(s.graph());
    const r = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(s.registers).toHaveLength(0);
    expect(s.graph()).toStrictEqual(before);
  });

  it('RED: a move the analysis hash cannot see (today\'s count restamped as the user\'s elsewhere) → superseded, no registration', async () => {
    const s = setup();
    const proposed = await s.call(TOOL, T);
    s.mutate((g) => { (nodeOf(g, OPERAND).observed_state as Record<string, unknown>).source = 'user_override'; });
    const r = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(s.registers).toHaveLength(0);
    expect(nodeOf(s.graph(), GOAL)).not.toHaveProperty('stated_response');
  });

  it('RED: the model moved between the approval\'s read and the write → the register CAS refuses, nothing written', async () => {
    const s = setup(served, { beforeRegister: ({ mutate }) => mutate((g) => { (nodeOf(g, 'monthly_churn').observed_state as Record<string, unknown>).value = 0.09; }) });
    const proposed = await s.call(TOOL, T);
    const r = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(s.registers).toHaveLength(1);
    expect(nodeOf(s.graph(), GOAL)).not.toHaveProperty('stated_response');
    expect(nodeOf(s.graph(), OPERAND).observed_state!.source).toBe('cee_inference');
  });
});

describe('row 7 — after commit, no writer rewrites the fact: a churn edit leaves it byte-identical; a count or price edit leaves it as it was (the reader decides staleness)', () => {
  const turn = { kind: 'system_event', scenario_id: SCENARIO, turn_id: '57575757-5757-4757-8757-575757575757', stage: 'frame' };
  const committed = async (): Promise<Graph> => {
    const s = setup();
    await proposeAndApprove(s);
    return s.graph();
  };
  const factorEdit = async (g: Graph, targetId: string, raw: number, unit: string): Promise<Graph> => {
    const event = { kind: 'factor_value_edit', target_id: targetId, value: raw, raw_value: raw, unit, field: 'value' };
    const r = await applyFactorValueEdit({ payload: { ...turn, event } as never, event: event as never, requestId: 'req-row7', persistedGraph: g, priorFacts: [] } as never);
    expect(r.kind, `the writer must WRITE here (got ${r.kind})`).toBe('mutated');
    return projectGraphForPersistence(clone((r as { mutatedGraph: Graph }).mutatedGraph));
  };

  it('RED: a churn edit (factor_value_edit on Monthly churn) → the fact is byte-identical', async () => {
    const g = await committed();
    const out = await factorEdit(g, 'monthly_churn', 8, '% per month');
    expect(nodeOf(out, 'monthly_churn').observed_state).toMatchObject({ raw_value: 8 });
    expect(JSON.stringify(nodeOf(out, GOAL).stated_response)).toBe(JSON.stringify(nodeOf(g, GOAL).stated_response));
    expect(nodeOf(out, GOAL).stated_response).toStrictEqual(FACT);
  });

  it('RED: an edit of today\'s count → the count moves, the fact stays as it was (never silently rewritten)', async () => {
    const g = await committed();
    const out = await factorEdit(g, OPERAND, 280, 'subscribers');
    expect(nodeOf(out, OPERAND).observed_state).toMatchObject({ raw_value: 280 });
    expect(nodeOf(out, GOAL).stated_response).toStrictEqual(FACT);
  });

  it('RED: an edit of the £59 option\'s price (option_intervention_edit) → the price moves, the fact stays as it was', async () => {
    const g = projectGraphForPersistence(await committed());
    const r = applyOptionInterventionEdit({ persistedGraph: g, optionId: AT_59, factorId: PRICE, modelValue: 0.3,
      expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!, scenarioId: SCENARIO, turnId: 'turn-row7', requestId: 'req-row7-p',
      freshness: 'none', hasExistingAnalysis: false } as never);
    expect(r.kind, `the writer must WRITE here (got ${r.kind}: ${JSON.stringify(r)})`).toBe('candidate');
    const out = projectGraphForPersistence(clone((r as { graph: Graph }).graph));
    expect((nodeOf(out, AT_59).interventions![PRICE] as { value: number }).value).toBe(0.3);
    expect(nodeOf(out, GOAL).stated_response).toStrictEqual(FACT);
  });

  it('RED: the register route\'s own ingress and the turn-path parse keep the fact by id', async () => {
    const g = await committed();
    const n = normaliseGraphNodeKindField(g);
    const ingress = n.ok ? GraphStateIngressSchema.safeParse(n.graph) : null;
    expect(ingress?.success).toBe(true);
    expect(nodeOf(ingress!.data as unknown as Graph, GOAL).stated_response).toStrictEqual(FACT);
    expect(nodeOf(GraphV3.parse(g) as unknown as Graph, GOAL).stated_response).toStrictEqual(FACT);
  });
});
