import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { MODEL_READ_FAILED_MESSAGE, ModelReadFailedError, REVISION_CONFLICT_MESSAGE, promoteRevisionConflictResponse } from '../../graph-revision-conflict.js';
import { getStatusCodeForErrorCode, toErrorV1 } from '../../../utils/errors.js';
import { GraphStaleWriteError } from '../../session/store.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
const { read, provider, commit } = vi.hoisted(() => ({ read: vi.fn(), provider: vi.fn(), commit: vi.fn() }));
vi.mock('../../build-turn-context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(), loadPersistedScenarioStateStrict: read,
}));
vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({ handleEditGraph: provider }));
vi.mock('../../commit.js', () => ({ commitDirectAnswer: commit, computeRequestHash: () => 'hash' }));
import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';

beforeEach(() => { __setUseAppendV6ForTest(true); vi.clearAllMocks(); });
afterEach(() => __setUseAppendV6ForTest(true));

describe('saved model admission failures are not evidence of a revision race', () => {
  it.each(['read_throws', 'negative_mean', 'invalid_revision', 'invalid_parse'] as const)('%s: refuses before provider/write, maps to 503 with pinned bytes', async mode => {
    const graph = buildD1Fixture();
    if (mode === 'negative_mean') graph.edges[0]!.strength.mean = -7;
    if (mode === 'invalid_parse') graph.nodes[0]!.kind = 'invalid' as typeof graph.nodes[0]['kind'];
    if (mode === 'read_throws') read.mockRejectedValueOnce(new Error('degraded combined read'));
    else read.mockResolvedValueOnce({ graph, briefText: null, revision: mode === 'invalid_revision' ? -1 : 7 });
    let error: unknown;
    try {
      await dispatchEditGraph({ payload: { kind: 'message', scenario_id: '22222222-2222-4222-8222-222222222222',
        turn_id: '33333333-3333-4333-8333-333333333333', stage: 'analyse', message: 'Rename budget', source: 'composer', turn_class: 'propose' },
        requestId: 'read-failure', request: {} as FastifyRequest, graphState: GraphStateIngressSchema.parse(buildD1Fixture()), analysisState: null });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ModelReadFailedError);
    const wire = toErrorV1(error);
    expect(getStatusCodeForErrorCode(wire.code)).toBe(503);
    expect(wire).toMatchObject({ code: 'model_read_failed', retryable: true, details: { code: 'model_read_failed', retryable: true } });
    expect(wire.message).toBe(MODEL_READ_FAILED_MESSAGE);
    expect(createHash('sha256').update(wire.message).digest('hex')).toBe('a30d669fc4f7f1f616124c4b1cc88d5def88a8ccef9039214593781c68f45f63');
    expect(wire.message).not.toContain(REVISION_CONFLICT_MESSAGE);
    expect(read).toHaveBeenCalledOnce();
    expect(provider).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(() => promoteRevisionConflictResponse({ status: 503, json: { ...wire } })).toThrow(ModelReadFailedError);
  });

  it('OLRV1 contrast preserves 409 revision_conflict and exact conflict sentence', () => {
    const wire = toErrorV1(new GraphStaleWriteError('OLRV1', { conflict_category: 'revision_conflict' }));
    expect(getStatusCodeForErrorCode(wire.code)).toBe(409);
    expect(wire.code).toBe('revision_conflict');
    expect(wire.message).toBe(REVISION_CONFLICT_MESSAGE);
    expect(() => promoteRevisionConflictResponse({ status: 409, json: { ...wire } })).toThrow(GraphStaleWriteError);
  });
});
