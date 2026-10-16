import { randomUUID } from 'node:crypto';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { describe, expect, it, vi } from 'vitest';
import { readRecordedRun, runOperationTurnId } from '../run-operation.js';

const scenario = randomUUID();
const turn = randomUUID();
const runId = randomUUID();
const hash = 'b'.repeat(16);
const at = '2026-10-16T01:00:00.000Z';
const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: scenario, run_id: runId, graph_hash_at_run: hash, computed_at: at,
    leading_option_id: null, summary: 'Model-relative analysis.' } });
const current = () => ({ currentRun: { runId, graphHashAtRun: hash, computedAt: at },
  analysisState: { run_state: { kind: 'complete_current' } }, analysisReady: { status: 'ready' },
  analysisResult: { type: 'analysis_result', summary: 'Canonical gated result' } });
function fixture() {
  const store = {
    readCommittedTurn: vi.fn(async () => ({ id: 'exact-native-row', request_hash: 'native', user_message: null,
      assistant_message: null, llm_calls_used: 0 })),
    readFactsFor: vi.fn(async () => [fact]),
  };
  return store;
}
describe('recorded Run recovery is exact-operation and canonical-current only', () => {
  it('reads only this operation row’s facts and forwards the canonical permission/result surfaces intact', async () => {
    const store = fixture();
    const read = current();
    expect(await readRecordedRun(store, scenario, turn, async () => read)).toEqual({ status: 200,
      json: { analysis_state: read.analysisState, analysis_ready: read.analysisReady, blocks: [read.analysisResult] } });
    expect(store.readCommittedTurn).toHaveBeenCalledWith(scenario, runOperationTurnId(scenario, turn));
    expect(store.readFactsFor).toHaveBeenCalledWith(['exact-native-row'], 'run_analysis');
    expect(runOperationTurnId(scenario, randomUUID())).not.toBe(runOperationTurnId(scenario, turn));
    expect(runOperationTurnId(randomUUID(), turn)).not.toBe(runOperationTurnId(scenario, turn));
  });
  it.each(['runId', 'graphHashAtRun', 'computedAt'] as const)('refuses canonical %s mismatch', async key => {
    const read = current(); read.currentRun[key] = randomUUID();
    expect(await readRecordedRun(fixture(), scenario, turn, async () => read)).toBeUndefined();
  });
  it('refuses a stale/missing canonical Run or missing canonical result', async () => {
    expect(await readRecordedRun(fixture(), scenario, turn, async () => ({ ...current(), currentRun: undefined }))).toBeUndefined();
    expect(await readRecordedRun(fixture(), scenario, turn, async () => ({ ...current(), analysisResult: undefined }))).toBeUndefined();
  });
  it('refuses a foreign scenario fact, ambiguous facts, failed reads and unavailable canonical state', async () => {
    const store = fixture();
    store.readFactsFor.mockResolvedValueOnce([{ ...fact, result: { ...fact.result, scenario_id: randomUUID() } }]);
    expect(await readRecordedRun(store, scenario, turn, async () => current())).toBeUndefined();
    store.readFactsFor.mockResolvedValueOnce([fact, fact]);
    expect(await readRecordedRun(store, scenario, turn, async () => current())).toBeUndefined();
    store.readFactsFor.mockRejectedValueOnce(new Error('unavailable'));
    expect(await readRecordedRun(store, scenario, turn, async () => current())).toBeUndefined();
    expect(await readRecordedRun(store, scenario, turn, async () => { throw new Error('read failed'); })).toBeUndefined();
  });
});
