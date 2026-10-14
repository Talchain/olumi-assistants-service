import { describe, expect, it } from 'vitest';
import type { AnalysisStateV1, OlumiResponse, RunDelta, RunDeliveredRecord } from '@talchain/schemas/boundary';
import { projectCurrentRead } from '../current-read-projection.js';

const runHash = '0123456789abcdef';
const currentHash = 'fedcba9876543210';
const result = { type: 'analysis_result', computed_against_hash: runHash } as unknown as OlumiResponse['blocks'][number];

function state(run_state: AnalysisStateV1['run_state']): AnalysisStateV1 {
  return { run_state } as AnalysisStateV1;
}

describe('the internal current-read producer projection', () => {
  it('carries the selector\'s current Run and exactly its selected result', () => {
    const run_state = { kind: 'complete_current', computed_at: '2026-09-30T12:00:00.000Z' } as AnalysisStateV1['run_state'];
    const read = projectCurrentRead({
      analysisState: state(run_state),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: runHash },
      analysisResult: result,
    });

    expect(read.run_state).toBe(run_state);
    expect(read.result).toBe(result);
    expect(read.computed_against_hash).toBe(runHash);
    expect(read.current_analysis_hash).toBe(runHash);
    expect(read.figures).toEqual([]);
  });

  it('keeps the stale reason and both canonical hashes but never an earlier figure', () => {
    const run_state = { kind: 'complete_stale', cause: 'graph_changed', computed_at: '2026-09-30T12:00:00.000Z' } as AnalysisStateV1['run_state'];
    const read = projectCurrentRead({
      analysisState: state(run_state),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: currentHash },
      analysisResult: result,
    });

    expect(read.run_state).toBe(run_state);
    expect(read.computed_against_hash).toBe(runHash);
    expect(read.current_analysis_hash).toBe(currentHash);
    expect(read.result).toBeNull();
  });

  it('SC-24: the Run comparison rides only under complete_current — a stale Run never carries it (CURRENT-READ-v1 row 1)', () => {
    const runDelta = { attribution_case: 'C2_unpaired', win_probabilities: [] } as unknown as RunDelta;
    const at = '2026-09-30T12:00:00.000Z';
    const current = projectCurrentRead({
      analysisState: state({ kind: 'complete_current', computed_at: at } as AnalysisStateV1['run_state']),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: runHash },
      analysisResult: result, runDelta,
    });
    expect(current.run_delta).toBe(runDelta);
    const stale = projectCurrentRead({
      analysisState: state({ kind: 'complete_stale', cause: 'graph_changed', computed_at: at } as AnalysisStateV1['run_state']),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: currentHash },
      analysisResult: result, runDelta,
    });
    expect(stale).not.toHaveProperty('run_delta');
    const noBlock = projectCurrentRead({
      analysisState: state({ kind: 'complete_current', computed_at: at } as AnalysisStateV1['run_state']),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: runHash },
      analysisResult: null, runDelta,
    });
    expect(noBlock).not.toHaveProperty('run_delta');
  });

  it('⭐ 0.79 Slice R: the Run\'s id and DELIVERED record ride only under complete_current, verbatim (never a copy)', () => {
    const deliveredRecord = { record_version: 1, run_id: 'run-b', graph_hash: runHash, phase3_blocks: [] } as unknown as RunDeliveredRecord;
    const at = '2026-09-30T12:00:00.000Z';
    const input = (kind: 'complete_current' | 'complete_stale', analysisResult: typeof result | null) => ({
      analysisState: state({ kind, ...(kind === 'complete_stale' ? { cause: 'graph_changed' } : {}), computed_at: at } as AnalysisStateV1['run_state']),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: kind === 'complete_current' ? runHash : currentHash },
      analysisResult, runId: 'run-b', deliveredRecord,
    });
    const current = projectCurrentRead(input('complete_current', result));
    expect(current.delivered_record).toBe(deliveredRecord);
    expect(current.run_id).toBe('run-b');
    const stale = projectCurrentRead(input('complete_stale', result));
    expect(stale).not.toHaveProperty('delivered_record');
    expect(stale).not.toHaveProperty('run_id');
    const noBlock = projectCurrentRead(input('complete_current', null));
    expect(noBlock).not.toHaveProperty('delivered_record');
    expect(noBlock).not.toHaveProperty('run_id');
  });

  it('distinguishes an authoritative never-run from an unreadable or absent read', () => {
    const never = projectCurrentRead({
      analysisState: state({ kind: 'never_run' }),
      derivation: { graph_hash_at_run: null, current_graph_hash: currentHash },
      analysisResult: result,
    });
    const unreadable = projectCurrentRead({ analysisState: null });

    expect(never.run_state).toEqual({ kind: 'never_run' });
    expect(never.current_analysis_hash).toBe(currentHash);
    expect(never.result).toBeNull();
    expect(unreadable).toEqual({ run_state: null, computed_against_hash: null, current_analysis_hash: null, result: null, figures: [] });
  });

  it('preserves the selector\'s degraded reason without laundering a prior result', () => {
    const run_state = { kind: 'unknown_degraded', cause: 'store_unreadable' } as AnalysisStateV1['run_state'];
    const read = projectCurrentRead({
      analysisState: state(run_state),
      derivation: { graph_hash_at_run: runHash, current_graph_hash: currentHash },
      analysisResult: result,
    });

    expect(read.run_state).toBe(run_state);
    expect(read.result).toBeNull();
  });
});
