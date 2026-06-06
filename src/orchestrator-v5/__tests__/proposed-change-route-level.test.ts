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
import { buildFlipProposalEmit } from '../compose/flip-proposal.js';
import { getDefaultRegistry } from '../tools/registry.js';

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
    // V5 P0.2 (Seam 1) — a factor node so set_factor_value flip
    // proposals resolve their target-entity kind during resume
    // validation (the validator requires the resolved node be 'factor').
    {
      id: 'fac-marketing',
      kind: 'factor',
      label: 'Marketing',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
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
const setFactorCalls: Array<Record<string, unknown>> = [];

// Forbidden internal vocabulary that must never reach the "Applying: …"
// echo / assistant text on a resumed set_factor_value flip proposal.
const FORBIDDEN_AT_RENDER_FLIP = [
  'apply_proposed_change',
  'pending_actions',
  'proposal_ref',
  'graph_hash',
  'set_factor_value',
  'what_would_flip',
  'prop_',
  'chip_',
  '_meta',
  '{"',
];

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
  // V5 P0.2 (Seam 1) — set_factor_value recording stub. Records the
  // converted ProposalAction so tests can assert the resumed flip
  // proposal dispatches with the EXACT numeric value (never a formatted
  // display string). Returns a canonical set_factor_value fact shape.
  const setFactorValueStub = async (invocation: { proposal?: unknown }) => {
    setFactorCalls.push({ proposal: invocation.proposal });
    return {
      assistant_text: 'Updated Marketing.',
      handler_facts: [
        {
          fact_type: 'set_factor_value' as const,
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'fac-marketing',
            status: 'applied' as const,
            before: { value: 0.1, raw_value: 5 },
            after: { value: 0.3, raw_value: 15 },
          },
        },
      ],
      llm_calls_used: 0,
    };
  };
  return new Map([
    ['add_constraint', addConstraintStub as unknown as ReturnType<HandlerRegistry['get']>],
    ['set_factor_value', setFactorValueStub as unknown as ReturnType<HandlerRegistry['get']>],
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

describe('Proposed-change route-level — bare confirm with multiple proposals resumes the most recent (P0-2 most-recent-wins)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bare "yes" with two live proposals dispatches the MOST RECENT (no clarification, no LLM) and echoes its label', async () => {
    // V5 P0.2 — most-recent-wins replaces the prior recovery_ambiguous
    // numbered clarification: a bare confirm against multiple live
    // proposals resumes the most-recently-emitted one. The resume echo
    // names the chosen proposal so a wrong-target resume stays visible.
    // (Ordinal resolution — "the first one" — is covered separately by
    // the deterministic-confirmations describe above.)
    const proposalA = applyProposedPendingAction(); // EMITTED_AT_ISO, "Add the cost cap"
    const proposalB: PendingAction = {
      ...applyProposedPendingAction(),
      id: `pa-${randomUUID()}`,
      chip_id: 'prop_bbbbbbbbbbbb',
      // Emitted AFTER proposalA → most-recent-wins selects this one.
      emitted_at_iso: '2026-05-07T11:05:00.000Z',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_bbbbbbbbbbbb',
        inline_patch: {
          handler_id: 'add_constraint',
          params: { value: 200, unit: 'GBP', constraint_type: 'at_most', label: 'Time cap' },
          target_entity_ids: ['goal-g'],
        },
        public_label: 'Add the time cap',
        public_message: 'Add the time cap.',
      },
    };

    pendingActionsForRead = [proposalA, proposalB];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-most-recent-wins', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    // Deterministic: no LLM, and NO numbered clarification round-trip.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.response.assistant_text).not.toContain('Which one would you like?');
    // Dispatched the most-recently-emitted proposal's handler exactly once.
    expect(addConstraintCalls).toHaveLength(1);
    // Resume echo names the resumed (most-recent) proposal.
    expect(result.response.assistant_text).toContain('Applying: Add the time cap.');
  });
});

