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
      for (const key of ['probability_of_goal', 'goal_probability']) {
        const probability = row[key];
        if ((probability !== 0 && probability !== 1)
          || (typeof row.option_id === 'string' && earned.get(row.option_id) === probability)) continue;
        projected ??= { ...row };
        delete projected[key];
      }
      return projected ?? raw;
    });
  };

  // Both are public per-option carriers. A Run with `results` as well as
  // `option_comparison` must not leak the withheld value through the alias.
  return {
    ...enrichment,
    ...(enrichment.option_comparison === undefined ? {} : { option_comparison: projectRows(enrichment.option_comparison) }),
    ...(enrichment.results === undefined ? {} : { results: projectRows(enrichment.results) }),
  };
}
