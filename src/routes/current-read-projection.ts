import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import type { FreshnessDerivation } from '../orchestrator-v5/context/freshness.js';

type ResultBlock = OlumiResponse['blocks'][number];
type RunHashes = Pick<FreshnessDerivation, 'graph_hash_at_run' | 'current_graph_hash'>;

/**
 * Internal producer projection for the selected saved Run. The graph route does
 * not publish this shape yet; its consumer contract is being reconciled.
 *
 * `run_state` is the existing selector's verdict. Null means the read failed;
 * `{ kind: 'never_run' }` means a successful read found no Run. The two must
 * never collapse. The hashes are both from the selector's canonical analysis
 * projection, not the graph route's raw compare-and-set `graph_hash` or the
 * admission record's wider digest.
 */
export interface CurrentReadProjection {
  readonly run_state: AnalysisStateV1['run_state'] | null;
  readonly computed_against_hash: string | null;
  readonly current_analysis_hash: string | null;
  /** The existing reader's current block, never an older Run's figures. */
  readonly result: ResultBlock | null;
}

export type CurrentReadInput =
  | { readonly analysisState: null; readonly derivation?: null; readonly analysisResult?: null }
  | { readonly analysisState: AnalysisStateV1; readonly derivation: RunHashes; readonly analysisResult: ResultBlock | null };

export function projectCurrentRead(input: CurrentReadInput): CurrentReadProjection {
  if (input.analysisState === null) {
    return { run_state: null, computed_against_hash: null, current_analysis_hash: null, result: null };
  }

  return {
    run_state: input.analysisState.run_state,
    computed_against_hash: input.derivation.graph_hash_at_run,
    current_analysis_hash: input.derivation.current_graph_hash,
    // A stale, absent or degraded read never gains a figure because a caller
    // accidentally handed this projection an old block. The selector owns the
    // state; this guard only enforces what its verdict permits to be shown.
    result: input.analysisState.run_state.kind === 'complete_current' ? input.analysisResult : null,
  };
}
