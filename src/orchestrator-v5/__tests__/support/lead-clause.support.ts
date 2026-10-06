/**
 * The headline / explanation LEAD CLAUSE in every form it has served — retired and current — owned once (Codex buddy
 * #2646 r1 F7). A negative assertion naming only the retired words ("scored highest") stops seeing the leader the day the
 * words move, and passes by testing nothing. One pattern over every form keeps "the leader is absent" a claim about the
 * leader, not about a vocabulary.
 *
 * Its control is `coaching/__tests__/lead-clause-ladder.test.ts`: every current producer form matches, and the
 * eliminated tail ("each supported by under 1% of runs") and a withheld disclosure do not.
 */
export const ANY_LEAD_CLAUSE_RE =
  /\b(?:scored\s+highest|came\s+out\s+(?:ahead|lowest)|(?:gave|gives)\s+the\s+(?:highest|lowest)\b|was\s+supported\s+by\s+(?:the\s+(?:next\s+)?most\s+runs|\d{1,3}(?:\.\d+)?%\s+of\s+runs))/i;
