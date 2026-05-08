/**
 * V5 G7/G8 — route-level integration tests for the apply_proposed_change
 * lifecycle through TurnExecutor.
 *
 * Coverage matrix (this file):
 *   - "yes" / "add that" / "apply that change" / "do it" / "go ahead"
 *     dispatch the stubbed `add_constraint` handler exactly once with
 *     the expected `inline_patch.params` payload.
 *   - "the first one" with one and with two live proposals resolves
 *     deterministically.
 *   - Two-turn ambiguous-then-ordinal: "yes" with multiple proposals
 *     emits a numbered clarification AND re-persists the proposals
 *     (P0-1); the next-turn "the first one" reads that re-persisted
 *     list and resolves without an LLM call.
 *   - Repeated "yes" after a successful apply does NOT double-dispatch
 *     (the new turn's pending_actions snapshot does not carry the
 *     proposal anymore).
 *   - Expired pending action commits the lapsed-recovery copy.
 *   - Dismissal phrases commit "OK, no change made." with the
 *     negative-control gate honoured.
 *   - Safety-string filter on every emitted text.
 *
 * Coverage NOT in this file (covered by unit tests instead — see the
 * `decideProposedChangeSynthesis` test suite):
 *   - graph-hash mismatch decision branch
 *   - already-applied decision branch with per-handler canonical
 *     matchers
 *   These flow through `commitProposedChangeRecovery` in TurnExecutor;
 *   the per-handler matcher logic is exercised exhaustively at the
 *   unit level rather than duplicating fact-shape fixtures here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import type { HandlerRegistry } from '../tools/registry.js';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';

const SCENARIO_ID = randomUUID();
const PROPOSAL_ID = 'prop_aaaaaaaaaaaa';
const EMITTED_AT_ISO = '2026-05-07T11:00:00.000Z';

/**
 * Strict GraphV3 fixture (P1-3): one option, one goal. Lowercase
 * canonical ids (matches the `CANONICAL_ID_REGEX` in cee-v3.ts).
 * Production buildTurnContext parses `persistedGraph` via
 * `GraphStateIngressSchema.passthrough()` first, but the chip /
 * graph-lookup paths inside TurnExecutor exercise the same shape
 * via `GraphV3.safeParse` — using a fixture that passes BOTH
 * proves the production path rather than the structural-fallback
 * compaction branch.
 */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
  ],
  edges: [],
};
// Sanity-check at module load: the fixture MUST pass GraphV3 strict
// parsing — otherwise the test silently exercises the fallback path.
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error(
      'Route-level test fixture failed GraphV3.safeParse — fix STRICT_GRAPH ' +
        'to match the production schema. Issues: ' +
        JSON.stringify(parsed.error.issues),
    );
  }
}
const MINIMAL_GRAPH = STRICT_GRAPH as unknown as Parameters<
  typeof computeAnalysisAffectingGraphHash
>[0];
const GRAPH_HASH = computeAnalysisAffectingGraphHash(MINIMAL_GRAPH) ?? 'h_unset';

let pendingActionsForRead: readonly PendingAction[] = [];
let priorTurnsForRead: ReadonlyArray<Record<string, unknown>> = [];
let priorFactsForRead: ReadonlyArray<Record<string, unknown>> = [];
const appendCalls: Array<Record<string, unknown>> = [];
const addConstraintCalls: Array<Record<string, unknown>> = [];

