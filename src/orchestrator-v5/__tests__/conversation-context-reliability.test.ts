/**
 * V5 Conversation Context Reliability — content carry-over regression suite.
 *
 * Root problem (proven against staging): v5_conversation_turns persisted turn
 * METADATA only — no user-message text, no assistant-answer text — and the
 * ContextPack projected only metadata stubs. The LLM therefore could not
 * resolve ordinary follow-ups ("Why?", "do that", "the second one",
 * "what changed?"). This suite asserts the ACTUAL WORDS now flow:
 *   write  → commitDirectAnswer captures user + assistant text;
 *   read   → buildTurnContext surfaces prior content on prior_turns;
 *   project→ assembleContextPack carries content into recent_turns (→ LLM);
 *   guard  → a chip turn with zero prior turns emits a continuity-gap event.
 *
 * Tests assert CONTENT, not just field presence (brief §"Required tests").
 */

import { describe, it, expect, afterEach } from 'vitest';

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { commitDirectAnswer, CONVERSATION_TEXT_CAP } from '../commit.js';
import {
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  applyEgressForbiddenPhraseGuard,
} from '../compose/forbidden-user-facing-phrases.js';
import { sanitiseOlumiResponseForEgress } from '../compose/output-safety.js';
import { buildTurnContext } from '../build-turn-context.js';
import { assembleContextPack } from '../context/context-pack-assembler.js';
import { ContextPackSchema } from '../context/context-pack-schema.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { parseConversationContent, type SessionTurnWithContent } from '../session/conversation-content.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeContentTurn(
  over: Partial<SessionTurnWithContent> & {
    turn_id: string;
    created_at: string;
  },
): SessionTurnWithContent {
  return {
    id: `row-${over.turn_id}`,
    scenario_id: SCENARIO,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${over.turn_id}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 100,
    user_message: null,
    assistant_message: null,
    ...over,
  };
}

function makeResponse(assistantText: string): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
}

/** A noop store whose `append` records the SessionTurnWrite it received. */
function makeCapturingStore(): { store: SessionStore; last: () => SessionTurnWrite | null } {
  let captured: SessionTurnWrite | null = null;
  const base = createNoopSessionStore();
  const store: SessionStore = {
    ...base,
    append: async (w: SessionTurnWrite) => {
      captured = w;
      return { id: 'row-committed' };
    },
  };
  return { store, last: () => captured };
}

afterEach(() => setTestSink(null));

// ---------------------------------------------------------------------------
// Write side — commitDirectAnswer captures content uniformly
// ---------------------------------------------------------------------------

describe('write side — commitDirectAnswer captures conversation content', () => {
  const META = {
    scenario_id: SCENARIO,
    turn_id: 'turn-1',
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: 'sha256:x',
    llm_calls_used: 1,
    duration_ms: 10,
    handler_facts: [],
  };

  it('persists the user message (metadata) and the assistant answer (response.assistant_text)', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse('Option B leads Option A by 6 points.'),
      { ...META, userMessage: 'Which option is best?' },
      store,
    );
    const w = last();
    expect(w?.userMessage).toBe('Which option is best?');
    expect(w?.assistantMessage).toBe('Option B leads Option A by 6 points.');
  });

  it('captures the user brief but null assistant_message when the response is provisional/empty (draft-graph commit shape)', async () => {
    // draft_graph commits a provisional empty response (its real narrative is
    // built post-commit). The user brief is still captured; assistant_message
    // is null (the narrative is reconstructable from the persisted graph).
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse(''),
      { ...META, userMessage: 'Expand into the EU?' },
      store,
    );
    expect(last()?.userMessage).toBe('Expand into the EU?');
    expect(last()?.assistantMessage).toBeUndefined();
  });

  it('persists undefined (→ NULL) for blank/whitespace text rather than an empty string', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(makeResponse('   '), { ...META, userMessage: '  ' }, store);
    expect(last()?.userMessage).toBeUndefined();
    expect(last()?.assistantMessage).toBeUndefined();
  });

  it('caps over-long content app-side (no DB CHECK ⇒ truncate, never fail the turn)', async () => {
    const { store, last } = makeCapturingStore();
    const huge = 'x'.repeat(CONVERSATION_TEXT_CAP + 500);
    await commitDirectAnswer(makeResponse(huge), { ...META, userMessage: huge }, store);
    expect(last()?.userMessage?.length).toBe(CONVERSATION_TEXT_CAP);
    expect(last()?.assistantMessage?.length).toBe(CONVERSATION_TEXT_CAP);
  });
});

