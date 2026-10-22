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
import type { LivingModelT } from '../../../schemas/living-model.js';
import type { Mapped, Withheld } from '../living-model/mapper.js';
import { stable } from '../living-model/diff.js';

/**
 * One offer per turn, shared by the draft and the change; the core route makes it per turn and `pathBTools` uses it.
 * ⭐ A REFUSAL CAN MAKE A TURN BETTER, NEVER WORSE (DL, #3672 fix-forward): the refused call is kept (`pending`) until a draft
 * or a card succeeds after it, and the turn's end runs a call still pending once more, with the offer used, exactly as base
 * would (`settle`, filled by `pathBTools`), so an agent that stops after the refusal still leaves its draft saved.
 */
export interface Restructure {
  offered: boolean;
  pending?: { readonly tool: 'build_model_from_brief'; readonly args: { brief: string; model: LivingModelT } }
    | { readonly tool: 'propose_change'; readonly args: { public_label: string; basis: string; model: LivingModelT; remove: string[] } };
  settle?: () => Promise<void>;
}

/**
 * The person's own content in a model: each item a person or a party gave, whole (its figures, quotes and settings), and every
 * view. A condition is keyed by its words and scope, its role left out: the one part the offer asks the AI to re-read.
 */
function personContent(m: LivingModelT): Map<string, string> {
  const out = new Map<string, string>();
  const theirs = (source: string) => source === 'user' || source === 'party';
  for (const kind of ['aims', 'options', 'factors', 'links', 'risks'] as const) {
    for (const item of m[kind]) if (theirs(item.source)) out.set(`${kind}:${item.id}`, stable(item));
  }
  for (const { role: _role, ...c } of m.conditions) {
    const scope = [...c.applies_to].sort();
    if (theirs(c.source)) out.set(`conditions:${stable([c.text, scope])}`, stable({ ...c, applies_to: scope }));
  }
  for (const v of m.views) out.set(`views:${stable([v.holder, v.position])}`, stable(v));
  return out;
}

/** What of the person's content in `refused` the retry left out or changed: the retry never loses it (DL, #3672 fix-forward). */
export function personContentLost(refused: LivingModelT, retry: LivingModelT): string[] {
  const kept = personContent(retry);
  return [...personContent(refused)].flatMap(([key, item]) => (kept.get(key) === item ? [] : [key]));
}

/** What the AI is told when its retry would have lost the person's content, so the refused call was used as it was. */
export const KEPT_AS_REFUSED = 'Your second call left out or changed items the person or a party gave (listed in lost), so your first '
  + 'call was used exactly as it was. Say so plainly if it matters to your reply.';

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
