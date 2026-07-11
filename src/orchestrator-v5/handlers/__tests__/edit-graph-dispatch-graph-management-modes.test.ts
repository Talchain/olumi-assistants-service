/**
 * Lane 8 — CEE_GRAPH_MANAGEMENT_MODE behaviour pins at the dispatch seam.
 *
 *  - off: byte-identical behaviour, ZERO referee calls (module spy).
 *  - shadow: referee evaluates + emits v5.candidate_mutation.* telemetry;
 *    the wire response AND the commit metadata are byte-identical to off
 *    (the CAS-observe pattern).
 *  - live + would_apply (rename): proceeds through the EXISTING apply path
 *    exactly as today (graph persists, edit fact persists).
 *  - live + held (tunable field update): the mutation is NOT persisted — no
 *    graph on the commit, no edit fact, no analysis_ready, returned graph
 *    null — and a REAL apply_proposed_change pending + confirm chip ship
 *    with held copy that carries no ack prose (§6.6 by construction).
 *
 * Harness mirrors edit-graph-dispatch-graph-cas-trusted-base.test.ts:
 * mocked handleEditGraph / commitDirectAnswer / loadPersistedGraphStrict +
 * buildTurnContext, env-stubbed mode flag.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { AppliedChanges, PatchOperation } from '../../../orchestrator/types.js';

// ── module-level mocks ──────────────────────────────────────────────

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

const { persistedBaseRef } = vi.hoisted(() => ({
  persistedBaseRef: { current: null as unknown },
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn(async () => persistedBaseRef.current),
    loadMostRecentPendingActions: vi.fn(async () => []),
    buildTurnContext: vi.fn(async () => ({
      prior_facts: [],
      prior_turns: [],
      most_recent_pending_actions: [],
    })),
  };
});

// Spy on the referee module so mode=off can pin ZERO referee calls.
const { refereeSpy } = vi.hoisted(() => ({ refereeSpy: { calls: 0 } }));
vi.mock('../../graph-management/referee.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../graph-management/referee.js')>();
  return {
    ...actual,
    refereeMutationBatch: vi.fn((...args: Parameters<typeof actual.refereeMutationBatch>) => {
      refereeSpy.calls += 1;
      return actual.refereeMutationBatch(...args);
    }),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { parsePendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { _resetConfigCache } from '../../../config/index.js';

// ── fixtures ────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

function makePayload(message: string) {
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

/** Ingress == persisted base (hashes match → the frame gate can proceed). */
const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price (revised)' },
  ],
  edges: INGRESS_GRAPH.edges,
};

const APPLIED_CHANGES: AppliedChanges = {
  summary: 'Renamed "Price" to "Price (revised)"',
  changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }],
  rerun_recommended: false,
};

/** update_node touching ONLY label → projects to rename_node → would_apply. */
const RENAME_OPS: PatchOperation[] = [
  { op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } },
];

/** update_node touching a non-label tunable field → held (TUNABLE_APPLY_HELD). */
const FIELD_OPS: PatchOperation[] = [
  { op: 'update_node', path: 'fac_price', value: { description: 'List price per unit' } },
];

function makeAppliedEditResult(ops: PatchOperation[]): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Renamed "Price" to "Price (revised)"',
    latencyMs: 900,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    appliedChanges: APPLIED_CHANGES,
    operations: ops,
    operation_meta: ops.map(() => ({ impact: 'low' as const, rationale: '' })),
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-gm-mode',
    graphPersisted: true,
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
  };
}

async function runDispatch(ops: PatchOperation[]) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    makeAppliedEditResult(ops),
  );
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
  const result = await dispatchEditGraph({
    payload: makePayload('Change the price factor'),
    requestId: 'req-gm-mode',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls).toHaveLength(1);
  return { result, response: calls[0]![0], metadata: calls[0]![1] };
}

function setMode(mode: string): void {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode);
  _resetConfigCache();
}

/** Strip volatile fields so off-vs-shadow byte-identity compares stable content. */
function stableMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { duration_ms: _d, ...rest } = metadata;
  return rest;
}