// ---------------------------------------------------------------------------
// Write side — stored assistant text is the DURABLE PUBLIC form (egress parity)
// ---------------------------------------------------------------------------
//
// COMMIT runs before two post-commit egress transforms (the route entity-id
// scrub + the turn-executor forbidden-phrase guard). The stored assistant_text
// must be reduced to the same public form so persisted history can NEVER carry
// a raw entity id or a forbidden phrase the user never saw — the privacy
// contract for stored assistant content.

describe('write side — stored assistant text equals the durable public (egress) form', () => {
  const META = {
    scenario_id: SCENARIO,
    turn_id: 'turn-1',
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: 'sha256:x',
    llm_calls_used: 1,
    duration_ms: 10,
    handler_facts: [],
  };

  it('scrubs a raw internal entity id out of the stored assistant_message', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse('The biggest driver is fac_delivery_cost in your model.'),
      { ...META, userMessage: 'What matters most?' },
      store,
    );
    const stored = last()?.assistantMessage ?? '';
    // The raw id is replaced (generic label) — it must never be persisted, even
    // if a Layer-1 handler scrub missed it before commit.
    expect(stored).not.toContain('fac_delivery_cost');
    expect(stored.length).toBeGreaterThan(0);
  });

  it('rewrites a forbidden contradiction phrase to the neutral fallback before storing', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse("I haven't applied any changes to the model."),
      { ...META, userMessage: 'Add a risk' },
      store,
    );
    // The wire path rewrites this to the neutral fallback post-commit; the
    // stored copy must match so a follow-up never reads a contradiction the
    // user never saw.
    expect(last()?.assistantMessage).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });

  it('leaves clean public prose unchanged', async () => {
    const { store, last } = makeCapturingStore();
    const clean = 'Option B leads Option A by 6 points.';
    await commitDirectAnswer(makeResponse(clean), { ...META, userMessage: 'Which wins?' }, store);
    expect(last()?.assistantMessage).toBe(clean);
  });

  // An ambiguous-prefix single-segment id (goal_revenue) is confirmed ONLY via
  // graph label resolution — the scrubber can't tell it from a legitimate
  // English compound (goal_setting) without the graph. So commit threads the
  // SAME graph the egress sanitiser uses (contentGraph).
  const GRAPH_WITH_GOAL = {
    nodes: [{ id: 'goal_revenue', kind: 'goal', label: 'Revenue' }],
    edges: [],
  };

  it('resolves an ambiguous-prefix id to its graph label when contentGraph is threaded (stored == wire)', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse('goal_revenue is most sensitive.'),
      { ...META, userMessage: 'What is most sensitive?', contentGraph: GRAPH_WITH_GOAL },
      store,
    );
    const stored = last()?.assistantMessage ?? '';
    // Matches the graph-aware route egress: raw id replaced by the human label.
    expect(stored).not.toContain('goal_revenue');
    expect(stored).toContain('Revenue');
  });

  it('documents the graph-free residual: an ambiguous-prefix id is retained without a graph (avoids corrupting goal_setting-style English)', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse('goal_revenue is most sensitive.'),
      { ...META, userMessage: 'What is most sensitive?' }, // no contentGraph
      store,
    );
    // Intentional, documented limitation: with no graph the scrubber cannot
    // distinguish goal_revenue (id) from goal_setting (English), so it leaves
    // it intact. A turn with no graph in scope cannot reference graph entities
    // anyway; threading contentGraph (above) closes this for real turns.
    expect(last()?.assistantMessage).toContain('goal_revenue');
  });

  it('still catches an unambiguous-prefix id even without a graph', async () => {
    const { store, last } = makeCapturingStore();
    await commitDirectAnswer(
      makeResponse('The driver fac_delivery_cost dominates.'),
      { ...META, userMessage: 'Why?' }, // no contentGraph
      store,
    );
    // fac_/opt_ are unambiguous short prefixes — redacted graph-free.
    expect(last()?.assistantMessage).not.toContain('fac_delivery_cost');
  });

  // Parity invariant: the stored assistant text must equal what the REAL route
  // egress (`sanitiseOlumiResponseForEgress`) produces for the same response +
  // graph, after the turn-executor forbidden-phrase guard. Asserting against
  // the actual egress helper (not a re-implementation) catches drift if egress
  // sanitisation changes. The turn-executor path threads the SAME graph
  // (`effectiveTurnGraph` → contentGraph here; `run.effectiveGraph` → route
  // egress), so stored == wire by construction — this locks that in.
  it('stored assistant text equals the route egress output for the same graph (stored == wire)', async () => {
    const { store, last } = makeCapturingStore();
    const text = 'goal_revenue is most sensitive; fac_delivery_cost is the runner-up.';
    await commitDirectAnswer(
      makeResponse(text),
      { ...META, userMessage: 'What matters?', contentGraph: GRAPH_WITH_GOAL },
      store,
    );
    // Reproduce the wire transform: forbidden-phrase guard (turn-executor
    // finalise) THEN entity-id egress scrub (route chokepoint), same graph.
    const wireResponse = sanitiseOlumiResponseForEgress(
      makeResponse(applyEgressForbiddenPhraseGuard(text).text),
      { graph: GRAPH_WITH_GOAL as never, requestId: 'test', exitPath: 'turn_executor', userMessage: null, mayNameLeadingOption: true },
    );
    expect(last()?.assistantMessage).toBe(wireResponse.assistant_text);
    // And concretely: the graph-resolved label is present, the raw ids are not.
    expect(last()?.assistantMessage).toContain('Revenue');
    expect(last()?.assistantMessage).not.toContain('goal_revenue');
    expect(last()?.assistantMessage).not.toContain('fac_delivery_cost');
  });
});

