/**
 * THE CONSUMER HALF: a replayed commit returns the prose it ACTUALLY recorded.
 *
 * The store half (`session/__tests__/replay-must-not-narrate-an-edit.test.ts`)
 * proves `append` surfaces `replayedAssistantMessage`. This proves the commit
 * seam PREFERS it — without this, the field exists and nothing reads it, which
 * is the guard-with-no-producer shape in reverse.
 *
 * Witnessed on deployed staging (build c12a54d, 22 Sep 2026), scenario
 * 6f59981e-541a-48ad-a774-cac6de21f810:
 *   T1 sets the factor to 14 -> persisted 14
 *   T2 (different turn) sets it to 17 -> persisted 17
 *   the T1 client retries T1 -> SAID "Updated ... from 17 months to 14 months",
 *   while dTurns=0, dVersions=0 and the persisted value stayed 17.
 */
import { describe, it, expect } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore } from '../session/store.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** What the FIRST attempt durably recorded. */
const RECORDED = 'Updated Sales Cycle Length from 9 months to 14 months.';
/** What the handler freshly composes on the retry, against state that moved on. */
const FRESHLY_COMPOSED = 'Updated Sales Cycle Length from 17 months to 14 months.';

function composed(text: string) {
  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: text,
    stage: 'analyse',
  });
}

function meta() {
  return {
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: 'sha256:test',
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
  };
}

/** A store whose append reports the outcome under test. */
function storeReporting(replayed?: string): SessionStore {
  const base = createNoopSessionStore();
  return {
    ...base,
    append: async () => ({
      id: 'turn-row',
      ...(replayed === undefined ? {} : { replayedAssistantMessage: replayed }),
    }),
  } as SessionStore;
}

describe('a replayed commit returns the prose that was actually recorded', () => {
  it('RED: the reply is the RECORDED prose, not the freshly composed claim', async () => {
    const result = await commitDirectAnswer(
      composed(FRESHLY_COMPOSED),
      meta() as never,
      storeReporting(RECORDED),
    );

    expect(
      result.response.assistant_text,
      'a retry whose write replayed must not tell the user an edit happened',
    ).toBe(RECORDED);
  });

  it('CONTROL — an ordinary FIRST commit keeps its own freshly composed prose', async () => {
    const result = await commitDirectAnswer(
      composed(FRESHLY_COMPOSED),
      meta() as never,
      storeReporting(undefined),
    );

    expect(result.response.assistant_text).toBe(FRESHLY_COMPOSED);
  });

  it('CONTROL — a replay whose recorded prose EQUALS the composed prose is untouched', async () => {
    const result = await commitDirectAnswer(
      composed(RECORDED),
      meta() as never,
      storeReporting(RECORDED),
    );

    expect(result.response.assistant_text).toBe(RECORDED);
  });
});
