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
 *
 * ── 2026-07-25: the residual gap was a LIVE data-corruption path ──────────
 *
 * The gap this header used to record as accepted ("an option referenced only
 * by a partial/distinctive token without the word 'option' … is not caught")
 * was reproduced on deployed staging `a833276`, scenario 908dabc0-…:
 *
 *   "Running the pop-up pilot reduces Capital Investment in Leeds Site to
 *    £20,000"
 *     → "Updated Capital Investment in Leeds Site from 0 to 20,000 GBP."
 *     → `fac_capital.observed_state.value` 0 → 20000 on the SHARED factor
 *       all four options read, while `opt_popup`'s own intervention stayed
 *       0.25 — the user's sentence rewrote a global assumption for every
 *       option AND did not do the thing they asked.
 *
 * The same sentence plus the single word "option" was correctly refused, and
 * so was the same shape naming the option by its FULL label — proving the
 * containment path works and the labels are available; only the PREDICATE
 * was too narrow.
 *
 * Trigger (3) below closes it by matching OPTION-DISTINCTIVE TOKENS. The
 * distinctive set is DERIVED, not listed: it is the option labels'
 * vocabulary MINUS the vocabulary of every other named entity in the graph.
 * That subtraction is what keeps the guard from swallowing legitimate factor
 * edits — in the live graph "Leeds" occurs in both an option label and three
 * factor labels, so it can never be an option cue, whereas "pilot" occurs
 * only in an option label and always is.
 */

import type { EntityKind } from './types.js';

/**
 * The entity kinds whose labels disqualify a word from being an option cue.
 *
 * `node` is the bucket `graph-lookup-adapter.ts` collapses factor / outcome
 * / decision / risk / action into, so this covers every entity a user could
 * name as a factor-value target, plus the goal.
 *
 * A kind missing from this list fails SAFE: fewer subtractions leave MORE
 * words counted as option cues, so the guard fires more often, never less.
 * That is why this is a short explicit list rather than a derivation over
 * the EntityKind enum — `edge` and `constraint` labels are expressions, not
 * entity names, and including them could only ever mask a real cue.
 */
const NON_OPTION_LABEL_KINDS: readonly EntityKind[] = ['node', 'goal'];

/** The minimal shape of the graph lookup this module needs. */
interface OptionGuardLabelSource {
  listEntitiesByKind(
    kind: EntityKind,
  ): ReadonlyArray<{ readonly label?: string | null }>;
}

function usableLabels(
  entities: ReadonlyArray<{ readonly label?: string | null }>,
): string[] {
  return entities
    .map((entity) => entity.label)
    .filter(
      (label): label is string => typeof label === 'string' && label.trim().length > 0,
    );
}

/**
 * Build both label sets `impliesOptionInterventionEdit` needs from a graph
 * lookup.
 *
 * Every call site uses this rather than projecting the lists itself, so the
 * four guard sites cannot drift into disagreeing about what counts as a
 * non-option label (trap 12 — the same defect class as two same-named
 * helpers computing different things).
 */
export function collectOptionGuardLabels(lookup: OptionGuardLabelSource): {
  readonly optionLabels: string[];
  readonly nonOptionLabels: string[];
} {
  const nonOptionLabels: string[] = [];
  for (const kind of NON_OPTION_LABEL_KINDS) {
    nonOptionLabels.push(...usableLabels(lookup.listEntitiesByKind(kind)));
  }
  return {
    optionLabels: usableLabels(lookup.listEntitiesByKind('option')),
    nonOptionLabels,
  };
}

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
 * Minimum length for a word to be usable as an option cue. Below this a
 * token carries too little information to distinguish "the user named an
 * option" from coincidence ("run", "new", "six", "quo"). It also removes
 * essentially every English function word without needing to list them.
 */
const MIN_DISTINCTIVE_TOKEN_LENGTH = 5;

/**
 * Closed-class English words of >= MIN_DISTINCTIVE_TOKEN_LENGTH that can
 * appear inside an option label ("Expand Through Franchising") but never
 * identify one.
 *
 * This IS a hand-maintained list, so it is worth being explicit about why it
 * is not the drift-prone kind (trap 12). It mirrors English function words,
 * not any artefact of this system: nothing in the codebase can change and
 * leave it stale, and a word missing from it costs at most one clarify turn
 * — it can never cause a missed guard, because the list only ever REMOVES
 * cues. Its failure mode is safe by construction.
 */
const NON_DISTINCTIVE_WORDS: ReadonlySet<string> = new Set([
  'about', 'above', 'after', 'again', 'against', 'along', 'among', 'around',
  'because', 'before', 'being', 'below', 'between', 'cannot', 'could',
  'doing', 'during', 'either', 'every', 'further', 'having', 'itself',
  'neither', 'other', 'others', 'should', 'since', 'their', 'theirs',
  'there', 'these', 'thing', 'those', 'through', 'under', 'until', 'where',
  'whether', 'which', 'while', 'within', 'without', 'would', 'yours',
]);

/** Lower-case alphanumeric words. "Pop-Up" → ["pop","up"]; "£20,000" → ["20","000"]. */
function tokenise(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

/**
 * True when two words are plausibly the same lexeme — an inflection or
 * derivation of one another ("franchise"/"franchising", "delay"/"delayed",
 * "location"/"locations").
 *
 * Deliberately a shared-prefix rule rather than a stemmer: it needs no
 * dictionary, is stable across locales, and its tolerance shrinks as words
 * get longer, so it accepts real morphology while rejecting long words that
 * merely start alike — "investment" vs "investigate" share only 6 of the 7
 * characters required at that length, and do not match.
 */
function tokensShareLexeme(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const required = Math.max(MIN_DISTINCTIVE_TOKEN_LENGTH, shorter - 3);
  return sharedPrefixLength(a, b) >= required;
}

/**
 * The words that identify an OPTION and nothing else in this graph.
 *
 * Derived by subtraction: every word used in an option label, minus every
 * word used by any other named entity, minus words too short or too generic
 * to identify anything. Deriving it per-graph (rather than listing option
 * keywords) is what makes the guard safe to widen — a word the user could
 * plausibly mean as a FACTOR is disqualified automatically, so the guard
 * cannot start refusing legitimate factor edits as graphs change.
 *
 * Exported for direct testing: the subtraction is the load-bearing step and
 * deserves assertions of its own.
 */
export function deriveOptionDistinctiveTokens(
  optionLabels: readonly string[],
  nonOptionLabels: readonly string[],
): { readonly cues: ReadonlySet<string>; readonly claimedElsewhere: ReadonlySet<string> } {
  const claimedElsewhere = new Set<string>();
  for (const label of nonOptionLabels) {
    if (typeof label !== 'string') continue;
    for (const token of tokenise(label)) claimedElsewhere.add(token);
  }

  const cues = new Set<string>();
  for (const label of optionLabels) {
    if (typeof label !== 'string') continue;
    for (const token of tokenise(label)) {
      if (token.length < MIN_DISTINCTIVE_TOKEN_LENGTH) continue;
      if (claimedElsewhere.has(token)) continue;
      if (NON_DISTINCTIVE_WORDS.has(token)) continue;
      cues.add(token);
    }
  }
  return { cues, claimedElsewhere };
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
 *   3. The message uses a word that identifies an option and nothing else in
 *      this graph, or an inflection of one ("Running the pop-up pilot …",
 *      "Franchising reduces …"). See `deriveOptionDistinctiveTokens`.
 *
 * `nonOptionLabels` — the labels of every OTHER named entity in the graph
 * (factors, outcomes, decisions, risks, actions, the goal). It is REQUIRED
 * rather than optional on purpose: an omitted argument would silently
 * restore the pre-2026-07-25 corruption path at that call site, so the
 * compiler is made to point at every caller instead (trap 12 — fail loud on
 * drift, never assume-good). Passing an incomplete list is safe in the
 * direction that matters: fewer subtractions means MORE words count as
 * option cues, so the guard fires more often, never less.
 *
 * Gated on the graph actually having option labels: with no options there is
 * nothing to misroute to, so the guard stays out of the way (a plain factor
 * edit that happens to say "option" colloquially is not blocked).
 *
 * Residual (accepted) gap — this is containment, not a complete option-edit
 * parser: an option referred to only by a pronoun or by a synonym absent
 * from its label ("switch the cheap one to £5k") is still not caught.
 */
export function impliesOptionInterventionEdit(
  message: string,
  optionLabels: readonly string[],
  nonOptionLabels: readonly string[],
): boolean {
  if (optionLabels.length === 0) return false;
  const normalised = message.toLowerCase().replace(/\s+/g, ' ').trim();
  const padded = ` ${normalised} `;

  // (1) option / intervention vocabulary. `\boptions?\b` matches
  // "option"/"options"/"option's" (the apostrophe is a word boundary) but
  // NOT "optional"; `\binterventions?\b` likewise.
  if (/\boptions?\b/.test(padded)) return true;
  if (/\binterventions?\b/.test(padded)) return true;

  // (2) names a specific option by its full label.
  for (const raw of optionLabels) {
    if (typeof raw !== 'string') continue;
    const label = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (label.length >= 3 && containsPhrase(padded, label)) return true;
  }

  // (3) uses a word that identifies an option and nothing else here.
  const { cues, claimedElsewhere } = deriveOptionDistinctiveTokens(
    optionLabels,
    nonOptionLabels,
  );
  if (cues.size > 0) {
    for (const token of tokenise(normalised)) {
      if (token.length < MIN_DISTINCTIVE_TOKEN_LENGTH) continue;
      // A word that names another entity is evidence for THAT entity, never
      // for an option — even if it happens to share a stem with an option
      // cue. Without this the exclusion is one-sided and the inflection rule
      // leaks: the live fixture "Hire Two Senior Engineers Locally" (option)
      // and "Local Senior Hire Indicator" (factor) let the factor's own word
      // "local" match the option's "locally", refusing a perfectly ordinary
      // factor edit. Subtraction has to apply to BOTH sides of the match.
      if (claimedElsewhere.has(token)) continue;
      for (const cue of cues) {
        if (tokensShareLexeme(cue, token)) return true;
      }
    }
  }

  return false;
}
