/**
 * HOLD-WIPE fix (task_2e1b8c87) — edit-classified dispatch commits must
 * thread live holds through instead of silently wiping them.
 *
 * RED baseline (F-HELD round-2 KNOWN RESIDUAL, edit-graph-referee-gate.ts /
 * commit.ts): `dispatchEditGraph` commits with NO `priorPendingActions`, so
 * a live consent hold (apply_proposed_change awaiting the user's yes) is
 * destroyed by ANY unrelated edit commit — no TTL decrement, no notice, no
 * telemetry. This suite pins the consent-first doctrine at that seam:
 *
 *   (a) THREAD — a hold that is still structurally valid against the
 *       post-edit graph carries forward, re-pinned to the new graph hash so
 *       the commit carry-forward's hash rule keeps it alive;
 *   (b) HONEST LAPSE — a hold genuinely invalidated by the mutation (its
 *       operations no longer referee cleanly against the new graph) is
 *       expired with a deterministic notice naming what was held and why,
 *       plus redacted `v5.pending_action.invalidated` telemetry;
 *   (c) NON-MUTATING edit turns (rejections, no-ops) thread every prior
 *       pending through UNCHANGED — nothing was invalidated.
 *
 * Mock pattern mirrors edit-graph-dispatch-persist-merge-back.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn(),
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  loadPersistedGraphStrict: vi.fn(),
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import {
  buildTurnContext,
  loadPersistedGraphStrict,
} from '../../build-turn-context.js';
import { GM_HELD_HANDLER_ID } from '../edit-graph-referee-gate.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Canonical GraphV3 base — strict-parses, hashes, and referees. */
const BASE_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'fac_team_size', kind: 'factor', label: 'Team size', observed_state: { value: 4 } },
    { id: 'fac_budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
  ],
  edges: [
    { from: 'dec_d', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_team_size', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_budget', to: 'goal_g', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as GraphStateIngress);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/** The UNRELATED applied edit: bump fac_budget's observed value. */
function buildAppliedGraph(): GraphV3T {
  const parsed = GraphV3.safeParse(clone(BASE_GRAPH));
  if (!parsed.success) throw new Error('fixture must GraphV3-parse');
  const graph = parsed.data;
  const node = graph.nodes.find((n) => n.id === 'fac_budget');
  if (!node) throw new Error('fixture node missing');
  (node as { observed_state?: Record<string, unknown> }).observed_state = { value: 120 };
  return graph;
}

function makeAppliedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'I have raised the budget to 120.',
    latencyMs: 900,
    appliedGraph: buildAppliedGraph() as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      { op: 'update_node', path: 'fac_budget', value: { observed_state: { value: 120 } } },
    ],
  } as EditGraphResult;
}

function makeRejectedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'I could not make that change.',
    latencyMs: 400,
    appliedGraph: null,
    wasRejected: true,
  } as EditGraphResult;
}

/** A live GM hold (lane 34 shape) pinned to the PRE-edit graph hash. */
function makeGmHold(pin: string, operations: readonly unknown[]): PendingAction {
  const ref = 'gmh_abcdef123456';
  const nowIso = new Date().toISOString();
  return {
    id: 'pend-hold-1',
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: GM_HELD_HANDLER_ID,
        apply_wiring: 'held_execute_v1',
        operations,
        operations_count: operations.length,
        candidate_id: 'cand-1',
        candidate_kind: 'update_node_field',
        mutation_class: 'tune',
        blocker_code: null,
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
      },
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    preconditions: { graph_hash: pin },
    expires_at_turn_count: 4,
    expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
    emitted_at_iso: nowIso,
  } as PendingAction;
}

/** A generic (non-GM) proposed-change hold pinned to the pre-edit hash. */
function makeGenericHold(pin: string): PendingAction {
  const ref = 'prop_0123456789ab';
  return {
    id: 'pend-hold-2',
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { factor_id: 'fac_team_size', value: 6 },
        target_entity_ids: ['fac_team_size'],
      },
      public_label: 'Set Team size to 6',
      public_message: 'Yes, set it',
    },
    preconditions: { graph_hash: pin, target_entity_ids: ['fac_team_size'] },
    expires_at_turn_count: 2,
    expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
    emitted_at_iso: new Date().toISOString(),
  } as PendingAction;
}

