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
 *   (iii) a factor no compared option acts on is therefore never ranked: nothing structural is left to rank;
 *   (iv)  LIMITS ARE NOT THE GOAL: every option row it keeps, in every carrier, has PLoT's limits-only joint
 *         `probability_of_joint_goal` renamed `all_limits_hold_probability` (with `limits_note`), and the brief's
 *         `goal_fit` is dropped;
 *   (v)   ABSENT STAYS ABSENT: when the run withheld its goal figures (#416's typed code), only the current carrier
 *         (`option_comparison`, top level or in `results`) is kept, with no P(goal) on any row; every downstream copy
 *         (`results[]`, `results.options` / `option_results`, `decision_brief.options`) is removed, exactly as
 *         `readOptionResultSources` refuses to read them (PR Review CR @ 0e1fd8c1).
 * The user-facing blocks are untouched; this is the Agent's view only.
 */
import { selectFactorEvppiPriority } from '../coaching/select-factor-evppi.js';
import { runWithheldGoalFigures } from '../../orchestrator/context/option-result-source.js';

export const NO_SINGLE_ASSUMPTION = 'No single assumption measurably changes which option leads.';

/**
 * WHOSE RANGE (AIQ ruling #72 5867782904, words ACK 5870069785; Core Stabilisation Plan §7). ISL echoes each
 * `factor_evppi` row's `spread_source`: `template` = Olumi's own assumed range, `user` = the user's. Read from the
 * SELECTED factor's own row only, and only once it is measured to change the leader (`resolved`). Anything else, or no
 * field, makes no claim.
 */
export type RangeSource = 'olumi_assumed' | 'yours';
const RANGE_OF: Readonly<Record<string, RangeSource>> = { template: 'olumi_assumed', user: 'yours' };
export const olumiAssumedRangeSay = (label: string): string =>
  `Within the range Olumi assumed for ${label}, ${label} could change which option leads. Do you know ${label} more precisely?`;

export type DecisionSensitivity =
  | {
    readonly status: 'measured';
    readonly most_sensitive: { readonly factor_id: string; readonly label: string; readonly range?: RangeSource };
    readonly say?: string;
  }
  | { readonly status: 'none_measurable'; readonly say: typeof NO_SINGLE_ASSUMPTION }
  | { readonly status: 'not_measured' };

const recordOf = (x: unknown): Record<string, unknown> | undefined =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;

/** "…'s lead because X is the strongest driver." → "…'s lead." (the clause is structural, `analysis-result-headline.ts`). */
export function withoutStrongestDriverClause(summary: string): string {
  // A label may carry a dot ("v2.0", "£49.00"), so the clause runs to the nearest " because ", not the nearest dot
  // (Canonical #2015 N1).
  return summary.replace(/ because (?:(?! because ).)*? is the strongest driver\./g, '.');
}

export function decisionSensitivityOf(enrichment: unknown): DecisionSensitivity {
  const d = selectFactorEvppiPriority(enrichment);
  if (d.outcome === 'selected') {
    const rows = recordOf(enrichment)?.factor_sensitivity;
    const labelled = Array.isArray(rows)
      ? (rows.map(recordOf).find((r) => r?.factor_id === d.factorId)?.factor_label)
      : undefined;
    const label = typeof labelled === 'string' && labelled !== '' ? labelled : d.factorId;
    const evppi = recordOf(enrichment)?.factor_evppi;
    const own = Array.isArray(evppi) ? evppi.map(recordOf).find((r) => r?.factor_id === d.factorId) : undefined;
    // Own keys only (DL nit on #2246): a plain-object lookup would hand back `constructor` / `toString` as a "range".
    const source = own?.spread_source;
    const range = typeof source === 'string' && Object.hasOwn(RANGE_OF, source) ? RANGE_OF[source] : undefined;
    if (range === undefined) return { status: 'measured', most_sensitive: { factor_id: d.factorId, label } };
    return {
      status: 'measured',
      most_sensitive: { factor_id: d.factorId, label, range },
      ...(range === 'olumi_assumed' ? { say: olumiAssumedRangeSay(label) } : {}),
    };
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
    const withheld = runWithheldGoalFigures(enrichment);
    const brief = recordOf(rest.decision_brief);
    let limitsRenamed = false;
    const rows = (value: unknown): unknown => {
      const projected = optionRowsForAgent(value, withheld);
      if (projected.renamed) limitsRenamed = true;
      return projected.rows;
    };
    if (brief !== undefined) {
      const { top_drivers: _drivers, ...briefRest } = brief;
      // ⛔ LIMITS ARE NOT THE GOAL (AIQ 5887531086; DL 5887546998): the brief's `goal_fit` is the LEADER's limits-only joint
      // (PLoT `decision-brief.ts`), so the Agent never sees it under that name.
      const summary = recordOf(briefRest.analysis_summary);
      if (summary !== undefined && 'goal_fit' in summary) {
        const { goal_fit: _jointOfLeader, ...summaryRest } = summary;
        briefRest.analysis_summary = summaryRest;
        limitsRenamed = true;
      }
      if ('options' in briefRest) {
        if (withheld) delete briefRest.options;
        else briefRest.options = rows(briefRest.options);
      }
      rest.decision_brief = briefRest;
    }
    if ('option_comparison' in rest) rest.option_comparison = rows(rest.option_comparison);
    const nested = recordOf(rest.results);
    if (Array.isArray(rest.results)) {
      if (withheld) delete rest.results;
      else rest.results = rows(rest.results);
    } else if (nested !== undefined) {
      const results: Record<string, unknown> = { ...nested };
      if ('option_comparison' in results) results.option_comparison = rows(results.option_comparison);
      for (const copy of ['options', 'option_results'] as const) {
        if (!(copy in results)) continue;
        if (withheld) delete results[copy];
        else results[copy] = rows(results[copy]);
      }
      rest.results = results;
    }
    out.enrichment = rest;
    if (limitsRenamed) out.limits_note = ALL_LIMITS_HOLD_NOTE;
  }
  out.decision_sensitivity = decisionSensitivityOf(enrichment);
  return out;
}

/**
 * One carrier's option rows for the Agent: each row's `probability_of_joint_goal` (how often ALL the user's limits hold
 * together — never the goal's target) becomes `all_limits_hold_probability`; under #416's withhold no row keeps a
 * `probability_of_goal`. Not an array → unchanged.
 */
function optionRowsForAgent(value: unknown, withheld: boolean): { rows: unknown; renamed: boolean } {
  if (!Array.isArray(value)) return { rows: value, renamed: false };
  let renamed = false;
  const rows = value.map((row) => {
    const r = recordOf(row);
    if (r === undefined) return row;
    let next: Record<string, unknown> = r;
    if ('probability_of_joint_goal' in next) {
      const { probability_of_joint_goal: joint, ...others } = next;
      next = { ...others, all_limits_hold_probability: joint };
      renamed = true;
    }
    if (withheld && 'probability_of_goal' in next) {
      const { probability_of_goal: _withheld, ...others } = next;
      next = others;
    }
    return next;
  });
  return { rows, renamed };
}

/** What the Agent is told about the limits-only figure (AIQ 5887531086: its own fact, in the UI's register). */
export const ALL_LIMITS_HOLD_NOTE =
  '`all_limits_hold_probability` is how often ALL the user\u2019s limits hold together in the model runs. It does NOT include '
  + 'the goal\u2019s target: never call it a chance of reaching the goal, a goal fit or a target fit, and never combine it with '
  + 'the goal. Say it, if at all, as "all your limits hold in N% of model runs (this does not include the goal\u2019s target)".';
