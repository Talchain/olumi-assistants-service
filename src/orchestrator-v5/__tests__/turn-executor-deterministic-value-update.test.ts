/**
 * TurnExecutor × deterministic value-update pre-route — wire-level test.
 *
 * Asserts that when the pre-route detects an explicit value-update phrasing,
 * the turn:
 *   - never calls the routing adapter (llm_calls_used === 0)
 *   - emits a clarify-shape direct_answer with candidate factor chips
 *   - emits the v5.deterministic_value_update telemetry event
 *
 * The pre-route lives BEFORE `routeWithToolUse` in turn-executor's lifecycle,
 * so a routing-adapter mock that throws on call is the simplest way to
 * verify the pre-route really skipped the LLM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

// Same session-store mock pattern as turn-executor-handler.test.ts.
const appendCalls: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { EMPTY_HANDLER_REGISTRY } = await import('../tools/registry.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): OrchestratorTurnPayload {
  return {
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function graphWithFactor(label: string) {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_1', kind: 'factor', label },
      { id: 'opt_a', kind: 'option', label: 'Opt A' },
      { id: 'opt_b', kind: 'option', label: 'Opt B' },
    ],
    edges: [],
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('turn-executor × deterministic value-update pre-route', () => {
  it('"Set Hiring and Staffing Cost to £300k" with single factor match → set_factor_value dispatch, no LLM call (A3.1)', async () => {
    // V5 D1 golden-path closure (A3.1): single substring match on a
    // factor-kind node short-circuits clarify and dispatches the handler
    // through the same Step 2-7 lifecycle a Sonnet tool-call would
    // follow. Adapter is never called either way; the difference from
    // pre-A3.1 is the response shape — handler turn with graph_patch
    // block, not clarify chips.
    const routingAdapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Set Hiring and Staffing Cost to £300k'),
      'req-pre-route-exact',
      {
        routingAdapter,
        graphState: graphWithFactor('Hiring and Staffing Cost'),
      },
    );
    const { response, telemetry, turn_outcome } = result;

    // Pre-route fired → adapter never called (zero LLM calls).
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);

    // Telemetry: dispatch flipped to set_factor_value, turn_class is
    // 'handler' (identical shape to a Sonnet-routed tool call).
    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.matched).toBe(true);
    expect(preRouteEvent?.data.dispatch).toBe('set_factor_value');
    expect(telemetry?.turn_class).toBe('handler');
    expect(telemetry?.intent_class).toBe('execute');
    expect(telemetry?.failure_type).toBeNull();

    // Response carries the deterministic confirmation + a graph_patch
    // block — same shape compose emits for any set_factor_value fact.
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'fac_1',
    });
    expect(response.assistant_text).toContain('Hiring and Staffing Cost');

    // P0 V5 golden-path repair (follow-up): graph_mutated must reflect
    // the actual graph mutation. Pre-fix, the flag was scoped to a
    // hand-maintained allowlist (draft_graph / edit_graph) and missed
    // set_factor_value despite the handler emitting mutated_graph.
    // Now derived from handler outcome.
    expect(turn_outcome?.graph_mutated).toBe(true);
  });

  it('"Set Cost and Revenue to 5" — two substring-matching factors → clarify (multi-match preserved)', async () => {
    // Realistic ambiguity per brief correction #4: both "Cost" and
    // "Revenue" appear in the message and substring-match the
    // factor labels. Stays clarify; dispatch never fires.
    const routingAdapter = throwingRoutingAdapter();
    const ambiguousGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'fac_cost', kind: 'factor', label: 'Cost' },
        { id: 'fac_revenue', kind: 'factor', label: 'Revenue' },
      ],
      edges: [],
    };
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Cost and Revenue to 5'),
      'req-pre-route-ambiguous',
      { routingAdapter, graphState: ambiguousGraph },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer');
    expect(response.assistant_text).toContain("wasn't sure");
    // Both candidate labels surface as chips.
    const labels = response.suggested_actions.map((a) => a.label);
    expect(labels).toContain('Cost');
    expect(labels).toContain('Revenue');

    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.dispatch).toBe('clarify');
    expect(preRouteEvent?.data.candidate_count).toBe(2);
  });

  it('"Set Hiring and Staffing Cost to £300k" with handler registry missing set_factor_value → falls back to clarify (registry guard)', async () => {
    // V5 D1 golden-path closure (A3.1) — registry guard. If the
    // active handler registry doesn't contain set_factor_value (e.g.
    // a misconfigured executor or a future flag-gated build), the
    // pre-route MUST NOT synthesise a handler turn that would fail
    // at execute-time with HANDLER_NOT_FOUND. Falls through to the
    // clarify path so the chip click on the next turn re-enters
    // Sonnet's normal routing.
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Hiring and Staffing Cost to £300k'),
      'req-pre-route-no-handler',
      {
        routingAdapter,
        graphState: graphWithFactor('Hiring and Staffing Cost'),
        // Use the canonical EMPTY_HANDLER_REGISTRY fixture rather
        // than `new Map() as unknown as ...` so this test doesn't
        // normalise boundary-style type erasure.
        handlerRegistry: EMPTY_HANDLER_REGISTRY,
      },
    );

    // No LLM call (the throwing adapter would have surfaced one).
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    // The synthesised handler turn was NOT taken — clarify path
    // committed a direct_answer instead.
    expect(telemetry?.turn_class).toBe('direct_answer');
    expect(response.assistant_text).toContain("wasn't sure");

    // Telemetry surfaces the downgrade reason so observability
    // reflects the FINAL dispatch, not just the pre-guard candidate.
    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.dispatch).toBe('clarify');
    expect(preRouteEvent?.data.original_dispatch).toBe('set_factor_value');
    expect(preRouteEvent?.data.downgrade_reason).toBe('handler_not_executable');
  });

  it('"Set Customer Risk to 5" — single substring match on a non-factor (risk) → falls back to clarify (factor-only dispatch gate)', async () => {
    // Brief correction #3: a single substring match that resolves to a
    // non-factor node MUST NOT dispatch set_factor_value. Risks live
    // in the same EntityKind 'node' bucket as factors in GraphLookup,
    // so this case can only be caught by re-resolving NodeV3.kind on
    // the raw graph state — exactly what the kind gate does.
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Customer Risk to 5'),
      'req-pre-route-non-factor',
      {
        routingAdapter,
        graphState: {
          nodes: [
            // Only one 'node'-bucket entity substring-matches the
            // message; it's a risk, not a factor. The kind gate
            // downgrades to clarify.
            { id: 'r1', kind: 'risk', label: 'Customer Risk' },
            { id: 'goal_1', kind: 'goal', label: 'Profit' },
          ],
          edges: [],
        },
      },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer');
    expect(response.assistant_text).toContain("wasn't sure");

    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    // Telemetry now reflects the FINAL dispatch (clarify) AND
    // surfaces the original pre-guard candidate plus the downgrade
    // reason so observability sees both halves of the decision.
    expect(preRouteEvent?.data.dispatch).toBe('clarify');
    expect(preRouteEvent?.data.original_dispatch).toBe('set_factor_value');
    expect(preRouteEvent?.data.downgrade_reason).toBe('non_factor_kind');
  });

  it('"What if I set the budget to £300k?" → falls through to LLM (negative gate)', async () => {
    // The negative gate fires on "what if". The routing adapter MUST be
    // called — meaning the pre-route declined. We don't need a real
    // routing flow here; a noop response is enough to confirm the call.
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue({
          content: [{ type: 'text' as const, text: 'A clarifying response.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 } as never,
          model: 'claude-sonnet-4-6',
          latencyMs: 50,
        }),
    };

    await runTurnExecutor(
      payload('What if I set the budget to £300k?'),
      'req-pre-route-hypothetical',
      {
        routingAdapter,
        graphState: graphWithFactor('budget'),
      },
    );

    // Adapter was called → pre-route correctly declined.
    expect(routingAdapter.chatWithTools).toHaveBeenCalled();

    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.matched).toBe(false);
    expect(preRouteEvent?.data.skip_reason).toBe('hypothetical_gate');
  });

  it('clarify-emit persists graph_hash on every set_factor_value pending action (P0 cross-turn divergence guard)', async () => {
    // The clarification-resume pre-route checks `preconditions.graph_hash`
    // on the reply turn and falls through to a focused recovery if the
    // live graph hash differs (e.g. the client sent a direct_graph_edit
    // between clarify and reply). For that guard to fire, the clarify
    // emit MUST persist the live graph hash at emit time. A regression
    // here would silently apply the original quantity to a model the
    // user has since edited.
    const routingAdapter = throwingRoutingAdapter();
    const ambiguousGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'fac_cost', kind: 'factor', label: 'Cost' },
        { id: 'fac_revenue', kind: 'factor', label: 'Revenue' },
      ],
      edges: [],
    };
    await runTurnExecutor(
      payload('Set Cost and Revenue to 5'),
      'req-clarify-graph-hash-persisted',
      { routingAdapter, graphState: ambiguousGraph },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();

    // The committed turn write carries pending_actions, one per
    // candidate. Every entry must carry a non-empty preconditions.graph_hash.
    expect(appendCalls.length).toBeGreaterThan(0);
    const write = appendCalls[0] as {
      pending_actions?: ReadonlyArray<{
        action: { kind: string };
        preconditions?: {
          target_entity_ids?: readonly string[];
          graph_hash?: string;
        };
      }>;
    };
    const pendings = write.pending_actions ?? [];
    expect(pendings.length).toBe(2);
    for (const pa of pendings) {
      expect(pa.action.kind).toBe('set_factor_value');
      expect(typeof pa.preconditions?.graph_hash).toBe('string');
      expect(pa.preconditions?.graph_hash?.length ?? 0).toBeGreaterThan(0);
      // target_entity_ids stays alongside graph_hash (kind-existence
      // check is independent of the surrounding-model check).
      expect(pa.preconditions?.target_entity_ids?.length ?? 0).toBe(1);
    }
    // All candidates emitted at the same turn share the same live hash.
    const hashes = pendings.map((pa) => pa.preconditions?.graph_hash);
    expect(new Set(hashes).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair (Wave 2) — Path A (selection narrowing) and
// Path B (selected-deictic) end-to-end through the turn-executor.
// ---------------------------------------------------------------------------

function graphWithTwoFactors(labels: readonly string[]) {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      ...labels.map((label, i) => ({ id: `fac_${i + 1}`, kind: 'factor' as const, label })),
      { id: 'opt_a', kind: 'option', label: 'Opt A' },
      { id: 'opt_b', kind: 'option', label: 'Opt B' },
    ],
    edges: [],
  };
}

describe('turn-executor × Path A — selection narrows multi-candidate', () => {
  it('two-substring message + selection picks one factor → set_factor_value, no LLM call', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Raise budget and cost to £30k'),
      'req-path-a',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['budget', 'cost']),
        selectedElements: { node_ids: ['fac_1'], edge_ids: [] },
      },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);

    const preRouteEvent = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRouteEvent?.data.dispatch).toBe('set_factor_value');
    expect(telemetry?.turn_class).toBe('handler');

    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'fac_1',
    });
  });

  it('two-substring message + zero factors selected → clarify (existing behaviour preserved)', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Raise budget and cost to £30k'),
      'req-path-a-no-selection',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['budget', 'cost']),
      },
    );
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer');
    expect(response.blocks).toEqual([]);
  });

  it('non-factor selection (option id) ignored — clarify, never updates a factor', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { telemetry } = await runTurnExecutor(
      payload('Raise budget and cost to £30k'),
      'req-path-a-option-selected',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['budget', 'cost']),
        // The option id is in selection but it isn't a factor — must NOT
        // narrow.
        selectedElements: { node_ids: ['opt_a'], edge_ids: [] },
      },
    );
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer'); // clarify
  });
});

describe('turn-executor × Path B — selected-deictic', () => {
  it('"Update that factor to £30k" + one factor selected → set_factor_value, no LLM call, no edit_graph', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Update that factor to £30,000'),
      'req-path-b',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['Advertising budget', 'Headcount']),
        selectedElements: { node_ids: ['fac_1'], edge_ids: [] },
      },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);
    expect(telemetry?.turn_class).toBe('handler');

    // Dispatched to set_factor_value, NOT edit_graph.
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'fac_1',
    });
    // No edit_graph block surfaces.
    const editGraphBlock = response.blocks.find((b) => (b as { type?: string }).type === 'edit_graph');
    expect(editGraphBlock).toBeUndefined();

    // Receipt copy uses the human label and user-units value, not raw IDs
    // or normalised model-unit fractions.
    expect(response.assistant_text).toContain('Advertising budget');
    expect(response.assistant_text).toMatch(/£30,000|£30000/);
    expect(response.assistant_text).not.toMatch(/\bfac_1\b/);
    expect(response.assistant_text).not.toMatch(/0\.\d+/); // no normalised 0.x fractions
  });

  it('"Update that factor to £30k" + no selection → clarify, never edit_graph', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Update that factor to £30k'),
      'req-path-b-no-selection',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['Advertising budget', 'Headcount']),
      },
    );
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer');
    expect(response.blocks).toEqual([]);
    // Curated clarification copy, no internal terms.
    expect(response.assistant_text).toContain('factor');
    expect(response.assistant_text).not.toMatch(/\bedit_graph\b/);
    expect(response.assistant_text).not.toMatch(/\bnoop\b/);
  });

  it('"Update that factor to £30k" + selected option (non-factor) → clarify', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { telemetry } = await runTurnExecutor(
      payload('Update that factor to £30k'),
      'req-path-b-option-selected',
      {
        routingAdapter,
        graphState: graphWithTwoFactors(['Advertising budget', 'Headcount']),
        selectedElements: { node_ids: ['opt_a'], edge_ids: [] },
      },
    );
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.turn_class).toBe('direct_answer');
  });
});
