/**
 * THIN CORE VIEW (20 Oct 2026): what the AI is given for a core scenario. The living model IS the meaning (sources,
 * quotes, views, history), so the AI reads it as saved, with what the engine graph withholds and why, never a meaning
 * re-derived from the graph. A present model that does not parse is reported as such, never replaced by the graph's.
 */
import { LivingModel } from '../../../schemas/living-model.js';
import { mapLivingModel, savedGoal, type Withheld } from './mapper.js';

export type LivingView =
  | { readonly living_model: unknown; readonly withheld: readonly Withheld[]; readonly assumed: readonly { readonly id: string; readonly text: string }[] }
  | { readonly living_model: unknown; readonly living_model_invalid: true };

/** The core view of a saved graph, or `undefined` when the scenario is not a core one (it has no living model). */
export function livingViewOf(graph: unknown): LivingView | undefined {
  if (graph === null || typeof graph !== 'object') return undefined;
  const living = (graph as Record<string, unknown>).living_model;
  if (living === undefined) return undefined;
  const parsed = LivingModel.safeParse(living);
  const mapped = parsed.success ? mapLivingModel(parsed.data, savedGoal(graph)) : undefined;
  return parsed.success && mapped !== undefined
    ? { living_model: parsed.data, withheld: mapped.withheld, assumed: mapped.assumed }
    : { living_model: living, living_model_invalid: true };
}
