/**
 * V5 Track 2A — TurnExecutor wire-level integration test for the
 * post-compose prose sanitiser inserted at STEP 6.4.
 *
 * Drives `runTurnExecutor` end-to-end with a routing adapter that
 * returns a text_only result containing all three classes of leak the
 * sanitiser targets (raw probability decimal, structural edge-strength
 * phrase, raw sensitivity value). Asserts the egress
 * `OlumiResponse.assistant_text` has been rewritten and that
 * `V5ResponseProseSanitised` was emitted with non-zero counters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

const SCENARIO_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PAYLOAD: OrchestratorTurnPayload = {
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'How does Option A look?',
  turn_class: 'decide',
  stage: 'analyse',
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const baseGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [
    {
      from: 'budget',
      to: 'goal',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
  ],
  options: [
    {
      id: 'opt_a',
      status: 'ready',
      interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } },
    },
    {
      id: 'opt_b',
      status: 'ready',
      interventions: { budget: { value: 50, target_match: { node_id: 'budget' } } },
    },
  ],
  goal_node_id: 'goal',
} as unknown as GraphStateIngress;

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 5,
  };
}

function textOnlyAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkTextResult(text)),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('TurnExecutor STEP 6.4 — post-compose prose sanitation (Track 2A — detect only)', () => {
  it('emits V5ResponseProseSanitised with non-zero counters AND leaves assistant_text unmodified', async () => {
    const offending =
      'Option A performs best with 0.862 probability and the edge carries a strength of 0.55, with a sensitivity value of 1.0 driving the result.';
    const adapter = textOnlyAdapter(offending);

    const result = await runTurnExecutor(PAYLOAD, 'req-prose-sanitation-1', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    const text = result.response.assistant_text ?? '';

    // A2.2 Task 2: detect-only mode. The post-compose sanitiser no
    // longer mutates assistant_text — Sonnet's output reaches the user
    // verbatim. Telemetry surfaces residual leakage so a regression is
    // loud, but we never silently mask it. Every offending substring
    // from the input is therefore present in the output.
    expect(text).toContain('0.862');
    expect(text).toContain('strength of 0.55');
    expect(text).toContain('sensitivity value of 1.0');
    // No rewritten phrases were stamped in the output.
    expect(text).not.toContain('86%');
    expect(text).not.toContain('very strong sensitivity signal');

    // Telemetry: V5ResponseProseSanitised STILL fires with non-zero
    // counters — the canary remains. mode is now 'detect_only'.
    const sanitisedEvent = events.find(
      (e) => e.event === 'v5.response.prose_sanitised',
    );
    expect(sanitisedEvent).toBeDefined();
    expect(sanitisedEvent!.data).toMatchObject({
      request_id: 'req-prose-sanitation-1',
      scenario_id: SCENARIO_ID,
    });
    expect(sanitisedEvent!.data.probability_rewrites).toBeGreaterThanOrEqual(1);
    expect(sanitisedEvent!.data.sensitivity_rewrites).toBeGreaterThanOrEqual(1);
    expect(sanitisedEvent!.data.structural_matches).toBeGreaterThanOrEqual(1);
    expect(sanitisedEvent!.data.structural_suppressed).toBeGreaterThanOrEqual(1);
    expect(
      Array.isArray(sanitisedEvent!.data.structural_rule_ids) &&
        (sanitisedEvent!.data.structural_rule_ids as string[]).includes('carries_strength'),
    ).toBe(true);
    // A2.2 Task 2 — the rewrite-to-detect_only flip just landed.
    // Upstream display-safe projections (A2 / A2.1 / A2.2) close every
    // known source of raw-numeric leakage; the sanitiser remains as a
    // detect-only canary. Final acceptance is post-deploy via staging
    // replay showing counters trend to zero.
    expect(sanitisedEvent!.data.mode).toBe('detect_only');
  });

  it('clean assistant_text: no rewrites, no V5ResponseProseSanitised event', async () => {
    const clean = 'Option A looks strong on the headline metric. Worth a closer look at the trade-offs.';
    const adapter = textOnlyAdapter(clean);

    const result = await runTurnExecutor(PAYLOAD, 'req-prose-sanitation-2', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    const text = result.response.assistant_text ?? '';
    expect(text).toContain(clean);

    const sanitisedEvent = events.find(
      (e) => e.event === 'v5.response.prose_sanitised',
    );
    expect(sanitisedEvent).toBeUndefined();
  });
});
