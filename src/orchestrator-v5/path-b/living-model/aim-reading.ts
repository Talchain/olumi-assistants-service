/**
 * How the core reads a goal aim's target (moved verbatim from `mapper.ts`, DL 23 Oct held-reason ruling): the level it asks
 * for, or the reason it cannot be read yet. ONE decision, used by the mapper (which holds the aim with this reason) and by the
 * ONE "no target" gap (`goal-target-gap.ts`), which says that reason's own words. A leaf: types only, no runtime imports.
 */
import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';
import { currentIsStated } from './figure-authorship.js';

export const stated = (s: LivingSourceT): boolean => s === 'user' || s === 'party';

export type Target = NonNullable<LivingModelT['aims'][number]['target']>;
export interface LevelTarget { readonly comparator: '>=' | '<=' | '>' | '<'; readonly value: number; readonly unit: string | null }
export type AimTargetHeld =
  | 'no_level_target' | 'target_not_theirs' | 'change_base_not_theirs' | 'exact_target_not_in_slice' | 'target_range_not_in_slice'
  | 'current_unit_mismatch' | 'goal_level_unknown' | 'change_kind_unknown' | 'change_base_invalid';

/**
 * The level a target asks for. A change from today ("raise it by 10%") is read on today's level, in that level's own unit
 * (Batch 0 rulings 19 and 21; amendment 1: carrying on as now leaves the quantity unchanged, so the status quo is today):
 * absolute B ± C, relative B × (1 ± r/100), points B ± C on a quantity that is itself a percentage. What a percentage change
 * means on a percentage is never picked (amendment 3): it needs the AI's declared `change_kind`.
 */
export function levelTargetOf(t: Target): LevelTarget | AimTargetHeld {
  if (t.comparator === '=') return 'exact_target_not_in_slice';
  if (t.value === null) return t.low !== null || t.high !== null ? 'target_range_not_in_slice' : 'no_level_target';
  // A declared unit is model content, never relabelled by another field (buddy R1 on #3525): today's level in another unit
  // than a level target has no supported conversion here, so the dependent calculation is withheld.
  if (t.comparator === '>=' || t.comparator === '<=' || t.comparator === '>' || t.comparator === '<') {
    if (t.current !== null && t.current_unit !== null && t.current_unit !== t.unit) return 'current_unit_mismatch';
    return { comparator: t.comparator, value: t.value, unit: t.unit };
  }
  if (t.current === null) return 'goal_level_unknown';
  const levelUnit = t.current_unit ?? t.unit;
  const kind = t.change_kind ?? (levelUnit === '%' ? null : t.unit === levelUnit ? 'absolute' : t.unit === '%' ? 'relative' : null);
  // Points are percentage points of a percentage quantity: both units are '%', or nothing is dropped silently.
  const fits = kind === 'absolute' ? t.unit === levelUnit : kind === 'relative' ? t.unit === '%'
    : kind === 'points' ? levelUnit === '%' && t.unit === '%' : false;
  if (kind === null || !fits) return 'change_kind_unknown';
  if (kind === 'relative' && !(t.current > 0)) return 'change_base_invalid';
  const sign = t.comparator === 'increase' ? 1 : -1;
  const by = Math.abs(t.value);
  return { comparator: sign > 0 ? '>=' : '<=', value: kind === 'relative' ? t.current * (1 + (sign * by) / 100) : t.current + sign * by, unit: levelUnit };
}

/**
 * The aim's target as the core reads it. "Exactly N" is never read as "at least N"; a change is read on today's level
 * (`levelTargetOf`), and only on the person's own: a change on Olumi's estimated base would need the provisional
 * estimate_only treatment (rulings 9/10), which this slice does not carry, so it is withheld and Olumi asks for today's level.
 * Olumi's suggested measure (`target.source`) carries no figure of its own: one there is never read as the person's target.
 */
export function aimTargetReading(aim: { readonly source: LivingSourceT; readonly target: Target | null }): LevelTarget | AimTargetHeld {
  const t = aim.target;
  const isChange = t !== null && (t.comparator === 'increase' || t.comparator === 'decrease');
  return t === null ? 'no_level_target'
    : t.source === 'olumi' && [t.value, t.low, t.high, t.current].some((v) => v !== null) ? 'target_not_theirs'
    : isChange && t.current !== null && !currentIsStated(aim) ? 'change_base_not_theirs' : levelTargetOf(t);
}
