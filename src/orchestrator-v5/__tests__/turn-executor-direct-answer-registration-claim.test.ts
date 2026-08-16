/**
 * L64 — the false "already recorded" claim on a DIRECT-ANSWER turn
 * (L60 diagnosis OBS 3), proven at the STEP 7 pre-commit chokepoint.
 *
 * The live turn (staging, guest, 2026-08-03T22:28:00Z, scenario
 * 04f53491-2fc1-4681-8ff5-faf58e255649) carried `handler = null` and routed
 * `direct_answer`: the Hero success-field's hidden dispatch produced the
 * message `My success target for "Grow MRR to £250,000" is 250000.`, no
 * handler ran, nothing was written, and the model answered that the target
 * was already in place. The persisted graph (real fixture, shared with the
 * unit pins) shows a BARE goal node.
 *
 * This file proves the WIRING, not the regex: the guard must fire on a turn
 * that composes through the converse/text_only branch — the branch the live
 * defect took — swap the false prose for the honest fallback BEFORE commit,
 * and commit no graph. The unit-altitude pins live in
 * compose/__tests__/goal-target-registration-claim-l60.test.ts.
 *
 * Store fake + adapter shape mirror
 * turn-executor-goal-target-commit-honesty.test.ts (same seam, same mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return {
        id: 'mock-row-id',
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { GOAL_TARGET_NOT_SAVED_TEXT, graphRegistersGoalTarget } = await import(
  '../compose/goal-target-receipt-guard.js'
);
const { getDefaultRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

/** exp01 fixtures — shared with turn-executor-goal-target-commit-honesty. */
const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const EXP01_GOAL_NODE_ID = 'goal_q3_delivery';

/** The canonical goal-target add_constraint tool call for the exp01 graph. */
function exp01GoalTargetToolCallAdapter() {
  const toolCall = {
    intent_class: 'execute',
    action: {
      handler_id: 'add_constraint',
      entity: {
        id: EXP01_GOAL_NODE_ID,
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 15, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  };
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [
          {
            type: 'tool_use' as const,
            id: 'tu-l64-f1',
            name: OLUMI_ACTION_TOOL_NAME,
            input: toolCall as Record<string, unknown>,
          },
        ],
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'mock',
        latencyMs: 5,
      })),
  };
}

/** The real persisted pricing graph — see the unit-pin file's fixture note. */
const PRICING_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('../compose/__tests__/fixtures/l60/pricing-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** Verbatim live assistant prose from the captured turn. */
const LIVE_FALSE_CLAIM =
  'The model already has that target in place: growing MRR to £250,000 is ' +
  'set as the goal, alongside your churn ceiling (below 3%) and gross margin ' +
  'floor (above 80%, already recorded as a constraint). There\'s nothing ' +
  'further to add for the MRR figure itself.';

/** Verbatim live user message minted by the Hero success field. */
const LIVE_USER_MESSAGE = 'My success target for "Grow MRR to £250,000" is 250000.';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const SCENARIO_ID = '04f53491-2fc1-4681-8ff5-faf58e255649';

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

/** text_only routing result → the converse/direct_answer compose branch. */
function textOnlyAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text' as const, text }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 500, output_tokens: 40 },
        model: 'mock',
        latencyMs: 5,
      })),
  };
}

beforeEach(() => {
  setTestSink(() => undefined);
  appendCalls.length = 0;
  currentPersistedGraph = null;
});

afterEach(() => {
  vi.clearAllMocks();
  setTestSink(null);
});

