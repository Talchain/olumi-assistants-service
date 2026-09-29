/**
 * Lane 22 (live 2026-07-07) — proposal-capture precondition hash.
 *
 * Both live `v5.proposal_continuation.captured` events persisted their
 * `proposed_concept` pending action with EMPTY preconditions (no
 * `graph_hash`), making hash-divergence invalidation inert: a proposal
 * captured before a graph edit could be resumed against a different
 * graph with no invalidation signal.
 *
 * Root cause: the capture-site hash at the STEP 7 commit computed
 * `computeAnalysisAffectingGraphHash(options.graphState)` — the RAW
 * request echo — which is absent on follow-up turns (the UI only sends
 * graphState on some turn classes). The executor already resolves the
 * authoritative per-turn graph (`graphStateForTurn` = request graphState
 * when present, else the persisted-graph fallback loaded by
 * buildTurnContext); the capture hash must use the same authority.
 *
 * This test drives a follow-up-turn shape (NO request graphState, a rich
 * persisted graph in the store) through a Sonnet turn whose reply is a
 * proposal, and pins that the captured pending action carries the
 * persisted graph's analysis-affecting hash as its precondition.
 */

import { readFileSync } from 'node:fs';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  pending_actions?: readonly PendingAction[];
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
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

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';

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

/** Sonnet reply shaped like a proposal — the capture pattern's canonical form. */
function proposalAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Would you like me to add team morale as a factor?',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'claude-sonnet-4-6',
        latencyMs: 50,
      } as unknown as ChatWithToolsResult),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  currentPersistedGraph = null;
});

afterEach(() => {
  setTestSink(null);
});

describe('proposal capture — precondition graph_hash on follow-up turns (Lane 22)', () => {
  it('a follow-up turn (no request graphState) captures the proposal WITH the persisted graph hash as its precondition', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const expectedHash = computeAnalysisAffectingGraphHash(
      clone(RICH_PERSISTED_GRAPH) as never,
    );
    expect(expectedHash).toBeTruthy();

    await runTurnExecutor(
      payload('What else should I consider?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21'),
      'req-lane22-capture-hash',
      {
        routingAdapter: proposalAdapter(),
        // Deliberately NO graphState — the live follow-up-turn shape.
      },
    );

    // The proposal WAS captured…
    const captured = events.find(
      (e) => e.event === 'v5.proposal_continuation.captured',
    );
    expect(captured).toBeDefined();

    // …and the persisted pending action carries the graph-hash
    // precondition (RED before the fix: preconditions was {}).
    expect(appendCalls.length).toBeGreaterThan(0);
    const write = appendCalls.at(-1)!;
    const proposalPending = (write.pending_actions ?? []).find(
      (p) => p.action.kind === 'proposed_concept',
    );
    expect(proposalPending).toBeDefined();
    expect(proposalPending!.preconditions.graph_hash).toBe(expectedHash);
  });
});
