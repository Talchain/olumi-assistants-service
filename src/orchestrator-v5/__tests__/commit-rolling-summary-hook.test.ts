/**
 * Context Architecture v2 — S4 rolling summary: commit-seam flag posture.
 *
 * Pins (mirrors commit-decision-record-hook.test.ts):
 *  - flag 'off' ⇒ byte-identical commit path: the maintainer is NEVER invoked,
 *    AND the commit result is byte-identical to the flag-on result (the hook
 *    never touches the turn);
 *  - flag 'maintain' ⇒ the maintainer fires once, fire-and-forget, with the
 *    store threaded as the history reader;
 *  - flag 'inject' ⇒ the maintainer also fires (injection is the follow-up;
 *    the maintain half runs in both stages).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { maintainSpy } = vi.hoisted(() => ({
  maintainSpy: vi.fn(async (_arg: Record<string, unknown>) => undefined),
}));

vi.mock('../rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: maintainSpy,
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { _resetConfigCache } from '../../config/index.js';

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

function setFlag(value: 'off' | 'maintain' | 'inject'): void {
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_ROLLING_SUMMARY', value);
  _resetConfigCache();
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('flag OFF — inert, byte-identical commit path', () => {
  it('never invokes the maintainer', async () => {
    setFlag('off');
    const result = await commitDirectAnswer(composed(), meta(), createNoopSessionStore({ appendId: 'row-1' }));
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(maintainSpy).not.toHaveBeenCalled();
  });

  it('JSON-additivity pin: flag-off and flag-maintain results are byte-identical', async () => {
    setFlag('off');
    const off = await commitDirectAnswer(composed(), meta(), createNoopSessionStore({ appendId: 'row-pin' }));
    await drainMicrotasks();
    setFlag('maintain');
    const on = await commitDirectAnswer(composed(), meta(), createNoopSessionStore({ appendId: 'row-pin' }));
    await drainMicrotasks();
    expect(JSON.stringify(off)).toBe(JSON.stringify(on));
  });
});

describe('flag maintain / inject — maintainer fires', () => {
  it('maintain: invokes the maintainer once with the store as history reader', async () => {
    setFlag('maintain');
    const store = createNoopSessionStore({ appendId: 'row-2' });
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

  it('inject: also invokes the maintainer (maintain half runs in both stages)', async () => {
    setFlag('inject');
    await commitDirectAnswer(composed(), meta(), createNoopSessionStore({ appendId: 'row-3' }));
    await drainMicrotasks();
    expect(maintainSpy).toHaveBeenCalledOnce();
  });
});