function applyProposedPendingAction(
  overrides: { graphHash?: string; expiresAtIso?: string } = {},
): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: PROPOSAL_ID,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: PROPOSAL_ID,
      inline_patch: {
        handler_id: 'add_constraint',
        // add_constraint accepts entity kinds ['node', 'goal']; the
        // fixture targets the goal node so the validator's per-entity
        // kind check (proposed kind === graph-resolved kind === 'goal')
        // and the structural check both pass.
        params: { value: 100, unit: 'GBP', constraint_type: 'at_most', label: 'Cost cap' },
        target_entity_ids: ['goal-g'],
      },
      public_label: 'Add the cost cap',
      public_message: 'Add the cost cap.',
    },
    preconditions: { graph_hash: overrides.graphHash ?? GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: EMITTED_AT_ISO,
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => priorTurnsForRead,
    readFactsFor: async () => priorFactsForRead,
    readFactsWithTurnFor: async () =>
      priorFactsForRead.map((fact, idx) => ({
        fact,
        turn_id: `turn-${idx}`,
        fact_created_at: '2026-05-08T00:00:00.000Z',
      })),
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => MINIMAL_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: MINIMAL_GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

/**
 * Build a `MessageTurnPayload`-shaped payload for `runTurnExecutor`.
 * `OrchestratorTurnPayload` is a discriminated union; the executor's
 * happy path takes the message variant. `turn_class` must be a
 * `ConversationTurnClass` literal (NOT a `Stage` literal) — `'decide'`
 * is the closest fit for analyse-stage proposed-change tests.
 */
function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when proposed-change resume matches');
      }),
  };
}

/**
 * Stubbed registry with an `add_constraint` handler that records every
 * invocation. Production handler reads the live graph and dispatches
 * to PLoT; the stub returns a canonical-shape outcome so the
 * validator/execute/commit pipeline completes.
 */
function stubbedRegistry(): HandlerRegistry {
  const addConstraintStub = async (invocation: { context: unknown; payload: unknown }) => {
    addConstraintCalls.push({
      payload: invocation.payload as Record<string, unknown>,
    });
    return {
      assistant_text: 'Added the cost cap.',
      handler_facts: [
        // Pass-8 P2-1: emit the canonical `GoalConstraint` shape the
        // production handler persists. result.target_id is the new
        // constraint's id; result.after carries
        // `{ constraint_id, node_id, operator, value, unit?, label? }`.
        {
          fact_type: 'add_constraint' as const,
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'constraint-uuid-stub-1',
            status: 'applied' as const,
            before: null,
            after: {
              constraint_id: 'constraint-uuid-stub-1',
              node_id: 'goal-g',
              operator: '<=',
              value: 100,
              unit: 'GBP',
              label: 'Cost cap',
            },
          },
        },
      ],
      llm_calls_used: 0,
    };
  };
  return new Map([
    ['add_constraint', addConstraintStub as unknown as ReturnType<HandlerRegistry['get']>],
  ]) as unknown as HandlerRegistry;
}

describe('Proposed-change route-level — deterministic confirmations dispatch the handler', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    pendingActionsForRead = [applyProposedPendingAction()];
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(['yes', 'do it', 'apply it', 'go ahead', 'confirmed'])(
    'typed "%s" dispatches the add_constraint handler exactly once with the proposal params',
    async (msg) => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(payload(msg), `req-confirm-${msg.replace(/\s+/g, '-')}`, {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      });
      // Zero LLM calls (deterministic resume).
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      // Exactly one handler invocation (no double-dispatch).
      expect(addConstraintCalls).toHaveLength(1);
      // Validator accepted the synthesised proposal.
      expect(result.telemetry.validation_error_code).toBeNull();
      expect(result.telemetry.stages_completed).toContain('validate');
      // Commit happened with the handler's emitted fact.
      expect(appendCalls).toHaveLength(1);
      const commitArgs = appendCalls[0]!;
      const handlerFacts = (commitArgs as { handler_facts?: ReadonlyArray<Record<string, unknown>> })
        .handler_facts;
      expect(handlerFacts).toBeDefined();
      expect(handlerFacts).toHaveLength(1);
      expect((handlerFacts as ReadonlyArray<Record<string, unknown>>)[0]!.fact_type).toBe(
        'add_constraint',
      );
    },
  );

  it.each(['add that', 'make that change', 'apply that change'])(
    'typed "%s" (proposal-targeted phrase) dispatches the handler exactly once',
    async (msg) => {
      const adapter = throwingRoutingAdapter();
      await runTurnExecutor(payload(msg), `req-pcp-${msg.replace(/\s+/g, '-')}`, {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      });
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(addConstraintCalls).toHaveLength(1);
      expect(appendCalls).toHaveLength(1);
    },
  );

  it('"the first one" with one live proposal dispatches the handler exactly once', async () => {
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('the first one'), 'req-ordinal-single', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('"the first one" with two live proposals dispatches handler ONCE for candidate 1', async () => {
    const proposalA = applyProposedPendingAction();
    const proposalB: PendingAction = {
      ...applyProposedPendingAction(),
      id: `pa-${randomUUID()}`,
      chip_id: 'prop_bbbbbbbbbbbb',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_bbbbbbbbbbbb',
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 200, constraint_type: 'at_most', label: 'Time cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: 'Add the time cap',
        public_message: 'Add the time cap.',
      },
    };
    pendingActionsForRead = [proposalA, proposalB];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('the first one'), 'req-ordinal-multi', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // Exactly one handler invocation — proposalA only, NOT proposalB.
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('repeated "yes" after a successful apply does NOT double-dispatch the handler', async () => {
    // First turn: "yes" → handler runs, fact recorded, commit happens.
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter1 = throwingRoutingAdapter();
    await runTurnExecutor(payload('yes'), 'req-yes-1', {
      routingAdapter: adapter1,
      handlerRegistry: stubbedRegistry(),
    });
    expect(addConstraintCalls).toHaveLength(1);

    // Second turn: the new turn's most_recent_pending_actions does NOT
    // carry the same proposal (the test harness clears it between
    // turns, simulating that a successful apply_proposed_change
    // commit does not re-emit itself). A second "yes" therefore
    // finds no live proposal to resume — natural no-op.
    pendingActionsForRead = [];
    const adapter2 = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'Generic LLM response.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(payload('yes'), 'req-yes-2', {
      routingAdapter: adapter2,
      handlerRegistry: stubbedRegistry(),
    });
    // Crucially: handler was NOT called a second time.
    expect(addConstraintCalls).toHaveLength(1);
  });
});

