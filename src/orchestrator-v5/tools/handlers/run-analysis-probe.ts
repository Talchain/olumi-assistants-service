/**
 * SCIENCE ROBUSTNESS (EXPERIMENT; SCIENCE/DSK, programme-docs #85 lease 5950283606): the seam through which the
 * on-demand "What would change this?" path receives the EXACT /v2/run payload a Run would send, built by the ONE Run
 * payload builder (`run-analysis.ts`), without a Run happening.
 *
 * When `RunAnalysisHandlerDeps.probe` is set, the handler hands the probe the final payload (after the seed decision,
 * i.e. exactly what `plotClient.run` would receive) and returns before PLoT with no facts — so nothing reaches a
 * caller to persist. Only the on-demand probes set it (via `RegistryOverrides.runAnalysisProbe`):
 * `handlers/decision-flip-dispatch.ts`, and `handlers/structural-challenge-dispatch.ts` (SCI-DEEP: proves the Run's request
 * still rebuilds exactly before the one-link alternative is run). The production registry never does, so a Run is
 * byte-identical.
 *
 * Kept in its own module because `run-analysis(.js)` may be imported only by `registry.ts`
 * (scripts/validate-handler-ownership.sh).
 */

import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';

export interface RunAnalysisProbeInput {
  /** The final /v2/run payload, `seed` included when one was decided. Owned by the probe: a copy. */
  readonly plotPayload: Record<string, unknown>;
  /** What a Run would record as SENT (its `sent_digest` is over `plotPayload` minus `request_id`). */
  readonly runInputSnapshot: RunInputSnapshot | null;
  readonly graphHashAtRun: string | null;
  readonly requestId: string;
}

export type RunAnalysisProbe = (sent: RunAnalysisProbeInput) => Promise<void>;
