/**
 * Forced-pill dedicated-contract — close the coach-bypass hole (Codex F3).
 *
 * THE FINDING (verified at the bytes by the review): the forced-explanation pill
 * mechanism `tool_choice`-forces the generic `olumi_action` tool, but that tool's
 * schema still admits execute|clarify|converse|coach; the handler is pinned only
 * AFTER parse by `applyForcedExplanationHandler`, which returns UNCHANGED for any
 * non-execute proposal. So a SCHEMA-VALID coach/converse output BYPASSES the
 * forced pin entirely — the declared "guarantee" has a hole.
 *
 * The interim fix shipped here (the dedicated-tool variant being too invasive —
 * it needs a server-constructed graph-valid entity threaded through the
 * turn-executor to survive `validateToolCall`):
 *   1. `buildForcedPillTool` — dynamically constrains the forced call's tool to a
 *      single execute intent + single handler enum (shrinks the first-pass
 *      schema surface); and
 *   2. assert-execute-after-parse (`enforceForcedExecute`) — FAILS LOUD: a forced
 *      non-execute is downgraded to a repairable parse failure → REPAIR_ONCE →
 *      terminal `schema_repair_failed`, so a coach/converse is NEVER served.
 *
 * These tests pin:
 *   - the coach / converse COUNTEREXAMPLE (schema-valid, would have bypassed) is
 *     now blocked (RED on the old semantics: old code RESOLVES with the coach
 *     result; the fix makes it REJECT — construct-to-discriminate);
 *   - PARITY: a valid execute forced answer produces the byte-identical
 *     RoutingResult the current forced path yields (handler pinned, answer
 *     preserved, single LLM call);
 *   - the guard is SCOPED to forced pills (a non-forced coach turn is unaffected);
 *   - the constrained tool is a DERIVED narrowing of the base advert.
 *
 * All tests use an injected mock adapter. No real Anthropic API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { assembleContextPack, type ContextPack } from '../../context/context-pack-assembler.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import {
  buildForcedPillTool,
  buildOlumiActionTool,
  OLUMI_ACTION_TOOL_NAME,
} from '../tool-schema.js';

// A valid AnswerShape (headline = exactly one sentence, ≤3 non-blank bullets,
// non-blank detail) — so a coach / converse tool call carrying it PARSES
// cleanly. That is what makes the counterexample a genuine BYPASS (a
// schema-valid non-execute), not a parse failure.
const VALID_SHAPE = {
  headline: 'Option A leads on the current analysis.',
  bullets: ['It holds under the robustness band.'],
  detail: 'Option A wins because the churn driver favours it and the margin is comfortable.',
};

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-forced',
      scenario_id: 'scen-forced',
      message: 'Explain these results.',
    }),
    priorTurns: [],
  });
}

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 42,
  };
}

function toolUse(input: Record<string, unknown>): ToolResponseBlock {
  return {
    type: 'tool_use',
    id: 'toolu_forced',
    name: OLUMI_ACTION_TOOL_NAME,
    input,
  } as unknown as ToolResponseBlock;
}

/** A schema-valid COACH proposal — the exact shape that bypassed the pin. */
const coachInput = {
  intent_class: 'coach',
  coaching_mode: 'reframe',
  answer_shape: VALID_SHAPE,
};

/** A schema-valid CONVERSE proposal — the second bypass vector. */
const converseInput = {
  intent_class: 'converse',
  answer_shape: VALID_SHAPE,
};

/** A well-formed execute proposal (the happy forced path). */
function executeInput(handlerId: string, answerText: string) {
  return {
    intent_class: 'execute',
    action: {
      handler_id: handlerId,
      entity: {
        id: 'opt-a',
        kind: 'option',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: [],
      explanation: { answer_text: answerText },
    },
  };
}

describe('routeWithToolUse — forced-pill coach/converse bypass is blocked (Codex F3)', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('REJECTS a schema-valid COACH output on the forced path (old code RESOLVED — the bypass)', async () => {
    // Every call returns the same schema-valid coach proposal: the first pass
    // parses it (no schema failure), and REPAIR_ONCE gets the same coach again.
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue(mkResult([toolUse(coachInput)])),
    };

    // Old semantics: tryInterpret → ok(coach) → applyForcedExplanationHandler
    // returns it UNCHANGED → routeWithToolUse RESOLVES with a coach RoutingResult.
    // The fix downgrades that to a repairable failure → REPAIR_ONCE → throw.
    await expect(
      routeWithToolUse(minimalContextPack(), 'Explain these results.', {
        requestId: 'req-coach-bypass',
        sessionId: 'scen-forced',
        adapter,
        forcedExplanationHandlerId: 'explain_results',
      }),
    ).rejects.toMatchObject({
      name: 'RoutingError',
      cause: 'schema_repair_failed',
    });

    // Repaired once (initial + repair) before failing loud.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);

    // The bypass is TELEMETERED on both attempts: first_pass_execute=false,
    // returned_intent='coach' — the measurable hole-closed signal.
    const outcomes = events.filter((e) => e.event === 'v5.routing.forced_pill_outcome');
    expect(outcomes).toHaveLength(2);
    for (const o of outcomes) {
      expect(o.payload.first_pass_execute).toBe(false);
      expect(o.payload.returned_intent).toBe('coach');
      expect(o.payload.forced_handler_id).toBe('explain_results');
      // R-004: no user text ever attached.
      const serialized = JSON.stringify(o.payload);
      expect(serialized).not.toContain(VALID_SHAPE.headline);
      expect(serialized).not.toContain(VALID_SHAPE.detail);
    }
    expect(outcomes.map((o) => o.payload.llm_call).sort()).toEqual([1, 2]);
  });

  it('REJECTS a schema-valid CONVERSE output on the forced path (second bypass vector)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue(mkResult([toolUse(converseInput)])),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'Explain these results.', {
        requestId: 'req-converse-bypass',
        sessionId: 'scen-forced',
        adapter,
        forcedExplanationHandlerId: 'what_would_flip',
      }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });

    const outcomes = events.filter((e) => e.event === 'v5.routing.forced_pill_outcome');
    expect(outcomes.every((o) => o.payload.returned_intent === 'converse')).toBe(true);
    expect(outcomes.every((o) => o.payload.first_pass_execute === false)).toBe(true);
  });

  it('RECOVERS when the repair returns a valid execute after a first-pass coach bypass', async () => {
    // Attempt 1: coach (bypass, blocked → repair). Attempt 2 (repair): a valid
    // execute answer. The turn must SUCCEED with the pinned execute proposal —
    // the guard fails loud but still gives the model its one repair.
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolUse(coachInput)]))
        .mockResolvedValueOnce(
          mkResult([toolUse(executeInput('explain_results', 'A complete plain-language explanation of the current analysis results and what they imply for the decision.'))]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'Explain these results.', {
      requestId: 'req-recover',
      sessionId: 'scen-forced',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call' || result.proposal.intent_class !== 'execute') {
      throw new Error('expected execute tool_call after repair');
    }
    expect(result.proposal.action.handler_id).toBe('explain_results');

    const outcomes = events.filter((e) => e.event === 'v5.routing.forced_pill_outcome');
    expect(outcomes.map((o) => o.payload.first_pass_execute)).toEqual([false, true]);
  });
});

