/** The selected Run's recorded option-participation verdict, never recomputed from a later graph. */
import { RunAnalysisResultSchema, type RunAnalysisResult } from '@talchain/schemas/orchestrator';
import { compareAnalysisRunFactIdentity } from '../../context/analysis-interpretation-identity.js';

export type StoredOptionParticipation = NonNullable<RunAnalysisResult['option_participation']>;

/** `[]` means recorded with no Olumi options; absence or an invalid record means unrecorded. */
export function readStoredOptionParticipation(raw: unknown): StoredOptionParticipation | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed = RunAnalysisResultSchema.shape.option_participation.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The selected fact itself proves why a provisional Olumi option removed leader permission.
 * A real failed/unchecked constraint retains its own cause; absence is never inferred as no limit. */
export function provisionalOptionLeaderClaimCause(result: unknown): boolean {
  const record = result !== null && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : null;
  const verdict = record?.constraint_verdict;
  const state = verdict !== null && typeof verdict === 'object'
    ? (verdict as { constraint_verdict_state?: unknown }).constraint_verdict_state : undefined;
  return (state === 'not_applicable' || state === 'evaluated_feasible')
    && readStoredOptionParticipation(record?.option_participation)?.some((p) => p.state === 'kept_olumi_provisional') === true;
}

/** A post-Run read may select a newer Run of the same graph. Carry only this executed Run's verdict. */
export function optionParticipationForExecutedRun(
  scenarioId: string,
  executedResult: unknown,
  executedState: unknown,
  read: { readonly analysis_result?: unknown; readonly analysis_state?: unknown; readonly option_participation?: unknown } | null,
): StoredOptionParticipation | undefined {
  if (read === null) return undefined;
  const rec = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const stateOf = (value: unknown) => rec(rec(value)?.run_state);
  if (stateOf(read.analysis_state)?.kind !== 'complete_current') return undefined;
  const identity = (result: unknown, state: unknown) => ({
    scenario_id: scenarioId,
    graph_hash_at_run: rec(result)?.computed_against_hash,
    computed_at: stateOf(state)?.computed_at,
  });
  if (compareAnalysisRunFactIdentity(identity(executedResult, executedState), identity(read.analysis_result, read.analysis_state)).status !== 'match') return undefined;
  return readStoredOptionParticipation(read.option_participation);
}
