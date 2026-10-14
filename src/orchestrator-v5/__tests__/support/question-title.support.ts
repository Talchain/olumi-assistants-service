/**
 * #3045 (Paul's vocabulary, 14 Oct; `admit-model.ts` `decisionEntityFor`): a drafted decision node with no brief-copied
 * question SHOWS "Question: <metric>", while its id still slugs from "Decision: <metric>". A capture or digest recorded
 * before #3045 differs by that title word ONLY; these project between the two so every other byte still compares.
 */
const DECISION = 'Decision: ';
const QUESTION = 'Question: ';
function retitled<T>(n: T, from: string, to: string): T {
  const x = n as { kind?: unknown; label?: unknown } | null;
  return x !== null && typeof x === 'object' && x.kind === 'decision' && typeof x.label === 'string' && x.label.startsWith(from)
    ? { ...n, label: `${to}${x.label.slice(from.length)}` } : n;
}
/** A pre-#3045 captured node, titled as today's construction titles it. */
export const asQuestionTitled = <T>(n: T): T => retitled(n, DECISION, QUESTION);
/** Today's node, read back to a pre-#3045 digest's title. */
export const asDecisionTitled = <T>(n: T): T => retitled(n, QUESTION, DECISION);
