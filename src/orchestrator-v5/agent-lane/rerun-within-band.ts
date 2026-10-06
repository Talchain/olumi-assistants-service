/**
 * ⭐ SD-1 INTERIM (DL 0df0e1 ruling, 6 Oct, cut 5): the within-band link moves S7 names, for the pair a `run_delta` names.
 *
 * A link figure the user restates inside its band (rehearsal10: 0.4 → 0.6, still strong) moves no band and no sizing, so
 * no `input_changes` row can state it until schemas 0.78's `effect` (cut 6), and S7 said "Olumi can't say what changed".
 * This reads the scenario's persisted Run facts (`loadScenarioAnalysisFactsForRead`, the read route's own loader) and hands
 * the pair's moves to S7 (`withinBandLinkMovesForRunPair`). Internal only: never on the wire; coverage stays `partial`.
 * Only a `partial` delta can carry such a move, so any other delta costs no read. Any failure is `[]` (S7 says what it said
 * before).
 */
import { loadScenarioAnalysisFactsForRead } from '../build-turn-context.js';
import { withinBandLinkMovesForRunPair } from '../coaching/build-run-delta.js';
import type { WithinBandLinkMove } from '../coaching/run-input-changes.js';

export async function withinBandMovesForRunDelta(
  scenarioId: string,
  requestId: string,
  runDelta: unknown,
): Promise<WithinBandLinkMove[]> {
  const d = runDelta !== null && typeof runDelta === 'object' ? runDelta as { input_coverage?: unknown } : undefined;
  if (d?.input_coverage !== 'partial') return [];
  try {
    const { factSet, hotWindow } = await loadScenarioAnalysisFactsForRead(scenarioId, requestId);
    return withinBandLinkMovesForRunPair([...factSet.facts, ...hotWindow.facts], runDelta);
  } catch {
    return [];
  }
}
