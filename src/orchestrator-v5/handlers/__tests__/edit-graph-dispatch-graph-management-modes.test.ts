/**
 * Lane 8 — CEE_GRAPH_MANAGEMENT_MODE behaviour pins at the dispatch seam.
 *
 *  - off: byte-identical behaviour, ZERO referee calls (module spy).
 *  - shadow: referee evaluates + emits v5.candidate_mutation.* telemetry;
 *    the wire response AND the commit metadata are byte-identical to off
 *    (the CAS-observe pattern).
 *  - live + would_apply (rename AND — since the D-S ruling, ROADMAP §D,
 *    Paul 2026-07-12 — every tunable field update): proceeds through the
 *    EXISTING apply path exactly as today (graph persists, edit fact
 *    persists, applied receipt + rerun chip untouched).
 *  - live + held (STRUCTURAL change; pre-D-S this class included tunables):
 *    the mutation is NOT persisted — no graph on the commit, no edit fact,
 *    no analysis_ready, returned graph null — and a REAL
 *    apply_proposed_change pending + confirm chip ship with held copy that
 *    carries no ack prose (§6.6 by construction).
 *  - D-S fixture of record: the 11 Jul manual-test batch shape (8
 *    update_edge_field envelopes, base_hash_match=true) applies in ONE
 *    commit with zero held events.
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
import { buildTurnContext } from '../../build-turn-context.js';
import {
  GM_HELD_REPLACES_PRIOR_NOTICE,
  gmHeldProposalRef,
} from '../edit-graph-referee-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
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

/** update_node touching a non-label tunable field → would_apply since D-S
 *  (ROADMAP §D, Paul 2026-07-12); pre-D-S this held TUNABLE_APPLY_HELD. */
const FIELD_OPS: PatchOperation[] = [
  { op: 'update_node', path: 'fac_price', value: { description: 'List price per unit' } },
];

/** Structural change (add_node, new id) → held STRUCTURAL_APPLY_HELD — the
 *  propose-confirm class D-S leaves unchanged. */
const STRUCT_OPS: PatchOperation[] = [
  { op: 'add_node', path: 'fac_cost', value: { id: 'fac_cost', kind: 'factor', label: 'Cost' } },
];

/** D-S fixture of record — the 11 Jul manual-test batch shape: 8 tunable
 *  update_edge_field envelopes (strength / exists_probability tweaks). */
const EIGHT_TUNABLE_EDGE_OPS: PatchOperation[] = Array.from({ length: 8 }, (_, i) => ({
  op: 'update_edge' as const,
  path: 'fac_price::goal_revenue',
  value:
    i % 2 === 0
      ? { strength: { mean: 0.3 + i * 0.05, std: 0.1 } }
      : { exists_probability: 0.8 - i * 0.02 },
  old_value:
    i % 2 === 0 ? { strength: { mean: 0.5, std: 0.1 } } : { exists_probability: 0.9 },
})) as PatchOperation[];

/** The V4 applied receipt's rerun chip shape (edit-graph.ts, rerun_recommended). */
const V4_RERUN_CHIP = {
  label: 'Re-run analysis',
  prompt: 'run the analysis again',
  role: 'facilitator' as const,
};

function makeAppliedEditResult(
  ops: PatchOperation[],
  overrides: Partial<EditGraphResult> = {},
): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Renamed "Price" to "Price (revised)"',
    latencyMs: 900,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    appliedChanges: APPLIED_CHANGES,
    operations: ops,
    operation_meta: ops.map(() => ({ impact: 'low' as const, rationale: '' })),
    ...overrides,
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

