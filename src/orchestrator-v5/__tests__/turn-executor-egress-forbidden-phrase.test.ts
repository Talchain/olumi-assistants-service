/**
 * V5 stale-aware explain recovery — finaliser-level egress guard test.
 *
 * Each of the brief's hard-fail phrases, when injected into Sonnet's
 * narrate output (the converse direct_answer path), MUST be rewritten
 * to the neutral fallback before commit AND emit
 * `v5.egress.forbidden_phrase_detected` telemetry. The chip set is
 * preserved.
 *
 * The injection point is the mocked routing adapter returning Sonnet
 * text containing a forbidden phrase. The egress guard sits in
 * `finalizeRun()` of turn-executor and runs as the LAST step before
 * the response is committed, so the assertion is on the post-commit
 * `response.assistant_text` — what the wire actually carries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import {
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  findForbiddenPhraseHit,
} from '../compose/forbidden-user-facing-phrases.js';
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

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'tell me about it',
  turn_class: 'frame',
  stage: 'frame',
};

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

function findEgressEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.egress.forbidden_phrase_detected');
}

// Each phrase injected verbatim into Sonnet output. The egress guard
// must rewrite the assistant_text and emit telemetry; the chip set and
// other response fields are out of scope here (a separate test exercises
// the post-mutation chip selection).
const FORBIDDEN_INJECTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    "I haven't applied any changes in this session yet. Tell me more.",
    "haven't applied any changes",
  ],
  [
    'I have not applied any changes. What would you like to do?',
    'have not applied any changes',
  ],
  [
    'Nothing changed on the model since the last analysis.',
    'nothing changed',
  ],
  [
    'There were no changes worth reporting.',
    'no changes',
  ],
  [
    'The wire currently shows unknown freshness.',
    'unknown freshness',
  ],
  [
    'These results were loaded from a prior run and may not be current.',
    'loaded from a prior run',
  ],
  [
    'Showing the cached result for your last query.',
    'cached result',
  ],
  [
    'The previous analysis suggested option A would lead.',
    'previous analysis',
  ],
  [
    'The prior analysis pointed at option A as the leader.',
    'prior analysis',
  ],
];

describe('turn-executor finaliser — egress forbidden-phrase guard', () => {
  for (const [injected, label] of FORBIDDEN_INJECTIONS) {
    it(`rewrites assistant_text and emits telemetry when "${label}" leaks through Sonnet`, async () => {
      const routingAdapter = mockRoutingAdapter(async () => mkTextResult(injected));
      const { response } = await runTurnExecutor(
        { ...BASE_PAYLOAD, message: `injection probe for ${label}` },
        `req-egress-${label.replace(/\s+/g, '-')}`,
        { routingAdapter },
      );

      // Wire-level assistant_text MUST be the neutral fallback, NOT the
      // injected text — the egress guard fires before commit.
      expect(response.assistant_text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
      // The fallback itself must contain no forbidden phrase.
      expect(findForbiddenPhraseHit(response.assistant_text!)).toBeNull();
      // Telemetry must record the hit with the phrase + dispatch path.
      const evt = findEgressEvent();
      expect(evt, 'egress telemetry event should fire').toBeDefined();
      expect(evt!.data.dispatch_path).toBe('turn_executor_finalise');
      expect((evt!.data.phrase as string).toLowerCase()).toMatch(
        new RegExp(label.split(/\s+/).join('\\s+'), 'i'),
      );
    });
  }

  it('does NOT fire when assistant_text is clean', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('That option leads at 72% probability.'),
    );
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'why does it lead?' },
      'req-egress-clean',
      { routingAdapter },
    );
    expect(response.assistant_text).toBe('That option leads at 72% probability.');
    expect(findEgressEvent()).toBeUndefined();
  });

  it('preserves suggested_actions and blocks when assistant_text is rewritten', async () => {
    // Even when the egress guard fires, the chip set + blocks must survive
    // so the user keeps a recovery affordance — only assistant_text is
    // rewritten to the neutral fallback.
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult("I haven't applied any changes yet, but let me know."),
    );
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'check' },
      'req-egress-preserves-chips',
      { routingAdapter },
    );
    expect(response.assistant_text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    // The response shape stays valid (Zod-shaped) — these fields ship
    // unmodified even when assistant_text is rewritten.
    expect(response.suggested_actions).toBeDefined();
    expect(response.blocks).toBeDefined();
  });
});
