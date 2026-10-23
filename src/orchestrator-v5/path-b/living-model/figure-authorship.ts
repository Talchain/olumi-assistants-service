import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';
import { figureAppearsIn } from '../../agent-lane/stated-by-user.js';

/** A necessary attribution check, not a semantic verifier: a quote with no such figure cannot be its source.
 * No values are inferred or changed. The native core still has to check the quantity, unit and meaning. */
export function quoteContainsFigure(quote: string | null | undefined, value: number, unit?: string | null): boolean {
  return figureAppearsIn(value, unit, quote);
}

type Aim = LivingModelT['aims'][number];
type CurrentAim = Pick<Aim, 'source' | 'target'> & { quote?: string | null };
/** The current figure's author, separate from the aim's words. Old saved forms keep their original fallback. */
export function currentAttribution(aim: CurrentAim): {
  source: LivingSourceT; quote: string | null; said_in?: 'chat' | null;
} {
  const t = aim.target;
  return t?.current_source != null ? { source: t.current_source, quote: t.current_quote ?? null,
    ...(t.said_in === 'chat' ? { said_in: 'chat' as const } : {}) } : { source: aim.source, quote: aim.quote ?? null };
}

export const currentIsStated = (aim: CurrentAim): boolean =>
  ['user', 'party'].includes(currentAttribution(aim).source);