/** Hold ops that stay valid post-edit: tune a field on an EXISTING node. */
const HOLD_OPS_STILL_VALID = [
  { op: 'update_node', path: 'fac_team_size', value: { observed_state: { value: 6 } } },
];

/** Hold ops genuinely invalidated post-edit: target node does not exist. */
const HOLD_OPS_TARGET_GONE = [
  { op: 'update_node', path: 'fac_gone', value: { observed_state: { value: 1 } } },
];

function makePayload(message = 'Raise the budget to 120 please') {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function installTurnContext(pendings: readonly PendingAction[]): void {
  (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockResolvedValue({
    prior_facts: [],
    prior_turns: [],
    most_recent_pending_actions: pendings,
    persistedGraph: null,
  } as never);
}

interface CapturedEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}

let events: CapturedEvent[] = [];

function invalidatedEvents(): CapturedEvent[] {
  return events.filter((e) => e.name === 'v5.pending_action.invalidated');
}

type CommitMeta = {
  priorPendingActions?: readonly PendingAction[];
  graph_hash?: string;
  pending_actions?: readonly PendingAction[];
};

function commitMeta(): CommitMeta {
  const calls = vi.mocked(commitDirectAnswer).mock.calls;
  expect(calls.length).toBe(1);
  return calls[0]![1] as CommitMeta;
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  setTestSink((name, data) => {
    events.push({ name, data });
  });
  // Echo mock — mirrors the real contract (the untouched fast path returns
  // the same response object it was given).
  vi.mocked(commitDirectAnswer).mockImplementation(async (resp) => ({
    response: resp,
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: true,
    // §3.2: the analysis hash of the bytes actually written. This echo mock
    // persists nothing, so `null` is the honest value.
    persistedAnalysisGraphHash: null,
    // Same reasoning, same honest value: the bytes actually written. Added when
    // `CommitResult` gained `persistedGraph` so a caller can derive from the
    // COMMITTED graph rather than its own pre-projection copy. An echo mock
    // writes nothing, so there are no committed bytes to hand back.
    persistedGraph: null,
    canonicalGraphReceipt: null,
    canonicalAnalysisReady: null,
    pendingLifecycle: {
      priorCount: 0,
      consumedCount: 0,
      supersededCount: 0,
      expiredWallCount: 0,
      expiredTurnsCount: 0,
      hashInvalidatedCount: 0,
      capDroppedCount: 0,
      survivedCount: 0,
    },
  }));
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>)
    .mockResolvedValue(clone(BASE_GRAPH));
});

afterEach(() => setTestSink(null));