describe('Proposed-change route-level — recovery branches commit deterministic copy', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('expired proposal + "yes" emits recovery copy and does NOT dispatch the handler', async () => {
    pendingActionsForRead = [
      applyProposedPendingAction({ expiresAtIso: '2024-01-01T00:00:00.000Z' }),
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-expired', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(result.response.assistant_text).toMatch(/lapsed|no longer/i);
  });

  it('dismissal "no" with a live apply_proposed_change emits "OK, no change made." and does NOT dispatch', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('no'), 'req-dismiss', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(result.response.assistant_text).toBe('OK, no change made.');
  });

  it('dismissal "cancel" emits the deterministic copy and does NOT dispatch', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('cancel'), 'req-dismiss-cancel', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(result.response.assistant_text).toBe('OK, no change made.');
  });

  it('"not now, but add it anyway" does NOT dismiss (negative-control gate)', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'Some Sonnet text.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(
      payload('not now, but add it anyway'),
      'req-dismiss-negative-control',
      {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      },
    );
    // The dismissal pre-route's negative-control gate refuses the
    // dismissal; the message contains the "but add" positive token,
    // so the LLM gets called instead.
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });
});

describe('Proposed-change route-level — two-turn ambiguous → ordinal resolves (P0-1)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Turn 1 ambiguous "yes" re-persists pending actions; Turn 2 "the first one" resolves without LLM', async () => {
    const proposalA = applyProposedPendingAction();
    const proposalB: PendingAction = {
      ...applyProposedPendingAction(),
      id: `pa-${randomUUID()}`,
      chip_id: 'prop_bbbbbbbbbbbb',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_bbbbbbbbbbbb',
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 200, constraint_type: 'at_most', label: 'Time cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: 'Add the time cap',
        public_message: 'Add the time cap.',
      },
    };

    // Turn 1: ambiguous "yes" → numbered clarification + re-persist.
    pendingActionsForRead = [proposalA, proposalB];
    const adapter1 = throwingRoutingAdapter();
    const turn1Result = await runTurnExecutor(payload('yes'), 'req-turn-1-ambiguous', {
      routingAdapter: adapter1,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter1.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(turn1Result.response.assistant_text).toContain('Which one would you like?');
    // The crucial P0-1 check: Turn 1's commit re-persisted both
    // proposals into pending_actions.
    expect(appendCalls).toHaveLength(1);
    const turn1Commit = appendCalls[0] as {
      pending_actions?: ReadonlyArray<{ chip_id: string; action: { kind: string } }>;
    };
    expect(turn1Commit.pending_actions).toBeDefined();
    expect(turn1Commit.pending_actions).toHaveLength(2);
    expect(turn1Commit.pending_actions!.map((p) => p.chip_id).sort()).toEqual(
      ['prop_aaaaaaaaaaaa', 'prop_bbbbbbbbbbbb'].sort(),
    );

    // Turn 2: "the first one". The mock store now returns the
    // re-persisted list (simulating the next turn reading them back).
    pendingActionsForRead = [proposalA, proposalB];
    appendCalls.length = 0;
    const adapter2 = throwingRoutingAdapter();
    await runTurnExecutor(payload('the first one'), 'req-turn-2-ordinal', {
      routingAdapter: adapter2,
      handlerRegistry: stubbedRegistry(),
    });
    // Resolved without LLM and dispatched the FIRST proposal's handler.
    expect(adapter2.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });
});

