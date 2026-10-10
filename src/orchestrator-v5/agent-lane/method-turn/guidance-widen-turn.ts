import type { GuidanceState } from '../guidance/types.js';
import { isGuidanceVariant } from '../turn-context/guidance-history.js';
import type { MethodReadback } from './method-turn.js';
import { widenTurnForReadback as currentWidenTurnForReadback, type WidenTurn } from './widen-turn.js';

/** A press keeps its offered identity; the model, Run, gates and words come from the current readback. */
export function widenTurnForReadback(chipId: unknown, rb: MethodReadback, guidance?: GuidanceState | null): WidenTurn | null {
  const turn = currentWidenTurnForReadback(chipId, rb);
  if (turn?.kind !== 'run' || turn.question !== undefined) return turn;
  const offered = guidance?.['RC-WIDEN'];
  const variant = offered?.status === 'offered' && isGuidanceVariant('RC-WIDEN', offered.variant_id)
    && offered.variant_id !== 'W6' && offered.variant_id !== 'W7' ? offered.variant_id : undefined;
  // Every legacy entry takes the unchanged staging path, without feeding history into its signals.
  if (variant === undefined) return turn;
  return { ...turn, variant };
}