// ---------------------------------------------------------------------------
// Read side — buildTurnContext surfaces prior content
// ---------------------------------------------------------------------------

describe('read side — buildTurnContext carries prior conversation content', () => {
  it('Turn 2 ("Why?") receives Turn 1 user AND assistant text on prior_turns', async () => {
    const turn1 = makeContentTurn({
      turn_id: 't1',
      created_at: '2026-06-09T10:00:00.000Z',
      user_message: 'Which option is best?',
      assistant_message: 'Option B (Mid-Market Tier) leads Option A by 6 points.',
    });
    const store = createNoopSessionStore({ priorTurns: [turn1] });
    const payload = makeMessagePayload({ scenario_id: SCENARIO, message: 'Why?', source: 'composer' });

    const ctx = await buildTurnContext(payload, 'req-why', { sessionStore: store });

    expect(ctx.prior_turns).toHaveLength(1);
    expect(ctx.prior_turns[0].user_message).toBe('Which option is best?');
    expect(ctx.prior_turns[0].assistant_message).toBe(
      'Option B (Mid-Market Tier) leads Option A by 6 points.',
    );
  });
});

// ---------------------------------------------------------------------------
// Projection — ContextPack.recent_turns carries the actual words to the LLM
// ---------------------------------------------------------------------------

