import type { AnalysisStateV1, OlumiResponse, RunDelta, RunDeliveredRecord } from '@talchain/schemas/boundary';
import type { FreshnessDerivation } from '../orchestrator-v5/context/freshness.js';
import type { SelectedRunFigure } from './selected-run-figures.js';
import type { AnalysisReadyPayload } from '../orchestrator-v5/compose/analysis-ready-emit.js';

type ResultBlock = OlumiResponse['blocks'][number];
type RunHashes = Pick<FreshnessDerivation, 'graph_hash_at_run' | 'current_graph_hash'>;

/**
 * Producer projection for the selected saved Run. The graph route publishes
 * its identity and typed figures; the selected raw `result` stays internal
 * because `analysis_result` is the one existing public block carrier.
 *
 * `run_state` is the existing selector's verdict. Null means the read failed;
 * `{ kind: 'never_run' }` means a successful read found no Run. The two must
 * never collapse. The hashes are both from the selector's canonical analysis
 * projection, not the graph route's raw compare-and-set `graph_hash` or the
 * admission record's wider digest.
 */
export interface CurrentReadProjection {
  /** Current graph readiness beside the selected Run verdict, never a second top-level authority. */
  readonly analysis_ready?: AnalysisReadyPayload;
  readonly run_state: AnalysisStateV1['run_state'] | null;
  readonly computed_against_hash: string | null;
  readonly current_analysis_hash: string | null;
  /** The existing reader's current block, never an older Run's figures. */
  readonly result: ResultBlock | null;
  /** Measures attested by that same selected Run, never by a historical copy. */
  readonly figures: readonly SelectedRunFigure[];
  /**
   * SC-24: this selected Run's comparison with the Run before it — the turn's own producer (`buildRunDelta`). It
   * carries per-option shares, which are figures, so it rides HERE under the same currentness gate (CURRENT-READ-v1
   * row 1): only when the selected Run is `complete_current`. ABSENT = no delta for this Run — never "nothing changed".
   */
  readonly run_delta?: RunDelta;
  /** 0.79 (SD-1 Slice R): the selected Run's execution identity, under the same currentness gate as its figures. */
  readonly run_id?: string;
  /**
   * 0.79 (SD-1 Slice R; DL ruling #87, option A): what this selected Run's turn DELIVERED (its Phase 3 blocks and
   * `analysis_ready` options), from the Run's newest `run_delivery` fact, served VERBATIM only when the Run is
   * `complete_current`. Never re-worded and never re-composed: the read serves the stored record or nothing.
   * ABSENT = none recorded, or not served.
   */
  readonly delivered_record?: RunDeliveredRecord;
}

export type CurrentReadInput =
  | { readonly analysisState: null; readonly derivation?: null; readonly analysisResult?: null }
  | { readonly analysisState: AnalysisStateV1; readonly derivation: RunHashes; readonly analysisResult: ResultBlock | null;
      readonly analysisReady?: AnalysisReadyPayload;
      readonly figures?: readonly SelectedRunFigure[]; readonly runDelta?: RunDelta;
      readonly runId?: string; readonly deliveredRecord?: RunDeliveredRecord };

export function projectCurrentRead(input: CurrentReadInput): CurrentReadProjection {
  if (input.analysisState === null) {
    return { run_state: null, computed_against_hash: null, current_analysis_hash: null, result: null, figures: [] };
  }

  // ONE gate for everything this Run attests (its figures, its comparison, its identity, its delivered record).
  const current = input.analysisState.run_state.kind === 'complete_current' && input.analysisResult !== null;

  return {
    ...(input.analysisReady === undefined ? {} : { analysis_ready: input.analysisReady }),
    run_state: input.analysisState.run_state,
    computed_against_hash: input.derivation.graph_hash_at_run,
    current_analysis_hash: input.derivation.current_graph_hash,
    // A stale, absent or degraded read never gains a figure because a caller
    // accidentally handed this projection an old block. The selector owns the
    // state; this guard only enforces what its verdict permits to be shown.
    result: input.analysisState.run_state.kind === 'complete_current' ? input.analysisResult : null,
    figures: input.analysisState.run_state.kind === 'complete_current' && input.analysisResult !== null
      ? input.figures ?? [] : [],
    ...(current && input.runDelta !== undefined ? { run_delta: input.runDelta } : {}),
    ...(current && input.runId !== undefined ? { run_id: input.runId } : {}),
    ...(current && input.deliveredRecord !== undefined ? { delivered_record: input.deliveredRecord } : {}),
  };
}