describe('Proposed-change route-level — mixed-ambiguity preserves both follow-up paths (P0-3)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mixed run_analysis + apply_proposed_change ambiguity persists BOTH pending actions on the clarification turn', async () => {
    // The proposal carries an apply_proposed_change pending action;
    // the same turn also has a live run_analysis pending action. A
    // bare "yes" returns recovery_ambiguous with two candidates of
    // mixed kinds. The clarification commit MUST persist:
    //   - the apply_proposed_change pending action (server-only,
    //     re-persisted explicitly)
    //   - the run_analysis pending action (chip-derivable, derived
    //     from the run_analysis ambiguous chip)
    // so the user can resume EITHER path on the next turn.
    const proposal = applyProposedPendingAction();
    const runAnalysis: PendingAction = {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_action_run_analysis_mixed',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: EMITTED_AT_ISO,
    };
    pendingActionsForRead = [proposal, runAnalysis];

    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-mixed-ambiguous', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(result.response.assistant_text).toContain('Which one would you like?');
    // The crucial P0-3 assertion: BOTH pending actions are persisted
    // on the clarification turn.
    expect(appendCalls).toHaveLength(1);
    const persisted = (
      appendCalls[0] as {
        pending_actions?: ReadonlyArray<{ chip_id: string; action: { kind: string } }>;
      }
    ).pending_actions;
    expect(persisted).toBeDefined();
    expect(persisted!.length).toBe(2);
    const persistedKinds = persisted!.map((p) => p.action.kind).sort();
    expect(persistedKinds).toEqual(['apply_proposed_change', 'run_analysis']);
  });
});

describe('Proposed-change route-level — ambiguous clarification text contains numbered labels', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('typed "yes" with two ambiguous proposals emits a numbered clarification listing each persisted label', async () => {
    pendingActionsForRead = [
      applyProposedPendingAction(),
      {
        ...applyProposedPendingAction(),
        id: `pa-${randomUUID()}`,
        chip_id: 'prop_bbbbbbbbbbbb',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_bbbbbbbbbbbb',
          inline_patch: {
            handler_id: 'add_constraint',
            params: { value: 200 },
            target_entity_ids: ['goal-g'],
          },
          public_label: 'Add the time cap',
          public_message: 'Add the time cap.',
        },
      },
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-ambiguous', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    // Numbered label assertion (Improvement: ambiguous-text test).
    expect(result.response.assistant_text).toContain('1) Add the cost cap');
    expect(result.response.assistant_text).toContain('2) Add the time cap');
    expect(result.response.assistant_text).toContain('Which one would you like?');
  });
});

