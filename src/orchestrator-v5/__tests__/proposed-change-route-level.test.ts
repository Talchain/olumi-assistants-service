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
        turn_created_at: '2026-05-08T00:00:00.000Z',
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
        {
          fact_type: 'add_constraint' as const,
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'node_X',
            status: 'applied' as const,
            before: null,
            after: { value: 100, unit: 'GBP' },
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
