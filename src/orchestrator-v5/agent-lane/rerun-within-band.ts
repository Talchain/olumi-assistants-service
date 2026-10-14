/**
 * ⭐ SD-1 INTERIM (DL 0df0e1 ruling, 6 Oct, cut 5): the within-band link moves S7 names, for the pair a `run_delta` names.
 *
 * A link figure the user restates inside its band (rehearsal10: 0.4 → 0.6, still strong) moves no band and no sizing, so
 * no `input_changes` row can state it until schemas 0.78's `effect` (cut 6), and S7 said "Olumi can't say what changed".
 * This reads the scenario's persisted facts (`loadScenarioAnalysisFactsForRead`, the read route's own loader) and hands the
 * pair's moves to S7 (`withinBandLinkMovesForRunPair`). Internal only: never on the wire; coverage stays `partial`.
 * - The Runs' snapshots come ONLY from the reconciled durable record when it is authority (`complete` / `capped`). A
 *   degraded or conflicting record names nothing: the hot window is never a second source of a Run (buddy r1 FAIL 1).
 * - A user-write receipt comes from the facts read WITH their rows' DB-stamped `created_at` (`priorFactsWithTurn`) and
 *   counts only between the two Runs and for the pair's own two means; it only ever turns a neutral line into "You".
 * - Only a `partial` delta can carry such a move, so any other delta costs no read. A read that fails or outlasts
 *   `deadlineMs` names nothing (buddy r1: never strand the chip on a pending read).
 */
import { loadScenarioAnalysisFactsForRead } from '../build-turn-context.js';
import { frameRefitLinksForRunPair, userWrittenLinksForRunPair, withinBandLinkMovesForRunPair } from '../coaching/build-run-delta.js';
import type { WithinBandLinkMove } from '../coaching/run-input-changes.js';
import { isScenarioAnalysisReasoningAuthority } from '../context/reconcile-scenario-analysis-facts.js';

export const WITHIN_BAND_READ_DEADLINE_MS = 1500;

/**
 * What S7 reads from the pair's own persisted Run facts: the within-band moves (SD-1 interim, above) and the links of the
 * delta's `strength` rows the USER wrote between the two Runs (cut 6 truth floor: a band row says "You changed" only for
 * these; `userWrittenLinksForRunPair`). Read only when the delta is `partial` or carries a `strength` row.
 */
export interface RerunPairRead {
  readonly withinBand: WithinBandLinkMove[];
  readonly userWrittenLinks: ReadonlySet<string>;
  /** S5t-W: the links only a frame refit moved between the two Runs (`frameRefitLinksForRunPair`): never said, never counted. */
  readonly frameRefitLinks: ReadonlySet<string>;
}

const NOTHING: RerunPairRead = { withinBand: [], userWrittenLinks: new Set(), frameRefitLinks: new Set() };

export async function rerunPairReadForRunDelta(
  scenarioId: string,
  requestId: string,
  runDelta: unknown,
  deadlineMs: number = WITHIN_BAND_READ_DEADLINE_MS,
): Promise<RerunPairRead> {
  const d = runDelta !== null && typeof runDelta === 'object' ? runDelta as { input_coverage?: unknown; input_changes?: unknown } : undefined;
  const hasStrengthRow = Array.isArray(d?.input_changes) && d.input_changes.some((r) =>
    r !== null && typeof r === 'object' && (r as { entity_kind?: unknown }).entity_kind === 'link' && (r as { field?: unknown }).field === 'strength');
  if ((d?.input_coverage !== 'partial' && !hasStrengthRow) || deadlineMs <= 0) return NOTHING;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<RerunPairRead>((resolve) => { timer = setTimeout(() => resolve(NOTHING), deadlineMs); });
  const read = (async (): Promise<RerunPairRead> => {
    const { factSet, priorFactsWithTurn } = await loadScenarioAnalysisFactsForRead(scenarioId, requestId);
    if (!isScenarioAnalysisReasoningAuthority(factSet)) return NOTHING;
    const receipts = priorFactsWithTurn.map((f) => ({ fact: f.fact, created_at: f.fact_created_at }));
    return {
      withinBand: withinBandLinkMovesForRunPair(factSet.facts, runDelta, receipts),
      userWrittenLinks: new Set(userWrittenLinksForRunPair(factSet.facts, runDelta, receipts)),
      frameRefitLinks: new Set(frameRefitLinksForRunPair(factSet.facts, runDelta, receipts)),
    };
  })().catch((): RerunPairRead => NOTHING);
  try {
    return await Promise.race([read, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The within-band moves alone (the SD-1 interim read, kept for its callers and its loader test). */
export async function withinBandMovesForRunDelta(
  scenarioId: string,
  requestId: string,
  runDelta: unknown,
  deadlineMs: number = WITHIN_BAND_READ_DEADLINE_MS,
): Promise<WithinBandLinkMove[]> {
  const d = runDelta !== null && typeof runDelta === 'object' ? runDelta as { input_coverage?: unknown } : undefined;
  if (d?.input_coverage !== 'partial') return [];
  return (await rerunPairReadForRunDelta(scenarioId, requestId, runDelta, deadlineMs)).withinBand;
}
