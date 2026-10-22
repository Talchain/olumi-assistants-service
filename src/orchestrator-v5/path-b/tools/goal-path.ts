/**
 * ⭐ CLASS 3 (thin-core plan, 20 Oct; DL 22 Oct): THE MAPPER'S VERDICT AS TOOL FEEDBACK, OPENAI-NATIVE. The schema lets the AI
 * write one meaning several ways and the mapper takes one; fixing each with a prompt line is whack-a-mole. When a draft or a
 * change would withhold the goal's chance through the AI's OWN encoding of an item on the goal's path (`mapped.rests_on`),
 * the tool says so once, with the typed reasons, and the agent restructures in the same SDK turn: one bounded retry
 * (`Restructure`, one per turn), structure only, never a new figure (the quote rule still labels any figure).
 * ONLY THE MEASURED CLASS (Codex r1 on #3672): a condition declared a prerequisite (served first drafts, 22 Oct: 4 of 8 chances
 * withheld). Its role is the AI's declaration, so re-reading it against the person's words changes no figure. An unsigned link
 * may be the person's own uncertainty, and moving a cause onto a part can change what its figure measures: neither is offered.
 */
import type { Mapped, Withheld } from '../living-model/mapper.js';

/** One offer per turn (`pathBTools` makes it per turn), shared by the draft and the change. */
export interface Restructure { offered: boolean }

export interface GoalPathCause {
  readonly id: string;
  readonly reason: Withheld['reason'];
  /** The condition's words, as the AI wrote them. */
  readonly item: string;
  /** The items it qualifies: part of its identity, since two conditions can share their words (Codex r1 on #3672). */
  readonly applies_to: readonly string[];
}

export function goalPathEncodingCauses(mapped: Mapped): GoalPathCause[] {
  return (mapped.rests_on ?? []).flatMap((w) => (w.reason === 'condition_not_in_slice' && w.id.startsWith('condition:')
    ? [{ id: w.id, reason: w.reason, item: w.id.slice('condition:'.length), applies_to: [...(w.applies_to ?? [])].sort() }] : []));
}

const key = (c: GoalPathCause) => JSON.stringify([c.id, c.reason, c.applies_to]);
/** The causes `after` has that `before` did not: a change answers only for what it adds. */
export const addedCauses = (before: readonly GoalPathCause[], after: readonly GoalPathCause[]): GoalPathCause[] =>
  after.filter((c) => !new Set(before.map(key)).has(key(c)));

const CHECK = 'Check each against the person\'s own words. A condition they stated as an assumption the result is worked out under is an '
  + 'assumption, and a doubt to raise is a challenge; only a requirement that must actually be met first stays a prerequisite. Never add '
  + 'or change a figure.';

/** What the AI is told with a draft it can restructure once (words for the AI, never shown to the person). */
export const RESTRUCTURE_DRAFT = `Not saved yet. The goal's chance would be withheld by the prerequisites in goal_path. ${CHECK} `
  + 'Then call build_model_from_brief once more. If every item is right as it is, call it again with the same model and it is saved as it is.';

/** What the AI is told with a change it can restructure once. */
export const RESTRUCTURE_CHANGE = `No card yet. This change would withhold the goal's chance through the prerequisites in goal_path. ${CHECK} `
  + 'Then call propose_change once more. If every item is right as it is, call it again with the same change and its card is made.';