// ── ROADMAP 2.474 / A10 — the mode is now STATED, not inherited ──────────
// `CEE_GRAPH_MANAGEMENT_MODE`'s repo default moved 'off' → 'live' (the referee
// ships ON; a trust story hanging on a dashboard variable is one careless edit
// from being untrue). This file pins PERSISTENCE mechanics — the merge base,
// the projection, the advertised hash — on a turn that reaches the commit. It
// was authored under the implicit 'off' default, and that premise is exactly
// what it needs: 'off' is the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged. Stating it
// here preserves the property this file was written to prove, and makes the
// dependency visible instead of inherited. Live-mode ROUTING is covered by its
// own files (edit-graph-dispatch-graph-management-modes.test.ts and the
// referee-gate suites), which is where a live regression would surface.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('dispatchEditGraph — holds thread through mutating commits (task_2e1b8c87)', () => {
  it('THREADS a still-valid hold through an unrelated applied edit, re-pinned to the post-edit hash', async () => {
    const pin = hashOf(BASE_GRAPH);
    const hold = makeGmHold(pin, HOLD_OPS_STILL_VALID);
    installTurnContext([hold]);
    vi.mocked(handleEditGraph).mockResolvedValue(makeAppliedEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-hold-thread',
      request: STUB_REQUEST,
      graphState: clone(BASE_GRAPH) as GraphStateIngress,
      analysisState: null,
    });

    const meta = commitMeta();
    // Premise: the edit really moved the analysis-affecting hash.
    expect(meta.graph_hash).toBeDefined();
    expect(meta.graph_hash).not.toBe(pin);

    // The hold is threaded, not wiped.
    const threaded = meta.priorPendingActions ?? [];
    expect(threaded).toHaveLength(1);
    expect(threaded[0]!.action.kind).toBe('apply_proposed_change');
    expect(threaded[0]!.chip_id).toBe(hold.chip_id);
    // Re-pinned to the post-edit hash so the carry-forward keeps it alive.
    expect(threaded[0]!.preconditions.graph_hash).toBe(meta.graph_hash);
    // TTL untouched here — the commit carry-forward is the single decrement site.
    expect(threaded[0]!.expires_at_turn_count).toBe(4);

    // No lapse: no notice, no invalidation telemetry.
    expect(result.response.assistant_text ?? '').not.toContain('lapsed');
    expect(invalidatedEvents()).toHaveLength(0);
  });

  it('HONESTLY LAPSES a hold whose operations no longer fit the post-edit graph (notice + telemetry, never silent)', async () => {
    const pin = hashOf(BASE_GRAPH);
    const hold = makeGmHold(pin, HOLD_OPS_TARGET_GONE);
    installTurnContext([hold]);
    vi.mocked(handleEditGraph).mockResolvedValue(makeAppliedEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-hold-lapse',
      request: STUB_REQUEST,
      graphState: clone(BASE_GRAPH) as GraphStateIngress,
      analysisState: null,
    });

    const meta = commitMeta();
    // The invalidated hold is NOT threaded.
    expect((meta.priorPendingActions ?? []).map((p) => p.chip_id)).not.toContain(hold.chip_id);

    // Deterministic notice names what was held and why it lapsed.
    const text = result.response.assistant_text ?? '';
    expect(text).toContain("'Continue with this change'");
    expect(text).toContain('has lapsed because the model changed');
    expect(text).not.toContain('—'); // house style: no em dash

    // Redacted telemetry (existing frozen event name; no labels/content).
    const lapses = invalidatedEvents();
    expect(lapses).toHaveLength(1);
    expect(lapses[0]!.data).toMatchObject({
      scenario_id: SCENARIO_ID,
      reason: 'graph_hash_changed',
      kind: 'apply_proposed_change',
      site: 'edit_graph_dispatch',
    });
  });

  it('HONESTLY LAPSES a generic (non-GM) proposed-change hold on a mutating commit — its confirm path is hash-gated so the mutation genuinely invalidates it', async () => {
    const pin = hashOf(BASE_GRAPH);
    const hold = makeGenericHold(pin);
    installTurnContext([hold]);
    vi.mocked(handleEditGraph).mockResolvedValue(makeAppliedEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-generic-lapse',
      request: STUB_REQUEST,
      graphState: clone(BASE_GRAPH) as GraphStateIngress,
      analysisState: null,
    });

    const meta = commitMeta();
    expect(meta.priorPendingActions ?? []).toHaveLength(0);
    const text = result.response.assistant_text ?? '';
    expect(text).toContain("'Set Team size to 6'");
    expect(text).toContain('has lapsed because the model changed');
    expect(invalidatedEvents()).toHaveLength(1);
  });

  it('does NOT emit a lapse notice when this turn\'s edit FULFILS a prior proposed_concept hold (adversarial round-3 concern 1)', async () => {
    const pin = hashOf(BASE_GRAPH);
    const hold: PendingAction = {
      id: 'pend-concept-1',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip-concept-1',
      action: {
        kind: 'proposed_concept',
        concept: 'customer churn',
        preferred_kind: 'risk',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with customer churn.',
      },
      preconditions: { graph_hash: pin },
      expires_at_turn_count: 4,
      expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
      emitted_at_iso: new Date().toISOString(),
    } as PendingAction;
    installTurnContext([hold]);

    // The user's edit ADDS the very concept the hold proposed.
    const parsed = GraphV3.safeParse(clone(BASE_GRAPH));
    if (!parsed.success) throw new Error('fixture must GraphV3-parse');
    const fulfilledGraph = parsed.data;
    fulfilledGraph.nodes.push({ id: 'risk_churn', kind: 'risk', label: 'Customer churn' } as GraphV3T['nodes'][number]);
    fulfilledGraph.edges.push({ from: 'risk_churn', to: 'goal_g', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' } as GraphV3T['edges'][number]);
    vi.mocked(handleEditGraph).mockResolvedValue({
      blocks: [],
      assistantText: 'I have added Customer churn as a risk.',
      latencyMs: 900,
      appliedGraph: fulfilledGraph as unknown as EditGraphResult['appliedGraph'],
      wasRejected: false,
      operations: [
        { op: 'add_node', path: 'risk_churn', value: { kind: 'risk', label: 'Customer churn' } },
        { op: 'add_edge', path: 'risk_churn::goal_g', value: { from: 'risk_churn', to: 'goal_g' } },
      ],
    } as EditGraphResult);

    const result = await dispatchEditGraph({
      // Phrased so NEITHER deterministic intercept claims the turn (the
      // add-risk classifier needs an "add X as a risk" shape; the proposal
      // matcher is mooted by the mocked loadMostRecentPendingActions=[]) —
      // the fulfilment happens on the LLM-applied edit path.
      payload: makePayload('Please reflect customer churn in the model'),
      requestId: 'req-hold-fulfilled',
      request: STUB_REQUEST,
      graphState: clone(BASE_GRAPH) as GraphStateIngress,
      analysisState: null,
    });

    const meta = commitMeta();
    // The fulfilled hold is retired (not threaded) — its purpose is served.
    expect((meta.priorPendingActions ?? []).map((p) => p.chip_id)).not.toContain(hold.chip_id);
    // But NO false "your held proposal lapsed" sentence on the very turn the
    // user fulfilled it.
    expect(result.response.assistant_text ?? '').not.toContain('lapsed');
    // Telemetry stays honest: the retirement is recorded as fulfilment.
    const lapses = invalidatedEvents();
    expect(lapses).toHaveLength(1);
    expect(lapses[0]!.data).toMatchObject({
      reason: 'graph_hash_changed',
      detail: 'fulfilled_by_this_mutation',
      kind: 'proposed_concept',
      site: 'edit_graph_dispatch',
    });
  });

  it('NON-MUTATING edit turn (rejection) threads every prior pending through UNCHANGED — no lapse, no notice, no telemetry', async () => {
    const pin = hashOf(BASE_GRAPH);
    const hold = makeGmHold(pin, HOLD_OPS_STILL_VALID);
    installTurnContext([hold]);
    vi.mocked(handleEditGraph).mockResolvedValue(makeRejectedEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload('Please do something impossible'),
      requestId: 'req-hold-nonmutating',
      request: STUB_REQUEST,
      graphState: clone(BASE_GRAPH) as GraphStateIngress,
      analysisState: null,
    });

    const meta = commitMeta();
    const threaded = meta.priorPendingActions ?? [];
    expect(threaded).toHaveLength(1);
    // Unchanged: same pin (the graph did not move), same TTL.
    expect(threaded[0]!.preconditions.graph_hash).toBe(pin);
    expect(threaded[0]!.expires_at_turn_count).toBe(4);
    // No graph write → no graph_hash threaded (carry-forward hash rule inert).
    expect(meta.graph_hash).toBeUndefined();
    expect(result.response.assistant_text ?? '').not.toContain('lapsed');
    expect(invalidatedEvents()).toHaveLength(0);
  });
});