beforeEach(() => {
  vi.clearAllMocks();
  refereeSpy.calls = 0;
  persistedBaseRef.current = INGRESS_GRAPH;
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

// ── mode=off ────────────────────────────────────────────────────────

describe('mode=off (default)', () => {
  it('makes ZERO referee calls and persists the applied mutation as today', async () => {
    setMode('off');
    const { result, metadata } = await runDispatch(FIELD_OPS);
    expect(refereeSpy.calls).toBe(0);
    expect(metadata.graph).toBeDefined();
    expect((metadata.handler_facts as unknown[]).length).toBe(1);
    expect(result.graph).not.toBeNull();
    expect(result.analysisReady).toBeDefined();
  });
});

// ── mode=shadow ─────────────────────────────────────────────────────

describe('mode=shadow', () => {
  it('referee runs, but response + commit metadata are byte-identical to off', async () => {
    setMode('off');
    const off = await runDispatch(FIELD_OPS);
    vi.clearAllMocks();
    refereeSpy.calls = 0;

    setMode('shadow');
    const shadow = await runDispatch(FIELD_OPS);

    expect(refereeSpy.calls).toBe(1); // referee evaluated the batch…
    // …and changed NOTHING (the CAS-observe pattern):
    expect(JSON.stringify(shadow.response)).toBe(JSON.stringify(off.response));
    expect(JSON.stringify(stableMetadata(shadow.metadata as never))).toBe(
      JSON.stringify(stableMetadata(off.metadata as never)),
    );
    expect(shadow.result.graph).toEqual(off.result.graph);
    expect(shadow.result.analysisReady).toEqual(off.result.analysisReady);
  });
});

// ── mode=live ───────────────────────────────────────────────────────

describe('mode=live', () => {
  it('would_apply (rename) proceeds through the EXISTING apply path exactly as today', async () => {
    setMode('live');
    const { result, metadata } = await runDispatch(RENAME_OPS);
    expect(refereeSpy.calls).toBe(1);
    expect(metadata.graph).toBeDefined(); // graph persists
    expect((metadata.handler_facts as unknown[]).length).toBe(1); // receipt fact persists
    expect(result.graph).not.toBeNull();
    expect(result.analysisReady).toBeDefined();
  });

  it('held (tunable field update): NO persist, NO fact, NO analysis_ready — real pending + held copy instead', async () => {
    setMode('live');
    const { result, response, metadata } = await runDispatch(FIELD_OPS);

    // Structural honesty: nothing persisted, nothing stamped.
    expect(metadata.graph).toBeUndefined();
    expect((metadata.handler_facts as unknown[]).length).toBe(0);
    expect(result.graph).toBeNull();
    expect(result.analysisReady).toBeUndefined();
    expect(metadata.expectedGraphIdentityHash).toBeUndefined(); // no CAS observation without a write

    // Held copy replaces the ack prose; §6.6 by construction.
    // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11): the ask NAMES the
    // held change (doctrine (a)) while keeping the swept consent framing.
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("update 'Price'");
    expect(text).toContain('Nothing in the model moves until you confirm');
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();

    // A REAL pending confirmation shipped with the commit…
    const pendings = metadata.pending_actions as unknown[];
    expect(pendings).toHaveLength(1);
    const parsed = parsePendingAction(pendings[0]);
    expect(parsed).not.toBeNull();
    expect(parsed!.action.kind).toBe('apply_proposed_change');

    // …and its confirm chip is on the wire (chip id == proposal_ref bridge).
    // Consent-clarity: the chip message names its subject so a click
    // resolves via exact-match to THIS hold.
    const chips = (response as { suggested_actions: Array<{ id: string; message: string }> })
      .suggested_actions;
    expect(chips).toHaveLength(1);
    expect(chips[0]!.id).toBe(parsed!.chip_id);
    expect(chips[0]!.message).toBe("Yes, update 'Price'.");

    // The wire carries the redacted public reason (codes only, no candidate internals).
    const blocks = (response as { blocks: Array<{ details?: Record<string, unknown> }> }).blocks;
    expect(blocks[0]!.details).toMatchObject({
      source: 'graph_management',
      verdict: 'held',
      blocker_code: 'TUNABLE_APPLY_HELD',
    });
    expect(blocks[0]!.details).not.toHaveProperty('candidate');
  });

  it('held flow reports an honest R7 outcome (proposal, graph_management branch), never success', async () => {
    setMode('live');
    const emitSpy = vi.spyOn(await import('../../../utils/telemetry.js'), 'emit');
    try {
      await runDispatch(FIELD_OPS);
      const turnEvents = emitSpy.mock.calls.filter((c) => c[0] === 'v5.edit_graph.turn');
      expect(turnEvents).toHaveLength(1);
      expect(turnEvents[0]![1]).toMatchObject({
        outcome: 'proposal',
        branch: 'graph_management_held',
      });
    } finally {
      emitSpy.mockRestore();
    }
  });
});

// ── R8: held_proposal block emission (CEE_HELD_PROPOSAL_EMIT, ships dark) ──

describe('mode=live — held_proposal block (CEE_HELD_PROPOSAL_EMIT)', () => {
  const HELD_SUMMARY = "A change to 'Price' is held for your confirmation.";

  function heldProposalBlocksOf(response: unknown): Array<Record<string, unknown>> {
    const blocks = (response as { blocks?: Array<Record<string, unknown>> }).blocks ?? [];
    return blocks.filter((b) => b.type === 'held_proposal');
  }

  it('flag OFF (default): held response carries NO held_proposal block (dormancy baseline)', async () => {
    setMode('live');
    const { response } = await runDispatch(FIELD_OPS);
    expect(heldProposalBlocksOf(response)).toHaveLength(0);
  });

  it('flag ON: exactly ONE schema-valid held_proposal block, additive next to the existing blocks', async () => {
    setMode('live');
    vi.stubEnv('CEE_HELD_PROPOSAL_EMIT', 'true');
    _resetConfigCache();
    const { response } = await runDispatch(FIELD_OPS);

    const heldBlocks = heldProposalBlocksOf(response);
    expect(heldBlocks).toHaveLength(1);
    const block = heldBlocks[0]!;

    // Strict boundary schema — a malformed KNOWN kind strict-fails the whole
    // envelope UI-side (R4 hazard class), so the emitter must produce a
    // fully valid block or nothing.
    const { HeldProposalBlockSchema } = await import('@talchain/schemas/boundary');
    const parsed = HeldProposalBlockSchema.safeParse(block);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);

    // Typed content — codes and refs, never free prose or doctrine wording.
    expect(block.mutation_class).toBe('tunable');
    expect(block.reason_code).toBe('TUNABLE_APPLY_HELD');
    expect(block.summary).toBe(HELD_SUMMARY);

    // confirm_action_id must reference the REAL confirm chip on THIS response.
    const chips = (response as { suggested_actions: Array<{ id: string }> }).suggested_actions;
    expect(chips).toHaveLength(1);
    expect(block.confirm_action_id).toBe(chips[0]!.id);
    expect(block.proposal_id).toBe(chips[0]!.id);
    expect(block.decline_action_id).toBeUndefined();
  });

  it('flag ON is ADDITIVE: response minus the held_proposal block matches flag-off (same block types, same copy)', async () => {
    setMode('live');
    const { response: offResponse } = await runDispatch(FIELD_OPS);

    vi.clearAllMocks(); // runDispatch pins exactly one commit call per run
    vi.stubEnv('CEE_HELD_PROPOSAL_EMIT', 'true');
    _resetConfigCache();
    const { response: onResponse } = await runDispatch(FIELD_OPS);

    const off = offResponse as { assistant_text: string; suggested_actions: unknown[]; blocks: Array<{ type: string }> };
    const on = onResponse as { assistant_text: string; suggested_actions: unknown[]; blocks: Array<{ type: string }> };
    expect(on.assistant_text).toBe(off.assistant_text);
    expect(JSON.stringify(on.suggested_actions)).toBe(JSON.stringify(off.suggested_actions));
    expect(on.blocks.filter((b) => b.type !== 'held_proposal').map((b) => b.type)).toEqual(
      off.blocks.map((b) => b.type),
    );
  });
});
