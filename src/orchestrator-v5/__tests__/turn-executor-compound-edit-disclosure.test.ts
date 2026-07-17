/**
 * POC-BOARD 5b — compound tunable edit: honest disclosure, not silent drop.
 *
 * CONFIRMED-LIVE defect (STEP0 trust-spine, build 6fd24d9, raw
 * `s1-06-multitunable-hold.json`): a two-op tunable edit — "Set X to 70% AND
 * set Y to 80%" — routed to `turn_executor`, applied ONLY the first
 * `set_factor_value` and SILENTLY dropped the second (DB-verified: the second
 * factor unchanged, `graph_patch` carried one op, assistant_text named only the
 * first change, no disclosure).
 *
 * Root cause: the V5 router's `tryInterpret` picked `content.find(tool_use)` —
 * block[0] — so every extra `olumi_action` the model emitted in the same
 * response was discarded with no trace. The scope-fenced fix (multi-apply would
 * need the commit/atomic path owned by PR #500/#501) keeps one op per turn but
 * makes the drop HONEST: the router surfaces the extra actions on
 * `droppedActions`, and the execute-success compose path discloses them.
 *
 * This end-to-end test drives the LLM-routed path with a mock adapter that
 * returns TWO `set_factor_value` tool_use blocks and asserts:
 *   1. the FIRST op applies (committed graph updated),
 *   2. the SECOND op is NOT applied (unchanged — one op per turn preserved),
 *   3. the response DISCLOSES the un-applied change by name (the honesty fix).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

const appendCalls: Array<{
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
}> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: {
      graph?: unknown;
      handler_id?: unknown;
      handler_facts?: unknown;
      turn_class?: unknown;
    }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

/** Two distinct £ factors, each with a resolved current value. */
function buildTwoFactorGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-marketing',
        kind: 'factor',
        label: 'Marketing Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      {
        id: 'f-sales',
        kind: 'factor',
        label: 'Sales Budget',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  } as GraphV3T;
}

function setProposal(id: string, label: string, rawValue: number): Record<string, unknown> {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id,
        kind: 'node',
        label,
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'value', value: { value: rawValue, unit: '£' }, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    },
  };
}

/** A routing adapter returning MULTIPLE olumi_action tool_use blocks at once. */
function mockMultiActionAdapter(inputs: Record<string, unknown>[]) {
  const content: ToolResponseBlock[] = inputs.map((input, i) => ({
    type: 'tool_use',
    id: `tu-${i + 1}`,
    name: OLUMI_ACTION_TOOL_NAME,
    input,
  }));
  const result: ChatWithToolsResult = {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 40 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('POC-BOARD 5b — compound tunable edit discloses the dropped op', () => {
  it('applies the first set, leaves the second UNCHANGED, and DISCLOSES the un-applied change by name', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
      setProposal('f-sales', 'Sales Budget', 60000),
    ]);

    const { response, telemetry } = await runTurnExecutor(
      payload('set marketing budget to £45,000 and set sales budget to £60,000'),
      'req-compound-edit',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    // The turn executes the FIRST op.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const marketing = committed.nodes.find((n) => n.id === 'f-marketing');
    const sales = committed.nodes.find((n) => n.id === 'f-sales');

    // (1) first op applied.
    expect(marketing?.observed_state?.raw_value).toBe(45000);
    // (2) second op NOT applied — one op per turn (unchanged from ingress).
    expect(sales?.observed_state?.raw_value).toBe(50000);

    // (3) HONESTY: the response names the un-applied change and does not
    // present it as done. Pre-fix this was silent (assistant_text named only
    // the first change).
    const text = response.assistant_text ?? '';
    expect(text).toContain('Sales Budget');
    expect(text.toLowerCase()).toMatch(/haven'?t applied|other change/);
    // It must NOT claim the dropped value was set.
    expect(text).not.toContain('£60,000');
  });

  it('a single-op set applies with NO spurious disclosure', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
    ]);

    const { response, telemetry } = await runTurnExecutor(
      payload('set marketing budget to £45,000'),
      'req-single-edit',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    const text = response.assistant_text ?? '';
    expect(text).not.toMatch(/haven'?t applied/i);
    expect(text).not.toContain('Sales Budget');
  });
});