describe('direct_answer registration claim vs persisted state (L60 OBS 3)', () => {
  it('RED→GREEN: the verbatim live false claim on a no-handler turn is swapped for the honest fallback before commit, and no graph is written', async () => {
    currentPersistedGraph = clone(PRICING_PERSISTED_GRAPH);
    // Identity-bound precondition: the goal node this claim is ABOUT carries
    // no registration marker, so the claim is unbacked by construction.
    expect(graphRegistersGoalTarget(currentPersistedGraph)).toBe(false);

    const result = await runTurnExecutor(
      payload(LIVE_USER_MESSAGE, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb6401'),
      'req-l64-direct-answer-false-claim',
      {
        routingAdapter: textOnlyAdapter(LIVE_FALSE_CLAIM),
        graphState: clone(PRICING_PERSISTED_GRAPH) as never,
      },
    );

    // The lie must not ship, on the wire or in the stored assistant_message.
    expect(result.response.assistant_text).toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(result.response.assistant_text).not.toContain('already has that target in place');

    // A swapped turn writes no graph (ROADMAP 1.19(b)).
    const write = appendCalls.at(-1)!;
    expect(write.graph).toBeUndefined();
  });

  it('POSITIVE CONTROL: the SAME prose ships untouched when the persisted goal node DOES register the target', async () => {
    const registered = clone(PRICING_PERSISTED_GRAPH);
    const goal = (registered.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'goal_mrr',
    )!;
    goal.goal_threshold_raw = 250000;
    goal.goal_threshold_unit = '£';
    currentPersistedGraph = registered;
    expect(graphRegistersGoalTarget(currentPersistedGraph)).toBe(true);

    const result = await runTurnExecutor(
      payload(LIVE_USER_MESSAGE, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb6402'),
      'req-l64-direct-answer-truthful-claim',
      {
        routingAdapter: textOnlyAdapter(LIVE_FALSE_CLAIM),
        graphState: clone(registered) as never,
      },
    );

    expect(result.response.assistant_text).not.toBe(GOAL_TARGET_NOT_SAVED_TEXT);
    expect(result.response.assistant_text).toContain('already has that target in place');
  });
});

/**
 * F1 SEVERITY PIN (review round 2) — over-firing does not mangle a sentence,
 * it DESTROYS AN APPLIED CHANGE.
 *
 * At this call site a `swap` also sets `graphForCommit = undefined` and
 * `handlerFactsForCommit = []` (ROADMAP 1.19(b) / overnight F5). So a false
 * positive on a TRUTHFUL edit receipt silently discards the user's mutation:
 * the graph write is withheld, the applied fact is withheld, and the user is
 * told the target could not be registered — for an edit that had nothing to do
 * with a target.
 *
 * The prose here is reviewer shape G2, verbatim: an ordinary passive sentence
 * about third-party sales targets, attached to a real factor-add receipt. It
 * fired the round-1 arm B (which had no `already|currently` requirement), and
 * the reviewer's end-to-end run returned `swap`/`unbacked_claim`.
 *
 * Identity-bound: the assertion is that the mutated graph REACHES the commit
 * carrying the exact node this handler added (`fac_leadership_buyin`), not
 * merely that "a graph" was written.
 */
describe('F1 — a truthful edit receipt must survive, graph write intact', () => {
  it('reviewer shape G2 on a mutating turn: prose ships untouched AND the applied graph is committed', async () => {
    // Mirrors the proven Lane-20 injection path (exp01 fixtures + a
    // registry-injected add_constraint), so the only variable under test is
    // the RECEIPT TEXT. Round-1 arm B fired on this sentence; the swap then
    // withheld the graph write, discarding the user's applied change.
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    const receipt =
      'Stretch targets are set by leadership, so I have added Leadership buy-in as a factor.';
    const mutated = clone(ECHO_GRAPH_STATE);
    (mutated.nodes as Array<Record<string, unknown>>).push({
      id: 'fac_leadership_buyin',
      kind: 'factor',
      label: 'Leadership buy-in',
      provenance: 'user_set',
    });

    const registry = new Map(getDefaultRegistry());
    registry.set('add_constraint', async () => ({
      assistant_text: receipt,
      handler_facts: [
        {
          fact_type: 'add_constraint',
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'gc-l64-f1',
            status: 'applied',
            before: null,
            after: { node_id: EXP01_GOAL_NODE_ID, operator: '>=', value: 15 },
          },
        },
      ] as never,
      llm_calls_used: 0,
      mutated_graph: mutated,
    }));

    const result = await runTurnExecutor(
      payload('Add Leadership buy-in as a factor', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb6403'),
      'req-l64-f1-truthful-edit-survives',
      {
        routingAdapter: exp01GoalTargetToolCallAdapter(),
        graphState: clone(ECHO_GRAPH_STATE) as never,
        handlerRegistry: registry,
      },
    );

    // The receipt is truthful — it must ship verbatim, not be swapped.
    expect(result.response.assistant_text).toBe(receipt);
    expect(result.response.assistant_text).not.toBe(GOAL_TARGET_NOT_SAVED_TEXT);

    // …and the user's applied change must actually be committed. Bound by
    // IDENTITY to the node this handler added, not to "a graph was written".
    const write = appendCalls.at(-1)!;
    expect(write.graph).toBeDefined();
    const committedNodes = (write.graph as Record<string, unknown>).nodes as Array<
      Record<string, unknown>
    >;
    expect(committedNodes.some((n) => n.id === 'fac_leadership_buyin')).toBe(true);
    expect(write.handler_facts).not.toEqual([]);
  });
});
