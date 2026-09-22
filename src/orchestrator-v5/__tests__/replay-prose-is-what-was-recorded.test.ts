/**
 * A REPLAY MUST NOT CLAIM AN EDIT — IN PROSE **OR** IN THE STRUCTURED PAYLOAD.
 *
 * Witnessed on deployed staging (build c12a54d): T1 set a factor to 14; a
 * DIFFERENT turn T2 moved it to 17; the T1 client retried and was told
 * "Updated Sales Cycle Length from 17 months to 14 months" while dTurns=0,
 * dVersions=0 and the persisted value stayed 17.
 *
 * ⛔ THE FIRST FIX SUBSTITUTED THE TURN'S ORIGINAL PROSE AND DID NOT WORK.
 *    "Updated ... from 9 months to 14 months" still implies the value is now 14
 *    — just as false. An independent review caught it, and caught that the old
 *    acceptance test PINNED that wrong answer while its own assertion message
 *    said the opposite. Replaying historical prose bare answers a question asked
 *    NOW with words composed for a question asked EARLIER.
 *
 * ⛔ AND PROSE ALONE IS NOT ENOUGH. `compose.ts` ships the same claim as
 *    machine-readable data (`graph_patch.status = 'applied'`), and its own
 *    comment says the renderer treats `assistant_text` as the FALLBACK. Fixing
 *    only the text fixes the fallback and leaves the contract lying.
 */
import { describe, it, expect } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore } from '../session/store.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FRESH = 'Updated Sales Cycle Length from 17 months to 14 months.';

function composed() {
  const base = composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: FRESH,
    stage: 'analyse',
  });
  return {
    ...base,
    blocks: [
      { type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: 'bc936d4c', before: 17, after: 14 },
      { type: 'ui_directive', directive: 'open_inspector', target_id: 'bc936d4c' },
    ],
  } as typeof base;
}

const meta = () => ({
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 0,
  duration_ms: 1,
  handler_facts: [],
});

function storeReporting(replayed: boolean): SessionStore {
  const base = createNoopSessionStore();
  return {
    ...base,
    append: async () => ({ id: 'turn-row', ...(replayed ? { replayedPriorTurn: true as const } : {}) }),
  } as SessionStore;
}

const blocksOf = (r: unknown) =>
  (((r as { blocks?: unknown }).blocks ?? []) as Array<Record<string, unknown>>);

describe('a replay states that nothing was written, in prose and in the payload', () => {
  it('RED: the prose does NOT claim an update happened', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting(true));
    expect(
      r.response.assistant_text,
      'the whole defect is a turn that tells the user it applied an edit it did not apply',
    ).not.toMatch(/\bUpdated\b/i);
    expect(r.response.assistant_text).toMatch(/nothing new was written/i);
  });

  it('RED: the machine-readable graph_patch no longer says `applied`', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting(true));
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch, 'the block must survive — it is the contract, not decoration').toBeDefined();
    expect(
      patch?.status,
      'compose.ts treats assistant_text as the FALLBACK and the block as the contract',
    ).toBe('noop');
  });

  it('RED: the open_inspector directive is dropped — no node was changed', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting(true));
    expect(blocksOf(r.response).some((b) => b.type === 'ui_directive')).toBe(false);
  });

  it('CONTROL — an ordinary FIRST commit is byte-identical', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting(false));
    expect(r.response.assistant_text).toBe(FRESH);
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch?.status).toBe('applied');
    expect(blocksOf(r.response).some((b) => b.type === 'ui_directive')).toBe(true);
  });
});