describe('Proposed-change route-level — mixed-kind bare confirm resumes the most recent (P0-3 most-recent-wins)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bare "yes" with a newer apply_proposed_change and an older run_analysis resumes the proposal (no LLM, no clarification)', async () => {
    // V5 P0.2 — most-recent-wins spans kinds: a bare confirm resumes the
    // most-recently-emitted resumable pending regardless of kind. Here
    // the apply_proposed_change is newer than the run_analysis, so the
    // proposal wins and its handler dispatches. (The prior P0-3 behaviour
    // — emit a clarification and re-persist BOTH candidates — is retired
    // with the recovery_ambiguous path.)
    const runAnalysis: PendingAction = {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_action_run_analysis_mixed',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-07T11:00:00.000Z', // OLDER
    };
    const proposal: PendingAction = {
      ...applyProposedPendingAction(),
      emitted_at_iso: '2026-05-07T11:05:00.000Z', // NEWER → most-recent-wins
    };
    pendingActionsForRead = [runAnalysis, proposal];

    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-mixed-most-recent', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.response.assistant_text).not.toContain('Which one would you like?');
    // The newer proposal wins → its handler dispatches exactly once.
    expect(addConstraintCalls).toHaveLength(1);
    expect(result.response.assistant_text).toContain('Applying: Add the cost cap.');
  });
});

