import { effectsTimingOf, type EffectsTiming } from './period-end-assumption.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';

import { SavedEffectsTimingSchema, type SavedEffectsTiming } from '../../schemas/assist.js';
export { SavedEffectsTimingSchema, type SavedEffectsTiming } from '../../schemas/assist.js';

/** T1 direct Run reader: unknown/incomplete source is NOT complete-source absence. */
export function currentSavedEffectsTiming(graph: Record<string, unknown>, revision: string, goalId: string): SavedEffectsTiming | null {
  const parsed = SavedEffectsTimingSchema.safeParse(graph.effects_timing_record);
  if (!parsed.success) return null;
  const r = parsed.data;
  const options = Array.isArray(graph.nodes) ? graph.nodes.filter((n: any) => n?.kind === 'option').map((n: any) => n.id).sort() : [];
  if (r.graph_revision !== revision || r.goal_id !== goalId || r.source_status !== 'complete'
    || stableStringify([...r.option_ids].sort()) !== stableStringify(options)) return null;
  return r;
}
export function currentEffectsTimingOf(graph: Record<string, unknown>, revision: string, goalId: string): EffectsTiming | null {
  return effectsTimingOf(currentSavedEffectsTiming(graph, revision, goalId)?.interpretation) ?? null;
}