describe('projection — ContextPack.recent_turns carries content', () => {
  it('carry-over: prior turn user + assistant text appears in recent_turns', () => {
    const priorTurns = [
      makeContentTurn({
        turn_id: 't1',
        created_at: '2026-06-09T10:00:00.000Z',
        user_message: 'Which option is best?',
        assistant_message: 'Option B leads Option A by 6 points.',
      }),
    ];
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Why?' }),
      priorTurns,
    });
    expect(pack.conversation.recent_turns[0].user_message).toBe('Which option is best?');
    expect(pack.conversation.recent_turns[0].assistant_message).toBe(
      'Option B leads Option A by 6 points.',
    );
    // The pack must validate against the (strict) schema with content present.
    expect(ContextPackSchema.safeParse(pack).success).toBe(true);
  });

  it('reference resolution: the option list the user means by "the second one" is in recent_turns', () => {
    const priorTurns = [
      makeContentTurn({
        turn_id: 't1',
        created_at: '2026-06-09T10:00:00.000Z',
        user_message: 'What are my options?',
        assistant_message: 'Two options: 1) Expand into the EU; 2) Stay domestic.',
      }),
    ];
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'the second one' }),
      priorTurns,
    });
    const lastAnswer = pack.conversation.recent_turns[0].assistant_message ?? '';
    // The referent ("the second one" → "Stay domestic") must be present so the
    // LLM can resolve the ellipsis instead of asking what the user means.
    expect(lastAnswer).toContain('Stay domestic');
    expect(lastAnswer).toContain('Expand into the EU');
  });

  it('rejected-edit follow-up: the rejection answer is available for "why did that fail?"', () => {
    const priorTurns = [
      makeContentTurn({
        turn_id: 't1',
        created_at: '2026-06-09T10:00:00.000Z',
        user_message: 'Add a risk for supplier delays',
        assistant_message:
          "I couldn't add that — the model is already at its 30-link limit, so a new factor can't be connected.",
      }),
    ];
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'why did that fail?' }),
      priorTurns,
    });
    expect(pack.conversation.recent_turns[0].assistant_message).toContain('30-link limit');
  });

  it('no blank valid context: when prior turns exist, recent_turns is non-empty AND content-bearing', () => {
    const priorTurns = [
      makeContentTurn({
        turn_id: 't1',
        created_at: '2026-06-09T10:00:00.000Z',
        user_message: 'Hello',
        assistant_message: 'Here is your decision model.',
      }),
    ];
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Why?' }),
      priorTurns,
    });
    expect(pack.conversation.recent_turns.length).toBeGreaterThan(0);
    const anyContent = pack.conversation.recent_turns.some(
      (t) => t.user_message !== null || t.assistant_message !== null,
    );
    expect(anyContent).toBe(true);
  });

  it('legacy turns without content project null (backward compatible), still schema-valid', () => {
    // A plain turn missing the content fields (pre-migration row / legacy
    // fixture) must project null, not undefined, and keep the pack schema-valid.
    const legacy = {
      id: 'row-legacy',
      scenario_id: SCENARIO,
      user_id: 'u',
      turn_id: 't-legacy',
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: 'sha256:legacy',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 10,
      created_at: '2026-06-09T09:00:00.000Z',
    };
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Why?' }),
      priorTurns: [legacy],
    });
    expect(pack.conversation.recent_turns[0].user_message).toBeNull();
    expect(pack.conversation.recent_turns[0].assistant_message).toBeNull();
    expect(ContextPackSchema.safeParse(pack).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Post-analysis follow-up — analysis + conversation content both present
// ---------------------------------------------------------------------------

describe('post-analysis follow-up — analysis summary AND conversation text present', () => {
  it('"what could change it?" has both the latest analysis and the prior answer in context', () => {
    const priorTurns = [
      makeContentTurn({
        turn_id: 't-analysis',
        created_at: '2026-06-09T10:00:00.000Z',
        turn_class: 'handler',
        handler_id: 'run_analysis',
        user_message: 'Run the analysis',
        assistant_message: 'Option B wins in 72% of futures; churn is the biggest swing factor.',
      }),
    ];
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'what could change it?' }),
      priorTurns,
      analysis: {
        winner: { option_id: 'opt-b', option_label: 'Mid-Market Tier', win_probability: 0.72 },
        options: [
          { option_id: 'opt-b', option_label: 'Mid-Market Tier', win_probability: 0.72, outcome_mean: 120000 },
          { option_id: 'opt-a', option_label: 'Enterprise', win_probability: 0.28, outcome_mean: 90000 },
        ],
        top_drivers: [
          { factor_id: 'f-churn', factor_label: 'Customer Churn', sensitivity: 0.41, direction: 'negative' },
        ],
        robustness_level: 'moderate',
        fragile_edge_count: 0,
        top_fragile_edges: [],
        margin: 0.44,
        margin_pp: 44,
        analysis_status: 'complete',
      },
    });
    // Latest analysis is present (so "what could change it?" has something to reason about)...
    expect(pack.analysis).not.toBeNull();
    expect(pack.analysis?.leading_option).not.toBeNull();
    // ...AND the prior conversational answer is carried so the follow-up resolves.
    expect(pack.conversation.recent_turns[0].assistant_message).toContain('churn');
  });
});