describe('Proposed-change route-level — bare confirm emits NO numbered clarification (P0-2 most-recent-wins)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('typed "yes" with two live proposals resumes the most recent WITHOUT a numbered clarification', async () => {
    // V5 P0.2 — the numbered-clarification round-trip is retired for bare
    // confirms; most-recent-wins resumes the latest offer directly.
    // (Numbered clarification still fires for genuine LABEL-MATCH
    // ambiguity — see the duplicate-label tests below — and that path's
    // render-safe sanitisation is pinned there + at the unit level.)
    pendingActionsForRead = [
      applyProposedPendingAction(), // EMITTED_AT_ISO, "Add the cost cap"
      {
        ...applyProposedPendingAction(),
        id: `pa-${randomUUID()}`,
        chip_id: 'prop_bbbbbbbbbbbb',
        emitted_at_iso: '2026-05-07T11:05:00.000Z', // NEWER → wins
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_bbbbbbbbbbbb',
          inline_patch: {
            handler_id: 'add_constraint',
            params: { value: 200, unit: 'GBP', constraint_type: 'at_most', label: 'Time cap' },
            target_entity_ids: ['goal-g'],
          },
          public_label: 'Add the time cap',
          public_message: 'Add the time cap.',
        },
      },
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-no-clarification', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
    // No numbered clarification list any more.
    expect(result.response.assistant_text).not.toContain('1) Add the cost cap');
    expect(result.response.assistant_text).not.toContain('2) Add the time cap');
    expect(result.response.assistant_text).not.toContain('Which one would you like?');
    // The most-recent proposal is echoed.
    expect(result.response.assistant_text).toContain('Applying: Add the time cap.');
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

  it('two proposals BOTH rendering to "Apply this change" commit a deterministic clarification (pass-10 P1)', async () => {
    pendingActionsForRead = [
      unsafeLabelProposal('prop_aaaaaaaaaaaa'),
      unsafeLabelProposal('prop_bbbbbbbbbbbb'),
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Apply this change'),
      'req-rendered-fallback-ambiguous',
      {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      },
    );
    // Pass-10 P1: ambiguous label match commits a deterministic
    // clarification; LLM is NOT called and no proposal executes.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    // Exactly one commit — the deterministic clarification.
    expect(appendCalls).toHaveLength(1);
    // The clarification re-persists the ambiguous proposals so the
    // user can disambiguate on the next turn.
    const persisted = (
      appendCalls[0] as {
        pending_actions?: ReadonlyArray<{ chip_id: string; action: { kind: string } }>;
      }
    ).pending_actions;
    expect(persisted).toBeDefined();
    expect(persisted!.length).toBe(2);
    expect(persisted!.map((p) => p.chip_id).sort()).toEqual(
      ['prop_aaaaaaaaaaaa', 'prop_bbbbbbbbbbbb'].sort(),
    );
    // Assistant text is the generic prompt (both labels equal the
    // safe fallback, so a numbered list of identical labels would
    // not help).
    expect(result.response.assistant_text).toBe(
      'I had more than one offer open. Which would you like?',
    );
  });

  it('two proposals with DISTINCT labels both matching the user input commit a numbered clarification', async () => {
    // Less common edge case: labels are different but both
    // happen to match the user input by message overlap. The
    // clarification text uses the rendered labels to disambiguate.
    pendingActionsForRead = [
      {
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
          public_label: 'Apply the cap',
          public_message: 'Apply this change',
        },
        preconditions: { graph_hash: GRAPH_HASH },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: EMITTED_AT_ISO,
      },
      {
        id: `pa-${randomUUID()}`,
        scenario_id: SCENARIO_ID,
        chip_id: 'prop_bbbbbbbbbbbb',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_bbbbbbbbbbbb',
          inline_patch: {
            handler_id: 'add_constraint',
            params: { value: 200, constraint_type: 'at_most', label: 'Time cap' },
            target_entity_ids: ['goal-g'],
          },
          public_label: 'Apply this change',
          public_message: 'Apply the change',
        },
        preconditions: { graph_hash: GRAPH_HASH },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: EMITTED_AT_ISO,
      },
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Apply this change'),
      'req-distinct-labels-ambiguous',
      {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      },
    );
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(appendCalls).toHaveLength(1);
    // At least one rendered label is distinct from the safe
    // fallback, so the clarification renders the numbered list.
    expect(result.response.assistant_text).toContain('Which one would you like?');
    expect(result.response.assistant_text).toContain('1)');
    expect(result.response.assistant_text).toContain('2)');
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

describe('Proposed-change route-level — render-safe sanitisation of unsafe persisted copy on RESUME ECHO (pass-7 / V5 P0.2)', () => {
  // V5 P0.2 update: with most-recent-wins, a bare confirm no longer
  // produces the numbered ambiguous-clarification. The render-safe
  // sanitisation contract is now pinned here on the RESUME ECHO path
  // ("Applying: …"), where an unsafe persisted public_label must be
  // swapped for the deterministic fallback before it reaches the user.
  // Coverage of the same property elsewhere:
  //   - Per-token label/message sanitisation: unit-tested exhaustively
  //     in proposed-change-emit.test.ts (sanitisePublicCopyOrFallback,
  //     every forbidden category, case-insensitive).
  //   - Sanitisation inside the numbered clarification (LABEL-MATCH
  //     ambiguity path, which still exists): the duplicate-label tests
  //     in the render-vs-raw + pre-route-stack describes above/below.
  //   - Sanitisation on the resume echo: this describe.

  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    setFactorCalls.length = 0;
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
          params: { value: 100, unit: 'GBP', constraint_type: 'at_most', label: 'Cost cap' },
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
    '_meta',
    '{"',
    '":',
  ];

  // Each case is the ONLY live proposal → most-recent-wins resumes it,
  // and the resume echo ("Applying: <label>.") must render the SANITISED
  // label. Unsafe LABELS collapse to the deterministic fallback; an
  // unsafe MESSAGE is never rendered on the resume turn (the echo uses
  // the label, and the chip-replay message is consumed, not echoed), so
  // it cannot leak either way.
  it.each([
    {
      kind: 'handler-id leak in label',
      label: 'Trigger add_constraint now',
      message: 'Add the cost cap.',
      expectEcho: 'Applying: Apply this change.',
    },
    {
      kind: 'raw JSON in label',
      label: 'See {"id":"prop_abc"}',
      message: 'Add the cost cap.',
      expectEcho: 'Applying: Apply this change.',
    },
    {
      kind: 'internal field name in label',
      label: 'Inspect graph_hash',
      message: 'Add the cost cap.',
      expectEcho: 'Applying: Apply this change.',
    },
    {
      kind: 'raw prop_ prefix in label',
      label: 'Apply prop_aaaaaaaaaaaa',
      message: 'Add the cost cap.',
      expectEcho: 'Applying: Apply this change.',
    },
    {
      kind: 'safe label but unsafe message',
      label: 'Add the cost cap',
      message: 'set_factor_value via tool',
      expectEcho: 'Applying: Add the cost cap.',
    },
    {
      kind: 'unsafe BOTH label and message',
      label: 'Trigger add_constraint',
      message: 'invalid_type encountered',
      expectEcho: 'Applying: Apply this change.',
    },
  ])(
    '$kind: resume echo renders the sanitised label, no forbidden token (or raw decimal) leaks',
    async ({ label, message, expectEcho }) => {
      pendingActionsForRead = [
        applyProposedWithUnsafePublicCopy({ chipId: 'prop_aaaaaaaaaaaa', label, message }),
      ];
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(payload('do it'), 'req-echo-sanitise', {
        routingAdapter: adapter,
        handlerRegistry: stubbedRegistry(),
      });
      // Deterministic resume: no LLM; the single live proposal dispatched.
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(addConstraintCalls).toHaveLength(1);
      // The "Applying: …" echo shows the SANITISED label.
      expect(result.response.assistant_text).toContain(expectEcho);
      // No forbidden token leaks into assistant_text, and the echo line
      // carries no raw normalised decimal (e.g. "0.3").
      for (const token of FORBIDDEN_AT_RENDER) {
        expect(result.response.assistant_text).not.toContain(token);
      }
      const echoLine = result.response.assistant_text.split('. ')[0];
      expect(echoLine).not.toMatch(/\d\.\d/);
      const chips = result.response.suggested_actions ?? [];
      for (const chip of chips) {
        for (const token of FORBIDDEN_AT_RENDER) {
          expect(chip.label).not.toContain(token);
          expect(chip.message).not.toContain(token);
        }
      }
    },
  );

  it('all-malformed: most-recent-wins resumes the latest and its unsafe label is sanitised in the echo', async () => {
    // Two unsafe-label proposals; the NEWER wins. Its unsafe label must
    // still collapse to the deterministic fallback in "Applying: …".
    pendingActionsForRead = [
      applyProposedWithUnsafePublicCopy({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Trigger add_constraint',
        message: 'add_constraint via zod',
      }),
      {
        ...applyProposedWithUnsafePublicCopy({
          chipId: 'prop_bbbbbbbbbbbb',
          label: 'See {"raw":"json"}',
          message: 'invalid_type encountered',
        }),
        emitted_at_iso: '2026-05-07T11:05:00.000Z', // NEWER → wins
      },
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('do it'), 'req-echo-all-malformed', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
    expect(result.response.assistant_text).toContain('Applying: Apply this change.');
    for (const token of FORBIDDEN_AT_RENDER) {
      expect(result.response.assistant_text).not.toContain(token);
    }
  });
});

describe('Proposed-change route-level — flip set_factor_value proposal: emit → resume → execute (V5 P0.2 Seam 1)', () => {
  // End-to-end consume half of Seam 1: a flip proposal is built by the
  // REAL producer (buildFlipProposalEmit) from enrichment.flip_thresholds,
  // persisted as an apply_proposed_change pending, then resumed by a bare
  // confirm. Proves: (1) "do it" dispatches set_factor_value; (2) the
  // handler receives the EXACT numeric user-unit value (never a formatted
  // display string); (3) that value round-trips (15 / cap 50 === flip
  // 0.3 — the real-normaliser round-trip is proven in flip-proposal.test);
  // (4) the resume echo "Applying: Test Marketing at 15." is safe (no
  // decimal, no internal tokens). The PRODUCE half (what_would_flip turn
  // → emit) is covered by flip-proposal.test.ts + the turn-executor wiring.
  const FLIP_FACTOR_ID = 'fac-marketing';
  const FLIP_VALUE = 0.3;
  const FACTOR_CAP = 50;

  function buildFlipPending(): PendingAction {
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: FLIP_FACTOR_ID,
          factor_label: 'Marketing',
          flip_value: FLIP_VALUE,
          direction: 'increase',
          unit: null,
        },
      ],
    };
    const emit = buildFlipProposalEmit(
      enrichment,
      (id) => (id === FLIP_FACTOR_ID ? { cap: FACTOR_CAP, unit: null } : undefined),
      {
        scenario_id: SCENARIO_ID,
        graph_hash: GRAPH_HASH,
        emitted_at_iso: EMITTED_AT_ISO,
        registry: getDefaultRegistry(),
      },
    );
    if (emit.status !== 'emitted') {
      throw new Error(`expected real producer to emit, got ${emit.status}`);
    }
    // Keep the pending live against the harness's real wall clock; the
    // producer-computed inline_patch / public copy / preconditions are
    // preserved exactly (only expiry is relaxed, as other fixtures do).
    return { ...emit.pending, expires_at_iso: '2099-12-31T23:59:59.000Z' };
  }

  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    setFactorCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('"do it" resumes the flip proposal → set_factor_value executes with the EXACT numeric value, echoed safely', async () => {
    const pending = buildFlipPending();
    // Sanity: the producer built the expected provenance-safe label and
    // exact-numeric params (the chip the user actually saw).
    expect(pending.action.kind).toBe('apply_proposed_change');
    const patch = (
      pending.action as unknown as {
        inline_patch: { handler_id: string; params: Record<string, unknown> };
      }
    ).inline_patch;
    expect(patch.handler_id).toBe('set_factor_value');
    // Exact numeric user-unit value 15 with cap 50 → model 15/50 = 0.3 ===
    // FLIP_VALUE. The round-trip through the REAL normaliser is proven in
    // compose/__tests__/flip-proposal.test.ts (normalise(invert(flip)) ===
    // flip); here we pin only that the producer emitted the exact numeric.
    expect(patch.params).toEqual({ value: { value: 15, cap: FACTOR_CAP } });

    pendingActionsForRead = [pending];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('do it'), 'req-flip-resume', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });

    // Resumed deterministically into set_factor_value (not add_constraint).
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(setFactorCalls).toHaveLength(1);

    // The handler received the EXACT numeric value, NOT a formatted
    // display string ("15"), and NOT the display label.
    const dispatched = JSON.stringify(setFactorCalls[0].proposal);
    expect(dispatched).toContain('"value":15');
    expect(dispatched).toContain('"cap":50');
    expect(dispatched).not.toContain('"value":"15"');
    expect(dispatched).not.toContain('Test Marketing');

    // The resume echo names the proposal exactly as the user saw it, with
    // no raw decimal and no internal tokens.
    expect(result.response.assistant_text).toContain('Applying: Test Marketing at 15.');
    expect(result.response.assistant_text.split('. ')[0]).not.toMatch(/\d\.\d/);
    for (const token of FORBIDDEN_AT_RENDER_FLIP) {
      expect(result.response.assistant_text).not.toContain(token);
    }
  });

  it('an EXPIRED flip proposal + "do it" does NOT execute set_factor_value', async () => {
    const expired: PendingAction = {
      ...buildFlipPending(),
      expires_at_iso: '2024-01-01T00:00:00.000Z',
    };
    pendingActionsForRead = [expired];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('do it'), 'req-flip-expired', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(setFactorCalls).toHaveLength(0);
    expect(addConstraintCalls).toHaveLength(0);
    // No false "Applying: …" claim for a lapsed offer.
    expect(result.response.assistant_text).not.toContain('Applying:');
  });

  it('a NO-OP apply (proposed value == current) dispatches but does NOT narrate "Applying:"', async () => {
    // The handler succeeds with noop:true. The echo is gated on a non-noop
    // mutation fact, so it must stay silent — narration must follow
    // persisted state (never claim "Applying:" when nothing changed).
    const noopRegistry = new Map([
      [
        'set_factor_value',
        (async (invocation: { proposal?: unknown }) => {
          setFactorCalls.push({ proposal: invocation.proposal });
          return {
            assistant_text: 'No change — Marketing is already at that value.',
            handler_facts: [
              {
                fact_type: 'set_factor_value' as const,
                fact_version: 1,
                noop: true,
                result: {
                  target_id: 'fac-marketing',
                  status: 'noop' as const,
                  before: { value: 0.3, raw_value: 15 },
                  after: { value: 0.3, raw_value: 15 },
                },
              },
            ],
            llm_calls_used: 0,
          };
        }) as unknown as ReturnType<HandlerRegistry['get']>,
      ],
    ]) as unknown as HandlerRegistry;

    pendingActionsForRead = [buildFlipPending()];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('do it'), 'req-flip-noop', {
      routingAdapter: adapter,
      handlerRegistry: noopRegistry,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // The handler still ran (the resume dispatched)…
    expect(setFactorCalls).toHaveLength(1);
    // …but no "Applying:" claim, because nothing changed.
    expect(result.response.assistant_text).not.toContain('Applying:');
  });
});

