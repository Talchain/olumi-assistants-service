/**
 * ROADMAP 2.11 / P1-3 — adjust_edge_strength backstop for configure-option
 * intent, via `runTurnExecutor`.
 *
 * Live-proven failure (2.11 diagnosis, scenario A A5/A7, staging 57959b2):
 * "Help me configure {option}." / "Configure the effects of {option}: …"
 * were LLM-routed to `adjust_edge_strength`, which APPLIED an edge-strength
 * tweak — a field PLoT's preflight ignores — so the analysis stayed blocked
 * and the same recovery chip re-offered forever.
 *
 * The primary fix routes these messages to the edit lane at route-v2
 * (deterministic; see route-v2-configure-option.test.ts). This backstop
 * covers the residue: if such a message DOES reach the executor and the
 * router proposes adjust_edge_strength, the proposal is REFUSED into the
 * recoverable clarify path — graph byte-unchanged, no handler executes,
 * honest copy. Mirrors the #279 set_factor_value misroute containment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from '../../../__tests__/fixtures.js';

import { setTestSink } from '../../../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../../adapters/llm/types.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

const appendCalls: Array<{ graph?: unknown; handler_id?: unknown }> = [];
vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown; handler_id?: unknown }) => {
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

const { runTurnExecutor } = await import('../../../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

/** A valid adjust_edge_strength proposal against the D1 fixture's edge. */
const ADJUST_EDGE_TOOL_CALL = {
  intent_class: 'execute',
  action: {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: 'f-budget→g-revenue',
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'strength', value: 0.7, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: ['graph.edges'],
  },
};

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('adjust_edge_strength configure-option backstop via runTurnExecutor', () => {
  it('REFUSES an adjust proposal when the message is the configure chip — graph unchanged, no handler', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(ADJUST_EDGE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();
    const graphBefore = JSON.stringify(ingressGraph);

    const payload = makeMessagePayload({
      turn_id: 'f1f1f1f1-ffff-4fff-8fff-f1f1f1f1f1f1',
      scenario_id: TEST_SCENARIO_ID,
      // The system's own recovery-chip message (A7): fixture option label.
      message: 'Help me configure Launch now.',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-cfg-1', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).toContain('validate');
    expect(telemetry.stages_completed).not.toContain('execute');
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toBeUndefined();
    // Honest clarify names the contrast and asks for the option's effect.
    expect(response.assistant_text).toContain("option's effect");
    expect(response.assistant_text.toLowerCase()).toContain("haven't changed anything");
    expect(JSON.stringify(ingressGraph)).toBe(graphBefore);
    for (const call of appendCalls) {
      expect(call.handler_id).not.toBe('adjust_edge_strength');
    }
  });

  it('REFUSES a free-text configure phrasing routed to adjust (A5 class)', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(ADJUST_EDGE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();
    const graphBefore = JSON.stringify(ingressGraph);

    const payload = makeMessagePayload({
      turn_id: 'f2f2f2f2-ffff-4fff-8fff-f2f2f2f2f2f2',
      scenario_id: TEST_SCENARIO_ID,
      message:
        'Configure the effects of the Launch now option: it strongly increases marketing budget.',
    });

    const { telemetry } = await runTurnExecutor(payload, 'req-cfg-2', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).not.toContain('execute');
    expect(JSON.stringify(ingressGraph)).toBe(graphBefore);
  });

  it('CONTROL: a genuine edge-strength request still executes (no regression)', async () => {
    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(ADJUST_EDGE_TOOL_CALL));
    const ingressGraph = buildD1Fixture();

    const payload = makeMessagePayload({
      turn_id: 'f3f3f3f3-ffff-4fff-8fff-f3f3f3f3f3f3',
      scenario_id: TEST_SCENARIO_ID,
      message: 'Make the marketing budget effect on revenue strong',
    });

    const { telemetry } = await runTurnExecutor(payload, 'req-cfg-3', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('execute');
  });
});
