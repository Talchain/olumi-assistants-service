/**
 * Is every edit verb in this message being used as something OTHER than an
 * instruction?
 *
 * `EDIT_GRAPH_POSITIVE_REGEX` is a bare word-boundary alternation, so it
 * matches an edit verb wherever it appears — including where the word is not a
 * command at all. Measured on the captured hiring session
 * (`manual-hiring-82f31082`, 15 Sep 2026), three of the user's fourteen turns
 * reached the V4 edit LLM purely this way:
 *
 *   "...launching our next product UPDATE in 6 months..."   (turns 8 and 10)
 *   "...their strength is not SET yet. Is that correct?"     (turn 0)
 *
 * Turns 8 and 10 carried the launch-timing and onboarding requirements that the
 * assessment records as never reaching the graph. Turn 0 asked whether data was
 * missing and was answered "I've drafted a change that fits your description" —
 * a claim of an action the product had not taken, in reply to a question that
 * requested no action.
 *
 * TWO USAGES ARE RECOGNISED, both grammatical rather than lexical, because a
 * phrase list is what this estate has repeatedly watched oscillate:
 *
 *   NOUN — the verb sits inside a determiner-headed noun phrase ("the hiring
 *   cost update", "that update", "our next product update"). A determiner plus
 *   up to three modifier words, with no intervening punctuation, so "the
 *   budget, change it to 5" does NOT read as a noun.
 *
 *   STATE — the verb is a passive or perfect participle describing how things
 *   ARE ("is not set yet", "has been changed"), not an instruction to make them
 *   so.
 *
 * ⚠ THE CONJUNCTION IS THE SAFETY PROPERTY, NOT A DETAIL. This returns true
 * only when EVERY edit-verb occurrence is non-instructional. "What did that
 * update do? Increase hiring cost to 0.9." contains a noun `update` AND an
 * instructional `Increase`, and must stay on the edit path. A predicate that
 * returned true on the first non-instructional hit would silently drop that
 * edit — and a dropped edit is the more damaging direction, because the user
 * watches their instruction do nothing.
 *
 * PURE. No I/O, no graph read, no telemetry. The message is the only input.
 */

/**
 * The same verbs `EDIT_GRAPH_POSITIVE_REGEX` alternates over. Deliberately
 * RE-STATED here with a drift guard in the spec asserting the two lists agree,
 * rather than imported: this module needs each verb's OFFSET, which a single
 * combined regex built for a boolean test does not expose. The guard fails loud
 * if the canonical list ever gains a verb this one lacks.
 */
export const EDIT_VERBS: readonly string[] = [
  'change', 'update', 'edit', 'modify', 'remove', 'delete', 'add', 'adjust',
  'set', 'reduce', 'increase', 'decrease', 'tweak', 'raise', 'lower',
];

const EDIT_VERB_SCAN = new RegExp(String.raw`\b(${EDIT_VERBS.join('|')})\b`, 'gi');

/**
 * A determiner, then at most three modifier words, then the verb — with no
 * punctuation in between. "our next product update" qualifies; "the budget,
 * change it" does not, because the comma breaks the word chain.
 */
const NOUN_PHRASE_BEFORE =
  /\b(?:the|a|an|our|your|their|its|my|this|that|these|those|another|each|every|any|some|no|one)\b(?:\s+[A-Za-z][\w-]*){0,3}\s*$/i;

