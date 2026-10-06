/**
 * ⭐ SD-1 INTERIM (DL 0df0e1 ruling, 6 Oct, cut 5): the within-band link moves S7 names, for the pair a `run_delta` names.
 *
 * A link figure the user restates inside its band (rehearsal10: 0.4 → 0.6, still strong) moves no band and no sizing, so
 * no `input_changes` row can state it until schemas 0.78's `effect` (cut 6), and S7 said "Olumi can't say what changed".
 * This reads the scenario's persisted facts (`loadScenarioAnalysisFactsForRead`, the read route's own loader) and hands the
 * pair's moves to S7 (`withinBandLinkMovesForRunPair`). Internal only: never on the wire; coverage stays `partial`.
 * - The Runs' snapshots come ONLY from the reconciled durable record when it is authority (`complete` / `capped`). A
 *   degraded or conflicting record names nothing: the hot window is never a second source of a Run (buddy r1 FAIL 1).
 * - A user-write receipt may come from either (it only ever turns a neutral line into "You", and is bound to the pair's
 *   own two means).
 * - Only a `partial` delta can carry such a move, so any other delta costs no read. A read that fails or outlasts
 *   `deadlineMs` names nothing (buddy r1: never strand the chip on a pending read).
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { loadScenarioAnalysisFactsForRead } from '../build-turn-context.js';
import { withinBandLinkMovesForRunPair } from '../coaching/build-run-delta.js';
import type { WithinBandLinkMove } from '../coaching/run-input-changes.js';
import { isScenarioAnalysisReasoningAuthority } from '../context/reconcile-scenario-analysis-facts.js';

export const WITHIN_BAND_READ_DEADLINE_MS = 1500;

export async function withinBandMovesForRunDelta(
  scenarioId: string,
  requestId: string,
  runDelta: unknown,
  deadlineMs: number = WITHIN_BAND_READ_DEADLINE_MS,
): Promise<WithinBandLinkMove[]> {
  const d = runDelta !== null && typeof runDelta === 'object' ? runDelta as { input_coverage?: unknown } : undefined;
  if (d?.input_coverage !== 'partial') return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<WithinBandLinkMove[]>((resolve) => { timer = setTimeout(() => resolve([]), deadlineMs); });
  const read = (async (): Promise<WithinBandLinkMove[]> => {
    const { factSet, hotWindow } = await loadScenarioAnalysisFactsForRead(scenarioId, requestId);
    if (!isScenarioAnalysisReasoningAuthority(factSet)) return [];
    const receipts: readonly HandlerFact[] = [...factSet.facts, ...hotWindow.facts];
    return withinBandLinkMovesForRunPair(factSet.facts, runDelta, receipts);
  })().catch((): WithinBandLinkMove[] => []);
  try {
    return await Promise.race([read, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