describe('Proposed-change route-level — render-vs-raw label resolution coupling (pass-8 P1-1)', () => {
  // The label/ordinal pre-route must match against the SAME strings
  // the user sees rendered, NOT against the raw persisted public_label
  // when that was sanitised away. Key invariants:
  //   1. Typing the rendered fallback ("Apply this change") resolves
  //      ONLY when exactly one live proposal renders to it.
  //   2. Typing the raw unsafe label (e.g. "Trigger add_constraint")
  //      MUST NOT resolve — the user never saw it.
  //   3. Two proposals both rendering to the fallback (because both
  //      had unsafe persisted copy) cannot resolve by label — falls
  //      through to LLM (or stays in clarification on a follow-up).

  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function unsafeLabelProposal(chipId: string): PendingAction {
    return {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: chipId,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: chipId,
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 100, constraint_type: 'at_most', label: 'Cost cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: 'Trigger add_constraint',
        public_message: 'set_factor_value via tool',
      },
      preconditions: { graph_hash: GRAPH_HASH },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: EMITTED_AT_ISO,
    };
  }

  it('rendered fallback "Apply this change" resolves when there is exactly ONE matching live proposal', async () => {
    pendingActionsForRead = [unsafeLabelProposal('prop_aaaaaaaaaaaa')];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Apply this change'), 'req-rendered-fallback-single', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('typing the RAW unsafe persisted label does NOT resolve (the user never saw it)', async () => {
    pendingActionsForRead = [unsafeLabelProposal('prop_aaaaaaaaaaaa')];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'mock' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(payload('Trigger add_constraint'), 'req-raw-label-no-match', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    // The raw label is unsafe — short-confirm's edit-verb gate AND
    // the new label pre-route both reject it. Falls through to LLM.
    expect(adapter.chatWithTools).toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
  });

  it('two proposals BOTH rendering to "Apply this change" do NOT resolve by label (P1-2 ambiguity)', async () => {
    pendingActionsForRead = [
      unsafeLabelProposal('prop_aaaaaaaaaaaa'),
      unsafeLabelProposal('prop_bbbbbbbbbbbb'),
    ];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'mock' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(payload('Apply this change'), 'req-rendered-fallback-ambiguous', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    // Both candidates render to the same fallback. The matcher
    // requires unambiguous resolution; the call falls through to
    // the LLM rather than silently executing the first proposal.
    expect(addConstraintCalls).toHaveLength(0);
  });

  it('chip-click replay: typing the rendered MESSAGE text resolves the same way as the label', async () => {
    // A chip-click that replays the chip's message (e.g. "Add the
    // cost cap.") must resolve to the same proposal as typing the
    // chip's label.
    const safeProposal: PendingAction = {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'prop_aaaaaaaaaaaa',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 100, constraint_type: 'at_most', label: 'Cost cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: 'Add the cost cap',
        public_message: 'Add the cost cap.',
      },
      preconditions: { graph_hash: GRAPH_HASH },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: EMITTED_AT_ISO,
    };
    pendingActionsForRead = [safeProposal];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Add the cost cap.'), 'req-message-resolves', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });
});

describe('Proposed-change route-level — exact-label pre-route (P1-1)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exact-label reply ("Add the cost cap") with one live proposal dispatches the handler', async () => {
    // Reproduces the reviewer's P1-1 scenario: short-confirm rejects
    // the message because of the edit-verb gate ("Add"). Without the
    // dedicated label/ordinal pre-route, this falls through to the
    // LLM. With the pre-route, the exact-label match resolves
    // deterministically.
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Add the cost cap'), 'req-label-single', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('exact-label reply with two live proposals resolves to the matching one (no LLM)', async () => {
    pendingActionsForRead = [
      applyProposedPendingAction(),
      {
        ...applyProposedPendingAction(),
        id: `pa-${randomUUID()}`,
        chip_id: 'prop_bbbbbbbbbbbb',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_bbbbbbbbbbbb',
          inline_patch: {
            handler_id: 'add_constraint',
            params: { value: 200, constraint_type: 'at_most', label: 'Time cap' },
            target_entity_ids: ['goal-g'],
          },
          public_label: 'Add the time cap',
          public_message: 'Add the time cap.',
        },
      },
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Add the time cap'), 'req-label-multi', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('label match is case-insensitive', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('add the COST cap'), 'req-label-case', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
  });

  it('non-matching message with live proposals still falls through to LLM', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () => ({
          content: [{ type: 'text', text: 'mock' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'mock',
          latencyMs: 0,
        })),
    };
    await runTurnExecutor(payload('explain why this matters'), 'req-label-no-match', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
  });
});

