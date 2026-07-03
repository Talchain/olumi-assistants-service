/**
 * Normative contract tests for runStageFailOpen — these ARE the fail-open
 * semantics future dual-model stages inherit (see fail-open.ts header).
 */
import { describe, it, expect, vi } from 'vitest';
import { runStageFailOpen, FAIL_OPEN_DETAIL_MAX_CHARS } from '../fail-open.js';
import type { StageResult } from '../contracts.js';

type Reason = 'stage_failed' | 'nothing_to_do' | 'applied';
type Graph = { readonly nodes: readonly string[] };

const M1: Graph = { nodes: ['goal_g'] };

function stageReturning(result: StageResult<Graph, Reason>) {
  return async () => result;
}

describe('runStageFailOpen — throw path', () => {
  it('a throwing stage degrades to fallbackReason with the SAME upstream reference', async () => {
    const onDegrade = vi.fn();
    const res = await runStageFailOpen<Graph, Reason>(M1, { fallbackReason: 'stage_failed', onDegrade }, async () => {
      throw new Error('boom');
    });
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('stage_failed');
    expect(res.graph).toBe(M1); // reference identity, the byte-identity guarantee
    expect(res.detail).toBe('boom');
    expect(onDegrade).toHaveBeenCalledExactlyOnceWith('stage_failed', 'boom');
  });

  it('non-Error throws are stringified', async () => {
    const res = await runStageFailOpen<Graph, Reason>(M1, { fallbackReason: 'stage_failed' }, async () => {
      throw 'string failure';
    });
    expect(res.detail).toBe('string failure');
    expect(res.graph).toBe(M1);
  });

  it('the runner NEVER rejects, even when onDegrade itself throws', async () => {
    const res = await runStageFailOpen<Graph, Reason>(
      M1,
      {
        fallbackReason: 'stage_failed',
        onDegrade: () => {
          throw new Error('observer broke');
        },
      },
      async () => {
        throw new Error('boom');
      },
    );
    expect(res.changed).toBe(false);
    expect(res.graph).toBe(M1);
  });

  it('detail is truncated to FAIL_OPEN_DETAIL_MAX_CHARS', async () => {
    const long = 'x'.repeat(FAIL_OPEN_DETAIL_MAX_CHARS + 50);
    const res = await runStageFailOpen<Graph, Reason>(M1, { fallbackReason: 'stage_failed' }, async () => {
      throw new Error(long);
    });
    expect(res.detail).toHaveLength(FAIL_OPEN_DETAIL_MAX_CHARS);
  });
});

describe('runStageFailOpen — degrade normalisation', () => {
  it('changed:false with a DIFFERENT graph object is normalised back to the upstream reference', async () => {
    const clone: Graph = { nodes: ['goal_g'] };
    const onDegrade = vi.fn();
    const res = await runStageFailOpen<Graph, Reason>(
      M1,
      { fallbackReason: 'stage_failed', onDegrade },
      stageReturning({ changed: false, reason: 'nothing_to_do', graph: clone }),
    );
    expect(res.graph).toBe(M1);
    expect(res.graph).not.toBe(clone);
    expect(res.reason).toBe('nothing_to_do');
    expect(onDegrade).toHaveBeenCalledExactlyOnceWith('nothing_to_do', undefined);
  });

  it('degrade detail from the stage is carried (and bounded)', async () => {
    const res = await runStageFailOpen<Graph, Reason>(
      M1,
      { fallbackReason: 'stage_failed' },
      stageReturning({ changed: false, reason: 'nothing_to_do', graph: M1, detail: 'd'.repeat(500) }),
    );
    expect(res.detail).toHaveLength(FAIL_OPEN_DETAIL_MAX_CHARS);
  });
});

describe('runStageFailOpen — success passthrough', () => {
  it('changed:true results pass through untouched and fire no degrade', async () => {
    const merged: Graph = { nodes: ['goal_g', 'risk_new'] };
    const onDegrade = vi.fn();
    const result: StageResult<Graph, Reason> = { changed: true, reason: 'applied', graph: merged };
    const res = await runStageFailOpen<Graph, Reason>(
      M1,
      { fallbackReason: 'stage_failed', onDegrade },
      stageReturning(result),
    );
    expect(res).toBe(result);
    expect(res.graph).toBe(merged);
    expect(onDegrade).not.toHaveBeenCalled();
  });
});
