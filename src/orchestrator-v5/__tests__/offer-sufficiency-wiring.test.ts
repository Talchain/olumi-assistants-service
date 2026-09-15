/**
 * ⭐⭐ THE WIRING WITNESS — the offer-sufficiency gate on the REAL turn path.
 *
 * `compose/__tests__/warrant-demotion-offer-sufficiency.test.ts` proves the
 * PREDICATE. This file proves the gate is actually REACHED, that no chip and
 * no pending are emitted when it fires, and that the user is told the truth.
 *
 * ⚠ WHY IT EXISTS AS A SEPARATE FILE: a unit-green predicate wired into a
 * branch nothing executes is how this estate ships a fix dark (CLAUDE.md trap
 * 3b / 16 — a green suite is not evidence about a path the product does not
 * take). The branch is four lines in `turn-executor.ts`; typecheck proves it
 * compiles and says nothing about whether it runs.
 *
 * ── THE WITNESS BEING CLOSED (CEE staging `8e4efce0`, 2026-09-14) ─────────
 * A second, VALUE-LESS `add_constraint` proposal was minted beside the real
 * one. Because `computeProposalId` hashes `params`, it got a different
 * `prop_` id, so the `chip_id`-keyed supersede rule could not fire and both
 * pendings survived. Both rendered as the constant label "Add this limit", so
 * `do it` produced "1) Add this limit 2) Add this limit" — two identical
 * strings, graph hash unchanged. The second was never appliable:
 * `add_constraint` throws PARAMETER_INVALID without a `value`.
 *
 * ── THE PAIR ──────────────────────────────────────────────────────────────
 * The negative case is worthless without the control: an "emits no chip"
 * assertion passes just as well when the harness cannot emit a chip at all
 * (trap 13). So the SAME adapter shape, the SAME utterance and the SAME graph
 * run twice, differing ONLY in whether `value` is present.
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
let servedGraph: unknown = null;
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
    loadGraph: async () => persistedGraph ?? servedGraph,
    loadGraphAndBriefText: async () => ({
      graph: persistedGraph ?? servedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** A read-shaped utterance: no mutation verb, so the demotion gate is reached. */
const READ_UTTERANCE = 'Open the analysis panel and show me the option comparison';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
  });
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
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
 * One adapter factory for BOTH arms. The ONLY difference between the arms is
 * whether the `value` parameter is present, so nothing else can explain a
 * difference in outcome.
 */
function addConstraintAdapter(opts: { readonly withValue: boolean }) {
  const parameters: Array<Record<string, unknown>> = [
    { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
  ];
  if (opts.withValue) parameters.push({ name: 'value', value: 7, source: 'user_explicit' });
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
            parameters,
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

function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

/** TRAP 19 — bind by the stable `prop_` handle and the wire action_type. */
function proposalChips(response: { suggested_actions?: readonly { id: string; action_type?: string }[] }) {
  return (response.suggested_actions ?? []).filter(
    (c) => c.id.startsWith('prop_') && c.action_type === 'add_constraint',
  );
}

function committedProposalPendings(): Array<Record<string, unknown>> {
  return appendCalls
    .flatMap((c) =>
      Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
    )
    .filter(
      (p) => (p as { action?: { kind?: unknown } }).action?.kind === 'apply_proposed_change',
    );
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

function demotionOutcomes(): unknown[] {
  return events
    .filter((e) => e.event === 'v5.turn_executor.mutation_warrant_absent' && e.data.layer === 'step2_gate')
    .map((e) => e.data.demotion);
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  persistedGraph = null;
  servedGraph = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('offer sufficiency — WIRED into the turn path', () => {
  it('⭐ CONTROL (trap 13) — WITH a value, the harness DOES mint a proposal chip and a persisted pending', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-suff-control', {
      routingAdapter: addConstraintAdapter({ withValue: true }),
      graphState: buildChurnGraph(),
    });

    // If this is ever 0, every negative assertion below proves nothing.
    expect(proposalChips(response)).toHaveLength(1);
    expect(committedProposalPendings()).toHaveLength(1);
    expect(demotionOutcomes()).toEqual(['offered']);
    // The offer is still an OFFER: nothing is written.
    expect(graphWrites()).toHaveLength(0);
  });

  it('⭐ THE FIX — WITHOUT a value, NO chip and NO pending are emitted, so nothing can accumulate', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-suff-novalue', {
      routingAdapter: addConstraintAdapter({ withValue: false }),
      graphState: buildChurnGraph(),
    });

    expect(proposalChips(response)).toHaveLength(0);
    expect(committedProposalPendings()).toHaveLength(0);
    // The gate is the reason, named — not some unrelated validator refusal.
    expect(demotionOutcomes()).toEqual(['emit_refused:required_parameter_missing:value']);
    // Still no write, which was never in doubt but is the whole regime.
    expect(graphWrites()).toHaveLength(0);
  });

  it('NO SUBSTITUTE CHIP is offered in the withdrawn proposal\'s place', async () => {
    // ⚠ Measured because a sibling lane witnessed the adjacent defect on
    // deployed staging: after a sentence about a churn threshold the product
    // offered "Run analysis" and "Configure <a price option>" — chips
    // unrelated to what had just been discussed. Withdrawing a chip is a
    // chance to introduce exactly that, by leaving a gap something generic
    // fills. Measured here: the refusal turn carries ZERO chips.
    //
    // This pins the measurement rather than claiming the adjacent defect is
    // fixed — it is a DIFFERENT defect on the same surface, is not addressed
    // by this change, and must not be fixed silently.
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-suff-nosub', {
      routingAdapter: addConstraintAdapter({ withValue: false }),
      graphState: buildChurnGraph(),
    });
    expect(response.suggested_actions ?? []).toEqual([]);
  });

  it('the refusal tells the truth and does not promise a change it cannot make', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-suff-copy', {
      routingAdapter: addConstraintAdapter({ withValue: false }),
      graphState: buildChurnGraph(),
    });

    const text = response.assistant_text;
    expect(text.toLowerCase()).toContain('nothing has been changed');
    // ⛔ The generic demotion copy ends "Say the word and I will make it."
    // With no chip and no pending there is nothing to say the word to, so
    // borrowing it here would rebuild the dead end by another door.
    expect(text).not.toContain('Say the word');
    // It names a move the user can actually make.
    expect(text).toContain("Tell me the number you want and I'll set it.");
    // No internal vocabulary reaches the user.
    expect(text).not.toContain('add_constraint');
    expect(text).not.toContain('value');
    expect(text.toLowerCase()).not.toContain('applied');
  });

  it('the pristine defect is closed AT THE CHIP LEVEL: the vague "that level" offer is never rendered', async () => {
    // At pristine this turn emitted a chip whose change description read
    // 'a limit keeping "Customer Churn Rate" at or below that level'.
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-suff-thatlevel', {
      routingAdapter: addConstraintAdapter({ withValue: false }),
      graphState: buildChurnGraph(),
    });
    expect(response.assistant_text).not.toContain('at or below that level');
    expect((response.suggested_actions ?? []).some((c) => c.label === 'Add this limit')).toBe(false);
  });
});
