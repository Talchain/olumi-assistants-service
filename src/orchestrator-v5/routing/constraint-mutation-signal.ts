/**
 * ⭐ THE CONSTRAINT-SHAPED MUTATION SIGNAL — extracted to a LEAF, unchanged.
 *
 * ⚠ MOVED, NOT REWRITTEN. Every byte of the patterns and of the documentation
 * below is `mutation-warrant.ts`'s, verbatim. The move exists for ONE reason:
 * `routing/ordinary-text-authority.ts` needs this predicate to subordinate its
 * veto to an unambiguous instruction, and `mutation-warrant.ts` needs
 * `ordinary-text-authority.ts` for that veto — so leaving it where it was would
 * have made the two modules import each other. `mutation-warrant.ts` RE-EXPORTS
 * both symbols, so every existing import path is untouched.
 */

/**
 * Constraint-shaped mutation phrasings the canonical
 * `MUTATION_SIGNAL_PATTERNS` does not carry.
 *
 * ⚠ EVERY PATTERN REQUIRES A DEONTIC FRAME **AND** A DIGIT. Dropping either
 * requirement flips this module's fail-safe direction (see the header): a
 * bare `stays below` would grant a warrant on "there's a 70% chance churn
 * stays below 3%", which is the calibration forecast #831 and ROADMAP 2.627
 * exist to keep OUT of the write path.
 *
 * Kept as a separate export rather than appended to
 * `MUTATION_SIGNAL_PATTERNS` deliberately: that list has six read-side
 * consumers (run-comparison, stale-rerun, vague-edit, post-analysis-label,
 * no-analysis, post-analysis-advice) whose short-circuit behaviour inverts on
 * a mutation hit, and widening it would change all six at once for reasons
 * none of them asked for. The union assertion in the spec keeps this list a
 * strict SUPERSET, which is the only relationship the warrant needs.
 */
export const CONSTRAINT_MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  // "Keep churn below 3%." · "Hold spend under 50k." · "Maintain uptime above 99%."
  /\b(?:keep|hold|maintain)\b[^.?!\n]{0,60}\b(?:below|under|above|over|beneath|beyond|at\s+or\s+(?:below|above)|within)\b[^.?!\n]{0,24}\d/i,
  // "Churn must be at most 3%." · "It has to be at least 1%." · "must stay under 3%"
  /\b(?:must|should|needs?\s+to|has\s+to|have\s+to)\b[^.?!\n]{0,40}\b(?:at\s+most|at\s+least|no\s+more\s+than|no\s+less\s+than|no\s+higher\s+than|no\s+lower\s+than|below|under|above|over|beneath)\b[^.?!\n]{0,24}\d/i,
  // "Churn can't exceed 3%." · "must not go above 3%" · "shouldn't rise above 3%"
  /\b(?:can(?:'|’)?t|cannot|can\s+not|must\s+not|mustn(?:'|’)?t|should\s+not|shouldn(?:'|’)?t|won(?:'|’)?t|may\s+not)\b[^.?!\n]{0,24}\b(?:exceed|surpass|go\s+(?:above|below|over|under|past)|rise\s+(?:above|over|past)|fall\s+below|drop\s+below|climb\s+(?:above|over))\b[^.?!\n]{0,24}\d/i,
  // "Limit churn to 3%." · "Cap spend at 50k." · "Constrain churn to 3%."
  /\b(?:limit|cap|restrict|constrain|bound|ceiling|floor)\b[^.?!\n]{0,60}\b(?:to|at|of)\b[^.?!\n]{0,24}\d/i,
  // "Make sure churn stays below 3%." · "Ensure uptime remains above 99%."
  /\b(?:make\s+sure|ensure|guarantee)\b[^.?!\n]{0,60}\b(?:stays?|remains?|sits?|is|are)\b[^.?!\n]{0,40}\b(?:below|under|above|over|beneath|at\s+or\s+(?:below|above))\b[^.?!\n]{0,24}\d/i,
  // "Don't let churn rise above 3%." · "Never let spend exceed 50k."
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never)\s+(?:let|allow)\b[^.?!\n]{0,60}\b(?:exceed|surpass|go\s+(?:above|below|over|under)|rise\s+(?:above|over)|fall\s+below|drop\s+below|get\s+(?:above|below))\b[^.?!\n]{0,24}\d/i,
  // Bare imperative constraint: "No more than 3% churn." · "At most 3% churn."
  /^\s*(?:no\s+(?:more|less|higher|lower)\s+than|at\s+most|at\s+least|up\s+to)\b[^.?!\n]{0,40}\d/im,
  // ⭐ THE CONVERSATIONAL CONSTRAINT — how users actually state a bound in
  // chat, and the shape the repo's OWN journey fixtures use:
  //   "We can't spend more than £50,000 on marketing."
  //   "Yes, we don't want to spend more than £50k on this."
  // A negated capability/desire plus a comparative bound plus a number. It is
  // an instruction, not a report, because of the negation — "we spent more than
  // £50k" carries no negation and does not match.
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never|can(?:'|’)?t|cannot|can\s+not|won(?:'|’)?t|will\s+not|must\s+not|mustn(?:'|’)?t)\b[^.?!\n]{0,60}\b(?:more|less|higher|lower|greater|bigger|smaller)\s+than\b[^.?!\n]{0,24}[£$€]?\s?\d/i,
];

/**
 * Does the message carry a CONSTRAINT-shaped mutation instruction? Narrow by
 * construction — see the fail-safe note above.
 */
export function hasConstraintMutationSignal(message: string): boolean {
  if (typeof message !== 'string') return false;
  for (const re of CONSTRAINT_MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}
