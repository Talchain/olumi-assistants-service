/**
 * Gate-1 claim integrity — A NO-OP EDIT MUST NOT RENDER AS APPLIED.
 *
 * The four-state vocabulary is proposed / applied / blocked / stale.
 * "noop" is not one of them and must never be dressed up as "applied".
 *
 * Live defect this file pins (observed on staging): setting a factor to
 * a value it ALREADY holds returned
 *
 *   "Updated <label> from 0.8 to 0.8. This change affects the model. The
 *    current analysis may not reflect it. Run the analysis to see
 *    updated results."
 *
 * …while the fact channel correctly carried `status: 'noop'`. Both
 * claims are false: no change occurred, and the analysis is NOT stale.
 * The two halves come from two independent channels and needed two
 * independent fixes:
 *
 *   PART 1 — narration. `set-factor-value.ts` computed `noop` for its
 *     fact but `changeText` ignored it and called `formatFactorChange`
 *     ("Updated X from A to B"). `adjust-edge-strength.ts` had the same
 *     divergence via `formatEdgeAdjustment`.
 *   PART 2 — coaching. `detectCoachingSignal` fired
 *     STALE_ANALYSIS_AFTER_EDIT for ANY edit handler whenever a prior
 *     successful run_analysis existed, with no no-op check.
 *
 * WHY THIS FILE EXISTS AT THE CHOKEPOINT
 * --------------------------------------
 * A green formatter test proves nothing about what the user reads. PR
 * #464's lane found all 12 of its pure-function guard tests passed with
 * the guard UNWIRED. So these tests drive the REAL turn through
 * `runTurnExecutor` and assert the two things a user actually receives:
 *
 *   - `response.assistant_text` — the whole string the user reads. Note
 *     there is NO `response.coaching` field: turn-executor.ts:6653 passes
 *     `coaching: coachingText` as an INPUT to `composeToolCallResponse`,
 *     which CONCATENATES it into `assistant_text`. That is why the live
 *     defect is one string carrying both false sentences, and why both
 *     halves are asserted against `assistant_text` here.
 *   - the SIGNAL THE SYSTEM ACTUALLY EMITS, captured off the telemetry
 *     sink as `v5.coaching.signal_fired`. (`coaching_signal_id` is a
 *     field on that emitted event, NOT on the `telemetry` object
 *     `runTurnExecutor` returns — asserting `telemetry.coaching_signal_id`
 *     reads `undefined` on every path and would pin nothing.)
 *
 * If either fix were reverted or left unwired, these fail.
 *
 * Every no-op assertion is paired with an APPLIED control proving the
 * mechanism still fires on a real change — a fix that blanket-silences
 * the channel would pass the no-op half alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../__tests__/fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRIOR_TURN_ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let priorTurns: unknown[] = [];
let priorFacts: unknown[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    readMostRecentPendingActions: async () => [],
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

// A message that does NOT trip the deterministic value-update pre-route
// (it intercepts bare "set/increase X to N" phrasings before Sonnet).
// This mirrors the follow-up turn where the chip's message reaches
// Sonnet and Sonnet emits the structured proposal.
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'update the customer churn factor',
});

/** f-churn already sits at raw_value=4, unit='%', cap=100 in the fixture. */
function setFactorToolCall(value: number): unknown {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: { value, unit: '%', cap: 100 },
          operator: 'set',
          source: 'user_explicit',
          unit: '%',
        },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  };
}

/** f-budget→g-revenue is fixture-defined with strength.mean = 0.4. */
function adjustEdgeToolCall(strength: number): unknown {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'adjust_edge_strength',
      entity: {
        id: 'f-budget→g-revenue',
        kind: 'edge',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'strength', value: strength, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: ['graph.edges'],
    },
  };
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

function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

/**
 * Seed a prior SUCCESSFUL run_analysis so the staleness coaching branch
 * is eligible. Without this the STALE signal cannot fire at all and the
 * no-op assertions would pass vacuously.
 */
function seedPriorSuccessfulAnalysis(): void {
  priorTurns = [
    {
      id: PRIOR_TURN_ROW_ID,
      scenario_id: TEST_SCENARIO_ID,
      user_id: null,
      turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:prev',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 42,
      created_at: '2026-06-11T23:33:33.796+00:00',
    },
  ];
  const fact: HandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: TEST_SCENARIO_ID,
      leading_option_id: 'o-launch',
      summary: 'Launch now currently leads.',
    },
  } as HandlerFact;
  priorFacts = [fact];
}

async function runEditTurn(toolCall: unknown, requestId: string) {
  const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(toolCall));
  return runTurnExecutor(BASE_PAYLOAD, requestId, {
    routingAdapter,
    graphState: buildD1Fixture(),
  });
}

/**
 * Coaching signal ids captured off the REAL telemetry sink. This is the
 * signal the system emits, not a re-derivation of it in the test.
 */
