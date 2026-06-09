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
});
