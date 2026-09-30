import { readStoredGoalCertainty } from '../tools/handlers/run-goal-certainty.js';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;

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

  const projectRows = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map((raw) => {
      const row = record(raw);
      if (row === null) return raw;
      let projected: RecordValue | null = null;
      for (const key of ['probability_of_goal', 'goal_probability', 'goalProbability']) {
        const probability = row[key];
        if ((probability !== 0 && probability !== 1)
          || (typeof row.option_id === 'string' && earned.get(row.option_id) === probability)) continue;
        projected ??= { ...row };
        delete projected[key];
      }
      return projected ?? raw;
    });
  };

  const projectNestedRows = (value: unknown, keys: readonly string[]): unknown => {
    const nested = record(value);
    if (nested === null) return value;
    const projected = { ...nested };
    for (const key of keys) {
      if (nested[key] !== undefined) projected[key] = projectRows(nested[key]);
    }
    return projected;
  };

  // Match the carriers read by readOptionResultSources, including UI-normalised
  // aliases. Project every present copy, rather than only the preferred array,
  // so a consumer fallback cannot revive an unearned exact goal probability.
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
