/**
 * Narrate-mode output sanitiser (addendum §2.1.4).
 *
 * Strips XML-like tags and em-dashes; flags (does not rewrite) banned internal
 * terms. The sanitiser is non-fatal: contamination is stripped or flagged
 * in-band and the response is still a success (BI-02). A telemetry event is
 * emitted upstream so we can track contamination rate without surfacing it to
 * the user.
 *
 * Banned-term behaviour mirrors V4 `src/orchestrator/deterministic/
 * sanitise-output.ts` (log + flag, do NOT rewrite): rewriting risks mangled
 * sentences where a word like "patch" is a legitimate noun. Flag-only keeps
 * text integrity while giving us observability.
 */

// Match anything that looks like an XML / pseudo-XML tag. Conservative — we
// strip the whole tag, including malformed closers, and keep inner text.
// Example: "<thinking>hidden</thinking>" → "hidden".
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

// Ported from V4 `sanitise-output.ts:19`. Narrow list targeting user-facing
// prose leaks; broader internal-jargon scanning lives in V4's
// response-normaliser and is out of A1 scope (A1 only emits assistant_text).
const BANNED_TERMS = /\b(interventions|graph_patch|patch|operation)\b/i;

// "node" in non-technical context — only flag when NOT preceded by a
// graph-modelling qualifier that makes it legitimate. Mirrors V4 precedent.
const NODE_TERM = /(?<!\bfactor |option |goal |decision |risk )(\bnode\b)/i;

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

  // 2. Flag banned terms (V4 parity — no rewrite). Test on the already-stripped
  //    text so XML tag names like <patch> don't double-count.
  if (BANNED_TERMS.test(output) || NODE_TERM.test(output)) {
    contamination = true;
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
