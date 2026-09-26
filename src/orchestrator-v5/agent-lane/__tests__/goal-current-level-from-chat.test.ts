/**
 * ⛔ WHEN THE USER STATES THE GOAL'S CURRENT LEVEL IN CHAT, IT CAN BE RECORDED — HELD FOR APPROVAL,
 * ON THE GOAL'S OWN FRAME, AS THE USER'S FIGURE — SO THE RUN CARRIES A BASELINE.
 *
 * Served (AI Quality 5843320710; CEE e26c3d2, OpenAI-only): after Paul's pricing brief and the approve,
 * "Our current MRR is £12,000." called only `get_canonical_state`. The goal's `observed_state` stayed
 * null and the Run kept `GOAL_THRESHOLD_NOT_CONVERTIBLE` with no `probability_of_goal`. No Agent tool
 * could record it: `propose_assumptions` takes factors only, and #1840 writes a goal baseline only at
 * build, from the brief.
 *
 * FIXTURE: Paul's own stored graph (`cbd15f83`). Goal `mrr`: target 20000 "GBP MRR", cap 25000
 * (`target_derived_headroom`), frame `level`, and NO `observed_state` (the served T2 state).
 *
 * THE PATH: the Agent's real `dispatchTool` → `createAgentCapabilities` (proposal held in the real
 * `ProposalStore`) → `authorise_change` → `/graph/register` (a fake store that enforces the CAS the
 * route enforces) → the REAL `run_analysis` handler, with PLoT faked, fed the stored bytes. Every
 * assertion names the goal by id (`mrr`) and binds the stamp by its literal source.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, toolsFor, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { userWordsOf } from '../stated-by-user.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const TOOL = 'propose_goal_current_level';
const GOAL = 'mrr';
const CAP = 25000;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c8';
/**
 * What the user TYPED (served T2), bound as the route binds it (`ctx.user_text`, #1978): the figure is recorded as the
 * user's only when it is written here. `goal-current-level-grounded.test.ts` owns the rows where it is not.
 */
const SAID = 'Our current MRR is £12,000.';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-goal-level', user_text: SAID };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: unknown } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: { from: string; to: string }[]; goal_constraints?: unknown[] } & Record<string, unknown>;

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as Graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;

/**
 * A scenario store that behaves like the read and register routes: the read returns the stored graph and its
 * revision; a register whose `expected_graph_hash` is not the current revision is refused `GRAPH_STALE` and
 * writes nothing; a register that lands moves the revision and mints a version. `beforeRegister` lets a
 * test land another writer between the approval's read and the write; `afterRegister` lands one straight after it.
 */