let firedSignalIds: string[] = [];

beforeEach(() => {
  priorTurns = [];
  priorFacts = [];
  firedSignalIds = [];
  setTestSink((eventName, data) => {
    if (eventName === 'v5.coaching.signal_fired') {
      firedSignalIds.push(String(data.signal_id));
    }
  });
});

afterEach(() => {
  setTestSink(null);
});

describe('Gate-1: a no-op edit must not render as applied (wired through runTurnExecutor)', () => {
  describe('PART 1 + PART 2 together — the exact live defect', () => {
    it('NO-OP set_factor_value with a prior analysis: neither false sentence reaches the user', async () => {
      seedPriorSuccessfulAnalysis();
      // f-churn is already 4%. Proposing 4% changes nothing.
      const { response, telemetry } = await runEditTurn(setFactorToolCall(4), 'req-noop-1');

      // Precondition: this really was dispatched as a no-op edit turn.
      expect(telemetry.turn_class).toBe('handler');
      expect(telemetry.failure_type).toBeNull();
      const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
      expect(patchBlock).toMatchObject({ operation: 'set_factor_value', status: 'noop' });

      // FALSE CLAIM 1 — narration. The user must not read a change receipt.
      expect(response.assistant_text).not.toContain('from 4% to 4%');
      expect(response.assistant_text).not.toMatch(/^Updated\b/);
      expect(response.assistant_text).not.toMatch(/from\s+(.+?)\s+to\s+\1/);
      // …and must read an honest one naming the already-held value.
      expect(response.assistant_text).toContain('Customer churn');
      expect(response.assistant_text).toContain('already');
      expect(response.assistant_text).toContain('4%');

      // FALSE CLAIM 2 — staleness. A no-op cannot stale an analysis.
      // This is the coaching half, concatenated into the same string.
      expect(response.assistant_text).not.toContain('This change affects the model');
      expect(response.assistant_text).not.toContain('may not reflect it');
      expect(response.assistant_text).not.toContain('stale');
      expect(firedSignalIds).toEqual([]);
    });

    it('APPLIED set_factor_value with a prior analysis: BOTH channels still fire (control)', async () => {
      seedPriorSuccessfulAnalysis();
      // f-churn 4% → 5% is a real change.
      const { response } = await runEditTurn(setFactorToolCall(5), 'req-applied-1');

      const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
      expect(patchBlock).toMatchObject({ operation: 'set_factor_value', status: 'applied' });

      // Narration still claims the change it really made.
      expect(response.assistant_text).toContain('Updated');
      expect(response.assistant_text).toContain('from 4% to 5%');
      expect(response.assistant_text).not.toContain('already');

      // Staleness coaching still fires — the analysis really is stale now.
      expect(firedSignalIds).toEqual(['STALE_ANALYSIS_AFTER_EDIT']);
      expect(response.assistant_text).toContain('This change affects the model');
    });
  });

  describe('PART 1 — adjust_edge_strength narration', () => {
    it('NO-OP adjust_edge_strength does not narrate an adjustment', async () => {
      seedPriorSuccessfulAnalysis();
      // f-budget→g-revenue is already 0.4.
      const { response } = await runEditTurn(adjustEdgeToolCall(0.4), 'req-noop-edge');

      const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
      expect(patchBlock).toMatchObject({ operation: 'adjust_edge_strength', status: 'noop' });

      expect(response.assistant_text).not.toMatch(/^Adjusted\b/);
      expect(response.assistant_text).not.toMatch(/from\s+(.+?)\s+to\s+\1/);
      expect(response.assistant_text).toContain('already');
      // PART 2 also covers the edge handler.
      expect(response.assistant_text).not.toContain('This change affects the model');
      expect(firedSignalIds).toEqual([]);
    });

    it('APPLIED adjust_edge_strength still narrates the adjustment (control)', async () => {
      seedPriorSuccessfulAnalysis();
      const { response } = await runEditTurn(adjustEdgeToolCall(0.9), 'req-applied-edge');

      const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
      expect(patchBlock).toMatchObject({ operation: 'adjust_edge_strength', status: 'applied' });

      expect(response.assistant_text).toMatch(/^Adjusted\b/);
      expect(response.assistant_text).not.toContain('already');
      expect(firedSignalIds).toEqual(['STALE_ANALYSIS_AFTER_EDIT']);
    });
  });

  describe('PART 2 — no prior analysis means no staleness claim either way', () => {
    it('NO-OP edit with NO prior analysis emits no coaching and an honest receipt', async () => {
      // priorFacts stays empty: nothing to stale yet.
      const { response } = await runEditTurn(setFactorToolCall(4), 'req-noop-noprior');

      expect(response.assistant_text).toContain('already');
      expect(response.assistant_text).not.toMatch(/^Updated\b/);
      expect(response.assistant_text).not.toContain('This change affects the model');
      expect(firedSignalIds).toEqual([]);
    });
  });
});
