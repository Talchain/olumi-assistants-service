import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import { commitDirectAnswer } from '../../commit.js';
import { composeDirectAnswerResponse } from '../../compose.js';
import type { ConditionalAppendOptions, SessionTurnWrite } from '../store.js';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';
import { __setUseAppendV6ForTest } from '../supabase-store.js';

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(false));

describe('versioned floor revision is bound to the original writer', () => {
  it('flag OFF keeps expectedRevision absent from actual append writes and options', async () => {
    __setUseAppendV6ForTest(false);
    const append = vi.fn(async (_write: SessionTurnWrite) => ({ id: 'ordinary-row' }));
    const appendIfLatest = vi.fn(async (_write: SessionTurnWrite, _options: ConditionalAppendOptions) => ({ id: 'answer-row' }));
    const store = createMockSessionStore({
      append,
      appendIfLatest,
      readMostRecentPendingActions: async (_scenario, options) => {
        options?.onLatestRowId?.('latest-row');
        return [];
      },
    });
    const metadata = {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: 'sha256:flag-off-shape',
      llm_calls_used: 0,
      duration_ms: 0,
      handler_facts: [],
    };
    await commitDirectAnswer(composeDirectAnswerResponse({
      answerKind: 'functional', assistant_text: 'Answer.', stage: 'frame',
    }), metadata, store);
    expect(append).toHaveBeenCalledOnce();
    expect(Object.prototype.hasOwnProperty.call(append.mock.calls[0]?.[0], 'expectedRevision')).toBe(false);

    const write: SessionTurnWrite = {
      ...metadata, turn_id: 'conditional-answer', response_emitted: true,
      assistantMessage: 'Answer.', pending_actions: [],
    };
    await appendCheckedGraphWrite({
      store, write, writesGraph: false,
      heldProposals: { isHeld: () => false, seenByThisRequest: new Set() },
    });
    expect(appendIfLatest).toHaveBeenCalledOnce();
    const [conditionalWrite, options] = appendIfLatest.mock.calls[0]!;
    expect(conditionalWrite).toBe(write);
    expect(options).toEqual({ expectedLatestRowId: 'latest-row' });
    expect(Object.prototype.hasOwnProperty.call(conditionalWrite, 'expectedRevision')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(options, 'expectedRevision')).toBe(false);
  });

  it.each(['drop', 'replace'] as const)('does not let a reconciliation callback %s the original expectation', async (mutant) => {
    const append = vi.fn(async (_write: SessionTurnWrite) => ({ id: 'committed-row' }));
    const write: SessionTurnWrite = {
      scenario_id: 'revision-floor-scenario', turn_id: 'revision-floor-turn',
      turn_class: 'direct_answer', handler_id: null, request_hash: 'sha256:revision-floor',
      response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [],
      expectedRevision: 11,
      // The floor forwards the semantic carrier; validation is the store's job.
      modelVersion: { mutation_id: 'floor-carrier' } as SessionTurnWrite['modelVersion'],
    };
    const reconcile = vi.fn((current: SessionTurnWrite) => {
      const { expectedRevision: _revision, ...rest } = current;
      return mutant === 'drop' ? rest : { ...rest, expectedRevision: 99 };
    });
    await appendCheckedGraphWrite({
      write, store: createMockSessionStore({ append }), writesGraph: false,
      heldProposals: { isHeld: () => false, seenByThisRequest: new Set(), onReconciled: reconcile },
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.[0]).toHaveProperty('expectedRevision', 11);
    expect(append.mock.calls[0]?.[0].modelVersion).toBe(write.modelVersion);
  });
});