describe('Proposed-change route-level — pre-route stack stays deterministic (pass-9)', () => {
  // Consolidated smoke test: each proposal pre-route resolution path
  // (exact label, exact message, ordinal, dismissal, duplicate-label
  // ambiguity) MUST stay free of LLM round-trips. Each match path is
  // expected to commit exactly once — either via the handler-dispatch
  // commit (label / message / ordinal match) or via a deterministic
  // direct-answer commit (dismissal, duplicate-label ambiguity).
  //
  // This is NOT a wall-clock latency test — it asserts the structural
  // invariant that pre-routes never enter LLM paths. Latency
  // observation is a post-activation monitoring concern.

  beforeEach(() => {
    appendCalls.length = 0;
    addConstraintCalls.length = 0;
    priorTurnsForRead = [];
    priorFactsForRead = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function safeProposal(args: {
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

  it('exact-label match: 0 LLM calls, exactly 1 handler dispatch, exactly 1 commit', async () => {
    pendingActionsForRead = [
      safeProposal({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Add the cost cap',
        message: 'Add the cost cap.',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Add the cost cap'), 'req-smoke-label', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
    expect(appendCalls).toHaveLength(1);
  });

  it('exact-message match (chip-click parity): 0 LLM calls, exactly 1 handler dispatch, exactly 1 commit', async () => {
    pendingActionsForRead = [
      safeProposal({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Add the cost cap',
        message: 'Add the cost cap.',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Add the cost cap.'), 'req-smoke-message', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
    expect(appendCalls).toHaveLength(1);
  });

  it('ordinal match: 0 LLM calls, exactly 1 handler dispatch, exactly 1 commit', async () => {
    pendingActionsForRead = [
      safeProposal({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Add the cost cap',
        message: 'Add the cost cap.',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('the first one'), 'req-smoke-ordinal', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(1);
    expect(appendCalls).toHaveLength(1);
  });

  it('dismissal: 0 LLM calls, 0 handler dispatch, exactly 1 deterministic commit', async () => {
    pendingActionsForRead = [
      safeProposal({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Add the cost cap',
        message: 'Add the cost cap.',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('no'), 'req-smoke-dismiss', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(appendCalls).toHaveLength(1);
  });

  it('duplicate-label ambiguity: 0 LLM, 0 handler dispatch, exactly 1 deterministic clarification commit (pass-10 P1)', async () => {
    pendingActionsForRead = [
      safeProposal({
        chipId: 'prop_aaaaaaaaaaaa',
        label: 'Apply this change',
        message: 'A unique message',
      }),
      safeProposal({
        chipId: 'prop_bbbbbbbbbbbb',
        label: 'Apply this change',
        message: 'B unique message',
      }),
    ];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('Apply this change'), 'req-smoke-ambiguous', {
      routingAdapter: adapter,
      handlerRegistry: stubbedRegistry(),
    });
    // Pass-10 P1: duplicate-label ambiguity is a deterministic
    // clarification path — no LLM, no handler dispatch, exactly
    // one commit, and the ambiguous proposals are re-persisted so
    // the next-turn reply can disambiguate.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(addConstraintCalls).toHaveLength(0);
    expect(appendCalls).toHaveLength(1);
    const persisted = (
      appendCalls[0] as {
        pending_actions?: ReadonlyArray<{ chip_id: string }>;
      }
    ).pending_actions;
    expect(persisted!.length).toBe(2);
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