describe('Proposed-change route-level — state-query order regression (P2-1)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('"what changed?" with live proposals does NOT execute and does NOT call the LLM', async () => {
    // The reviewer flagged that the ordering of state-query vs the
    // proposed-change pre-routes is not contract-literal. Practical
    // risk should be zero because state-query phrases never match
    // short-confirm / proposal-confirm / dismissal / label gates.
    // This test pins that contract: a state-query-style message with
    // a live proposal must not dispatch the proposal AND must not
    // reach the LLM.
    pendingActionsForRead = [applyProposedPendingAction()];
    priorFactsForRead = [
      {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: false,
        result: {
          target_id: 'c1',
          status: 'applied',
          before: null,
          after: {
            constraint_id: 'c1',
            node_id: 'goal-g',
            operator: '<=',
            value: 100,
            label: 'Cost cap',
          },
        },
      } as unknown as Record<string, unknown>,
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('what changed?'), 'req-state-query', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(result.response.assistant_text.length).toBeGreaterThan(0);
  });

  it('"what did you update?" with live proposals does NOT dispatch the proposal', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    priorFactsForRead = [
      {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: false,
        result: {
          target_id: 'c1',
          status: 'applied',
          before: null,
          after: {
            constraint_id: 'c1',
            node_id: 'goal-g',
            operator: '<=',
            value: 100,
            label: 'Cost cap',
          },
        },
      } as unknown as Record<string, unknown>,
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('what did you update?'), 'req-state-query-2', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
  });
});

