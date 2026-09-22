/**
 * GATE 1 — THE DURABLE TURN IDENTITY IS THE CLIENT'S, NOT THIS HTTP REQUEST'S.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 * CEE persisted two different durable turn identities on two different paths:
 *
 *   · route-v2's own commit branches wrote `turn_id: ingress.turn_id` — the
 *     client's body identity (9 `commitDirectAnswer` sites, e.g. route-v2.ts
 *     :4559, :8056);
 *   · the TurnExecutor's commit branches — every HANDLER-ROUTED turn, i.e.
 *     every graph mutation — wrote `turn_id: context.request_id`, a
 *     server-minted per-HTTP-request id (~36 `commitTurn` sites).
 *
 * The turn FENCE keys on the client identity on both paths
 * (`turn-fence-prehandler.ts` → `readIngressTurnIdentity` → `v5_turn_fence
 * (scenario_id, turn_id)`), so on a handler-routed mutation the fence row and
 * the durable turn row were keyed by DIFFERENT identifiers.
 *
 * `append_turn_atomic_v5` enforces `UNIQUE (scenario_id, turn_id)` and the
 * durable replay lookup is `committedTurnRowId(scenario_id, write.turn_id)`.
 * Keyed on a request id, a retry — which is a new HTTP request and therefore a
 * new `request_id` — can never find the row its first attempt committed. The
 * repaired replay-before-CAS SQL ordering cannot help: there is no prior row
 * UNDER THE KEY IT IS GIVEN, so the write is treated as fresh and the CAS
 * refuses it, because the original write already moved the graph head.
 *
 * Measured live on 22 Sep 2026 (most recent 1000 `v5_conversation_turns` rows,
 * left-joined against `v5_turn_fence` for the same 359 scenarios): handler-
 * routed turns whose committed `turn_id` appears in the fence table — 16 of
 * 341 (4.7%); every other turn class — 372 of 659 (56.4%). The second figure
 * is the contrast control: the probe can see agreement, and handler turns are
 * the ones that lack it.
 *
 * ── WHAT THESE TESTS BIND, AND WHY THAT SHAPE ─────────────────────────────
 * By IDENTITY, never by a value predicate another object could satisfy: the
 * committed id must be the SAME STRING the fence parser extracts from the same
 * request body, and it must NOT be the request id. A test asserting only "it is
 * a UUID" would pass on the defect, because a request id is a UUID too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { readIngressTurnIdentity } from '../../orchestrator/turn-fence-prehandler.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

const appendCalls: Array<{ scenario_id: string; turn_id: string }> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write as { scenario_id: string; turn_id: string });
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

/** The client's durable operation identity — what a retry would reuse. */
const CLIENT_TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** The server's per-HTTP-request id — a NEW value on every retry. */
const REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const PAYLOAD = makeMessagePayload({
  turn_id: CLIENT_TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

/**
 * A proposal the validator REFUSES, so the turn reaches a TurnExecutor commit
 * without running a handler or calling a provider. The commit is what this
 * suite is about; which recoverable code produced it is not.
 */
const REFUSED_PROPOSAL = {
  intent_class: 'execute',
  action: {
    handler_id: 'not_a_real_handler',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: {},
  },
  user_facing_summary: 'Looking at that now.',
};

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

function routingAdapter(): { chatWithTools: unknown } {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkToolUseResult(REFUSED_PROPOSAL)),
  };
}

beforeEach(() => {
  appendCalls.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Gate 1 — the committed turn identity is the client\'s durable one', () => {
  it('commits under the CLIENT turn_id, not the per-request id', async () => {
    await runTurnExecutor(PAYLOAD, REQUEST_ID, {
      routingAdapter: routingAdapter() as never,
    });

    expect(appendCalls.length).toBeGreaterThan(0);
    const committed = appendCalls[0]!;
    expect(committed.scenario_id).toBe(SCENARIO_ID);
    // The whole defect, in one assertion pair. Both are needed: the second
    // alone would pass on any value that merely differs from the request id.
    expect(committed.turn_id).toBe(CLIENT_TURN_ID);
    expect(committed.turn_id).not.toBe(REQUEST_ID);
  });

  it('agrees with the FENCE parser on the same request body, by identity', async () => {
    // The fence claims `v5_turn_fence (scenario_id, turn_id)` from exactly this
    // parse. Binding the commit key to the fence key here — rather than to a
    // literal — means a future change to either side cannot silently reopen the
    // split this suite exists to close.
    const fenceIdentity = readIngressTurnIdentity(PAYLOAD);
    expect(fenceIdentity).not.toBeNull();

    await runTurnExecutor(PAYLOAD, REQUEST_ID, {
      routingAdapter: routingAdapter() as never,
    });

    const committed = appendCalls[0]!;
    expect(committed.turn_id).toBe(fenceIdentity!.turnId);
    expect(committed.scenario_id).toBe(fenceIdentity!.scenarioId);
  });

  it('a retry with the same durable identity presents the SAME idempotency key', async () => {
    // Acceptance clause "retry carries the same durable client operation/turn
    // identity". Two executor runs, same payload, DIFFERENT request ids — which
    // is exactly what a re-send looks like on the wire. The key the RPC's
    // `UNIQUE (scenario_id, turn_id)` sees must not move.
    await runTurnExecutor(PAYLOAD, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', {
      routingAdapter: routingAdapter() as never,
    });
    await runTurnExecutor(PAYLOAD, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', {
      routingAdapter: routingAdapter() as never,
    });

    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[0]!.turn_id).toBe(appendCalls[1]!.turn_id);
    expect(appendCalls[0]!.turn_id).toBe(CLIENT_TURN_ID);
  });

  it('a genuinely DIFFERENT turn still presents a different key', async () => {
    // The refusing half of the acceptance: recovery must not become
    // "every turn on this scenario is the same turn". A new client turn id is a
    // new durable operation and must key differently, so the RPC's conflict
    // clause cannot swallow it.
    await runTurnExecutor(PAYLOAD, REQUEST_ID, {
      routingAdapter: routingAdapter() as never,
    });
    await runTurnExecutor(
      { ...PAYLOAD, turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      REQUEST_ID,
      { routingAdapter: routingAdapter() as never },
    );

    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[0]!.turn_id).not.toBe(appendCalls[1]!.turn_id);
  });
});
