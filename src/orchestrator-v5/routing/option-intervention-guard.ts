/**
 * V5 edit_graph P0 containment (task_99f83f0d) — option-intervention
 * misroute guard.
 *
 * An option-specific intervention edit — "revise the Outsource option's
 * Annual Support Cost intervention to £135k" — can be (mis)proposed as a
 * `set_factor_value` on the SHARED factor: the model names the factor and a
 * value and drops the option framing, and the validator accepts it because
 * the factor is a real, correctly-kinded target. Applying it would silently
 * mutate the factor's own observed value (the wrong entity) instead of the
 * option's intervention.
 *
 * `set_factor_value` remains a legitimate handler for genuine factor-value
 * edits (the deterministic pre-route AND a tested LLM tool-call path), so
 * this guard does NOT disable it. It only detects the narrow case where the
 * user's message implies an OPTION intervention edit, so the caller can
 * refuse the factor mutation and clarify instead — graph unchanged.
 *
 * Detection is intentionally safe-biased: a false positive costs one clarify
 * turn (the documented acceptable fallback); a false negative is a silent
 * wrong mutation. It is a heuristic on the user's text, not a full intent
 * parser — see the residual gaps on `impliesOptionInterventionEdit`.
 */

/**
 * Whole-word / phrase membership. Returns true when `needle` appears in
 * `paddedHaystack` bounded by non-alphanumerics (so "hire" matches "the
 * hire" but not "hiring" or "outsourced"). Both arguments must already be
 * lower-cased; `paddedHaystack` must be space-padded at both ends. Uses
 * `indexOf` (not RegExp) so option labels with regex-special characters are
 * matched literally.
 */
export function containsPhrase(paddedHaystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const at = paddedHaystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = paddedHaystack[at - 1];
    const after = paddedHaystack[at + needle.length];
    const boundedBefore = before === undefined || !/[a-z0-9]/.test(before);
    const boundedAfter = after === undefined || !/[a-z0-9]/.test(after);
    if (boundedBefore && boundedAfter) return true;
    from = at + 1;
  }
}

/**
 * True when `message` names or strongly implies an edit to an OPTION's
 * intervention rather than a factor's own value.
 *
 * Triggers (any one):
 *   1. The message uses option / intervention vocabulary ("option",
 *      "options", "intervention") — the strongest CEE-domain signal that the
 *      user is talking about an option's effect on a factor, not the factor
 *      itself. A genuine factor-value edit ("set Annual Support Cost to
 *      £120,000") does not use these words.
 *   2. The message names a specific option by its full label.
 *
 * Gated on the graph actually having option labels: with no options there is
 * nothing to misroute to, so the guard stays out of the way (a plain factor
 * edit that happens to say "option" colloquially is not blocked).
 *
 * Residual (accepted) gaps — this is containment, not a complete option-edit
 * parser: an option referenced only by a partial/distinctive token without
 * the word "option" (e.g. "revise Outsource so…" when the option label is
 * "Outsource to BPO Vendor") is not caught.
 */
export function impliesOptionInterventionEdit(
  message: string,
  optionLabels: readonly string[],
): boolean {
  if (optionLabels.length === 0) return false;
  const padded = ` ${message.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  // (1) option / intervention vocabulary. `\boptions?\b` matches
  // "option"/"options"/"option's" (the apostrophe is a word boundary) but
  // NOT "optional"; `\binterventions?\b` likewise.
  if (/\boptions?\b/.test(padded)) return true;
  if (/\binterventions?\b/.test(padded)) return true;

  // (2) names a specific option by its full label.
  for (const raw of optionLabels) {
    const label = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (label.length >= 3 && containsPhrase(padded, label)) return true;
  }
  return false;
}