function scenarioStore(initial: Graph, opts: {
  beforeRegister?: (s: { bump: () => void }) => void;
  afterRegister?: (s: { overwrite: (g: Graph) => void }) => void;
} = {}) {
  let graph = clone(initial);
  let rev = 0;
  const hash = () => `h${rev}`;
  const registers: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: hash(), graph_identity_hash: { value: `id-${hash()}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b as unknown as Record<string, unknown>);
      opts.beforeRegister?.({ bump: () => { rev += 1; } });
      // The route's own contract gate (`assist.v1.scenario-graph-register.ts`): bytes it would refuse are refused here.
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== hash()) {
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      graph = b.graph;
      rev += 1;
      const answer = { status: 200, json: { graph_hash: hash(), model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
      opts.afterRegister?.({ overwrite: (g) => { graph = g; rev += 1; } });
      return answer;
    }
    return { status: 500, json: {} };
  };
  return { dispatch, registers, graph: () => graph };
}

function setup(initial: Graph = paulGraph, opts: Parameters<typeof scenarioStore>[1] = {}, said: string = SAID) {
  const store = scenarioStore(initial, opts);
  const proposals = new ProposalStore();
  const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, proposals);
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), { ...ctx, user_text: said }, caps);
  return { ...store, proposals, caps, call };
}

/** What the Agent passes for "Our current MRR is £12,000." after a brief that asked to reach £20k MRR. */
const T2 = { goal_label: 'MRR', value: 12000, unit: 'GBP', goal_is: 'at_least', user_stated: true };

/** The real `run_analysis` handler over a stored graph, PLoT faked; returns the request PLoT received. */
async function plotRequestFor(graph: Graph): Promise<{ graph: Graph; goal_node_id: unknown }> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: graph.nodes.find((n) => n.kind === 'goal')?.id ?? null,
    goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  return run.mock.calls[0]![0] as unknown as { graph: Graph; goal_node_id: unknown };
}

describe('T2 — "Our current MRR is £12,000." is recorded on the goal, held for approval, and reaches the Run', () => {
  it('CONTRAST (served T2 state): the Run PLoT receives for Paul\'s stored model has a goal with no baseline', async () => {
    const req = await plotRequestFor(clone(paulGraph));
    expect(req.goal_node_id).toBe(GOAL);
    const goal = req.graph.nodes.find((n) => n.id === GOAL)!;
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal).not.toHaveProperty('observed_state');
  });

  it('RED: the tool is declared to the Agent in full mode, and dispatch reaches it (served: no tool could record it)', async () => {
    expect(toolsFor('full').map((t) => t.name)).toContain(TOOL);
    const { call } = setup();
    const r = await call(TOOL, T2);
    expect(r.refusal, JSON.stringify(r)).not.toBe('unknown_tool');
  });

  it('RED: propose → nothing written; approve → the goal carries {raw 12000, value = baseline = 12000/25000, the user\'s stamp}; the Run request carries it', async () => {
    const s = setup();
    const proposed = await s.call(TOOL, T2) as ToolResult & { proposal_id?: string; public_label?: string };
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.mutated).toBe(false);
    expect(typeof proposed.proposal_id).toBe('string');
    expect(proposed.public_label).toContain('MRR');
    expect(proposed.public_label).toContain('12000');
    // HELD: the proposer wrote nothing, and the stored goal is still the served one.
    expect(s.registers, 'nothing is written before the user approves').toEqual([]);
    expect(goalOf(s.graph())).not.toHaveProperty('observed_state');

    const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id }) as ToolResult & { receipts?: { version: number }[] };
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.mutated).toBe(true);
    expect(applied.receipts?.map((x) => x.version)).toEqual([2]);
    expect(s.registers).toHaveLength(1);
    // CAS-gated on the revision the user approved, from the same read.
    expect(s.registers[0]!.expected_graph_hash).toBe('h0');
    expect(s.registers[0]!.expected_graph_identity_hash).toBe('id-h0');

    // The #1840 shape, on the goal's OWN cap, stamped as the user's chat figure.
    expect(goalOf(s.graph()).observed_state).toStrictEqual({
      value: 12000 / CAP, baseline: 12000 / CAP, unit: 'GBP MRR', source: USER_EDIT_SOURCE, raw_value: 12000, cap: CAP,
    });
    expect(USER_EDIT_SOURCE).toBe('user_override');
    // The stored goal is one the GraphV3 contract reads back unchanged.
    expect(GraphV3.parse(s.graph()).nodes.find((n) => n.id === GOAL)?.observed_state).toStrictEqual(goalOf(s.graph()).observed_state);
    // Nothing else in the model moved: every other node is byte-identical to the served graph.
    const others = (g: Graph) => g.nodes.filter((n) => n.id !== GOAL);
    expect(others(s.graph())).toStrictEqual(others(paulGraph));
    expect(s.graph().edges).toStrictEqual(paulGraph.edges);
    expect(s.graph().goal_constraints).toStrictEqual(paulGraph.goal_constraints);

    // At the PLoT request boundary: the level frame now has the baseline ISL converts against.
    const req = await plotRequestFor(s.graph());
    const goal = req.graph.nodes.find((n) => n.id === GOAL)!;
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_threshold_raw).toBe(20000);
    expect(goal.observed_state).toMatchObject({ baseline: 12000 / CAP, value: 12000 / CAP, raw_value: 12000, cap: CAP });
  });

  it('RED (approve chip): the one proposal is offered as a one-click approval naming it', async () => {
    const s = setup();
    const proposed = await s.call(TOOL, T2) as ToolResult & { proposal_id: string };
    const chips = approvalChipsFor([{ name: TOOL, ok: true, mutated: false, proposal_id: proposed.proposal_id }]);
    expect(chips.map((c) => c.id)).toContain(approvalChipIdFor(proposed.proposal_id));
  });
});

describe('CONTROLS — refused with a plain reason, nothing proposed, nothing written', () => {
  const refusedAndInert = async (args: Record<string, unknown>, initial: Graph = paulGraph) => {
    const s = setup(initial);
    const r = await s.call(TOOL, args) as ToolResult & { refusal?: string; detail?: string; proposal_id?: string };
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.mutated).toBe(false);
    expect(r).not.toHaveProperty('proposal_id');
    expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(s.registers).toEqual([]);
    expect(goalOf(s.graph())).toStrictEqual(goalOf(initial));
    return r;
  };

  it('an incoherent unit — "12%" for an MRR goal in GBP — is refused, not stored (admitGoalBaseline alone would admit 12/25000)', async () => {
    const r = await refusedAndInert({ ...T2, value: 12, unit: '%' });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain('GBP MRR');
    expect(r.detail).toContain('MRR');
  });

  it('CONTRAST: the same figure in the goal\'s own kind of unit ("£") is proposed', async () => {
    const s = setup();
    const r = await s.call(TOOL, { ...T2, unit: '£' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('a figure for a DIFFERENT metric (a factor: the Pro plan price) is never written to the goal', async () => {
    const r = await refusedAndInert({ ...T2, goal_label: 'Pro plan price', value: 49 });
    expect(r.refusal).toBe('not_the_goal');
    expect(r.detail).toContain('Pro plan price');
    expect(r.detail).toContain('MRR');
  });

  it('a metric the model does not have (ARR) is never written to the goal', async () => {
    const r = await refusedAndInert({ ...T2, goal_label: 'ARR', value: 144000 });
    expect(r.refusal).toBe('not_the_goal');
    expect(r.detail).toContain('MRR');
  });

  it('an Olumi estimate is never written as the user\'s (user_stated absent or false)', async () => {
    for (const user_stated of [false, undefined]) {
      const r = await refusedAndInert({ ...T2, user_stated });
      expect(r.refusal, String(user_stated)).toBe('not_the_users_figure');
    }
  });

  it('a goal_is the user has not stated is refused, never defaulted to "at least"', async () => {
    for (const goal_is of [undefined, 'roughly']) {
      const r = await refusedAndInert({ ...T2, goal_is });
      expect(r.refusal, String(goal_is)).toBe('goal_is_unstated');
    }
  });

  it('a goal whose target is on another frame (delta) has no level to set a baseline against', async () => {
    const g = clone(paulGraph);
    goalOf(g).goal_threshold_frame = 'delta';
    const r = await refusedAndInert(T2, g);
    expect(r.refusal).toBe('no_target');
  });

  it('a goal with no stated target on the level frame has nothing to measure against', async () => {
    const g = clone(paulGraph);
    const goal = goalOf(g);
    for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_cap_provenance']) delete goal[k];
    const r = await refusedAndInert(T2, g);
    expect(r.refusal).toBe('no_target');
  });
});

describe('CONTROLS — the brief path\'s operator and scale rules hold on this path, word for word', () => {
  /** The build path's own sentence for the same goal, target and level (`admitCandidateModel`). */
  const buildSentence = (operator: string, baseline: number): string | undefined => {
    const m = admitCandidateModel({
      goal: { metric: 'MRR', operator, target_stated: true, value: 20000, unit: 'GBP MRR', horizon_months: null, provenance: 'explicit', baseline_known: true, baseline_value: baseline, baseline_provenance: 'explicit' },
      constraints: [], risks: [], outcomes: [],
      options: [
        { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
        { label: 'Raise to £55', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Pro plan price', value: 55, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      ],
      factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 }],
      links: [{ from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred' }],
    } as unknown as CandidateModel);
    return m.loss.find((l) => l.field_path === 'nodes[mrr].observed_state.baseline')?.reason;
  };

  it.each([
    ['above', '>', 12000, 'strictly above'],
    ['at_most', '<=', 12000, 'stay at or below'],
    ['below', '<', 12000, 'stay below'],
    ['at_least', '>=', 24000, 'already above the target'],
  ])('goal_is %s (%s), level %d → refused with the brief path\'s own sentence (%s)', async (goal_is, operator, value, phrase) => {
    const s = setup(paulGraph, {}, `Our current MRR is £${value}.`);
    const r = await s.call(TOOL, { ...T2, goal_is, value }) as ToolResult & { refusal?: string; detail?: string };
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_admitted');
    const said = buildSentence(operator, value);
    expect(said, 'the build path refuses the same pair').toBeDefined();
    expect(said).toContain(phrase);
    expect(r.detail).toBe(said);
    expect(s.registers).toEqual([]);
  });

  /**
   * A negative level ("outside the range", -5) can no longer reach admission: the scanner reads no signed figure
   * (`stated-amounts.ts`, "signed values"), so -5 is never a figure the user wrote — refused before admission, under-claiming.
   */
  it('a negative level (-5) is never read as a figure the user wrote → refused before admission, nothing prepared', async () => {
    for (const said of ['Our current MRR is -£5.', 'Our current MRR is £-5.', 'MRR is -5 GBP.']) {
      const s = setup(paulGraph, {}, said);
      const r = await s.call(TOOL, { ...T2, value: -5 }) as ToolResult & { refusal?: string };
      expect(r.ok, said).toBe(false);
      expect(r.refusal, said).toBe('figure_not_in_users_words');
      expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
    }
  });

  it('CONTROL: equality under "at least" is a meaningful hold-the-line and is proposed (not refused)', async () => {
    const s = setup(paulGraph, {}, 'We are at £20,000 MRR today.');
    const r = await s.call(TOOL, { ...T2, value: 20000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(buildSentence('>=', 20000)).toBeUndefined();
  });
});

describe('CONTROLS — the approval is the write, and only onto the model the user approved', () => {
  it('a writer landing between the approval\'s read and the write → refused by the CAS, nothing written', async () => {
    let first = true;
    const s = setup(paulGraph, { beforeRegister: ({ bump }) => { if (first) { first = false; bump(); } } });
    const proposed = await s.call(TOOL, T2) as ToolResult & { proposal_id: string };
    const r = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.mutated).toBe(false);
    expect(r.refusal).toBe('superseded');
    expect(goalOf(s.graph())).not.toHaveProperty('observed_state');
  });

  it('saved, then changed by another writer straight afterwards → never reported as applied (confirmed from state)', async () => {
    const s = setup(paulGraph, { afterRegister: ({ overwrite }) => overwrite(clone(paulGraph)) });
    const proposed = await s.call(TOOL, T2) as ToolResult & { proposal_id: string };
    const r = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(r.applied, JSON.stringify(r)).not.toBe(true);
    expect(r.ok).toBe(false);
    expect(r.mutated).toBe(true);
    expect(r.refusal).toBe('not_verified');
  });

  it('read-only preview: the tool is not declared and dispatch refuses it', async () => {
    expect(toolsFor('preview').map((t) => t.name)).not.toContain(TOOL);
    const s = setup();
    const r = await dispatchTool(TOOL, JSON.stringify(T2), ctx, s.caps, 'preview');
    expect(r.refusal).toBe('read_only_preview');
  });

  it('the same figure already recorded as the user\'s → nothing to approve', async () => {
    const s = setup();
    const proposed = await s.call(TOOL, T2) as ToolResult & { proposal_id: string };
    await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    const again = await s.call(TOOL, T2);
    expect(again.ok).toBe(false);
    expect(again.refusal).toBe('already_recorded');
  });

  it('a different figure over a recorded one says what it replaces', async () => {
    const s = setup(paulGraph, {}, userWordsOf([SAID], 'Sorry, it is £13,000 now.'));
    const first = await s.call(TOOL, T2) as ToolResult & { proposal_id: string };
    await s.call('authorise_change', { proposal_id: first.proposal_id });
    const revised = await s.call(TOOL, { ...T2, value: 13000 }) as ToolResult & { public_label?: string; replaces?: number };
    expect(revised.ok, JSON.stringify(revised)).toBe(true);
    expect(revised.replaces).toBe(12000);
    expect(revised.public_label).toContain('12000');
    expect(revised.public_label).toContain('13000');
  });
});
