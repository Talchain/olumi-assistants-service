/**
 * SENTENCE-LEVEL SURGERY — the shared mechanics for removing ONE offending unit
 * of prose without destroying the prose around it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS AT ALL, and why it is a MOVE and not a new copy.
 *
 * Two gates in this estate need the same three properties:
 *
 *   1. `context/withheld-history-redaction.ts` — the MODEL-INPUT gate. Removes
 *      ordering claims from prior-turn assistant messages before they are fed
 *      back to the model.
 *   2. `compose/leading-option-wire-enforcement.ts` — the WIRE gate (ROADMAP
 *      2.149). Removes an unlicensed leading-option designation from the answer
 *      the USER receives.
 *
 * They differ in exactly two things — the per-unit READER and the REPLACEMENT
 * string — and the readers deliberately have opposite cost functions (see
 * `leading-option-egress-guard.ts` :236-262). Everything else is identical, and
 * "everything else" is where the properties live:
 *
 *   LOSSLESS SPLIT     `splitIntoRedactableUnits(t).join('') === t`, exactly.
 *   BYTE IDENTITY      no unit asserts ⇒ the SAME REFERENCE comes back.
 *   NEVER EMPTIES      a replaced unit is REPLACED, never deleted.
 *
 * Duplicating that machinery is CLAUDE.md trap #12 in its purest form: two
 * copies of a splitter, one of which gets a bug fix. So the implementation lives
 * here once, and `withheld-history-redaction.ts`'s four module-load probes —
 * which exercise the live-leak corpus, the over-suppression corpus, the lossless
 * split and the never-empties property — now certify THIS code. There is no
 * second implementation to keep in step because there is no second
 * implementation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Split prose into redactable units: LINES first, then sentences within a line.
 *
 * LINES FIRST IS LOAD-BEARING. The live leaking answers are bullet lists
 * (`• **Your stored lean is …**`), and a naive sentence split over the whole
 * message would fuse a bullet's tail to the next bullet's head and redact both
 * on one hit. Splitting on newlines first bounds the blast radius of a hit to
 * the line it occurred on, which is the difference between losing one bullet
 * and losing the answer.
 *
 * The separators are RETAINED in the returned units so `units.join('')` is the
 * input, exactly — that identity is what makes the "no claim ⇒ byte-identical"
 * property a derivation rather than a hope, and it is asserted at module load in
 * `withheld-history-redaction.ts`'s `assertSupersetAndLosslessSplit`.
 */
/**
 * Is this terminal-punctuation run a real sentence boundary, or an abbreviation?
 *
 * ⚠ A FALSE BOUNDARY IS NOT COSMETIC — IT GARBLES PROSE AND CAN AMPLIFY A LEAK.
 * (Found by adversarial review of #768.) `"Compare Hire vs. Hold. Hire leads."`
 * split after `vs.`, so the "sentence" the gate removed was half a clause: the
 * user got a mangled fragment, and the half that survived could still carry the
 * designation. Splitting too eagerly makes surgery LESS surgical, not more.
 *
 * ⚠ AND THE FIX IS DELIBERATELY NOT AN ABBREVIATION ALLOWLIST. `["vs", "i.e",
 * "e.g", "No", "Inc", …]` is precisely the hand-maintained mirror CLAUDE.md trap
 * #12 is about: the abbreviation nobody listed reads as green on the day it
 * ships, and prose vocabulary is unbounded. Two STRUCTURAL rules instead, each
 * derived from what a sentence boundary IS rather than from a list of things it
 * is not:
 *
 *   1. WHAT FOLLOWS MUST BE ABLE TO OPEN A SENTENCE. A lowercase letter after
 *      the whitespace means the sentence continued — `"e.g. the second option"`,
 *      `"Acme Inc. reported"`. `!` and `?` are exempt: no abbreviation ends in
 *      one, so they are boundaries unconditionally.
 *   2. WHAT PRECEDES MUST NOT BE ABBREVIATION-SHAPED. Abbreviations are SHORT or
 *      INTERNALLY DOTTED, and that is a property of the token, not of a lexicon:
 *      a token containing its own `.` (`i.e`, `e.g`, `U.S`) or of one-to-two
 *      letters (`vs`, `No`, `Dr`, `Mr`) is not a sentence's last word.
 *
 * RESIDUAL, STATED RATHER THAN LEFT TO BE DISCOVERED: a ≥3-letter abbreviation
 * followed by a capital (`"Acme Inc. Revenue fell."`) is structurally
 * indistinguishable from a sentence end and still splits. The failure is bounded
 * (one extra unit boundary) and the direction is the same as before this fix.
 * The opposite error — a genuine 1-2 letter sentence-final word (`"It is so. Now
 * we act."`) — MERGES two sentences into one unit, which is the SAFE direction:
 * a larger unit removes more, never less, and can never leave half a claim.
 */
