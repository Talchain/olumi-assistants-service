/**
 * ⭐ THE PRODUCER HALF: one sentence every chat-writing model is given (joined into `AGENT_INSTRUCTIONS`, and appended to
 * `RESEARCH_INSTRUCTIONS`). Code only: it ships in the CEE build and is never written to a prompt store. No dash a user
 * could see quoted back, and no figure other than the two budgets.
 */
export const REPLY_SHAPE_INSTRUCTION =
  "Keep the existing reply structure where required by this role’s schema, but put the useful answer and necessary explanation in the visible answer. Do not rely on a host-authored headline, hidden More detail section or later appendix to communicate it.";
