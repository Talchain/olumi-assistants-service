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
  return owed;
}

/** Append owed disclosures to the Agent's own text, without rewriting it. */
export function withDisclosures(assistantText: string, owed: readonly string[]): string {
  if (owed.length === 0) return assistantText;
  const body = assistantText.trimEnd();
  return body.length === 0 ? owed.join('\n\n') : `${body}\n\n${owed.join('\n\n')}`;
}
