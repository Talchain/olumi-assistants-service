import { readStoredGoalCertainty } from '../tools/handlers/run-goal-certainty.js';
import { GOAL_CHANCE_COMPANION_KEYS, unsupportedIntervalOptionIds } from '../../orchestrator/context/option-result-source.js';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;

/**
 * Every option-result row a public block carries, projected by `projectRow` (which returns the row itself when it keeps it).
 * Match the carriers read by readOptionResultSources, including UI-normalised aliases. Project every present copy, rather
 * than only the preferred array, so a consumer fallback cannot revive a figure the projection withholds.
 */
function mapOptionRows(enrichment: RecordValue, projectRow: (row: RecordValue) => RecordValue): RecordValue {
  const projectRows = (value: unknown): unknown => !Array.isArray(value) ? value
    : value.map((raw) => { const row = record(raw); return row === null ? raw : projectRow(row); });
  const projectNestedRows = (value: unknown, keys: readonly string[]): unknown => {
    const nested = record(value);
    if (nested === null) return value;
    const projected = { ...nested };
    for (const key of keys) {
      if (nested[key] !== undefined) projected[key] = projectRows(nested[key]);
    }
    return projected;
  };
  return {
    ...enrichment,
    ...(enrichment.option_comparison === undefined ? {} : { option_comparison: projectRows(enrichment.option_comparison) }),
    ...(enrichment.results === undefined ? {} : {
      results: Array.isArray(enrichment.results)
        ? projectRows(enrichment.results)
        : projectNestedRows(enrichment.results, ['option_comparison', 'options', 'option_results']),
    }),
    ...(enrichment.decision_brief === undefined ? {} : {
      decision_brief: projectNestedRows(enrichment.decision_brief, ['options']),
    }),
  };
}

/**
 * The stored Run retains its exact P(goal). The public result block may carry an
 * exact 0 or 1 only when that Run's own certainty decision earned it. This is a
 * transport projection, shared by the turn and cold graph-read block builder.
 */
export function projectGoalProbabilitiesForTransport(
  enrichment: RecordValue | undefined,
  storedGoalCertainty: unknown,
): RecordValue | undefined {
  if (enrichment === undefined) return undefined;
  const decisions = readStoredGoalCertainty(storedGoalCertainty) ?? [];
  const earned = new Map<string, 0 | 1>();
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (seen.has(decision.option_id)) {
      earned.delete(decision.option_id);
      continue;
    }
    seen.add(decision.option_id);
    if (decision.earned) {
      earned.set(decision.option_id, decision.probability_of_goal);
    }
  }
  return mapOptionRows(enrichment, (row) => {
    let projected: RecordValue | null = null;
    for (const key of ['probability_of_goal', 'goal_probability', 'goalProbability']) {
      const probability = row[key];
      if ((probability !== 0 && probability !== 1)
        || (typeof row.option_id === 'string' && earned.get(row.option_id) === probability)) continue;
      projected ??= { ...row };
      delete projected[key];
      // An unearned exact figure's precision (`n_met` = 0 or n) and drivers reveal it: they go with it (design-g4g6 Q3).
      for (const k of GOAL_CHANCE_COMPANION_KEYS) delete projected[k];
    }
    return projected ?? row;
  });
}

/** The simulated range of an outcome (never its centre, `mean` / `p50`), in both row shapes. */
const OUTCOME_RANGE_KEYS = ['std', 'p10', 'p90'] as const;
const FLAT_OUTCOME_RANGE_KEYS = ['outcome_std', 'outcome_p10', 'outcome_p90'] as const;

/**
 * ⭐ STEP 8 (AIE 764e9c72): the stored Run keeps each option's whole outcome, but a public block carries no simulated range
 * for an option whose range rests on an unsupported spread (`unsupportedIntervalOptionIds`, the Run's own record). The centre
 * stays: it is the model's arithmetic. The same transport projection as above, on the same carriers.
 */
export function projectUnsupportedIntervalsForTransport(
  transport: RecordValue | undefined,
  /** The stored Run's enrichment, which carries its own record (the transport copy may not). */
  recordedOn: unknown = transport,
): RecordValue | undefined {
  if (transport === undefined) return undefined;
  const ids = unsupportedIntervalOptionIds(recordedOn);
  if (ids.size === 0) return transport;
  return mapOptionRows(transport, (row) => withoutUnsupportedInterval(row, ids));
}

/** One option row without its simulated outcome range when `ids` names it. */
function withoutUnsupportedInterval(row: RecordValue, ids: ReadonlySet<string>): RecordValue {
  const id = typeof row.option_id === 'string' ? row.option_id : typeof row.id === 'string' ? row.id : undefined;
  if (id === undefined || !ids.has(id)) return row;
  const projected: RecordValue = { ...row };
  for (const k of FLAT_OUTCOME_RANGE_KEYS) delete projected[k];
  const outcome = record(row.outcome);
  if (outcome !== null) {
    const kept = { ...outcome };
    for (const k of OUTCOME_RANGE_KEYS) delete kept[k];
    projected.outcome = kept;
  }
  return projected;
}
