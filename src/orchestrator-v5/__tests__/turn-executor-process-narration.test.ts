/**
 * ROUTE-LEVEL proof that the model's process narration cannot reach the user.
 *
 * ⭐⭐ WHY THIS FILE EXISTS ALONGSIDE THE UNIT SPEC. The unit spec proves the
 * guard classifies the two witnessed strings correctly. It says nothing about
 * whether the guard is REACHED — and "reached" is exactly what failed here:
 * `stripPlanningPreamble` is a correct stripper wired to the execute and
 * clarify branches only, so the coach / converse / text_only branches (the ones
 * that leaked on 3 Sep) never met it. A green unit spec for a guard pointed at
 * the wrong branch is this estate's trap 3b, one level up. So every assertion
 * below drives `runTurnExecutor` end to end.
 *
 * ── ⭐⭐⭐ WHICH LEAK IS DRIVEN HERE, AND WHY IT IS THE ROUTING VERDICT ──────
 * A THIRD guard turned out to be in play, and finding it CHANGED this file.
 * `applyCoachingOutputGuard` (coaching-output-postcheck.ts) runs on the coach
 * and converse compose branches. Probed at this tip against a FRESH, usable
 * pack — so its state-conditional arms are off and anything it reports is pure
 * lexical detection — with two contrast controls in the same run:
 *
 *   LEAK deliberation (turn 18)          safe=false  internal_field_exposed
 *   …with `graph.edges` removed          safe=false  internal_field_exposed
 *   …with `ContextPack` removed too      safe=TRUE   —
 *   LEAK routing verdict (turn 15)       safe=TRUE   —
 *   CONTROL "The graph_hash …"           safe=false  internal_field_exposed
 *   CONTROL a clean analysis headline    safe=TRUE   —
 *
 * Read that carefully, because it is the honest statement of what was already
 * covered and what was not. The coaching postcheck sees the deliberation ONLY
 * through its two internal TOKENS. Strip those and the monologue — the
 * third-person opener, the self-addressed "Let me check", the honesty-policy
 * sentence — is invisible to it. The routing verdict is invisible outright.
 *
 * Two consequences, both load-bearing:
 *
 *   1. The end-to-end assertions below use the ROUTING VERDICT, because it is
 *      the leak no shipped guard can see. Driving the deliberation through a
 *      coach/converse turn would be a test that passes whether or not this
 *      change exists — the postcheck would degrade it first, on a token. A
 *      test whose subject another guard already handles proves nothing about
 *      the guard it is named after (CLAUDE.md trap 13b: a guard agreeing with
 *      itself). The deliberation is pinned in the unit spec, where the
 *      classification is what is under test.
 *   2. Even where the postcheck DOES fire, its remedy is a state template
 *      ("No analysis has been run on your model yet…") — correct about state
 *      and unrelated to what the user asked. That is the behaviour Paul
 *      describes as operating machinery rather than talking to a reasoning
 *      partner, and it is why this guard's remedy answers instead.
 *
 * Fixtures are VERBATIM from `olumi-debug-f2e2df1b-20260903.json`
 * (`Talchain/olumi-programme-docs`), UI build `86786efb`. Harness mirrors
 * `turn-executor-reasoning-capture.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: '99999999-9999-4999-8999-999999999931',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31',
  message: 'how much did that edit actually move the result?',
});

/** Turn 15 of the capture, verbatim. Shipped as `assistant_text`, status 200. */
const LEAK_ROUTING_VERDICT =
  `This is a question about existing analysis results, not a model edit ` +
  `request. Per the conversation, updating Sales Headcount Investment from ` +
  `£80 to £100,000 widened Continue With Founder-Led Sales's lead by about 1 ` +
  `percentage point (now winning in 63% of runs), because the higher ` +
  `investment value increases the modelled Runway Depletion Risk more ` +
  `strongly, which weighs against the goal. That link is still flagged as ` +
  `fragile, so treat the shift as directional rather than settled. No model ` +
  `changes are needed to answer this.`;

/** The two sentences of it that are the system talking about itself. */
const NARRATION_SENTENCES = [
  'This is a question about existing analysis results, not a model edit request.',
  'No model changes are needed to answer this.',
] as const;

function textOnlyResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function toolResult(input: unknown, prefaceText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (prefaceText) content.push({ type: 'text', text: prefaceText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function mockAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

describe('TurnExecutor — the routing verdict leak (3 Sep 2026 capture)', () => {
  beforeEach(() => {
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('text_only: the router\'s own taxonomy does not reach assistant_text', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-narration-text-only', {
      routingAdapter: mockAdapter(textOnlyResult(LEAK_ROUTING_VERDICT)),
    });

    const shipped = result.response.assistant_text;
    for (const sentence of NARRATION_SENTENCES) {
      expect(shipped).not.toContain(sentence);
    }
    // Never silence — there is nothing behind this branch to fall back to.
    expect(shipped.trim().length).toBeGreaterThan(0);
  });

  it('converse tool call: same outcome through the answer_text channel', async () => {
    // A second, independent emit path into the same field — the ROADMAP 1.38
    // `answer_text` channel rather than the pre-tool-call text block. Two
    // branches, one guard: this is what a finaliser hook buys over a per-branch
    // fix, and it is the reason the fix is not two more `stripPlanningPreamble`
    // call sites.
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-narration-converse', {
      routingAdapter: mockAdapter(
        toolResult(
          {
            intent_class: 'converse',
            answer_shape: {
              headline: 'This is a question about existing analysis results, not a model edit request.',
              bullets: ['That link is still flagged as fragile.'],
              detail: 'No model changes are needed to answer this.',
            },
          },
          'Orientation.',
        ),
      ),
    });

    const shipped = result.response.assistant_text;
    for (const sentence of NARRATION_SENTENCES) {
      expect(shipped).not.toContain(sentence);
    }
    expect(shipped.trim().length).toBeGreaterThan(0);
  });

  it('⭐ the narration is ROUTED to the reasoning disclosure channel, not destroyed', async () => {
    // Paul's standard: reasoning must remain AVAILABLE to users; it must not be
    // the first thing they read. `run.reasoning` is the ROADMAP 1.42
    // `_reasoning` sidecar that route-v2 attaches post-egress.
    //
    // ⭐ THIS IS ALSO THE DISCRIMINATING ASSERTION OF THE FILE. No other guard
    // in the finalise chain writes `reasoning`; the leader-claim, forbidden-
    // phrase and success-claim guards only rewrite `assistant_text`. So this
    // can only be green because THIS guard ran.
    //
    // ⚠ SCOPE, so it is not read as more than it is: the WIRE exposure of that
    // sidecar is gated by CEE_REASONING_CAPTURE_ENABLED (default false) at
    // route-v2, and by VITE_FEATURE_REASONING_DISCLOSURE in the UI. This proves
    // the executor HANDS THE NARRATION OVER; it is not a claim that the
    // disclosure is user-visible on today's flag posture.
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-narration-reasoning', {
      routingAdapter: mockAdapter(textOnlyResult(LEAK_ROUTING_VERDICT)),
    });

    expect(result.reasoning).toBeDefined();
    for (const sentence of NARRATION_SENTENCES) {
      expect(result.reasoning).toContain(sentence);
    }
    // The answer sentence stayed in the answer and is NOT duplicated into the
    // disclosure — the two channels carry different halves, by construction.
    expect(result.reasoning).not.toContain('still flagged as fragile');
    // And the sidecar is never on the pre-egress body.
    expect('_reasoning' in (result.response as Record<string, unknown>)).toBe(false);
  });

  it('a REAL answer on the same branch is shipped byte-identical', async () => {
    // The control that makes the three assertions above mean anything: this
    // guard is not simply replacing every reply on this branch. Verbatim from
    // the same capture (turn 19) — and it is the answer the model finally gave
    // when the user asked the leaked question a second time.
    const GOOD =
      `I'm saying the first: I don't have visibility of any strength ` +
      `percentages on your factors and risks.`;
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-narration-control', {
      routingAdapter: mockAdapter(textOnlyResult(GOOD)),
    });

    expect(result.response.assistant_text).toBe(GOOD);
    expect(result.reasoning).toBeUndefined();
  });
});
