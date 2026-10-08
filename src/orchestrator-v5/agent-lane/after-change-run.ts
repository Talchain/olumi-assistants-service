import type { HandlerFact } from '@talchain/schemas/orchestrator';

export const AFTER_CHANGE_RUN_CHIP_ID = 'agent-run-after-change';

export type AfterChangeRunDecision =
  | { readonly kind: 'run' }
  | {
    readonly kind: 'skip';
    readonly reason: 'already_current' | 'no_prior_run' | 'freshness_unknown' | 'stale_view' | 'no_graph';
  };

export function isAfterChangeRunChip(_body: unknown): boolean {
  throw new Error('CT-2 not implemented');
}

export function afterChangeRunDecision(_input: {
  readonly currentGraphHash: string | null;
  readonly priorFacts: readonly HandlerFact[];
  readonly priorFactsReadOk: boolean;
  readonly baseGraphHash?: string;
}): AfterChangeRunDecision {
  throw new Error('CT-2 not implemented');
}
