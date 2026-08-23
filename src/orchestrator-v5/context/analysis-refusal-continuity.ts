/**
 * Durable, non-result evidence that a run_analysis attempt was refused.
 *
 * A refusal is neither a successful analysis nor an absent event. Persisting
 * it as a non-success run_analysis fact lets the existing freshness/canonical
 * selectors carry the attempt across turns without changing structural
 * readiness or fabricating result fields.
 */
import {
  RunAnalysisHandlerFactSchema,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

export const ANALYSIS_REFUSAL_STATUS = 'refused' as const;

const CONTINUITY_REFUSAL_CAUSES: ReadonlySet<string> = new Set([
  'analysis_not_ready',
  'analysis_blocked',
]);

/**
 * Scope the durable marker to science/readiness refusals. A transient engine
 * busy recovery or a non-analysis execution error is not evidence that the
 * model itself was refused, and must not acquire refusal continuity.
 */
export function isAnalysisRefusalContinuityCause(cause: string): boolean {
  return CONTINUITY_REFUSAL_CAUSES.has(cause);
}

export interface BuildAnalysisRefusalFactInput {
  readonly scenarioId: string;
  readonly reasonCode: string;
  readonly graphHash?: string | null;
  readonly computedAt?: string;
}

function safeReasonCode(raw: string): string {
  const normalised = raw.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalised)
    ? normalised
    : 'analysis_attempt_refused';
}

/** Build and strict-validate the only persisted refusal-fact shape. */
export function buildAnalysisRefusalFact(
  input: BuildAnalysisRefusalFactInput,
): RunAnalysisHandlerFact {
  const computedAt =
    input.computedAt !== undefined && Number.isFinite(Date.parse(input.computedAt))
      ? input.computedAt
      : new Date().toISOString();
  const candidate = {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: input.scenarioId,
      leading_option_id: null,
      summary: 'Analysis attempt was refused before computation.',
      enrichment: {
        analysis_status: ANALYSIS_REFUSAL_STATUS,
        refusal_reason_code: safeReasonCode(input.reasonCode),
      },
      ...(typeof input.graphHash === 'string' && input.graphHash.length > 0
        ? { graph_hash_at_run: input.graphHash }
        : {}),
      computed_at: computedAt,
    },
  };
  return RunAnalysisHandlerFactSchema.parse(candidate);
}

/** True only for the refusal marker above; partial/degraded results stay apart. */
export function isAnalysisRefusalFact(
  fact: HandlerFact,
): fact is RunAnalysisHandlerFact {
  return (
    fact.fact_type === 'run_analysis' &&
    fact.noop === false &&
    fact.result.enrichment?.analysis_status === ANALYSIS_REFUSAL_STATUS
  );
}