// ---------------------------------------------------------------------------
// Guard — continuity-gap on a chip turn with zero prior turns
// ---------------------------------------------------------------------------

describe('RC-2 guard — continuity-gap detection', () => {
  it('emits v5.session.continuity_gap for a chip_click turn with zero prior turns', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({ priorTurns: [] });
    const payload = makeMessagePayload({
      scenario_id: SCENARIO,
      message: 'What could change the outcome?',
      source: 'chip_click',
      stage: 'analyse',
    });

    await buildTurnContext(payload, 'req-gap', { sessionStore: store });

    const gap = events.find((e) => e.name === 'v5.session.continuity_gap');
    expect(gap).toBeDefined();
    expect(gap!.data).toMatchObject({
      scenario_id: SCENARIO,
      source: 'chip_click',
      stage: 'analyse',
      prior_turn_count: 0,
    });
    // Content-free: the event must never carry message text.
    expect(JSON.stringify(gap!.data)).not.toContain('What could change the outcome');
  });

  it('does NOT emit a continuity gap for a composer turn with zero prior turns (legitimate first message)', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({ priorTurns: [] });
    const payload = makeMessagePayload({ scenario_id: SCENARIO, message: 'Should I expand?', source: 'composer' });

    await buildTurnContext(payload, 'req-first', { sessionStore: store });

    expect(events.find((e) => e.name === 'v5.session.continuity_gap')).toBeUndefined();
  });

  it('does NOT emit a continuity gap for a chip_click turn that HAS prior turns', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      priorTurns: [
        makeContentTurn({ turn_id: 't1', created_at: '2026-06-09T10:00:00.000Z', assistant_message: 'A leads B.' }),
      ],
    });
    const payload = makeMessagePayload({ scenario_id: SCENARIO, message: 'what would flip it?', source: 'chip_click' });

    await buildTurnContext(payload, 'req-ok', { sessionStore: store });

    expect(events.find((e) => e.name === 'v5.session.continuity_gap')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseConversationContent — read-side coercion unit (strip-before-strict path)
// ---------------------------------------------------------------------------

describe('parseConversationContent', () => {
  it('passes through strings, nulls absent/empty to null', () => {
    expect(parseConversationContent({ user_message: 'hi', assistant_message: 'yo' })).toEqual({
      user_message: 'hi',
      assistant_message: 'yo',
    });
    expect(parseConversationContent({})).toEqual({ user_message: null, assistant_message: null });
    expect(parseConversationContent({ user_message: '   ', assistant_message: null })).toEqual({
      user_message: null,
      assistant_message: null,
    });
  });

  it('coerces a non-string anomaly to null rather than throwing', () => {
    expect(parseConversationContent({ user_message: 42 as unknown as string })).toEqual({
      user_message: null,
      assistant_message: null,
    });
  });

  it('parses each field independently — a bad side does not drop the good side', () => {
    // A malformed user_message must NOT take a valid assistant_message down
    // with it (and vice versa).
    expect(
      parseConversationContent({
        user_message: { not: 'a string' } as unknown as string,
        assistant_message: 'Option B leads by 6 points.',
      }),
    ).toEqual({ user_message: null, assistant_message: 'Option B leads by 6 points.' });
    expect(
      parseConversationContent({
        user_message: 'Which option wins?',
        assistant_message: [1, 2, 3] as unknown as string,
      }),
    ).toEqual({ user_message: 'Which option wins?', assistant_message: null });
  });
});
