import { authorshipOf } from '../../../cee/provenance/provenance-of.js';
/** K3: only an explicit typed estimate declaration permits a new AI act with incomplete source.
 * A claimed user quote needs verification. A known unknown-source
 * figure cannot be relabelled by marking it as an estimate. Verified human evidence wins.
 */
export function statementOrigin(verified: boolean, unknown: boolean, sourceComplete = true, ownEstimate = false): 'human' | 'unknown' | 'ai' {
  // System 3: who said it is the one authority's answer (`authorshipOf({ words })`).
  return authorshipOf({ words: { verified, unknown, sourceComplete, ownEstimate } }).origin;
}

/** Plain words (DL 15 Oct): the user is never told about a "source check", an "origin" or a "verification". */
export const UNKNOWN_ORIGIN_DETAIL = 'Olumi cannot tell whether this figure is the user\u2019s or its own estimate, so nothing was prepared. '
  + 'Ask the user, in plain words, whether it is their figure and what it is for. Never call this a source check, an origin or a verification.';

/**
 * ⭐ ONE COLLIDING ESTIMATE NEVER SINKS THE CARD (served marketing harness 09aa3118, 15 Oct): Olumi's own estimate that is the
 * same number the user wrote for something else ("25%" for an option's founder time, the brief's "I can't spend more than 25%
 * of my time") cannot be told apart from the user's figure, so it is LEFT OUT and asked, never written; the rest is offered.
 */
export const FIGURES_LEFT_OUT_NOTE = 'Some of Olumi\u2019s estimates were left out of this card (figures_left_out): each is the same number the '
  + 'user wrote for something else (their words are in your_words), so Olumi cannot tell whether it is theirs or its own estimate. '
  + 'Nothing was written for them. Name each one in plain words, quote the user\u2019s words, and ask what it should be. '
  + 'Never call this a source check, an origin or a verification.';

export interface FigureLeftOut {
  readonly factor: string; readonly factor_id: string; readonly option?: string; readonly option_id?: string;
  readonly value: number; readonly unit: string; readonly your_words?: string;
}
