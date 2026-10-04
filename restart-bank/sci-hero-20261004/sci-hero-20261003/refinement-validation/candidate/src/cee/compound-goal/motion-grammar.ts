/**
 * Shared motion grammar for bound extraction and construction ownership.
 * The base and expanded languages are retained unchanged. A parser must not
 * claim a prevention subject that the direction gate already understands.
 * This leaf has no dependencies, so both consumers can import it without a cycle.
 */
export const FALL_VERB = String.raw`(?:drop(?:ping|s)?|fall(?:ing|s)?|slip(?:ping|s)?|dip(?:ping|s)?)`;
export const RISE_VERB = String.raw`(?:go(?:ing|es)?|ris(?:e|es|ing)|climb(?:ing|s)?|grow(?:ing|s)?|increas(?:e|es|ing)|exceed(?:ing|s)?|creep(?:ing|s)?)`;

function inner(src: string): string {
  return src.startsWith('(?:') && src.endsWith(')') ? src.slice(3, -1) : src;
}

/** Existing direction-gate floor vocabulary, including its external-corpus additions. */
export const FALL_PLUS_SRC = `(?:${inner(FALL_VERB)}|go(?:es|ing)?|went|sink(?:s|ing)?|sank|declin(?:e|es|ing)|decreas(?:e|es|ing)|slid(?:e|es|ing)?|` +
  'shrink(?:s|ing)?|shrank|shrunk|contract(?:s|ing)?|dwindl(?:e|es|ing)|' +
  'erod(?:e|es|ing)|deteriorat(?:e|es|ing)|worsen(?:s|ing)?|weaken(?:s|ing)?|' +
  'diminish(?:es|ing)?|lessen(?:s|ing)?|sag(?:s|ging)?|soften(?:s|ing)?|' +
  'taper(?:s|ing)?|reduc(?:e|es|ing)|fall(?:s|ing)?\\s+short|' +
  'plummet(?:s|ing)?|plung(?:e|es|ing)|tumbl(?:e|es|ing)|collaps(?:e|es|ing)|' +
  'crash(?:es|ing)?|crater(?:s|ing)?|reced(?:e|es|ing)|retreat(?:s|ing)?|' +
  'subsid(?:e|es|ing)|wan(?:e|es|ing)|ebb(?:s|ing)?|backslid(?:e|es|ing)|' +
  'degrad(?:e|es|ing)|regress(?:es|ing)?)';

/** Existing direction-gate rise vocabulary, including upper-crossing phrases. */
export const RISE_PLUS_SRC = '(?:exceed(?:s|ing)?|surpass(?:es|ing)?|overshoot(?:s|ing)?|' +
  'go(?:es|ing)?\\s+(?:above|over|beyond|past)|ris(?:e|es|ing)\\s+above|' +
  'climb(?:s|ing)?|grow(?:s|ing)?|escalat(?:e|es|ing)|balloon(?:s|ing)?|' +
  'spiral(?:s|ling|ing)?|surg(?:e|es|ing)|spik(?:e|es|ing)|creep(?:s|ing)?\\s+(?:up|above)|' +
  'inflat(?:e|es|ing)|swell(?:s|ing)?|top(?:s|ping)?)';
