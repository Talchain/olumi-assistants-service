/**
 * ⭐ A SECTION LABEL THE PANEL CAN RENDER — marked at the SOURCE, because the
 * renderer deliberately does not guess.
 *
 * The Olumi panel renders producer prose through a small markdown subset
 * (`safeRichText`). It handles bold, bullets, numbered lists and line breaks,
 * and it does NOT infer structure that was never marked — inventing paragraph
 * breaks at the render boundary would make the wire and the screen disagree.
 * So a lead-in like `Limit to confirm:` sent as plain prose renders as an
 * unbroken run; sent as `**Limit to confirm:**` it gets bold AND an automatic
 * paragraph gap, with no UI change at all.
 *
 * ⛔⛔ THE RULE THAT MAKES THIS SAFE, AND IT IS NOT STYLISTIC. Markup must wrap
 * a WHOLE label or a WHOLE phrase, never split one. `enforceLeadingOptionClaimsAtWire`
 * finds a leader claim IN ORDER TO REDACT IT when the claim is withheld, and its
 * patterns join words with `\s+`. Measured:
 *
 *     SEEN    **Leading option:** X           → guard matches
 *     SEEN    **the lead** is not stable      → guard matches
 *     BLIND   The **leading** option is X     → NOTHING matches
 *     BLIND   It **is** ahead of the rest     → NOTHING matches
 *
 * A split phrase does not merely render oddly — it makes the product withhold a
 * claim in its record and name a leader in the prose beside it. `\b` survives
 * `**`; an interior `\s+` does not. This helper only ever wraps a complete
 * label, which is why it cannot produce the blind cases.
 */

/** The panel's bold marker. One definition, so a change here cannot leave half
 *  the composers on the old spelling (trap 12 — no hand-maintained mirror). */
const BOLD = '**';

/**
 * `sectionLabel('Limit to confirm')` → `'**Limit to confirm:**'`
 *
 * Takes the label WITHOUT its colon and adds both the colon and the markers, so
 * no call site can mark up a partial phrase or forget the colon the panel keys
 * its paragraph gap on.
 */
export function sectionLabel(label: string): string {
  const trimmed = label.trim().replace(/:+$/, '');
  return `${BOLD}${trimmed}:${BOLD}`;
}

/**
 * ⛔ THERE IS DELIBERATELY NO `splitsAPhrase()` HELPER HERE, AND THE REASON IS
 * THE FINDING.
 *
 * I wrote one, then tested it against the four measured cases and it was WRONG:
 * it rejected `**the lead** is not stable`, which is a WHOLE phrase and must be
 * allowed. The error was not in the regex — it was in the premise. "Splitting a
 * phrase" is not a syntactic property of the text at all. `The **leading**
 * option` is blind because the markers fall INSIDE the span
 * `/\bleading\s+option/` matches; `**the lead**` is safe because they fall
 * OUTSIDE the span `/\bthe\s+lead\b/` matches. Which is which depends on the
 * GUARD'S phrases, and no predicate over the characters can know them.
 *
 * So the guarantee is asserted by RUNNING THE REAL MATCHER rather than by a
 * lookalike predicate: `__tests__/section-label-is-guard-safe.test.ts` feeds
 * each emitted label-bearing sentence to the live leader-claim patterns and
 * requires the verdict to be IDENTICAL with and without the markup. A
 * re-implementation here would be a second copy free to drift from the thing
 * that actually runs (trap 12), and — worse — it would have shipped agreeing
 * with itself.
 */