function isSentenceBoundary(line: string, matchIndex: number, matchText: string): boolean {
  if (/[!?]/.test(matchText)) return true;

  // Rule 1 — what follows must be able to open a sentence. An empty tail means
  // the line ends in trailing whitespace, which is a boundary by exhaustion.
  const nextChar = line.slice(matchIndex + matchText.length).charAt(0);
  if (nextChar !== '' && !/[A-Z0-9"'([]/.test(nextChar)) return false;

  // Rule 2 — what precedes must not be abbreviation-shaped.
  const token = /(\S*)$/.exec(line.slice(0, matchIndex))?.[1] ?? '';
  if (token.includes('.')) return false;
  if (/^[A-Za-z]{1,2}$/.test(token)) return false;

  return true;
}

export function splitIntoRedactableUnits(text: string): string[] {
  const units: string[] = [];
  // Keep the newline runs as their own units: they are separators, never
  // content, and they must survive redaction so the answer's shape is intact.
  for (const line of text.split(/(\n+)/)) {
    if (line === '') continue;
    if (/^\n+$/.test(line)) {
      units.push(line);
      continue;
    }
    // Sentence boundary: terminal punctuation followed by whitespace. The
    // whitespace rides with the sentence it follows, so the join is lossless.
    // A candidate that {@link isSentenceBoundary} rejects is simply not cut on —
    // `start` does not move, so the text stays in the current unit and the join
    // identity is untouched.
    let start = 0;
    const re = /[.!?]+["')\]]*\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (!isSentenceBoundary(line, m.index, m[0])) continue;
      units.push(line.slice(start, m.index + m[0].length));
      start = m.index + m[0].length;
    }
    if (start < line.length) units.push(line.slice(start));
  }
  return units;
}

/**
 * Replace every unit that `asserts` with `replacement`, leaving every other byte
 * of `text` alone.
 *
 * ⚠ RETURNS THE INPUT REFERENCE when no unit asserts. Callers compare by
 * identity to prove the anti-over-suppression property, so this is part of the
 * contract, not an optimisation.
 *
 * CONSECUTIVE REPLACEMENTS COLLAPSE. Prose that is wall-to-wall offending units
 * would otherwise become a wall of identical replacement sentences — noise that
 * reads as a malfunction and eats budget. One replacement per contiguous run.
 *
 * ⚠ NEVER RETURNS EMPTY FOR A NON-EMPTY INPUT. An offending unit is REPLACED,
 * never deleted. Both consumers depend on this for different reasons: the
 * rolling-summary gate would render an emptied slot as `(none)` (an affirmative
 * "the summariser found none"), and the wire gate would ship an empty
 * `assistant_text` — a required schema field, and a worse answer than the one it
 * was repairing.
 *
 * PURE. Never throws, never mutates.
 */
export function replaceAssertingUnits(
  text: string,
  asserts: (unit: string) => boolean,
  replacement: string,
): string {
  const units = splitIntoRedactableUnits(text);
  if (!units.some((unit) => asserts(unit))) return text;

  const out: string[] = [];
  // A separator between two REPLACED units is dropped with the second of them
  // (one replacement per contiguous run); a separator between a replacement and
  // surviving prose is kept, or the two would be concatenated with no break at
  // all. Buffering is what lets that decision be made after seeing what comes
  // next.
  let pendingSeparator = '';
  let lastWasReplacement = false;
  for (const unit of units) {
    if (/^\s+$/.test(unit)) {
      pendingSeparator += unit;
      continue;
    }
    if (asserts(unit)) {
      if (lastWasReplacement) {
        // ⚠ THIS USED TO BE `pendingSeparator = ''` AND IT GLUED SENTENCES
        // TOGETHER. (Found by adversarial review of #768; pre-existing, moved
        // here verbatim from `withheld-history-redaction.ts`, and invisible to
        // that module's four probes because none of them has TWO consecutive
        // offending units followed by surviving prose.)
        //
        //   "X leads. Y comes out ahead. Done."
        //     u1 replaced → pendingSeparator = ' ' (u1's trailing space)
        //     u2 collapses → separator CLEARED
        //     u3 pushed with no separator → "…put forward yet.Done."
        //
        // The collapsed unit's OWN trailing whitespace has to take over as the
        // pending separator, exactly as the first replaced unit's did — the run
        // is one replacement, so it ends where the LAST collapsed unit ended.
        const collapsedTrailing = /\s+$/.exec(unit);
        pendingSeparator = collapsedTrailing !== null ? collapsedTrailing[0] : '';
        continue;
      }
      out.push(pendingSeparator);
      pendingSeparator = '';
      out.push(replacement);
      // The unit's OWN trailing whitespace rides with the replacement: sentence
      // units carry the space that followed their full stop, and losing it
      // would run the replacement straight into the next sentence.
      const trailing = /\s+$/.exec(unit);
      if (trailing !== null) pendingSeparator = trailing[0];
      lastWasReplacement = true;
      continue;
    }
    out.push(pendingSeparator);
    pendingSeparator = '';
    out.push(unit);
    lastWasReplacement = false;
  }
  out.push(pendingSeparator);
  return out.join('');
}
