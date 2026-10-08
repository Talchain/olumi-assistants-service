/**
 * ⭐ THE PRODUCER HALF: one sentence every chat-writing model is given (joined into `AGENT_INSTRUCTIONS`, and appended to
 * `RESEARCH_INSTRUCTIONS`). Code only: it ships in the CEE build and is never written to a prompt store. No dash a user
 * could see quoted back, and no figure other than the two budgets.
 */
export const REPLY_SHAPE_INSTRUCTION =
  'Shape: begin with one short sentence that answers. Then give at most three bullets, each on its own line starting '
  + 'with "- " and under 20 words: concise, action-oriented points grounded in this model (two bullets if you also ask a '
  + 'question). Keep that part under 75 words, with one reasoning move and at most one question or next action; no '
  + 'generic advice. Put any further explanation after the bullets, after a blank line: Olumi shows it under More '
  + 'detail, so never repeat it in the bullets. If you ask a question, it stays your last sentence.';
