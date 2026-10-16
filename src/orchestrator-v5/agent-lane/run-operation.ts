import { createHash } from 'node:crypto';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { SessionStore } from '../session/store.js';

/** One native Run identity per user operation, never per model revision. */
export function runOperationTurnId(scenarioId: string, turnId: string): string {
  const b = createHash('sha256').update(JSON.stringify(['agent_run_operation', scenarioId, turnId])).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type RunRead = {
  currentRun?: { runId: string; graphHashAtRun: string; computedAt: string };
  analysisState?: unknown; analysisReady?: unknown; analysisResult?: unknown;
};
export type RecoveredRun = { status: number; json: Record<string, unknown> };

/** Existing exact-operation fact + existing canonical reader; neither a new result store nor a freshness rule. */
export async function readRecordedRun(store: Pick<SessionStore, 'readCommittedTurn' | 'readFactsFor'>,
  scenarioId: string, turnId: string, read: () => Promise<RunRead>): Promise<RecoveredRun | undefined> {
  if (typeof store.readCommittedTurn !== 'function') return undefined;
  try {
    const row = await store.readCommittedTurn(scenarioId, runOperationTurnId(scenarioId, turnId));
    if (row === null) return undefined;
    const facts = await store.readFactsFor([row.id], 'run_analysis');
    if (facts.length !== 1) return undefined;
    const parsed = RunAnalysisHandlerFactSchema.safeParse(facts[0]);
    if (!parsed.success || parsed.data.noop || parsed.data.result.scenario_id !== scenarioId) return undefined;
    const fact = parsed.data.result;
    const current = await read();
    const run = current.currentRun;
    if (run === undefined || run.runId !== fact.run_id || run.graphHashAtRun !== fact.graph_hash_at_run
      || run.computedAt !== fact.computed_at || current.analysisResult === undefined || current.analysisState === undefined) return undefined;
    return { status: 200, json: { analysis_state: current.analysisState, analysis_ready: current.analysisReady,
      blocks: [current.analysisResult] } };
  } catch { return undefined; }
}
