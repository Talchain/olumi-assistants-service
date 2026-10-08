import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import type { SessionTurnWrite } from '../store.js';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';
import { __setUseAppendV6ForTest } from '../supabase-store.js';

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(false));

describe('versioned floor revision is bound to the original writer', () => {
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
