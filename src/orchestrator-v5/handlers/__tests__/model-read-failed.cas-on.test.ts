
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { REVISION_CONFLICT_MESSAGE, promoteRevisionConflictResponse } from '../../graph-revision-conflict.js';
import { getStatusCodeForErrorCode, toErrorV1 } from '../../../utils/errors.js';
import { GraphStaleWriteError } from '../../session/store.js';
const { read, provider, commit } = vi.hoisted(() => ({ read: vi.fn(), provider: vi.fn(), commit: vi.fn() }));
vi.mock('../../build-turn-context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(), loadPersistedScenarioStateStrict: read,
}));
vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({ handleEditGraph: provider }));
vi.mock('../../commit.js', () => ({ commitDirectAnswer: commit, computeRequestHash: () => 'hash' }));

beforeEach(() => { __setUseAppendV6ForTest(true); vi.clearAllMocks(); });
afterEach(() => __setUseAppendV6ForTest(true));

describe('saved model admission failures are not evidence of a revision race', () => {

  it('OLRV1 contrast preserves 409 revision_conflict and exact conflict sentence', () => {
    const wire = toErrorV1(new GraphStaleWriteError('OLRV1', { conflict_category: 'revision_conflict' }));
    expect(getStatusCodeForErrorCode(wire.code)).toBe(409);
    expect(wire.code).toBe('revision_conflict');
    expect(wire.message).toBe(REVISION_CONFLICT_MESSAGE);
    expect(() => promoteRevisionConflictResponse({ status: 409, json: { ...wire } })).toThrow(GraphStaleWriteError);
  });
});
