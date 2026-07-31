/**
 * Coaching Context Pack v1 — turn-executor integration (both coaching branches).
 *
 * Drives the LLM-authored coaching path (text_only → converse) through the real
 * turn-executor with a mocked routing adapter. UNCONDITIONAL since 2026-07-20
 * (O-7 wave 2: CEE_COACHING_CONTEXT_PROMPT_ENABLED deleted, live-true on
 * staging). Proves:
 *   - an invented mutation-success claim on a real graph label → the wire
 *     `assistant_text` is DEGRADED to a deterministic safe trust response +
 *     rerun chip, and `v5.coaching.output_postcheck` telemetry fires;
 *   - safe prose (incl. pre-analysis directional coaching, the T1/T2 fix) →
 *     unchanged, no telemetry.
 * (The former "flag OFF = byte-identical" describe was removed with the
 * flag: its scenario — pre-analysis directional prose shipping verbatim —
 * is identical to the pass-through case above, which it silently duplicated
 * once the T1/T2 fix landed.)
 *
 * The session store is mocked with no facts / no graph, so the canonical
 * freshness verdict is `none` (unsafe). Mirrors
 * turn-executor-egress-forbidden-phrase.test's harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import {
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  findForbiddenPhraseHit,
} from '../compose/forbidden-user-facing-phrases.js';
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

// Dash-free so `sanitiseNarrateOutput` is a no-op — keeps the byte-identity
// assertion about the LANE, not the (unchanged) sanitiser.
//
// DIRECTIONAL is `isDirectionalOptionAdvice` tier 2 (recommendation verb +
// option-selection signal) AND, since ROADMAP 2.213, a banned choice directive
// at the wire seam. It is kept because the T1/T2 guarantee is about the
// POST-CHECK not firing — see the two tests below, which separate the two
// concerns that used to ride on this one string.
const DIRECTIONAL = 'You should choose Option A. It is clearly the best option.';

// `isDirectionalOptionAdvice` tier 1 (copula + inherently-option judgement,
// "is stronger"), so it exercises exactly the same post-check branch as
// DIRECTIONAL — but it names no choice for the user to make, so the 2.213
// doctrine set at the egress seam lets it through. This is what keeps the
// T1/T2 passthrough assertion NON-VACUOUS: it is directional option advice,
// not the plain safe prose already covered by the next test.
const DIRECTIONAL_DOCTRINE_SAFE = 'Option A is stronger on cost so far.';

describe('turn-executor — Coaching Context Pack v1 post-check (unconditional)', () => {
  it('CONTROL: the T1/T2 fixture is genuinely DIRECTIONAL option advice, not plain safe prose', async () => {
    // Without this, swapping the T1/T2 fixture for a 2.213-compliant string
    // could silently turn that test into a duplicate of "passes safe coaching
    // prose through unchanged" — a control that passes by testing nothing
    // (trap 12b). `checkCoachingOutput` classifies directional option advice as
    // a violation when the state is UNSAFE; a stale pack is the cheapest way to
    // ask the real classifier whether the prose is directional at all.
    const { checkCoachingOutput } = await import('../coaching/coaching-output-postcheck.js');
    const stalePack = {
      analysis_present: true,
      freshness: 'stale' as const,
      readiness_status: 'ready' as const,
      rerun_required: true,
      usable_for_prose: true,
      usable_for_chips: false,
      blocked: false,
      actionable_blocker_count: 0,
    };
    // Directional → unsafe under a stale pack.
    expect(checkCoachingOutput(DIRECTIONAL_DOCTRINE_SAFE, stalePack).safe).toBe(false);
    expect(checkCoachingOutput(DIRECTIONAL, stalePack).safe).toBe(false);
    // Plain safe prose → safe under the same pack. The two fixtures are NOT
    // interchangeable, which is what makes the T1/T2 assertion below real.
    expect(
      checkCoachingOutput('Here is one way to weigh the trade-off between speed and cost.', stalePack).safe,
    ).toBe(true);
    // …and the doctrine-safe fixture carries no 2.213 choice directive, which
    // is why it survives the egress seam while DIRECTIONAL does not.
    expect(findForbiddenPhraseHit(DIRECTIONAL_DOCTRINE_SAFE)).toBeNull();
    expect(findForbiddenPhraseHit(DIRECTIONAL)).not.toBeNull();
  });

  it('pre-analysis (none) directional coaching REACHES THE USER, not the canned dead-end (behavioural-retest T1/T2)', async () => {
    // The reported bug: a genuine coaching answer on an early conversational
    // turn (the model WAS invoked — converse branch) was degraded into the
    // canned "No analysis has been run… run the analysis?" nudge because the
    // state-conditional post-check fired purely on freshness === 'none'.
    // Pre-analysis there is no result to misrepresent, so the model's answer
    // must ship through and the post-check must NOT fire.
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what should I do about my decision?' },
      'req-coach-preanalysis-passthrough',
      { routingAdapter: mockRoutingAdapter(DIRECTIONAL_DOCTRINE_SAFE) },
    );

    // The model's actual coaching answer reaches the user verbatim.
    expect(response.assistant_text).toBe(DIRECTIONAL_DOCTRINE_SAFE);
    // It is NOT the canned no-analysis dead-end.
    expect(response.assistant_text).not.toMatch(/no analysis has been run/i);
    // No degrade telemetry — nothing was clobbered.
    expect(postcheckEvent()).toBeUndefined();
  });

  it('ROADMAP 2.213 — a CHOICE DIRECTIVE is replaced at the egress seam, and the T1/T2 post-check still does not fire', async () => {
    // Supersession, stated rather than buried: this test used to assert that
    // `DIRECTIONAL` — "You should choose Option A. It is clearly the best
    // option." — reached the user VERBATIM pre-analysis. The founder's binding
    // no-recommendations doctrine (ROADMAP 2.213) says the product never tells
    // the user what to choose, at any freshness. So the string no longer ships.
    //
    // The T1/T2 guarantee is untouched and is still asserted here: the failure
    // T1/T2 fixed was the post-check firing on freshness === 'none' and
    // clobbering real coaching with the canned nudge. That post-check still
    // does NOT fire; what replaces the text is the separate, later egress guard,
    // and its remedy is the neutral fallback, never the no-analysis dead-end.
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what should I do about my decision?' },
      'req-coach-preanalysis-choice-directive',
      { routingAdapter: mockRoutingAdapter(DIRECTIONAL) },
    );

    // The choice directive does not reach the user. Asserted against the
    // GUARD ITSELF rather than against two hand-copied regexes: a per-phrase
    // `not.toMatch(/you should choose/i)` only ever pins the two frames
    // someone remembered to copy, so a leak through any of the other doctrine
    // patterns would pass. `findForbiddenPhraseHit` is the same function the
    // egress seam runs, so this catches ANY pattern's leak, present or future.
    expect(response.assistant_text).not.toBe(DIRECTIONAL);
    expect(findForbiddenPhraseHit(response.assistant_text ?? '')).toBeNull();
    // The directive fixture trips a FATAL-class pattern, so the remedy is the
    // whole-response neutral fallback — not a terminology rewrite.
    expect(response.assistant_text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    // …and it is NOT the canned no-analysis dead-end either (T1/T2 intact).
    expect(response.assistant_text).not.toMatch(/no analysis has been run/i);
    // The coaching post-check is not what replaced it.
    expect(postcheckEvent()).toBeUndefined();
  });

  it('passes safe coaching prose through unchanged (no telemetry)', async () => {
    const safe = 'Here is one way to weigh the trade-off between speed and cost.';
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'help me think about this' },
      'req-coach-safe',
      { routingAdapter: mockRoutingAdapter(safe) },
    );
    expect(response.assistant_text).toBe(safe);
    expect(postcheckEvent()).toBeUndefined();
  });

  // A graph whose labels ("Plan A", "Pricing") are NOT type nouns — only the
  // label-aware path can catch references to them, so these prove the
  // turn-executor actually threads the graph's real labels into the post-check.
  const LABELLED_GRAPH = {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal' },
      { id: 'dec_d', kind: 'decision', label: 'Decision' },
      { id: 'opt_plan_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_plan_b', kind: 'option', label: 'Plan B' },
      { id: 'f_pricing', kind: 'factor', label: 'Pricing' },
    ],
    goal_node_id: 'goal_g',
    edges: [
      { from: 'dec_d', to: 'opt_plan_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
      { from: 'opt_plan_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    ],
  };

  it('pre-analysis (none): a directional recommendation on a real option label REACHES THE USER (T1/T2 fix)', async () => {
    // "I recommend Plan A" pre-analysis is legitimate coaching, not a
    // misrepresented result — it must ship through. (Post-analysis, when a
    // stale/unknown/blocked result exists, the label-aware directional degrade
    // still fires — covered by the coaching-output-postcheck unit tests.)
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what should I do about my decision?' },
      'req-coach-label-dir',
      { routingAdapter: mockRoutingAdapter('I recommend Plan A.'), graphState: LABELLED_GRAPH as never },
    );
    expect(response.assistant_text).toBe('I recommend Plan A.');
    expect(postcheckEvent()).toBeUndefined();
  });

  it('threads the graph’s real factor label: "I updated Pricing" degrades even pre-analysis (always-on rule)', async () => {
    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'help me think about this' },
      'req-coach-label-mut',
      { routingAdapter: mockRoutingAdapter('I updated Pricing.'), graphState: LABELLED_GRAPH as never },
    );
    expect(response.assistant_text).not.toBe('I updated Pricing.');
    expect(postcheckEvent()?.data.violation).toBe('invented_mutation_success');
  });
});


