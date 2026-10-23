import type { LivingModelT } from '../../../schemas/living-model.js';

/** One shared interpretation for the compiler and its structural reviewer.
 * Explicit priority is model content and changes through the existing approval diff.
 * Legacy models keep their selected goal and previous fallback; no text heuristics.
 */
export function selectCurrentAim(model: LivingModelT, savedGoal?: string): {
  aim: LivingModelT['aims'][number] | undefined; ambiguous: boolean;
} {
  const current = model.aims.filter(a => a.status === 'current');
  const primary = current.filter(a => a.priority === 'primary');
  if (primary.length > 1) return { aim: undefined, ambiguous: true };
  return { aim: primary[0] ?? current.find(a => a.id === savedGoal)
    ?? current.find(a => a.target !== null) ?? current[0], ambiguous: false };
}