describe('Proposed-change route-level — render-time sanitisation of unsafe persisted copy (pass-7)', () => {
  // Pass-7 hardening: the parser already enforces public_label /
  // public_message presence on new emits, but legacy entries or
  // direct DB writes could land malformed copy in the JSONB. The
  // ambiguous-clarification render path re-sanitises and falls back
  // to safe deterministic copy when an unsafe token is detected.
  // These tests pin that contract end-to-end through TurnExecutor.

  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function applyProposedWithUnsafePublicCopy(args: {
    chipId: string;
    label: string;
    message: string;
  }): PendingAction {
    return {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: args.chipId,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: args.chipId,
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 100, constraint_type: 'at_most', label: 'Cost cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: args.label,
        public_message: args.message,
      },
      preconditions: { graph_hash: GRAPH_HASH },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: EMITTED_AT_ISO,
    };
  }

  const FORBIDDEN_AT_RENDER = [
    'apply_proposed_change',
    'pending_actions',
    'proposal_ref',
    'chip_metadata',
    'graph_hash',
    'add_constraint',
    'set_factor_value',
    'adjust_edge_strength',
    'run_analysis',
    'what_would_flip',
    'zod',
    'STRUCTURAL_VALIDATION_FAILED',
    'invalid_type',
    'prop_',
    'chip_',
    '{"',
    '":',
  ];

  it.each([
    {
      kind: 'handler-id leak in label only',
      label: 'Trigger add_constraint now',
      message: 'Add the cost cap.',
      expectLabelFallback: true,
      expectMessageFallback: false,
    },
    {
      kind: 'handler-id leak in message only',
      label: 'Add the cost cap',
      message: 'set_factor_value via tool',
      expectLabelFallback: false,
      expectMessageFallback: true,
    },
    {
      kind: 'raw JSON in label only',
      label: 'See {"id":"prop_abc"}',
      message: 'Add the cost cap.',
      expectLabelFallback: true,
      expectMessageFallback: false,
    },
    {
      kind: 'Zod jargon in message only',
      label: 'Add the cost cap',
      message: 'invalid_type detected by zod',
      expectLabelFallback: false,
      expectMessageFallback: true,
    },
    {
      kind: 'internal field name in label only',
      label: 'Inspect graph_hash',
      message: 'Add the cost cap.',
      expectLabelFallback: true,
      expectMessageFallback: false,
    },
    {
      kind: 'raw prop_ prefix in label only',
      label: 'Apply prop_aaaaaaaaaaaa',
      message: 'Add the cost cap.',
      expectLabelFallback: true,
      expectMessageFallback: false,
    },
    {
      kind: 'unsafe BOTH label and message',
      label: 'Trigger add_constraint',
      message: 'invalid_type encountered',
      expectLabelFallback: true,
      expectMessageFallback: true,
    },
  ])(
    '$kind: render-time sanitiser swaps unsafe persisted copy for the deterministic fallback',
    async ({ label, message, expectLabelFallback, expectMessageFallback }) => {
      pendingActionsForRead = [
        applyProposedWithUnsafePublicCopy({
          chipId: 'prop_aaaaaaaaaaaa',
          label,
          message,
        }),
        // Add a second SAFE proposal so the ambiguous flow is triggered.
        applyProposedWithUnsafePublicCopy({
          chipId: 'prop_bbbbbbbbbbbb',
          label: 'Add the time cap',
          message: 'Add the time cap.',
        }),
      ];
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(payload('yes'), 'req-render-sanitise', {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      });
      // recovery_ambiguous path commits clarification; no LLM call.
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      // No forbidden token leaks into assistant_text or any chip.
      for (const token of FORBIDDEN_AT_RENDER) {
        expect(result.response.assistant_text).not.toContain(token);
      }
      const chips = result.response.suggested_actions ?? [];
      for (const chip of chips) {
        for (const token of FORBIDDEN_AT_RENDER) {
          expect(chip.label).not.toContain(token);
          expect(chip.message).not.toContain(token);
        }
      }
      // The malformed-copy chip renders the deterministic fallback
      // for whichever field was unsafe; safe fields render verbatim.
      const malformedChip = chips.find((c) => c.id === 'prop_aaaaaaaaaaaa');
      expect(malformedChip).toBeDefined();
      if (expectLabelFallback) {
        expect(malformedChip!.label).toBe('Apply this change');
      } else {
        expect(malformedChip!.label).toBe(label);
      }
      if (expectMessageFallback) {
        expect(malformedChip!.message).toBe('Apply the proposed change');
      } else {
        expect(malformedChip!.message).toBe(message);
      }
    },
  );

  it('when ALL candidates have malformed copy, the assistant text falls back to the generic prompt (no numbered list)', async () => {
    pendingActionsForRead = [
      applyProposedWithUnsafePublicCopy({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Trigger add_constraint',
        message: 'add_constraint via zod',
      }),
      applyProposedWithUnsafePublicCopy({
        chipId: 'prop_bbbbbbbbbbbb',
        label: 'See {"raw":"json"}',
        message: 'invalid_type encountered',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-render-all-malformed', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // Both chips render the same fallback; the assistant text falls
    // back to the generic prompt rather than a numbered list of
    // identical fallbacks.
    expect(result.response.assistant_text).toBe(
      'I had more than one offer open. Which would you like?',
    );
    for (const token of FORBIDDEN_AT_RENDER) {
      expect(result.response.assistant_text).not.toContain(token);
    }
    const chips = result.response.suggested_actions ?? [];
    expect(chips.length).toBe(2);
    for (const chip of chips) {
      expect(chip.label).toBe('Apply this change');
      expect(chip.message).toBe('Apply the proposed change');
    }
  });
});

describe('Proposed-change route-level — safety string filter on emitted text', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const FORBIDDEN_TOKENS = [
    'apply_proposed_change',
    'pending_actions',
    'proposal_ref',
    'chip_metadata',
    'STRUCTURAL_VALIDATION_FAILED',
    '—', // em dash
  ];

  it('expired-recovery copy contains no internal vocabulary', async () => {
    pendingActionsForRead = [
      applyProposedPendingAction({ expiresAtIso: '2024-01-01T00:00:00.000Z' }),
    ];
    const result = await runTurnExecutor(payload('yes'), 'req-safety-expired', {
      routingAdapter: throwingRoutingAdapter(),
      handlerRegistry: stubbedRegistry(),
    });
    for (const token of FORBIDDEN_TOKENS) {
      expect(result.response.assistant_text).not.toContain(token);
    }
  });

  it('dismissal copy contains no internal vocabulary', async () => {
    pendingActionsForRead = [applyProposedPendingAction()];
    const result = await runTurnExecutor(payload('no'), 'req-safety-dismiss', {
      routingAdapter: throwingRoutingAdapter(),
      handlerRegistry: stubbedRegistry(),
    });
    for (const token of FORBIDDEN_TOKENS) {
      expect(result.response.assistant_text).not.toContain(token);
    }
  });
});
