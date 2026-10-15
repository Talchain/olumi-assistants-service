import { authorshipOf } from '../../../cee/provenance/provenance-of.js';
/** K3: only an explicit typed estimate declaration permits a new AI act with incomplete source.
 * A claimed user quote needs verification. A known unknown-source
 * figure cannot be relabelled by marking it as an estimate. Verified human evidence wins.
 */
export function statementOrigin(verified: boolean, unknown: boolean, sourceComplete = true, ownEstimate = false): 'human' | 'unknown' | 'ai' {
  // System 3: who said it is the one authority's answer (`authorshipOf({ words })`).
  return authorshipOf({ words: { verified, unknown, sourceComplete, ownEstimate } }).origin;
}

/**
 * ⛔ DEMO (Paul's founder-hours transcript, AIE #94 6192426755): "we have no funding" was refused here, then re-asked. An unknown
 * origin records nothing as the user's figure, but the words stay in the conversation: never ask the user to say or confirm them
 * again. A correction to the model as a whole goes through propose_change op revise_model, which reads them as context.
 */
export const UNKNOWN_ORIGIN_DETAIL = 'The retained source is not verified, so nothing was recorded as the user\u2019s own figure and its origin stays unknown. '
  + 'Do not ask the user to repeat or confirm it: it stays in the conversation as context. If it changes the model as a whole, '
  + 'offer propose_change op revise_model.';
