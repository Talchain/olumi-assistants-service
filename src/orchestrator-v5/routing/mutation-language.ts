/**
 * Mutation-language detector — pure regex helper.
 *
 * Returns true when `text` reads as if the speaker is performing a graph
 * mutation ("Proposing to add X", "I'll set Y to 5", "updating the budget").
 * Used by:
 *
 *  1. `validateExplanationAnswer` — Sonnet's `answer_text` for an explanation
 *     handler must NOT sound like an edit. A match marks the answer invalid;
 *     the handler falls through to deterministic fallback.
 *
 *  2. The turn-executor STEP 6 log-only safety check — if a non-edit handler's
 *     final composed `assistant_text` slipped through with mutation language,
 *     emit `v5_mutation_language_guard` telemetry. Detection-only at STEP 6
 *     (no re-compose, no swap).
 *
 * Bias is toward false positives over false negatives. The cost of a false
 * positive on an explanation handler is "use the deterministic fallback" —
 * the user always sees a useful response. The cost of a false negative is
 * the user believing a graph mutation occurred when it did not (the
 * "Proposing to add a competitive response risk factor..." failure observed
 * during manual testing on staging).
 */

const MUTATION_PATTERNS: readonly RegExp[] = [
  // First-person commitments to mutate ("I'll add", "I will update",
  // "I'm going to remove", "I'd like to add", "I would set").
  /\bI(?:'ll|'d like to| would like to|'m going to| am going to| will| would|'d)\s+(add|set|change|update|remove|increase|decrease|adjust)\b/i,
  // "Proposing to ..." constructions.
  /\bproposing to\s+(add|update|change|set|remove|adjust|increase|decrease)\b/i,
  /\bproposed\s+(addition|update|change|removal|adjustment)\b/i,
  // "Adding/updating/removing the X" — actions in progress.
  /\b(adding|updating|removing|setting|changing|adjusting)\s+(the|a|an|this|that|your)\b/i,
  // Suggestions framed as mutations.
  /\bI(?:'d| would) suggest\s+(adding|setting|changing|updating|removing|adjusting)\b/i,
  /\blet me\s+(add|set|change|update|remove|adjust)\b/i,
];

export function containsMutationLanguage(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return MUTATION_PATTERNS.some((pattern) => pattern.test(text));
}
