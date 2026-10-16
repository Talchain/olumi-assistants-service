/** C1: exercise the retained writer's failure mapping, rather than pinning the deleted executor's catch text. */
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { extractGraphConflictRecovery,failedTurnReply } from '../commit-failure-boundary.js';
import { StateCommitFailedError } from '../session/store.js';
import { TurnFenceRejectedError } from '../session/turn-fence.js';
import { INTERNAL_TO_WIRE } from '../types.js';
import { makeMessagePayload } from './fixtures.js';

const failure = vi.hoisted(() => ({ error: new Error('injected commit failure') as Error }));
vi.mock('../build-turn-context.js', async load => ({
  ...await load<typeof import('../build-turn-context.js')>(),
  buildTurnContext: async () => { throw failure.error; },
}));
const { runHeldProposalApproval } = await import('../handlers/approve-held-proposal.js');
const { GraphStaleWriteError } = await import('../build-turn-context.js');
const payload = makeMessagePayload({ stage: 'analyse', source: 'chip', message: 'Yes', chip: { id: 'gmh_fence' } });
beforeEach(() => { failure.error = new Error('injected commit failure'); });

async function replyFor(error: Error) {
  failure.error = error;
  const run = await runHeldProposalApproval(payload, 'req-fence');
  expect(run.telemetry.commit_performed).toBe(false);
  return failedTurnReply(run, payload.stage, 'req-fence');
}

describe('the retained card writer keeps typed commit refusals', () => {
  it('TurnFenceRejectedError still rides the typed commit-failure family', () => {
    const error = new TurnFenceRejectedError('refused', { verdict: 'stopped', generation: 1, maxGeneration: 2 });
    expect(error).toBeInstanceOf(StateCommitFailedError);
    expect(error.verdict).toBe('stopped');
    expect(error.name).toBe('TurnFenceRejectedError');
  });
  it('GRAPH_WRITE_CONFLICT remains GRAPH_DIVERGED, distinct from INTERNAL_ERROR', () => {
    expect(INTERNAL_TO_WIRE.GRAPH_WRITE_CONFLICT).toBe('GRAPH_DIVERGED');
    expect(INTERNAL_TO_WIRE.STATE_COMMIT_FAILED).toBe('INTERNAL_ERROR');
    expect(INTERNAL_TO_WIRE.STATE_COMMIT_FAILED).not.toBe(INTERNAL_TO_WIRE.GRAPH_WRITE_CONFLICT);
  });
  it.each([
    ['stopped', 'start_new_draft'], ['superseded', 'refresh_and_reconfirm'],
    ['unclaimed', 'retry_later'], ['unavailable', 'retry_later'],
  ] as const)('%s keeps its exact 409 recovery body', async (verdict, recovery) => {
    const reply = await replyFor(new TurnFenceRejectedError('refused', { verdict, generation: 1, maxGeneration: 2 }));
    expect(reply).toEqual({ status: 409, json: {
      error: 'GRAPH_DIVERGED', boundary: 'B1', direction: 'egress', validator: 'turn_commit',
      details: { retryable: false, reason: 'graph_write_conflict', failure_type: 'GRAPH_DIVERGED',
        recovery_action: recovery, conflict_category: `turn_fence_${verdict}`, fence_verdict: verdict,
        stage: 'analyse', stages_completed: [] }, request_id: 'req-fence', retryable: false,
    } });
  });
  it('a generic failure keeps the 500 retryable boundary; a previous conflict cannot leak into it', async () => {
    await replyFor(new TurnFenceRejectedError('refused', { verdict: 'stopped', generation: 1, maxGeneration: 2 }));
    expect(await replyFor(new Error('append failed'))).toEqual({ status: 500, json: {
      error: 'INTERNAL_ERROR', boundary: 'B1', direction: 'egress', validator: 'turn_commit',
      details: { retryable: true, reason: 'state_commit_failed_or_turn_runtime_failure', failure_type: 'INTERNAL_ERROR', stage: 'analyse', stages_completed: [] },
      request_id: 'req-fence', retryable: true,
    } });
  });
  it('a revision conflict keeps its measured revisions and wire code', async () => {
    const reply = await replyFor(new GraphStaleWriteError('stale', { conflict_category: 'revision_conflict',
      cause: { details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) } }));
    expect(reply.status).toBe(409);
    expect(reply.json).toEqual({ error: 'GRAPH_DIVERGED', boundary: 'B1', direction: 'egress', validator: 'turn_commit',
      details: { retryable: false, reason: 'graph_write_conflict', failure_type: 'GRAPH_DIVERGED', recovery_action: 'refresh_and_reconfirm',
        conflict_category: 'revision_conflict', expected_base_graph_hash: null, expected: 7, current: 8, stage: 'analyse', stages_completed: [], code: 'revision_conflict' },
      request_id: 'req-fence', retryable: false, code: 'revision_conflict',
      message: 'The scenario changed while I was saving, so nothing was saved. Try again.', expected: 7, current: 8 });
  });
  it('forwards only the shared recovery manifest, preserving null and measured zero', () => {
    expect(extractGraphConflictRecovery({ blocks: [{ type: 'error', details: {
      fence_verdict: 'stopped', recovery_action: 'start_new_draft', conflict_category: 'revision_conflict',
      expected_base_graph_hash: null, expected: 0, current: 1, other: 'unrelated',
    } }] })).toEqual({ recovery_action: 'start_new_draft', conflict_category: 'revision_conflict', fence_verdict: 'stopped',
      expected_base_graph_hash: null, expected: 0, current: 1 });
  });
});
