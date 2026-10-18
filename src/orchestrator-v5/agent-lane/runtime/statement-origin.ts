/**
 * ⛔ DEMO (Paul's founder-hours transcript, AIE #94 6192426755): "we have no funding" was refused here, then re-asked. An unknown
 * origin records nothing as the user's figure, but the words stay in the conversation: never ask the user to say or confirm them
 * again. Corrections use the existing targeted tools, retaining their original context.
 */
export const UNKNOWN_ORIGIN_DETAIL = 'The proposed figure could not be verified for this model field, so it was not recorded. Retain the '
  // AIE #94 6194613256, exact.
  + 'original words and any known speaker and source; an unverified field binding does not make that known origin unknown. Do not ask '
  + 'the user to repeat or confirm supplied facts. Explain only genuinely missing or conflicting meaning. If this changes the model as '
  + 'a whole, retain the complete correction and use supported targeted operations; explain any unsupported part and continue useful qualitative reasoning without claiming a save.';
