import { createHash } from 'node:crypto';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { getModelManagementService } from '../model-management/index.js';
import type { SessionStore } from '../session/store.js';
import { SELECTED_RUN_DELTA_DEADLINE_MS } from './selected-run-delta-for-model.js';

/** One native Run identity per user operation, never per model revision. */
export function runOperationTurnId(scenarioId: string, turnId: string): string {
  const b = createHash('sha256').update(JSON.stringify(['agent_run_operation', scenarioId, turnId])).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * ⭐ ONE RESTORE = ONE Run (PATH-B gap 4; Codex R1 on #3469). When the saved head is a restore of this scenario (an Undo or
 * Redo: its own saved version and mutation), the Run that analyses it is THAT restore's operation, whoever presses Run and
 * with whatever request id: the key is the restore's mutation. Any other head, or one that cannot be read in time, keys nothing.
 */
export async function restoreRunOperation(scenarioId: string): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const head = await Promise.race([getModelManagementService().getCurrentVersion(scenarioId),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), SELECTED_RUN_DELTA_DEADLINE_MS); })]);
    if (head?.status !== 'ok' || head.value === null) return undefined;
    const v = head.value;
    return v.scenario_id === scenarioId && v.creation_kind === 'restore' && typeof v.mutation_id === 'string' && v.mutation_id !== ''
      ? `restore:${v.mutation_id}` : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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
