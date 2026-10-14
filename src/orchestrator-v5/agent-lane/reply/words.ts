/**
 * ⭐ S-A: THE ONE REPLY VOCABULARY (lane COPY-SHAPE, DL 0fd71f, 7 Oct 2026; DESIGN §3d). One concept, one phrase, here.
 * Producers import the phrase; they never restate it. No imports (the `limit-operator-words.ts` pattern), so any producer
 * can depend on it without a cycle.
 *
 * First entries (absorbed from Codex WORDING, 7 Oct; Science's interim ruling of 6 Oct): a link Olumi has only a
 * placeholder for "isn't sized in the model yet". Never "nobody has set yet" (D-05: untrue in part, and odd). The other
 * phrasings of this concept (census §3d: ≥15) move here in slice 2.
 */

/** A link with only a placeholder strength (Science, 6 Oct). */
export const NOT_SIZED = "isn't sized in the model yet";

/** The same, as the strength(s) of one or more links, with agreement rather than implied authorship. */
export const strengthNotSized = (plural: boolean): string => (plural ? "strengths aren't sized in the model yet" : `strength ${NOT_SIZED}`);
