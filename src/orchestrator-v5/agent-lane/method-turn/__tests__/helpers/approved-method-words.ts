/**
 * Prompt P19 (AIE one-pass packet, SHA 94ad9c8f…): a recorded pre-mortem turn's directive as the approved words send it now.
 * Exactly two edits, each asserted present once: the opening line keeps its facts (a pre-mortem, no tools) and gains the
 * approved method sentence; the word cap line goes. And AIE 19 Oct (prompt/AIE-PREMORTEM-HUMAN-SOURCE-GROUNDING-20261019-v1.json,
 * AMEND): every link item's class reads "a relationship on this plan’s path" ("an option’s" in a decision turn), never "nobody
 * has sized this yet". Every other byte of the recorded turn stays pinned.
 */
const RECORDED_OPENING = 'METHOD TURN: the user asked for a pre-mortem. This reply follows the method below exactly, and calls no tools.';
const APPROVED_OPENING = 'METHOD TURN: the user asked for a pre-mortem, and this reply calls no tools.\n'
  + 'Use the selected method and its supplied facts to develop a useful answer for the actual question. Keep it concise without '
  + 'omitting relevant reasoning, evidence, dissent or uncertainty to fit an arbitrary word limit. Preserve this role’s required '
  + 'response schema.';
const RECORDED_CAP = /\nAt most \d+ words\.(?=\n|$)/gu;
const RECORDED_LINK_CLASS = '(nobody has sized this yet)';
const APPROVED_LINK_CLASS = '(a relationship on this plan’s path)';

export function withApprovedMethodWords<T>(turn: T): T {
  const directive = (turn as { directive?: unknown } | null | undefined)?.directive;
  if (typeof directive !== 'string') return turn;
  if (directive.split(RECORDED_OPENING).length !== 2) throw new Error('recorded directive lacks its one opening line');
  if ((directive.match(RECORDED_CAP) ?? []).length !== 1) throw new Error('recorded directive lacks its one word cap');
  const decision = (turn as { context?: { decision_level?: unknown } }).context?.decision_level === true;
  return { ...turn, directive: directive.replace(RECORDED_OPENING, APPROVED_OPENING).replace(RECORDED_CAP, '')
    .replaceAll(RECORDED_LINK_CLASS, decision ? APPROVED_LINK_CLASS.replaceAll('this plan', 'an option') : APPROVED_LINK_CLASS) };
}
