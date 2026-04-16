/**
 * Narrate-mode output sanitiser (addendum §2.1.4).
 *
 * Strips XML-like tags, a fixed set of banned terms, and em-dashes before the
 * text reaches the OlumiResponse. The sanitiser is non-fatal: contamination is
 * stripped in-band and the response is still a success (BI-02). A telemetry
 * event is emitted so we can track contamination rate without surfacing it to
 * the user.
 */

// Match anything that looks like an XML / pseudo-XML tag. Conservative — we
// strip the whole tag, including malformed closers, and keep inner text.
// Example: "<thinking>hidden</thinking>" → "hidden".
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

// Banned phrases per house style. Extend additively if Paul adds more.
const BANNED_SUBSTRINGS: string[] = [
  // no-op today; kept as the hook for future deterministic scrubs
];

const EM_DASH = '\u2014'; // —
const EN_DASH = '\u2013'; // –

export interface SanitiseResult {
  output: string;
  contamination_detected: boolean;
}

export function sanitiseNarrateOutput(input: string): SanitiseResult {
  let output = input;
  let contamination = false;

  // 1. Strip XML-like tags
  if (TAG_PATTERN.test(output)) {
    contamination = true;
    output = output.replace(TAG_PATTERN, '');
  }

  // 2. Banned substrings (case-insensitive whole-word-ish match)
  for (const banned of BANNED_SUBSTRINGS) {
    const pattern = new RegExp(banned, 'gi');
    if (pattern.test(output)) {
      contamination = true;
      output = output.replace(pattern, '');
    }
  }

  // 3. Replace em-dashes with a comma + space per house style, en-dashes with
  //    a hyphen. Matches V4 response-quality pass.
  if (output.includes(EM_DASH) || output.includes(EN_DASH)) {
    // Note: em-dash replacement is a style normalisation, NOT contamination.
    // Do not flag contamination_detected solely for dash swaps.
    output = output.replaceAll(EM_DASH, ', ').replaceAll(EN_DASH, '-');
  }

  // 4. Collapse runs of whitespace left behind by strip operations.
  output = output.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { output, contamination_detected: contamination };
}
