/**
 * The composer's explicit approval of the ONE offered link proposal (S1 harness).
 *
 * The message must START with the approval sentence ("Yes, apply that." / "yes, add it!"), and that sentence must END
 * there: approval words followed by a clause ("yes, apply it but only the first one") are not consent. Anything AFTER the
 * sentence is a further request the user made in the same message ("Yes, apply that. Tooling moderately drives velocity
 * too, so connect it."); it counts only when it carries no cancelling / qualifying / quoting word, so
 * "yes, apply it. Do not change anything; I am quoting the button" is NOT consent. The route binds a match to exactly
 * one outstanding offer, before the model sees the turn; a model's own tool call never reaches this.
 */
const APPROVAL_SENTENCE = /^yes[,!\s]+(?:apply (?:it|that)|add (?:it|that)|record (?:it|that)|make that change|go ahead with that)\s*(?:[.!]\s*([\s\S]*))?$/i;
const CANCELLING = /\b(?:don'?t|do not|doesn'?t|does not|didn'?t|did not|not|no|never|none|nothing|cancel|ignore|without|except|unless|but|only|instead|actually|quote|quoting|quoted|wait|stop|undo|revert|hold|rather)\b/i;

export function isComposerApprovalWords(text: string): boolean {
  const match = APPROVAL_SENTENCE.exec(text.trim());
  if (match === null) return false;
  const rest = (match[1] ?? '').trim();
  return rest === '' || !CANCELLING.test(rest);
}