describe('routeWithToolUse — PARITY: a valid execute forced answer is unchanged', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('produces the SAME RoutingResult the current forced path yields (handler pinned, answer preserved, one LLM call)', async () => {
    // The model routes to a DIFFERENT explanation handler; the pin must override
    // it to the forced handler — exactly the pre-fix behaviour. The execute path
    // is untouched by the fix (enforceForcedExecute passes execute straight to
    // applyForcedExplanationHandler), so this is a byte-for-byte parity proof.
    const ANSWER =
      'A thorough plain-language explanation of the current analysis, grounded in the drivers and the robustness band.';
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolUse(executeInput('explain_from_structure', ANSWER))])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'Explain these results.', {
      requestId: 'req-parity',
      sessionId: 'scen-forced',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    // Exactly one call — first-pass valid, no repair tax.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call' || result.proposal.intent_class !== 'execute') {
      throw new Error('expected execute tool_call');
    }
    // Forced, not reclassified — the pin overrode the model's handler choice.
    expect(result.proposal.action.handler_id).toBe('explain_results');
    // The authored answer + entity are preserved (downstream side-band judges it).
    expect(result.proposal.action.explanation?.answer_text).toBe(ANSWER);
    expect(result.proposal.action.entity.id).toBe('opt-a');
    expect(result.llmCallCount).toBe(1);
    expect(result.droppedActions).toEqual([]);

    // First-pass-valid outcome is telemetered (the latency-win counter).
    const outcomes = events.filter((e) => e.event === 'v5.routing.forced_pill_outcome');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.payload.first_pass_execute).toBe(true);
    expect(outcomes[0]!.payload.returned_intent).toBe('execute');
    expect(outcomes[0]!.payload.llm_call).toBe(1);
  });
});

describe('routeWithToolUse — the guard is scoped to forced pills only', () => {
  afterEach(() => setTestSink(null));

  it('leaves a NON-forced coach turn untouched (no forcedExplanationHandlerId → resolves)', async () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    setTestSink((event, payload) => events.push({ event, payload }));
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolUse(coachInput)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'hi', {
      requestId: 'req-unforced-coach',
      sessionId: 'scen-forced',
      adapter,
      // no forcedExplanationHandlerId
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.proposal.intent_class).toBe('coach');
    }
    // No forced-pill outcome telemetry on a non-forced turn.
    expect(events.filter((e) => e.event === 'v5.routing.forced_pill_outcome')).toHaveLength(0);
  });
});

describe('buildForcedPillTool — a DERIVED narrowing of the base advert', () => {
  it('constrains intent_class to [execute] and handler_id to the single forced handler', () => {
    const tool = buildForcedPillTool('what_would_flip');
    const props = tool.input_schema.properties as Record<string, { enum?: unknown[] }> & {
      action: { properties: { handler_id: { enum?: unknown[] } } };
    };
    expect(props.intent_class.enum).toEqual(['execute']);
    expect(props.action.properties.handler_id.enum).toEqual(['what_would_flip']);
    // Same tool NAME so the tool_choice force + toolUse.name check still match.
    expect(tool.name).toBe(OLUMI_ACTION_TOOL_NAME);
    // Derived from the base: the answer_shape property (added by
    // buildOlumiActionTool) is still present, proving this is a narrowed COPY.
    expect(props.answer_shape).toBeDefined();
  });

  it('does NOT mutate the base olumi_action tool (still offers all four intents)', () => {
    buildForcedPillTool('explain_results');
    const base = buildOlumiActionTool();
    const baseProps = base.input_schema.properties as Record<string, { enum?: unknown[] }>;
    expect(baseProps.intent_class.enum).toEqual(['execute', 'clarify', 'converse', 'coach']);
  });
});
