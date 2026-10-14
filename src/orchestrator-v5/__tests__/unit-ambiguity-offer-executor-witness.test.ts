/**
 * ⭐⭐ THE UNIT-AMBIGUITY OFFER GATE, WITNESSED THROUGH `runTurnExecutor`.
 *
 * WHY THIS FILE EXISTS. The review of the change that added this branch said:
 * *"this spec has 0 `runTurnExecutor` calls (vs 10 in the sibling's), so the
 * new turn-executor branch is UNWITNESSED."* That was correct. The unit tests
 * exercised `findUnitAmbiguousOffer` directly and proved the predicate; nothing
 * proved the PRODUCTION CALL SITE reaches it, passes it the right arguments, or
 * does anything with the answer.
 *
 * A predicate proven in isolation and a branch proven to run are different
 * claims, and only the second one is about the product.
 *
 * ── WHAT IT PINS ──────────────────────────────────────────────────────────
 * The branch at `turn-executor.ts:11527` emits
 * `emit_refused:unit_ambiguous_probability_domain` and withholds the offer.
 * The two arms differ in ONE field — whether the target node carries
 * `observed_state.unit` — and that field is exactly the one the false-refusal
 * defect turned on.
 *
 * ⚠ `outcome` + `at_most`, NOT `goal` + `at_least`. A goal + `at_least` whose
 * value would change takes the narrowed fail-open branch in
 * `findUnitAmbiguousOffer` and returns null whatever the unit does — so it
 * cannot discriminate, and a control built on it would pass vacuously. The
 * unit-level suite hit exactly that and both its controls failed.
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

let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown }) => {
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
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

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const READ_UTTERANCE = 'Open the analysis panel and show me the option comparison';
/** Outside [0,1], so the predicate's second gate does not short-circuit. */
const AMBIGUOUS_VALUE = 300_000;
const REFUSAL_OUTCOME = 'emit_refused:unit_ambiguous_probability_domain';

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

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

/** ONE adapter for BOTH arms — only the GRAPH differs between them. */
function arrCeilingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'add_constraint',
            entity: {
              id: 'o-arr',
              kind: 'node',
              label: 'Annual Recurring Revenue',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [
              { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
              { name: 'value', value: AMBIGUOUS_VALUE, source: 'user_explicit' },
              // ⛔ NO `unit` parameter. That is the whole point: the handler
              // resolves it from elsewhere, and this gate used not to.
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

function graphWithArr(observedState: Record<string, unknown> | undefined): GraphV3T {
  return {
    nodes: [
      { id: 'g-growth', kind: 'goal', label: 'Grow the business' },
      {
        id: 'o-arr',
        kind: 'outcome',
        label: 'Annual Recurring Revenue',
        ...(observedState === undefined ? {} : { observed_state: observedState }),
      },
      { id: 'opt-expand', kind: 'option', label: 'Expand Outbound Sales' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function demotionOutcomes(): unknown[] {
  return events
    .filter((e) => e.event === 'v5.turn_executor.mutation_warrant_absent' && e.data.layer === 'step2_gate')
    // ⚠ `demotion`, NOT `outcome`. The first version read `outcome` — copied
    // from a sibling suite — and the CONTROL caught it: the event fired and the
    // field read `undefined`, so `[undefined]` did not contain the refusal.
    // Had the control been omitted, the second test's absence assertion would
    // have passed against a field that does not exist.
    .map((e) => e.data.demotion);
}

beforeEach(() => {
  events = [];
  persistedGraph = null;
  setTestSink((event, data) => {
    events.push({ event, data: data as Record<string, unknown> });
  });
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('the unit-ambiguity offer gate, at the production call site', () => {
  /**
   * ⚠ THE CONTROL FIRST, and it is not a formality. Every assertion in the
   * second test is an ABSENCE — "the refusal did not fire". If this branch
   * could not fire at all (wrong utterance, wrong kind, value inside [0,1],
   * the gate never reached), that absence would be free. This proves the
   * branch is live and reachable in this harness.
   */
  it('CONTROL — with no unit ANYWHERE, the branch fires and withholds the offer', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-ua-control', {
      routingAdapter: arrCeilingAdapter(),
      graphState: graphWithArr(undefined),
    });

    expect(
      demotionOutcomes(),
      'the unit-ambiguity branch must be REACHABLE here, or the next test asserts nothing',
    ).toContain(REFUSAL_OUTCOME);
    expect(response.assistant_text).toBeTruthy();
  });

  /**
   * ⭐ THE DEFECT, AT THE CALL SITE. One field differs from the control: the
   * node carries a unit the handler resolves. The handler would ACCEPT, so
   * withholding the offer is a silent capability loss — the trade this estate
   * rejects.
   */
  it('a unit on the node is resolvable, so the branch must NOT withhold the offer', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-ua-nodeunit', {
      routingAdapter: arrCeilingAdapter(),
      graphState: graphWithArr({ unit: 'GBP' }),
    });

    expect(
      demotionOutcomes(),
      'the handler resolves this unit from observed_state and accepts — refusing here loses the capability silently',
    ).not.toContain(REFUSAL_OUTCOME);
    expect(response.assistant_text).toBeTruthy();
  });
});
