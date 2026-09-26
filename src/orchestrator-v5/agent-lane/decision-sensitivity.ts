/**
 * ⛔ DECISION SENSITIVITY COMES FROM EVPPI ALONE (Canonical #70 5847574837; finish line: truthful explanation).
 *
 * MEASURED on served `levelless-reason-PIN2` turn 3: `factor_sensitivity[0]` = `decision_brief.top_drivers[0]` =
 * "Paid AI add-on revenue" (labelled "biggest", `importance_basis: graph_structural`) — a factor only the EXCLUDED
 * option acts on — while `factor_evppi` was `below_resolution` for EVERY factor and `decision_evpi` ≈ 0.00025. The
 * Agent then named a "most decision-sensitive assumption" the run does not support.
 *
 * So the run result the Agent reads is projected here:
 *   (i)   `factor_sensitivity` and `decision_brief.top_drivers` are PLoT's structural goal-sensitivity, NOT decision
 *         sensitivity — they are removed from what the Agent reads, and so is the summary's "…is the strongest
 *         driver" clause built from them;
 *   (ii)  `decision_sensitivity` is added, read ONLY from `factor_evppi` by CEE's own reader
 *         (`selectFactorEvppiPriority`): a factor above resolution → `measured`; every row below resolution →
 *         `none_measurable` with the one true sentence; anything else → `not_measured` (no claim);
 *   (iii) a factor no compared option acts on is therefore never ranked: nothing structural is left to rank.
 * The user-facing blocks are untouched; this is the Agent's view only.
 */
import { selectFactorEvppiPriority } from '../coaching/select-factor-evppi.js';

export const NO_SINGLE_ASSUMPTION = 'No single assumption measurably changes which option leads.';

export type DecisionSensitivity =
  | { readonly status: 'measured'; readonly most_sensitive: { readonly factor_id: string; readonly label: string } }
  | { readonly status: 'none_measurable'; readonly say: typeof NO_SINGLE_ASSUMPTION }
  | { readonly status: 'not_measured' };

const recordOf = (x: unknown): Record<string, unknown> | undefined =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;

/** "…'s lead because X is the strongest driver." → "…'s lead." (the clause is structural, `analysis-result-headline.ts`). */
export function withoutStrongestDriverClause(summary: string): string {
  return summary.replace(/ because [^.]*? is the strongest driver\./g, '.');
}

export function decisionSensitivityOf(enrichment: unknown): DecisionSensitivity {
  const d = selectFactorEvppiPriority(enrichment);
  if (d.outcome === 'selected') {
    const rows = recordOf(enrichment)?.factor_sensitivity;
    const labelled = Array.isArray(rows)
      ? (rows.map(recordOf).find((r) => r?.factor_id === d.factorId)?.factor_label)
      : undefined;
    return { status: 'measured', most_sensitive: { factor_id: d.factorId, label: typeof labelled === 'string' && labelled !== '' ? labelled : d.factorId } };
  }
  if (d.reason === 'all_below_resolution') return { status: 'none_measurable', say: NO_SINGLE_ASSUMPTION };
  return { status: 'not_measured' };
}

/** The run's `analysis_result` block as the Agent reads it: (i)–(iii) above. Never mutates its input. */
export function analysisResultForAgent(result: unknown): unknown {
  const block = recordOf(result);
  if (block === undefined) return result;
  const enrichment = recordOf(block.enrichment);
  const out: Record<string, unknown> = { ...block };
  if (typeof block.summary === 'string') out.summary = withoutStrongestDriverClause(block.summary);
  if (enrichment !== undefined) {
    const { factor_sensitivity: _structural, ...rest } = enrichment;
    const brief = recordOf(rest.decision_brief);
    if (brief !== undefined) {
      const { top_drivers: _drivers, ...briefRest } = brief;
      rest.decision_brief = briefRest;
    }
    out.enrichment = rest;
  }
  out.decision_sensitivity = decisionSensitivityOf(enrichment);
  return out;
}
