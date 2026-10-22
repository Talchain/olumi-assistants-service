/**
 * ⭐ CLASS 3 (thin-core plan, 20 Oct; DL 22 Oct): THE MAPPER'S VERDICT AS TOOL FEEDBACK, OPENAI-NATIVE. The schema lets the AI
 * write one meaning several ways and the mapper takes one; fixing each with a prompt line is whack-a-mole. When a draft or a
 * change would withhold the goal's chance through the AI's OWN encoding of an item on the goal's path (`mapped.rests_on`),
 * the tool says so once, with the typed reasons, and the agent restructures in the same SDK turn: one bounded retry
 * (`Restructure`, one per turn), structure only, never a new figure (the quote rule still labels any figure). A cause that only
 * the person's input can settle (a level, a range's law, a contradiction between figures) never triggers it: that stays the
 * existing ask.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import type { Mapped, Withheld } from '../living-model/mapper.js';

/** One offer per turn (`pathBTools` makes it per turn), shared by the draft and the change. */
export interface Restructure { offered: boolean }

/**
 * Causes the AI's own encoding can change without a figure: a condition's role, a link's sign, a figure's form, the item a
 * link acts on (served first drafts, 22 Oct: a condition declared a prerequisite withheld 4 of 8 chances).
 */
const ENCODING = new Set<Withheld['reason']>(['condition_not_in_slice', 'link_sign_unknown', 'exact_not_drawable', 'identity_other_cause']);

export interface GoalPathCause { readonly id: string; readonly reason: Withheld['reason']; readonly item: string }

export function goalPathEncodingCauses(model: LivingModelT, mapped: Mapped): GoalPathCause[] {
  const label = (id: string) => model.factors.find((f) => f.id === id)?.label ?? model.options.find((o) => o.id === id)?.label
    ?? model.aims.find((a) => a.id === id)?.text ?? model.risks.find((r) => r.id === id)?.label ?? id;
  return (mapped.rests_on ?? []).flatMap((w) => {
    if (!ENCODING.has(w.reason)) return [];
    if (w.id.startsWith('condition:')) return [{ id: w.id, reason: w.reason, item: w.id.slice('condition:'.length) }];
    const l = model.links.find((x) => x.id === w.id);
    return [{ id: w.id, reason: w.reason, item: l === undefined ? label(w.id) : `${label(l.from)} → ${label(l.to)}` }];
  });
}

const key = (c: { id: string; reason: string }) => `${c.id}\u0000${c.reason}`;
/** The causes `after` has that `before` did not: a change answers only for what it adds. */
export const addedCauses = (before: readonly GoalPathCause[], after: readonly GoalPathCause[]): GoalPathCause[] =>
  after.filter((c) => !new Set(before.map(key)).has(key(c)));

const CHECK = 'Check each against the person\'s own words. Where your encoding misstates what they said, correct its structure: a condition '
  + 'they stated as an assumption the result is worked out under, or as a doubt to raise, is not a prerequisite; a direction they gave is '
  + 'the link\'s sign; a figure they gave as approximate is not exact; a cause of a quantity made up of parts acts on the part it changes. '
  + 'Never add or change a figure.';

/** What the AI is told with a draft it can restructure once (words for the AI, never shown to the person). */
export const RESTRUCTURE_DRAFT = `Not saved yet. The goal's chance would be withheld by the items in goal_path, each with its reason. ${CHECK} `
  + 'Then call build_model_from_brief once more. If every item is right as it is, call it again with the same model and it is saved as it is.';

/** What the AI is told with a change it can restructure once. */
export const RESTRUCTURE_CHANGE = `No card yet. This change would withhold the goal's chance through the items in goal_path, each with its `
  + `reason. ${CHECK} Then call propose_change once more. If every item is right as it is, call it again with the same change and its card is made.`;
