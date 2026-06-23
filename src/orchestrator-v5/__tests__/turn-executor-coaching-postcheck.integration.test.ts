/**
 * Coaching Context Pack v1 — turn-executor integration (both coaching branches).
 *
 * Drives the LLM-authored coaching path (text_only → converse) through the real
 * turn-executor with a mocked routing adapter. Proves:
 *   - flag ON + confident directional advice under unsafe state → the wire
 *     `assistant_text` is DEGRADED to a deterministic safe trust response +
 *     rerun chip, and `v5.coaching.output_postcheck` telemetry fires;
 *   - flag ON + safe prose → unchanged, no telemetry;
 *   - flag OFF → byte-identical to today (LLM prose verbatim, no post-check,
 *     no telemetry) — the activation is a deliberate flag flip.
 *
 * The session store is mocked with no facts / no graph, so the canonical
 * freshness verdict is `none` (unsafe). Mirrors
 * turn-executor-egress-forbidden-phrase.test's harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkTextResult(text)) as never),
  };
}

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'tell me about my decision',
  turn_class: 'frame',
  stage: 'frame',
};

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function setFlag(on: boolean): void {
  if (on) vi.stubEnv('CEE_COACHING_CONTEXT_PROMPT_ENABLED', 'true');
  else vi.stubEnv('CEE_COACHING_CONTEXT_PROMPT_ENABLED', 'false');
  _resetConfigCache();
}

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

function postcheckEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.coaching.output_postcheck');
}

// Dash-free so `sanitiseNarrateOutput` is a no-op — keeps the flag-off
// byte-identity assertion about the LANE, not the (unchanged) sanitiser.
const DIRECTIONAL = 'You should choose Option A. It is clearly the best option.';

describe('turn-executor — Coaching Context Pack v1 post-check (flag ON)', () => {
  it('degrades confident directional advice under unsafe (none) state + emits telemetry', async () => {
    setFlag(true);
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what should I do about my decision?' },
      'req-coach-degrade',
      { routingAdapter: mockRoutingAdapter(DIRECTIONAL) },
    );

    // The wire text is NOT the model's confident advice — it is a safe
    // deterministic trust response.
    expect(response.assistant_text).not.toBe(DIRECTIONAL);
    expect(response.assistant_text).toMatch(
      /no analysis has been run|may be out of date|can't confirm|usable result/i,
    );
    // A rerun affordance survives.
    expect(
      (response.suggested_actions ?? []).some(
        (a) => (a as { action_type?: string }).action_type === 'run_analysis',
      ),
    ).toBe(true);
    // Telemetry records the violation + closed-enum state.
    const evt = postcheckEvent();
    expect(evt, 'post-check telemetry should fire').toBeDefined();
    expect(evt!.data.violation).toBe('confident_advice_under_unsafe_state');
    expect(evt!.data.freshness).toBe('none');
  });

  it('passes safe coaching prose through unchanged (no telemetry)', async () => {
    setFlag(true);
    const safe = 'Here is one way to weigh the trade-off between speed and cost.';
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'help me think about this' },
      'req-coach-safe',
      { routingAdapter: mockRoutingAdapter(safe) },
    );
    expect(response.assistant_text).toBe(safe);
    expect(postcheckEvent()).toBeUndefined();
  });
});

describe('turn-executor — Coaching Context Pack v1 (flag OFF = byte-identical)', () => {
  it('emits the model prose verbatim and never invokes the post-check', async () => {
    setFlag(false);
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what should I do about my decision?' },
      'req-coach-flagoff',
      { routingAdapter: mockRoutingAdapter(DIRECTIONAL) },
    );
    // Flag off: the very same confident advice ships unchanged — proving the
    // activation is a deliberate flag flip, not a merge side-effect.
    expect(response.assistant_text).toBe(DIRECTIONAL);
    expect(postcheckEvent()).toBeUndefined();
  });
});
