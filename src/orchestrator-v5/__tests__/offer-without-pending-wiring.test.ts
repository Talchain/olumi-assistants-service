/**
 * ⭐⭐ THE OFFER MUST NOT PROMISE WHAT NO ACCEPTANCE CAN RESUME.
 *
 * `buildMutationWarrantDemotionText` closes with "Say the word and I will make
 * it." That sentence is honourable ONLY when the same turn persists an
 * `apply_proposed_change` pending, because acceptance is handled by
 * `tryShortConfirmResume`, which REPLAYS A STORED `inline_patch` and never
 * re-reads the user's message (`deterministic-short-confirm.ts`).
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * Six branches in `turn-executor.ts` feed ONE `commitTurn(..., pending_actions:
 * demotionPending)`. `demotionPending` is non-empty in exactly one of them.
 * Three of the remaining five emitted the full offer copy anyway, so the
 * product told the user it was ready to act and kept nothing for a "yes" to
 * find. This file pins the `no_graph_hash` branch, which is the reachable one:
 * a session with no graph selected for the turn produces a null
 * analysis-affecting hash, the proposal is complete, and the branch DELIBERATELY
 * declines to emit a pending because the drift precondition cannot be built.
 * Declining to emit is correct. Promising anyway is not.
 *
 * ── WHY THE COPY AND NOT THE RECOGNISER (binding) ─────────────────────────
 * ⛔ Widening the confirmation predicate was recommended once and WITHDRAWN in
 * commit `d8a908b3`: a held change replays entirely from its stored patch, so a
 * wider recogniser would apply the OFFER's number and silently discard a value
 * the user restated in their acceptance — with a receipt saying it worked. The
 * recogniser is right to refuse. Nothing here touches it.
 *
 * ── THE PRECEDENT THIS EXTENDS ────────────────────────────────────────────
 * PR #1491 ruled exactly this for the `required_parameter_missing` branch and
 * pinned it (`offer-sufficiency-wiring.test.ts:255-258`): "With no chip and no
 * pending there is nothing to say the word to, so borrowing it here would
 * rebuild the dead end by another door." That remedy was scoped to the instance
 * in hand and never swept its siblings. This is the sweep.
 *
 * ── THE PAIR ──────────────────────────────────────────────────────────────
 * A "does not promise" assertion passes just as well against a harness that
 * cannot promise at all (trap 13). So the SAME adapter, the SAME utterance and
 * the SAME proposal run twice, differing ONLY in whether a graph state is
 * supplied — which is the only input the null-hash branch turns on. The control
 * arm must still emit the chip, the pending AND the promise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';

interface AppendWrite {
  graph?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
const pendingActionsForRead: readonly PendingAction[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** A read-shaped utterance: no mutation verb, so the demotion gate is reached. */
const READ_UTTERANCE = 'Open the analysis panel and show me the option comparison';

/** The promise under test, verbatim from `buildMutationWarrantDemotionText`. */
const PROMISE = 'Say the word and I will make it.';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
  });
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

/**
 * ONE adapter for BOTH arms — a COMPLETE `add_constraint` proposal, so
 * `buildWarrantDemotion` returns `ok: true` and the only thing that can differ
 * between the arms is the graph hash.
 */
function completeAddConstraintAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'add_constraint',
            entity: {
              id: 'f-churn',
              kind: 'node',
              label: 'Customer Churn Rate',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [
              { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
              { name: 'value', value: 7, source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

function buildChurnGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-mrr', kind: 'goal', label: 'Reach 250,000 MRR' },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Customer Churn Rate',
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
      { id: 'o-outbound', kind: 'option', label: 'Expand Outbound Sales' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** TRAP 19 — bind by the stable `prop_` handle and the wire action_type. */
function proposalChips(response: {
  suggested_actions?: readonly { id: string; action_type?: string }[];
}) {
  return (response.suggested_actions ?? []).filter(
    (c) => c.id.startsWith('prop_') && c.action_type === 'add_constraint',
  );
}

/**
 * The thing an acceptance would have to find. Bound by `action.kind`, which is
 * what `tryShortConfirmResume` matches on — not by "something was stored".
 */
function committedProposalPendings(): Array<Record<string, unknown>> {
  return appendCalls
    .flatMap((c) =>
      Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
    )
    .filter((p) => (p as { action?: { kind?: unknown } }).action?.kind === 'apply_proposed_change');
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

function demotionOutcomes(): unknown[] {
  return events
    .filter(
      (e) =>
        e.event === 'v5.turn_executor.mutation_warrant_absent' && e.data.layer === 'step2_gate',
    )
    .map((e) => e.data.demotion);
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  persistedGraph = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('an offer with no resumable pending must not close with a promise', () => {
  it('⭐ CONTROL (trap 13) — WITH a graph, the harness DOES emit the chip, the pending AND the promise', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-control', {
      routingAdapter: completeAddConstraintAdapter(),
      graphState: buildChurnGraph(),
    });

    // If any of these is ever wrong, every negative assertion below proves nothing.
    expect(demotionOutcomes()).toEqual(['offered']);
    expect(proposalChips(response)).toHaveLength(1);
    expect(committedProposalPendings()).toHaveLength(1);
    // ⭐ THE DISCRIMINATING HALF: the promise SURVIVES where it is honourable.
    // Without this, a fix that simply deleted the sentence everywhere would pass.
    expect(response.assistant_text).toContain(PROMISE);
  });

  it('⭐ THE FIX — with NO graph the branch declines to emit a pending, so the promise is withdrawn', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-nohash', {
      routingAdapter: completeAddConstraintAdapter(),
      // No `graphState`: `currentAnalysisGraphHashForTurn` is null, so the
      // proposal's drift precondition cannot be built and the branch refuses.
    });

    // The branch is the reason, NAMED — not some unrelated validator refusal.
    expect(demotionOutcomes()).toEqual(['emit_refused:no_graph_hash']);
    // Nothing an acceptance could resume was stored…
    expect(proposalChips(response)).toHaveLength(0);
    expect(committedProposalPendings()).toHaveLength(0);
    // …so the product must not say it is waiting to be told to act.
    expect(response.assistant_text).not.toContain(PROMISE);
    expect(response.assistant_text).not.toContain('Say the word');
  });

  it('the withdrawn offer still discloses the no-write FIRST and still names a move', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-copy', {
      routingAdapter: completeAddConstraintAdapter(),
    });

    const text = response.assistant_text;
    // The no-write disclosure is the invariant PR #1583/INV-3 protects; the fix
    // must not cost it. Also proves the egress forbidden-phrase guard did not
    // swallow the reply and replace it with the neutral fallback.
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    expect(text).toContain('tell me what you would like changed');
    // INV-3: it asserts nothing about what the user did or did not ask for.
    expect(text).not.toMatch(
      /\byou\s+(?:did\s+not|didn['’]t|have\s+not|haven['’]t|never)\s+(?:ask|request|say|state|tell|mention)/i,
    );
    // No internal vocabulary reaches the user.
    expect(text).not.toContain('add_constraint');
    expect(text).not.toContain('graph_hash');
    expect(text.toLowerCase()).not.toContain('applied');
  });

  it('NO SUBSTITUTE CHIP fills the gap left by the withdrawn offer', async () => {
    // Withdrawing an affordance is a chance to introduce an unrelated one; a
    // sibling lane witnessed exactly that on deployed staging. Pin the measurement.
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-nosub', {
      routingAdapter: completeAddConstraintAdapter(),
    });
    expect(response.suggested_actions ?? []).toEqual([]);
  });
});
