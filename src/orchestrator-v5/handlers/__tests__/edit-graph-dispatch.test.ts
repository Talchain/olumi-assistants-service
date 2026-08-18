/**
 * Unit tests for dispatchEditGraph.
 *
 * Pins the post-R-001 contract:
 *
 *  1. Applied edit (appliedGraph !== null, wasRejected === false)
 *     → commitDirectAnswer called with a metadata.graph whose nodes/edges
 *     are editResult.appliedGraph's, so append_turn_atomic persists the
 *     post-edit graph atomically with the turn row. Without this,
 *     scenarios.graph would stay stale across edit turns (the original
 *     P0 finding). V5-PERSIST-FIX-01 amendment: the committed object is
 *     the MERGE of the applied nodes/edges onto the persisted-graph base
 *     (ingress fallback when no persisted graph exists, as in this
 *     suite's degraded-context environment) — identity with appliedGraph
 *     is no longer the contract; node/edge content equality is. The
 *     merge semantics themselves are pinned in
 *     edit-graph-dispatch-persist-merge-back.test.ts.
 *
 *  2. Rejected edit (appliedGraph === null, wasRejected === true)
 *     → commitDirectAnswer called with metadata.graph === undefined so the RPC
 *     receives p_graph = null and scenarios.graph is left unchanged.
 *
 *  3. Handler throw → dispatchEditGraph rethrows; no commit attempted. The
 *     route-level catch maps the thrown error to a 500 BoundaryError.
 *
 *  4. Commit failure → dispatchEditGraph returns commitPerformed: false; the
 *     response is still returned (server-side fallback). No throw.
 *
 *  5. Permissive ingress graph that fails strict GraphV3 parse → handler is
 *     still invoked with a structural fallback graph (no throw, no skipped
 *     dispatch). This proves the adapter at graphStateToGraphV3 keeps the
 *     edit pipeline reachable even when the UI sends weakly-typed graph state.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks ────────────────────────────────────────────────────────

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

// V5-PERSIST-FIX-01: stub ONLY the strict persisted read so applied
// mutations do not fail closed against the unconfigured test store.
// `null` = a genuinely-empty scenarios.graph → ingress-base fallback merge,
// i.e. the same (request-graph) base these tests used before the fix.
// Everything else in build-turn-context stays real.
// ROADMAP 1.33: `loadRecentConversationTurns` defaults to empty (matches the
// real degraded-store fallback these tests already ran against implicitly
// before this export existed) so pre-existing tests are unaffected. Tests
// that need a specific conversation slice override via mockResolvedValueOnce.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
  };
});

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { loadRecentConversationTurns } from '../../build-turn-context.js';
import type { GraphStateIngress, AnalysisStateIngress } from '../../boundary/request-extensions.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import type {
  PendingClarificationState,
  PendingProposalState,
  SuggestedAction,
  TypedConversationBlock,
  GraphPatchBlockData,
} from '../../../orchestrator/types.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// ── helpers ───────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID     = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Increase the strength of the launch → revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
  ],
  edges: [
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

function makeAppliedEditResult(overrides: Partial<EditGraphResult> = {}): EditGraphResult {
  // V5 H5 (Codex round-1 P1): a real "applied mutation" returns
  // wasRejected=false + appliedGraph + non-empty operations. The
  // V5 dispatcher gates graph persistence on
  // `isSuccessfulAppliedMutation(editResult)` which requires all
  // three. Previously this fixture omitted `operations` and the test
  // still passed because the dispatcher persisted graph state
  // unconditionally on `wasRejected=false`. With the fixed gate,
  // the fixture must include operations to match production shape.
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_edge', path: 'fac_price->goal_revenue', value: 0.7 }],
    ...overrides,
  };
}

function makeRejectedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'The proposed edit was rejected.',
    latencyMs: 800,
    appliedGraph: null,
    wasRejected: true,
  };
}

function makeCommitResult(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-edit-1',
    graphPersisted,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('R-001 regression — applied edit graph persistence', () => {
    it('forwards editResult.appliedGraph to commitDirectAnswer.metadata.graph', async () => {
      // This is the assertion that pins the R-001 fix. Before the fix, the
      // dispatcher omitted `graph` from the metadata, so `append_turn_atomic`
      // received `p_graph = null` and `scenarios.graph` stayed stale.
      const editResult = makeAppliedEditResult();
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(editResult);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-applied',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      // V5-PERSIST-FIX-01: the committed graph is the applied mutation
      // merged onto the persisted-base shape (ingress fallback here —
      // no persisted graph in this suite's degraded context), not the
      // appliedGraph object itself. Content equality on nodes/edges is
      // the persistence contract; the applied arrays are carried by
      // reference.
      const committedGraph = metadata.graph as { nodes: unknown; edges: unknown };
      // ⚠ VALUE, NOT REFERENCE: `mergeAppliedGraphForPersistence` clones its
      // result (return contract — see
      // `system-events/__tests__/persist-merge-helpers-own-their-clone.test.ts`).
      // The R-001 invariant is that the APPLIED graph reaches the commit, which
      // is a claim about content, not about object identity.
      expect(committedGraph.nodes).toEqual(editResult.appliedGraph!.nodes);
      expect(committedGraph.edges).toEqual(editResult.appliedGraph!.edges);
      expect(metadata.scenario_id).toBe(SCENARIO_ID);
      expect(metadata.turn_id).toBe(TURN_ID);
      expect(metadata.handler_id).toBeNull();
      // V5 H5 (Codex round-1 P1) contract update: the fixture now
      // includes `operations` to match the "successful applied
      // mutation" shape that `isSuccessfulAppliedMutation()`
      // requires for graph persistence. The fact-builder still
      // emits null here because `appliedChanges` is missing — the
      // generic fallback emits a minimal fact instead. The
      // fact-emission contract for FULLY-populated
      // EditGraphResult fixtures is pinned in
      // edit-graph-dispatch-fact-emission.test.ts (B1-B9). This
      // test continues to assert the R-001 graph-persistence
      // contract: a true successful applied mutation persists
      // graph state via metadata.graph.
      expect(metadata.handler_facts.length).toBe(1);
    });
  });

  describe('rejected edit', () => {
    it('passes graph=undefined to commitDirectAnswer (so RPC receives p_graph=null)', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeRejectedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-rejected',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(true);
      expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.graph).toBeUndefined();
      // Wire-side: rejected edit produces a neutral assistant_text.
      expect(result.response.assistant_text).toBe('The proposed edit was rejected.');
    });
  });

  describe('handler throw', () => {
    it('rethrows so the route can map to a 500 BoundaryError; no commit attempted', async () => {
      const handlerErr = new Error('PLoT semantic validation timed out');
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockRejectedValue(handlerErr);

      await expect(
        dispatchEditGraph({
          payload: makePayload(),
          requestId: 'req-edit-throw',
          request: STUB_REQUEST,
          graphState: INGRESS_GRAPH,
          analysisState: null,
        }),
      ).rejects.toBe(handlerErr);

      expect(commitDirectAnswer).not.toHaveBeenCalled();
    });
  });

  describe('commit failure', () => {
    it('returns commitPerformed: false without throwing when commitDirectAnswer rejects', async () => {
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockRejectedValue(new Error('StateCommitFailedError: RPC timeout'));

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-commit-fail',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(false);
      // Response is still returned for server-side logging — the route-v2
      // path maps commitPerformed=false to a wire-level retryable error.
      expect(result.response.assistant_text).toBeDefined();
    });

    it('returns graph: null on commit failure even for a successful applied mutation (Codex round-3 self-consistency)', async () => {
      // The mutation appeared successful upstream
      // (`isSuccessfulAppliedMutation()` returns true) but
      // `commitDirectAnswer` threw — the post-edit graph was NOT
      // persisted. Returning `editResult.appliedGraph` here would
      // imply a persistence outcome that didn't happen. The dispatch
      // result must be self-consistent with `commitPerformed=false`.
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockRejectedValue(new Error('StateCommitFailedError: RPC timeout'));

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-commit-fail-graph-null',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(result.commitPerformed).toBe(false);
      expect(result.graph).toBeNull();
    });
  });

  // ── recovery surface — composer forwards rejection blocks + chips ─────────
  // Pre-this-fix, `editResultToOlumiResponse` hardcoded blocks=[] and
  // suggested_actions=[], silently dropping clarification chips,
  // propose-and-confirm chips, and rejection codes. These tests pin the
  // forwarding contract.

  describe('composer recovery — rejection blocks', () => {
    function makeRejectedBlock(code: string, attempts: number): TypedConversationBlock {
      const data: GraphPatchBlockData = {
        patch_type: 'edit',
        operations: [],
        status: 'rejected',
        base_graph_hash: 'sha256:base',
        rejection: {
          reason: 'Structural validation failed: NO_PATH_TO_GOAL',
          code,
          attempts,
        },
      };
      return {
        block_id: 'block_rej_1',
        block_type: 'graph_patch',
        data,
        provenance: { trigger: 'tool:edit_graph', turn_id: TURN_ID, timestamp: '2026-04-28T00:00:00.000Z' },
      };
    }

    it('structural rejection → emits boundary error block carrying rejection_code, no graph commit', async () => {
      const result: EditGraphResult = {
        blocks: [makeRejectedBlock('STRUCTURAL_VALIDATION_FAILED', 3)],
        assistantText: "I wasn't able to make that change safely.",
        latencyMs: 4500,
        appliedGraph: null,
        wasRejected: true,
        suggestedActions: [
          { role: 'facilitator', label: 'Try a simpler change', prompt: 'Try a simpler version of this change.' },
          { role: 'facilitator', label: 'Start fresh', prompt: 'Let\'s rebuild the model from the updated brief.' },
        ],
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-rej-struct',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      // Boundary error block carries rejection metadata (not a V4 graph_patch).
      expect(dispatched.response.blocks).toHaveLength(1);
      const block = dispatched.response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('INTERNAL_ERROR');
        expect(block.severity).toBe('warn');
        expect(block.details).toBeDefined();
        expect(block.details!.source).toBe('edit_graph');
        expect(block.details!.rejection_code).toBe('STRUCTURAL_VALIDATION_FAILED');
        expect(block.details!.attempts).toBe(3);
        // Stable codes only — no raw `reason` text on the wire.
        expect(block.details!.reason).toBeUndefined();
      }

      // Recovery chips forwarded from result.suggestedActions.
      expect(dispatched.response.suggested_actions).toHaveLength(2);
      expect(dispatched.response.suggested_actions[0]!.label).toBe('Try a simpler change');
      expect(dispatched.response.suggested_actions[0]!.message).toBe('Try a simpler version of this change.');

      // No graph commit on rejection — appliedGraph: null → metadata.graph: undefined.
      const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
      expect(metadata.graph).toBeUndefined();

      // analysis_ready undefined on rejection — UI keeps prior store value.
      expect(dispatched.analysisReady).toBeUndefined();

      // Boundary validity pinned where blocks + chips are synthesised.
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });

    it('PLoT semantic rejection → boundary error block carries plot_code and rejection_code', async () => {
      const data: GraphPatchBlockData = {
        patch_type: 'edit',
        operations: [],
        status: 'rejected',
        base_graph_hash: 'sha256:base',
        rejection: {
          reason: 'PLoT rejected: cycle detected',
          code: 'PLOT_SEMANTIC_REJECTED',
          plot_code: 'CYCLE_DETECTED',
          attempts: 2,
        },
      };
      const block: TypedConversationBlock = {
        block_id: 'block_plot_rej',
        block_type: 'graph_patch',
        data,
        provenance: { trigger: 'tool:edit_graph', turn_id: TURN_ID, timestamp: '2026-04-28T00:00:00.000Z' },
      };
      const result: EditGraphResult = {
        blocks: [block],
        assistantText: "I wasn't able to make that change safely.",
        latencyMs: 5000,
        appliedGraph: null,
        wasRejected: true,
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-plot-rej',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const wireBlock = dispatched.response.blocks[0]!;
      expect(wireBlock.type).toBe('error');
      if (wireBlock.type === 'error') {
        expect(wireBlock.details!.rejection_code).toBe('PLOT_SEMANTIC_REJECTED');
        expect(wireBlock.details!.plot_code).toBe('CYCLE_DETECTED');
        // Raw rejection text not on the wire.
        expect(wireBlock.details!.reason).toBeUndefined();
      }
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });
  });

  describe('composer recovery — clarification chips', () => {
    it('pendingClarification → maps candidate_labels to suggested_actions when no explicit chips', async () => {
      const pending: PendingClarificationState = {
        tool: 'edit_graph',
        original_edit_request: 'increase the budget',
        candidate_labels: ['Annual Budget', 'Marketing Budget', 'Project Budget'],
      };
      const result: EditGraphResult = {
        blocks: [],
        assistantText: 'Which budget did you mean — Annual Budget or Marketing Budget or Project Budget?',
        latencyMs: 1200,
        appliedGraph: null,
        wasRejected: true,
        pendingClarification: pending,
        // No suggestedActions — composer must derive chips from pending state.
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-clarify-pending',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.suggested_actions).toHaveLength(3);
      expect(dispatched.response.suggested_actions.map((a) => a.label))
        .toEqual(['Annual Budget', 'Marketing Budget', 'Project Budget']);
      expect(dispatched.response.suggested_actions[0]!.message).toBe('Update Annual Budget.');
    });

    it('overlapping explicit + pendingClarification → merged with dedupe (one entry per message)', async () => {
      // Both sources produce identical prompts. Merge collects all four;
      // dedupe-by-message keeps two. Explicit chips come first, so they
      // win on the dedupe collision.
      const pending: PendingClarificationState = {
        tool: 'edit_graph',
        original_edit_request: 'update budget',
        candidate_labels: ['Foo', 'Bar'],
      };
      const explicit: SuggestedAction[] = [
        { role: 'facilitator', label: 'Foo', prompt: 'Update Foo.' },
        { role: 'facilitator', label: 'Bar', prompt: 'Update Bar.' },
      ];
      const result: EditGraphResult = {
        blocks: [],
        assistantText: 'Which one?',
        latencyMs: 100,
        appliedGraph: null,
        wasRejected: true,
        suggestedActions: explicit,
        pendingClarification: pending,
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-clarify-dedupe',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.suggested_actions).toHaveLength(2);
      const messages = dispatched.response.suggested_actions.map((a) => a.message);
      expect(new Set(messages).size).toBe(messages.length);
    });

    it('non-overlapping explicit chip + pendingClarification → merged (both surfaced)', async () => {
      // Mixed recovery state: an explicit "Re-run analysis" rerun chip
      // alongside pendingClarification candidate labels. Earlier
      // exclusive-precedence logic would drop the clarification chips;
      // merge semantics surface all of them.
      const pending: PendingClarificationState = {
        tool: 'edit_graph',
        original_edit_request: 'update factor',
        candidate_labels: ['Cost', 'Revenue'],
      };
      const explicit: SuggestedAction[] = [
        { role: 'facilitator', label: 'Re-run analysis', prompt: 'run the analysis again' },
      ];
      const result: EditGraphResult = {
        blocks: [],
        assistantText: 'Mixed state',
        latencyMs: 100,
        appliedGraph: null,
        wasRejected: false,
        suggestedActions: explicit,
        pendingClarification: pending,
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-merge-mixed',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.suggested_actions).toHaveLength(3);
      expect(dispatched.response.suggested_actions.map((a) => a.label))
        .toEqual(['Re-run analysis', 'Cost', 'Revenue']);
      // Boundary validity is pinned where chips are synthesised.
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });
  });

  // ── violation_codes synthesis from diagnostics — covers the
  // structural-violation path (edit-graph.ts:1950) which returns
  // blocks: [] but populates result.diagnostics.validation_violation_codes.
  // Ensures OPTION_NO_FACTOR_EDGES (and any future structural codes) reach
  // the wire even when the V4 GraphPatchBlock with rejection metadata is
  // absent.
  describe('composer recovery — violation_codes synthesis from diagnostics', () => {
    it('structural-violation immediate reject → synthesises wire error block from diagnostics', async () => {
      // V4 returns blocks: [] for structural-intent immediate rejects
      // (the bypass-repair path). The composer must synthesise the wire
      // error block from result.diagnostics so the rejection_code and
      // violation_codes still reach the UI.
      const result: EditGraphResult = {
        blocks: [],
        assistantText: 'I could not apply that change. Consider simplifying.',
        latencyMs: 600,
        appliedGraph: null,
        wasRejected: true,
        diagnostics: {
          classified_intent: 'structural',
          instruction_mode_applied: 'structural_default',
          edit_instruction_preview: 'add an option for contract hiring',
          graph_context_node_count: 5,
          graph_context_edge_count: 5,
          operations_proposed_count: 2,
          operations_proposed_types: ['add_node', 'add_edge'],
          validation_outcome: 'graph_structure_invalid',
          validation_violation_codes: ['OPTION_NO_FACTOR_EDGES'],
          recovery_path_chosen: 'rejection_block',
          conversational_state_summary: null,
          target_resolution: null,
          resolution_mode: 'auto_apply',
          proposal_returned: false,
          branch_taken: 'rejection',
          branch_reason: 'graph_structure_invalid',
          failure_branch: 'graph_structure_invalid',
          failure_code: 'OPTION_NO_FACTOR_EDGES',
          failure_message: 'Option opt_x has no outbound edge to a factor',
        },
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-structural-synth',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.blocks).toHaveLength(1);
      const block = dispatched.response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.details!.source).toBe('edit_graph');
        expect(block.details!.rejection_code).toBe('OPTION_NO_FACTOR_EDGES');
        expect(block.details!.violation_codes).toEqual(['OPTION_NO_FACTOR_EDGES']);
        expect(block.details!.failure_branch).toBe('graph_structure_invalid');
        // Raw failure_message not promoted to the wire — stable codes only.
        expect(block.details!.reason).toBeUndefined();
      }
      // No graph commit + no analysis_ready on rejection.
      expect(dispatched.analysisReady).toBeUndefined();
      // Boundary validity pinned for diagnostics-synthesised blocks.
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });

    it('V4 GraphPatchBlock rejection + diagnostics → wire block carries both rejection_code and violation_codes', async () => {
      const data: GraphPatchBlockData = {
        patch_type: 'edit',
        operations: [],
        status: 'rejected',
        base_graph_hash: 'sha256:base',
        rejection: {
          reason: 'Structural violation',
          code: 'STRUCTURAL_VALIDATION_FAILED',
          attempts: 3,
        },
      };
      const block: TypedConversationBlock = {
        block_id: 'block_rej',
        block_type: 'graph_patch',
        data,
        provenance: { trigger: 'tool:edit_graph', turn_id: TURN_ID, timestamp: '2026-04-28T00:00:00.000Z' },
      };
      const result: EditGraphResult = {
        blocks: [block],
        assistantText: "I wasn't able to make that change safely.",
        latencyMs: 5000,
        appliedGraph: null,
        wasRejected: true,
        diagnostics: {
          classified_intent: 'structural',
          instruction_mode_applied: 'structural_default',
          edit_instruction_preview: 'add an option',
          graph_context_node_count: 5,
          graph_context_edge_count: 5,
          operations_proposed_count: 2,
          operations_proposed_types: ['add_node', 'add_edge'],
          validation_outcome: 'graph_structure_invalid',
          validation_violation_codes: ['OPTION_NO_FACTOR_EDGES'],
          recovery_path_chosen: 'rejection_block',
          conversational_state_summary: null,
          target_resolution: null,
          resolution_mode: 'auto_apply',
          proposal_returned: false,
          branch_taken: 'rejection',
          branch_reason: 'final_attempt',
          failure_branch: 'structural_validation_failed',
          failure_code: 'STRUCTURAL_VALIDATION_FAILED',
          failure_message: 'Repair exhausted',
        },
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-rej-with-violations',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const wireBlock = dispatched.response.blocks[0]!;
      expect(wireBlock.type).toBe('error');
      if (wireBlock.type === 'error') {
        // Umbrella rejection_code from V4 block.
        expect(wireBlock.details!.rejection_code).toBe('STRUCTURAL_VALIDATION_FAILED');
        // Specific violation codes promoted from diagnostics.
        expect(wireBlock.details!.violation_codes).toEqual(['OPTION_NO_FACTOR_EDGES']);
        expect(wireBlock.details!.attempts).toBe(3);
        // Raw rejection.reason text not promoted to the wire.
        expect(wireBlock.details!.reason).toBeUndefined();
      }
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });
  });

  describe('composer recovery — propose-and-confirm chips intentionally suppressed', () => {
    it('pendingProposal alone → no chips emitted (deterministic-replay not wired)', async () => {
      // V5 dispatch does not currently persist pendingProposal across
      // turns nor thread it via invocationInput, so accept/cancel chips
      // would replay as plain user prompts (the LLM has to re-resolve
      // the proposal). Showing non-deterministic accept/cancel chips is
      // worse UX than showing none — the user can confirm in natural
      // language until the deterministic-replay path is wired.
      const proposal: PendingProposalState = {
        tool: 'edit_graph',
        original_edit_request: 'increase fac_budget by 50%',
        proposed_changes: { changes: [], summary: 'increase budget' } as unknown as PendingProposalState['proposed_changes'],
        candidate_labels: ['fac_budget'],
        base_graph_hash: 'sha256:proposal',
      };
      const result: EditGraphResult = {
        blocks: [],
        assistantText: 'Apply the proposed change?',
        latencyMs: 600,
        appliedGraph: null,
        wasRejected: false,
        pendingProposal: proposal,
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(false) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-propose',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.suggested_actions).toHaveLength(0);
      // Boundary validity pinned for the no-chip path too.
      expect(() => OlumiResponseSchema.parse(dispatched.response)).not.toThrow();
    });
  });

  describe('composer recovery — successful edit', () => {
    it('blocks remain empty for successful edits (no V4→boundary graph_patch mapping)', async () => {
      // Successful applied edit returns a V4 graph_patch with status=accepted/applied.
      // The boundary graph_patch enum doesn't fit V5 multi-op edits, so blocks=[].
      // The applied graph reaches the UI via analysis_ready + scenarios.graph row.
      const data: GraphPatchBlockData = {
        patch_type: 'edit',
        operations: [],
        status: 'accepted',
        base_graph_hash: 'sha256:applied',
      };
      const successBlock: TypedConversationBlock = {
        block_id: 'block_applied',
        block_type: 'graph_patch',
        data,
        provenance: { trigger: 'tool:edit_graph', turn_id: TURN_ID, timestamp: '2026-04-28T00:00:00.000Z' },
      };
      const result: EditGraphResult = {
        blocks: [successBlock],
        assistantText: 'Edge strength increased.',
        latencyMs: 1100,
        appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
        wasRejected: false,
        // V5 H5 (Codex round-2 P1) — a "successful applied edit"
        // requires non-empty operations per
        // `isSuccessfulAppliedMutation()`. The previous fixture
        // omitted them, which was the impossible shape the unified
        // mutation predicate now blocks. Add a representative op so
        // `analysisReady` and other downstream effects fire.
        operations: [{ op: 'update_edge', path: 'fac_price->goal_revenue', value: 0.7 }],
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const dispatched = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-applied-blocks-empty',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      expect(dispatched.response.blocks).toEqual([]);
      // analysis_ready stamped from applied graph.
      expect(dispatched.analysisReady).toBeDefined();
    });
  });

  describe('graph adapter fallback', () => {
    it('still invokes handleEditGraph when ingress graph fails strict GraphV3 parse', async () => {
      // Ingress shape strips required GraphV3 fields (effect_direction,
      // strength, exists_probability). The adapter logs a warn and builds a
      // structural fallback so the edit pipeline remains reachable.
      const weaklyTypedGraph: GraphStateIngress = {
        nodes: [
          { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
          { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        ],
        edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
      };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      const result = await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-fallback',
        request: STUB_REQUEST,
        graphState: weaklyTypedGraph,
        analysisState: null,
      });

      expect(handleEditGraph).toHaveBeenCalledTimes(1);
      expect(result.commitPerformed).toBe(true);
      // Confirm the adapter passed something graph-shaped (nodes + edges) to
      // handleEditGraph rather than throwing on the strict-parse miss.
      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(context.graph?.nodes).toHaveLength(2);
      expect(context.graph?.edges).toHaveLength(1);
    });

    it('passes analysisState to context when provided', async () => {
      const analysis: AnalysisStateIngress = { analysis_status: 'complete' };
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-with-analysis',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: analysis,
      });

      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(context.analysis_response).not.toBeNull();
      expect((context.analysis_response as { analysis_status: string }).analysis_status).toBe('complete');
    });
  });

  describe('ROADMAP 1.33 — edit-lane conversation feed', () => {
    // `loadRecentConversationTurns` arrives most-recent-first (matches
    // `SessionStore.readRecent` / context-pack-assembler convention).
    // Index 0 = turn 4 (most recent prior turn); index 3 = turn 1 (oldest).
    function makePriorTurn(overrides: Partial<SessionTurnWithContent> = {}): SessionTurnWithContent {
      return {
        id: overrides.id ?? 'row-1',
        scenario_id: overrides.scenario_id ?? SCENARIO_ID,
        user_id: overrides.user_id ?? 'user-1',
        turn_id: overrides.turn_id ?? 't-prev-1',
        turn_class: overrides.turn_class ?? 'direct_answer',
        handler_id: overrides.handler_id ?? null,
        request_hash: overrides.request_hash ?? 'hash-1',
        response_emitted: overrides.response_emitted ?? true,
        llm_calls_used: overrides.llm_calls_used ?? 1,
        duration_ms: overrides.duration_ms ?? 250,
        created_at: overrides.created_at ?? '2026-07-01T00:00:00.000Z',
        user_message: overrides.user_message ?? null,
        assistant_message: overrides.assistant_message ?? null,
      };
    }

    const TURN_1_USER = "Let's model whether to launch our product.";
    const TURN_1_ASSISTANT = "Sure - I've drafted a decision graph.";
    const TURN_2_USER = 'What affects revenue the most?';
    const TURN_2_ASSISTANT = 'Marketing spend and launch timing are the top two drivers.';
    // Turn 3 establishes the edit target a later ambiguous "increase it"
    // request depends on.
    const TURN_3_USER = "Let's focus on marketing spend as the main lever for revenue.";
    const TURN_3_ASSISTANT = 'Got it - marketing spend is now the focus factor.';
    const TURN_4_USER = 'Now bump the launch timing to Q3.';
    const TURN_4_ASSISTANT = 'Done - updated the launch timing.';

    const FOUR_PRIOR_TURNS: readonly SessionTurnWithContent[] = [
      makePriorTurn({
        turn_id: 't-4',
        created_at: '2026-07-01T00:03:00.000Z',
        user_message: TURN_4_USER,
        assistant_message: TURN_4_ASSISTANT,
      }),
      makePriorTurn({
        turn_id: 't-3',
        created_at: '2026-07-01T00:02:00.000Z',
        user_message: TURN_3_USER,
        assistant_message: TURN_3_ASSISTANT,
      }),
      makePriorTurn({
        turn_id: 't-2',
        created_at: '2026-07-01T00:01:00.000Z',
        user_message: TURN_2_USER,
        assistant_message: TURN_2_ASSISTANT,
      }),
      makePriorTurn({
        turn_id: 't-1',
        created_at: '2026-07-01T00:00:00.000Z',
        user_message: TURN_1_USER,
        assistant_message: TURN_1_ASSISTANT,
      }),
    ];

    it('feeds turn-3\'s edit-target-establishing content to the edit LLM context, not just the verbatim current message', async () => {
      (loadRecentConversationTurns as MockedFunction<typeof loadRecentConversationTurns>)
        .mockResolvedValueOnce(FOUR_PRIOR_TURNS);
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload({ message: 'Increase it by 10%' }),
        requestId: 'req-edit-conversation-feed',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;

      // The defect: before this fix, context.messages was hardcoded to
      // `[{ role: 'user', content: payload.message }]` — turn 3's
      // disambiguating content ("marketing spend is now the focus factor")
      // never reached the edit LLM, so a follow-up "increase it by 10%"
      // had no way to resolve "it" to the factor the user just established.
      expect(context.messages).toContainEqual({ role: 'user', content: TURN_3_USER });
      expect(context.messages).toContainEqual({ role: 'assistant', content: TURN_3_ASSISTANT });

      // Chronological order (oldest first) so the conversation reads as a
      // narrative: turn 1 precedes turn 3 precedes turn 4.
      const contents = context.messages.map((m) => m.content);
      expect(contents.indexOf(TURN_1_USER)).toBeLessThan(contents.indexOf(TURN_3_USER));
      expect(contents.indexOf(TURN_3_USER)).toBeLessThan(contents.indexOf(TURN_4_USER));

      // The current turn's message is sent separately as handleEditGraph's
      // `editDescription` argument (mock.calls[0][1]) — asserting it is NOT
      // duplicated into context.messages guards against double-counting it
      // in the rendered prompt.
      expect(contents).not.toContain('Increase it by 10%');
      const [, editDescription] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(editDescription).toBe('Increase it by 10%');
    });

    it('degrades to an empty conversation slice (not a thrown error) when the prior-turns read is empty', async () => {
      (loadRecentConversationTurns as MockedFunction<typeof loadRecentConversationTurns>)
        .mockResolvedValueOnce([]);
      (handleEditGraph as MockedFunction<typeof handleEditGraph>)
        .mockResolvedValue(makeAppliedEditResult());
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
        .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);

      await dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-edit-no-prior-turns',
        request: STUB_REQUEST,
        graphState: INGRESS_GRAPH,
        analysisState: null,
      });

      const [context] = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]!;
      expect(context.messages).toEqual([]);
    });
  });
});