/** A copula or auxiliary, optional negation/adverb, optionally "been". */
const STATE_BEFORE =
  /\b(?:is|are|was|were|be|been|being|isn't|aren't|wasn't|weren't|has|have|had|hasn't|haven't|hadn't|get|gets|got)\s+(?:not\s+|never\s+|already\s+|still\s+|yet\s+)*(?:been\s+)?$/i;

/**
 * ⚠⚠ THE CLAUSE THAT AN INDEPENDENT CORPUS FORCED, AND THE REASON IT EXISTS.
 *
 * The first version of this module asked only "is every edit verb a noun or a
 * state description?". Run against the 59-row labelled corpus in
 * `mutation-warrant-explicit-veto.test.ts` — written by an adversarial review,
 * not by this lane — it suppressed TWO rows labelled EDIT:
 *
 *   "What did that update do? Replace the pricing factor with margin."
 *   "What did that update do? Simplify the model."
 *
 * Both carry a real instruction in a SECOND sentence, through verbs
 * (`replace`, `simplify`) that `EDIT_GRAPH_POSITIVE_REGEX` does not contain —
 * so the only verb this module could see was the noun `update`, and it
 * concluded the whole message was non-instructional. A corpus written here
 * could not have found that: the blind spot was the verb list itself, and the
 * fix cannot be another verb list with the same blind spot.
 *
 * So the test is inverted onto a genuinely CLOSED class. An imperative sentence
 * opens with a verb; a question or a statement opens with a function word.
 * Every sentence must open with one of these, or the message is treated as
 * possibly carrying a command and is left on the edit path. Unknown openers
 * fail towards dispatching, which is the safe direction: a suppressed
 * instruction is a user watching their edit do nothing.
 */
const NON_IMPERATIVE_OPENERS = new Set([
  // interrogatives
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  // pronouns and determiners
  'i', 'we', 'you', 'they', 'he', 'she', 'it', 'this', 'that', 'these', 'those',
  'my', 'our', 'your', 'their', 'his', 'her', 'its', 'the', 'a', 'an',
  'all', 'both', 'each', 'every', 'any', 'some', 'no', 'none', 'one', 'there',
  // auxiliaries and copulas
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being', 'do', 'does', 'did',
  'has', 'have', 'had', 'can', 'could', 'will', 'would', 'shall', 'should',
  'may', 'might', 'must', "isn't", "aren't", "wasn't", "weren't", "doesn't",
  "didn't", "don't", "can't", "won't", "shouldn't", "couldn't",
  // conjunctions, adverbs and prepositions that open a clause
  'and', 'but', 'or', 'so', 'because', 'if', 'then', 'also', 'however',
  'therefore', 'though', 'although', 'while', 'since', 'as', 'at', 'in', 'on',
  'for', 'with', 'from', 'to', 'by', 'about', 'after', 'before', 'now',
  'currently', 'still', 'yet', 'just', 'only', 'even', 'ok', 'okay', 'yes',
  'right', 'well', 'hold',
]);

/**
 * Does every sentence open with a function word rather than a bare verb?
 * Sentences are split on terminal punctuation; a leading quote, bracket or
 * bullet is stripped before the opener is read.
 */
function everySentenceOpensNonImperatively(text: string): boolean {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return false;
  for (const sentence of sentences) {
    const opener = /^[^A-Za-z']*([A-Za-z']+)/.exec(sentence)?.[1];
    if (opener === undefined) return false;
    if (!NON_IMPERATIVE_OPENERS.has(opener.toLowerCase())) return false;
  }
  return true;
}

/**
 * True when the message contains at least one edit verb and EVERY occurrence is
 * a noun or a state description. False when the message has no edit verb at all
 * (there is nothing for this predicate to say about it) and false as soon as one
 * occurrence could be an instruction.
 */
export function hasOnlyNonInstructionalEditVerbs(message: string): boolean {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (text.length === 0) return false;

  // Checked BEFORE the verb scan: a message carrying a command this module
  // cannot see must never be reported as non-instructional, whatever its
  // recognised verbs are doing.
  if (!everySentenceOpensNonImperatively(text)) return false;

  EDIT_VERB_SCAN.lastIndex = 0;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = EDIT_VERB_SCAN.exec(text)) !== null) {
    found = true;
    const before = text.slice(0, match.index);
    if (!NOUN_PHRASE_BEFORE.test(before) && !STATE_BEFORE.test(before)) {
      // One occurrence that could be an instruction is enough to keep the whole
      // message on the edit path. Fail towards dispatching.
      return false;
    }
  }
  return found;
}
