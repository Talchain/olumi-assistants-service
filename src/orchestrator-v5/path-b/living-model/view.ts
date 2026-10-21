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

/** A scenario saved before the core lane: a saved graph with no living model (the flip's named bridge, `laneModeFor`). */
export function isLegacyGraph(graph: unknown): boolean {
  return graph !== null && typeof graph === 'object' && (graph as Record<string, unknown>).living_model === undefined;
}

/**
 * The bridge's reading of one graph read. Only a read that SHOWS the scenario (200) or proves it absent (404) can select core;
 * any other answer keeps the full legacy lane, whose tools cover every scenario (Codex #3522 r4: a failed read never narrows them).
 */
export function legacyFromRead(read: { readonly status: number; readonly json?: unknown } | undefined): boolean {
  if (read === undefined) return true;
  if (read.status === 404) return false;
  return read.status === 200 ? isLegacyGraph((read.json as Record<string, unknown> | undefined)?.['graph']) : true;
}

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
