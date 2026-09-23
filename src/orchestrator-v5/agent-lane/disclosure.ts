/**
 * Agent lane — Olumi discloses what it could not represent. Not the model.
 *
 * ⛔ WHY THIS IS NOT LEFT TO THE AGENT. When the user authorises "add this link",
 * the wire REQUIRES a magnitude (`structural_add_edge` takes
 * `magnitude: z.number().min(0).max(1)` and excludes `unknown` direction), so a
 * direction-only authorisation cannot be expressed and a placeholder strength is
 * written. The tool result says so — but a sentence in a tool result is a
 * suggestion to a language model, and the one guarantee we owe the user is that
 * they are TOLD when the model now holds a number they never gave.
 *
 * So the disclosure is appended deterministically by Olumi, from what actually
 * happened, after the Agent has written its reply. The Agent may also mention it;
 * this does not depend on whether it does.
 *
 * ⭐ It is appended ONLY when a placeholder was actually written. A disclosure
 * that appears on every turn is noise, and noise is how a real one gets missed.
 */

export interface DisclosableOutcome {
  /** A write happened. */
  readonly mutated: boolean;
  /** The written strength was a placeholder, not a stated one. */
  readonly placeholder_strength?: boolean;
  /** Links a build added to the goal on Olumi's own authority, with the direction assumed. */
  readonly assumed_goal_links?: readonly { readonly from_label: string; readonly to_label: string; readonly direction: 'positive' | 'negative' }[];
}

const GOAL_LINKS_SHOWN = 3;
/**
 * ⛔ AN ASSUMED DIRECTION CAN INVERT THE COMPARISON (Panel #1730 B2): "more churn
 * increases revenue" makes the option that raises churn read as better. So each link
 * is named with the direction assumed, and the user is told how to flip it.
 */
export function assumedGoalLinksDisclosure(links: NonNullable<DisclosableOutcome['assumed_goal_links']>): string {
  const lines = links.slice(0, GOAL_LINKS_SHOWN).map((l) =>
    `\u201c${l.from_label}\u201d \u2192 \u201c${l.to_label}\u201d: I assumed more of it ${l.direction === 'negative' ? 'lowers' : 'raises'} ${l.to_label}`);
  const more = links.length > GOAL_LINKS_SHOWN ? ` (and ${links.length - GOAL_LINKS_SHOWN} more)` : '';
  return `Note: nothing you said linked these to your goal, so I connected them as assumptions \u2014 the direction and the strength are mine, not yours: ${lines.join('; ')}${more}. If any of those runs the other way, tell me and I will flip it before you rely on the comparison.`;
}

export const PLACEHOLDER_STRENGTH_DISCLOSURE =
  'Note: you set the direction of that link, not its strength. The model needs a number to ' +
  'compute with, so it is holding a placeholder — that figure is not yours and should not be ' +
  'read as a measurement. Tell me how strong you think the effect is and I will replace it.';

/** The disclosures owed for this turn, in order. Empty when nothing is owed. */
export function disclosuresFor(outcomes: readonly DisclosableOutcome[]): readonly string[] {
  const owed: string[] = [];
  if (outcomes.some((o) => o.mutated && o.placeholder_strength === true)) {
    owed.push(PLACEHOLDER_STRENGTH_DISCLOSURE);
  }
  const assumed = outcomes.flatMap((o) => (o.mutated && Array.isArray(o.assumed_goal_links) ? o.assumed_goal_links : []));
  if (assumed.length > 0) owed.push(assumedGoalLinksDisclosure(assumed));
  return owed;
}

/** Append owed disclosures to the Agent's own text, without rewriting it. */
export function withDisclosures(assistantText: string, owed: readonly string[]): string {
  if (owed.length === 0) return assistantText;
  const body = assistantText.trimEnd();
  return body.length === 0 ? owed.join('\n\n') : `${body}\n\n${owed.join('\n\n')}`;
}
