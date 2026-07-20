/**
 * Context Architecture v2 — S4 rolling summary: commit-seam posture.
 *
 * UNCONDITIONAL since the O-2 activation (2026-07-20): the CEE_ROLLING_SUMMARY
 * flag is DELETED (no-dark-launches ruling — rollback = code revert), so the
 * maintainer fires after EVERY durable commit. Pins (mirrors
 * commit-decision-record-hook.test.ts):
 *  - the maintainer fires exactly once per commit, fire-and-forget, with the
 *    store threaded as the history reader and the turn's brief threaded as
 *    the floor input;
 *  - fire-and-forget contract AT THIS SEAM: the commit never awaits the
 *    maintainer — a maintainer that never settles cannot block the commit,
 *    and the commit result is byte-identical to a resolving maintainer's.
 *    (Failure CONTAINMENT lives inside maintainRollingSummaryForCommit and
 *    is pinned by rolling-summary/__tests__/maintainer.test.ts — the real
 *    maintainer is contractually non-throwing.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { maintainSpy } = vi.hoisted(() => ({
  maintainSpy: vi.fn(async (_arg: Record<string, unknown>) => undefined),
}));

vi.mock('../rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: maintainSpy,
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function composed() {
  return composeDirectAnswerResponse({ assistant_text: 'hi', stage: 'analyse' });
}

function meta() {
  return {
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: 'sha256:test',
    llm_calls_used: 0,
    duration_ms: 42,
    handler_facts: [],
    briefText: 'We are choosing a new HQ.',
  };
}

async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rolling-summary commit hook — unconditional (O-2 activation)', () => {
  it('fires the maintainer once with the store as history reader + the brief as floor input', async () => {
    const store = createNoopSessionStore({ appendId: 'row-1' });
    const result = await commitDirectAnswer(composed(), meta(), store);
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(maintainSpy).toHaveBeenCalledOnce();
    const arg = maintainSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.scenarioId).toBe(SCENARIO_ID);
    expect(arg.turnId).toBe(TURN_ID);
    expect(arg.historyReader).toBe(store);
    expect(arg.briefText).toBe('We are choosing a new HQ.');
  });

  it('fire-and-forget pin: a never-settling maintainer cannot block the commit, result byte-identical', async () => {
    const ok = await commitDirectAnswer(composed(), meta(), createNoopSessionStore({ appendId: 'row-pin' }));
    await drainMicrotasks();
    maintainSpy.mockImplementationOnce(() => new Promise<undefined>(() => {}));
    const withHungMaintainer = await commitDirectAnswer(
      composed(),
      meta(),
      createNoopSessionStore({ appendId: 'row-pin' }),
    );
    await drainMicrotasks();
    expect(maintainSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(withHungMaintainer)).toBe(JSON.stringify(ok));
  });
});