async function runDispatch(ops: PatchOperation[], resultOverrides: Partial<EditGraphResult> = {}) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    makeAppliedEditResult(ops, resultOverrides),
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

  it('tunable field update AUTO-APPLIES (D-S, ROADMAP §D Paul 2026-07-12): graph persists, edit fact persists, no pending, ack prose untouched (pre-D-S pin: held with pending)', async () => {
    setMode('live');
    const { result, response, metadata } = await runDispatch(FIELD_OPS);

    // The existing apply path ran exactly as in mode=off.
    expect(metadata.graph).toBeDefined();
    expect((metadata.handler_facts as unknown[]).length).toBe(1);
    expect(result.graph).not.toBeNull();
    expect(result.analysisReady).toBeDefined();

    // Honest receipt: the V4 applied narration reaches the wire unswapped —
    // never the consent-ask copy on an applied tunable (F3 guard class).
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toBe('Renamed "Price" to "Price (revised)"');
    expect(text).not.toContain('Nothing in the model moves until you confirm');
    expect(text).not.toContain('Proposing to');

    // No consent pending shipped with the commit.
    expect((metadata.pending_actions as unknown[] | undefined) ?? []).toHaveLength(0);
  });

  it('D-S fixture of record: 8 tunable update_edge_field ops apply in ONE commit — zero held events, applied receipt keeps the rerun chip', async () => {
    setMode('live');
    const emitSpy = vi.spyOn(await import('../../../utils/telemetry.js'), 'emit');
    try {
      const { response, metadata } = await runDispatch(EIGHT_TUNABLE_EDGE_OPS, {
        assistantText: 'Updated the influence of Price on Revenue.',
        appliedChanges: { ...APPLIED_CHANGES, rerun_recommended: true },
        suggestedActions: [V4_RERUN_CHIP],
      });

      // Applied in one commit (runDispatch pins exactly one commit call),
      // with the edit fact and persisted graph.
      expect(metadata.graph).toBeDefined();
      expect((metadata.handler_facts as unknown[]).length).toBe(1);

      // Zero held events on the hold path; all 8 envelopes would_apply.
      const mutationEvents = emitSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).startsWith('v5.candidate_mutation.'),
      );
      expect(mutationEvents).toHaveLength(8);
      expect(
        mutationEvents.every((c) => c[0] === 'v5.candidate_mutation.would_apply'),
      ).toBe(true);

      // The applied receipt's rerun affordance survives to the wire
      // (generated by edit-graph.ts when rerun_recommended — the existing
      // edit-applied vocabulary D-S reuses).
      const chips = (response as { suggested_actions: Array<{ label: string; message: string }> })
        .suggested_actions;
      expect(chips.some((c) => c.label === 'Re-run analysis')).toBe(true);

      // Honest receipt text, no consent ask, no proposal language.
      const text = (response as { assistant_text: string }).assistant_text;
      expect(text).toBe('Updated the influence of Price on Revenue.');
      expect(text).not.toContain('Proposing to');
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('held (STRUCTURAL add): NO persist, NO fact, NO analysis_ready — real pending + held copy instead (propose-confirm unchanged by D-S)', async () => {
    setMode('live');
    const { result, response, metadata } = await runDispatch(STRUCT_OPS);

    // Structural honesty: nothing persisted, nothing stamped.
    expect(metadata.graph).toBeUndefined();
    expect((metadata.handler_facts as unknown[]).length).toBe(0);
    expect(result.graph).toBeNull();
    expect(result.analysisReady).toBeUndefined();
    expect(metadata.expectedGraphIdentityHash).toBeUndefined(); // no CAS observation without a write

    // Held copy replaces the ack prose; §6.6 by construction.
    // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11): the ask NAMES the
    // held change (doctrine (a)) while keeping the swept consent framing.
    // D-O consent naming unchanged by D-S.
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("add factor 'Cost'");
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
    expect(chips[0]!.message).toBe("Yes, add factor 'Cost'.");

    // The wire carries the redacted public reason (codes only, no candidate internals).
    const blocks = (response as { blocks: Array<{ details?: Record<string, unknown> }> }).blocks;
    expect(blocks[0]!.details).toMatchObject({
      source: 'graph_management',
      verdict: 'held',
      blocker_code: 'STRUCTURAL_APPLY_HELD',
    });
    expect(blocks[0]!.details).not.toHaveProperty('candidate');
  });

  it('MIXED tunable+structural batch: held WHOLESALE — nothing persisted, no partial apply (D-S batch boundary)', async () => {
    setMode('live');
    const { result, metadata } = await runDispatch([...FIELD_OPS, ...STRUCT_OPS]);
    expect(metadata.graph).toBeUndefined();
    expect((metadata.handler_facts as unknown[]).length).toBe(0);
    expect(result.graph).toBeNull();
    expect((metadata.pending_actions as unknown[])).toHaveLength(1);
  });

  it('held flow reports an honest R7 outcome (proposal, graph_management branch), never success', async () => {
    setMode('live');
    const emitSpy = vi.spyOn(await import('../../../utils/telemetry.js'), 'emit');
    try {
      // (op switched FIELD_OPS → STRUCT_OPS per D-S: tunables now apply.)
      await runDispatch(STRUCT_OPS);
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

// ── P0 held-proposal survival (2026-07-15, DGAI #340) requirement 4 ──────
// Honest supersession: a NEW hold minted while an earlier consent hold is
// still live must say what happens to the earlier one — same target is
// replaced (carry-forward same-key rule), different target coexists and is
// NAMED. Never two holds silently.

describe('mode=live — held supersession honesty (P0 DGAI #340 req 4)', () => {
  function priorHold(overrides: {
    chipId: string;
    label?: string;
    expiresAtIso?: string;
  }): PendingAction {
    return {
      id: `pend-prior-${overrides.chipId}`,
      scenario_id: SCENARIO_ID,
      chip_id: overrides.chipId,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: overrides.chipId,
        inline_patch: {
          handler_id: 'graph_management_held_v1',
          apply_wiring: 'held_execute_v1',
          operations: [
            { op: 'update_node', path: 'fac_price', value: { description: 'desc' } },
          ],
          operations_count: 1,
          params: {},
          target_entity_ids: [],
        },
        public_label: overrides.label ?? 'Update the earlier thing',
        public_message: `Yes, ${(overrides.label ?? 'Update the earlier thing').toLowerCase()}.`,
      },
      preconditions: { graph_hash: 'h_prior_pin' },
      expires_at_turn_count: 4,
      expires_at_iso: overrides.expiresAtIso ?? new Date(Date.now() + 600_000).toISOString(),
      emitted_at_iso: new Date().toISOString(),
    } as PendingAction;
  }

  function installPriorPendings(pendings: readonly PendingAction[]): void {
    vi.mocked(buildTurnContext).mockResolvedValueOnce({
      prior_facts: [],
      prior_turns: [],
      most_recent_pending_actions: pendings,
    } as never);
  }

  it('same-target newer hold says it REPLACES the earlier one', async () => {
    setMode('live');
    // STRUCT_OPS adds node fac_cost → the new hold's deterministic handle.
    const sameTargetRef = gmHeldProposalRef(SCENARIO_ID, 'node:fac_cost');
    installPriorPendings([priorHold({ chipId: sameTargetRef, label: "Add 'Cost'" })]);
    const { response } = await runDispatch(STRUCT_OPS);
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain('Nothing in the model moves until you confirm');
    expect(text).toContain(GM_HELD_REPLACES_PRIOR_NOTICE);
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('different-target newer hold NAMES the still-live earlier hold (never two silent holds)', async () => {
    setMode('live');
    installPriorPendings([
      priorHold({ chipId: 'gmh_differenttar', label: 'Set Team size to 6' }),
    ]);
    const { response, metadata } = await runDispatch(STRUCT_OPS);
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).toContain("I am still holding the earlier change 'Set Team size to 6' as well");
    expect(text).toContain('all of them');
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
    // The new hold still ships its own pending confirmation.
    expect((metadata.pending_actions as unknown[])).toHaveLength(1);
  });

  it('an EXPIRED earlier hold earns no supersession sentence (no notice spam)', async () => {
    setMode('live');
    installPriorPendings([
      priorHold({
        chipId: 'gmh_expiredearli',
        label: 'Set Team size to 6',
        expiresAtIso: '2020-01-01T00:00:00.000Z',
      }),
    ]);
    const { response } = await runDispatch(STRUCT_OPS);
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).not.toContain('still holding the earlier change');
    expect(text).not.toContain(GM_HELD_REPLACES_PRIOR_NOTICE);
  });

  it('no prior pendings → held copy byte-identical to the no-supersession baseline', async () => {
    setMode('live');
    const { response } = await runDispatch(STRUCT_OPS);
    const text = (response as { assistant_text: string }).assistant_text;
    expect(text).not.toContain('still holding the earlier change');
    expect(text).not.toContain(GM_HELD_REPLACES_PRIOR_NOTICE);
    expect(text).toContain('Nothing in the model moves until you confirm');
  });
});

// ── R8: held_proposal block emission (UNCONDITIONAL — flag deleted) ──
// The CEE_HELD_PROPOSAL_EMIT gate was deleted per Paul's NO-DARK-LAUNCHES
// ruling once the DGAI card (#382) went live on staging. A live-mode GM
// referee HOLD now emits the typed held_proposal block on every response,
// with no flag to toggle. Mutation-check: re-introducing the gate at the
// dispatch append site turns the unconditional-emit pin below RED.

describe('mode=live — held_proposal block (unconditional emit)', () => {
  // Ops switched FIELD_OPS → STRUCT_OPS per D-S (tunables no longer hold, so
  // only structural changes mint held_proposal blocks). Wave-2 ask #20: the
  // card-body summary now carries the FULL changeset description from the
  // 1.134 seam (the add_node op names its factor from the op payload, so no
  // pre-edit-graph label resolution is needed) — this pin is the end-to-end
  // proof the description reaches the wire block on the real dispatch path,
  // now that the confirm-chip label is clamped short.
  const HELD_SUMMARY = "Held for your confirmation: add factor 'Cost'.";

  function heldProposalBlocksOf(response: unknown): Array<Record<string, unknown>> {
    const blocks = (response as { blocks?: Array<Record<string, unknown>> }).blocks ?? [];
    return blocks.filter((b) => b.type === 'held_proposal');
  }

  it('held response carries exactly ONE schema-valid held_proposal block (unconditional — no flag)', async () => {
    setMode('live');
    const { response } = await runDispatch(STRUCT_OPS);

    const heldBlocks = heldProposalBlocksOf(response);
    expect(heldBlocks).toHaveLength(1);
    const block = heldBlocks[0]!;

    // Strict boundary schema — a malformed KNOWN kind strict-fails the whole
    // envelope UI-side (R4 hazard class), so the emitter must produce a
    // fully valid block or nothing. This is the SAME 0.18.0
    // HeldProposalBlockSchema the merged DGAI card (#382) parses, so
    // safeParse success IS the producer↔consumer contract match.
    const { HeldProposalBlockSchema } = await import('@talchain/schemas/boundary');
    const parsed = HeldProposalBlockSchema.safeParse(block);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);

    // Typed content — codes and refs, never free prose or doctrine wording.
    expect(block.mutation_class).toBe('structural');
    expect(block.reason_code).toBe('STRUCTURAL_APPLY_HELD');
    expect(block.summary).toBe(HELD_SUMMARY);

    // Referenced by proposal_id / confirm_action_id into the response's own
    // suggested_actions[] — the chip seam the UI card resolves confirm
    // through (source:'chip'); there is NO target_refs on this block.
    const chips = (response as { suggested_actions: Array<{ id: string }> }).suggested_actions;
    expect(chips).toHaveLength(1);
    expect(block.confirm_action_id).toBe(chips[0]!.id);
    expect(block.proposal_id).toBe(chips[0]!.id);
    expect(block.decline_action_id).toBeUndefined();
    expect(block.target_refs).toBeUndefined();
  });

  it('the held_proposal block is ADDITIVE: filtering it out leaves the pre-slice block set (the redacted public-reason error block) and does not disturb assistant_text or suggested_actions', async () => {
    setMode('live');
    const { response } = await runDispatch(STRUCT_OPS);

    const r = response as {
      assistant_text: string;
      suggested_actions: Array<{ id: string }>;
      blocks: Array<{ type: string }>;
    };
    // Exactly one held_proposal, purely additive next to the pre-slice
    // redacted public-reason error block (order-preserved: error first).
    expect(r.blocks.filter((b) => b.type === 'held_proposal')).toHaveLength(1);
    expect(r.blocks.filter((b) => b.type !== 'held_proposal').map((b) => b.type)).toEqual(['error']);
    // The consent ask copy and the confirm chip are unchanged by the append.
    expect(r.assistant_text).toContain('Nothing in the model moves until you confirm');
    expect(r.suggested_actions).toHaveLength(1);
  });
});
