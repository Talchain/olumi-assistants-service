/**
 * ⭐ ROADMAP 2.427 — CLOSE THE LLM-SUGGESTION LOOP.
 *
 * The 2.11 diagnosis named the defect once and it has kept coming back in new
 * clothes: *"the assistant suggests phrasings that cannot return to the lane
 * that suggested them: a closed loop, minted by the product's own copy."*
 *
 * 2.11 / P1-3 closed it for the DETERMINISTIC copy surfaces — the misroute
 * clarify and the GM needs-encoding notice — with a contract test that derives
 * the advised exemplars from the shipped copy and runs the shipped detector
 * over each. That test is real and it still bites. **It is also blind to the
 * one surface that produces most of the advice a user actually reads.**
 *
 * On the no-op branch, `edit-graph.ts` PRESERVES the edit LLM's own
 * `coaching.summary` into `assistant_text` (the R10 preservation path). That
 * prose is unbounded, it is written by a model that has been taught the
 * product's vocabulary only approximately, and it routinely advises a phrasing
 * — and NOTHING checked that the advised phrasing routes. A contract test over
 * deterministic copy cannot see it, because the copy is not in the repo: it
 * arrives at runtime.
 *
 * So the check has to be a PRODUCTION predicate, and this module is it. The
 * extractor below is the SAME one the 2.11 contract test used; it has been
 * lifted out of the test file into production so the test now imports the
 * shipped extractor rather than keeping a second copy of it (trap 12 — the
 * test/prod pair was itself a hand-maintained mirror waiting to drift).
 *
 * ⚠ SCOPE, deliberately narrow, and this is the load-bearing design decision.
 * Requiring EVERY quoted phrase in LLM prose to route would be wrong and would
 * regress a working feature: an edit-lane clarifying question legitimately
 * quotes factor names, values and plain words (`say "yes" to confirm`), none of
 * which are configure-option advice and none of which the configure gate owns.
 * The predicate therefore fires on exactly one class — advice that REFERS TO AN
 * OPTION and does not route — because that is the class where a non-routing
 * suggestion is, by construction, the closed loop. The option reference is
 * decided by the detector's OWN anchor notion (the literal word "option", or a
 * label from the current graph), not by a second spelling of it.
 */

import { detectConfigureOptionIntent } from './configure-option-intent.js';
import { containsPhrase } from './option-intervention-guard.js';

/**
 * "option"/"options" — the detector's own literal anchor. Kept byte-identical
 * to `OPTION_WORD` in `configure-option-intent.ts`; the two are asserted equal
 * by `configure-option-advice.test.ts` rather than shared, because exporting a
 * regex with `lastIndex` state across modules is its own hazard.
 */
const OPTION_WORD = /\boptions?\b/;

/**
 * Extract every advised exemplar from a piece of assistant copy: a straight-
 * quoted ('…' or "…") phrase introduced by "say" or "for example".
 *
 * This is the copy grammar every advised site in the product uses. Extraction
 * from the LIVE text — rather than a list of known phrasings — is what makes
 * the contract derived rather than mirrored.
 *
 * HONEST LIMIT, stated because an absence claim from this function is only as
 * wide as its grammar: advice phrased WITHOUT the "say"/"for example" lead-in
 * and without quotes is invisible here. That is a deliberate floor, not an
 * oversight — a wider extractor would start claiming ordinary prose as advice
 * and the false-positive cost is a preserved clarifying question thrown away.
 * The positive control in the test suite pins what the grammar does see.
 *
 * ⚠ THE POSSESSIVE APOSTROPHE, and why the single-quote branch is not the
 * obvious `'([^']+)'`. The product's OWN advised format is
 * `Set the <option> option's effect on <factor> to <value>` — it contains an
 * apostrophe. A naive single-quote extractor terminates on it and yields the
 * TRUNCATED fragment "Set the Cloud-Native CRM option", which does not route —
 * so the guard would have reported the product's own sanctioned advice as a
 * closed loop and thrown away a working reply. Caught by execution, not by
 * inspection: the guard was correct and pointed at the wrong bytes. An
 * apostrophe followed by a word character is therefore treated as part of the
 * exemplar, never as its terminator.
 *
 * ⚠ SMART QUOTES ARE HANDLED, NOT MERELY DOCUMENTED (adversarial review of
 * `572f7ea9`). LLM prose routinely emits typographic quotes — `‘…’`, `“…”` —
 * and an extractor that saw only ASCII would go silently blind on exactly the
 * copy this guard exists to police, which is the worse failure direction here:
 * broken advice ships unnoticed. The curly-single branch needs the same
 * possessive escape as the ASCII one, and needs it MORE, because U+2019 is both
 * the closing quote and the correct typographic apostrophe — `‘Set the X
 * option’s effect…’` is genuinely ambiguous, and the same "followed by a word
 * character" rule resolves it the way a reader does.
 */
export function extractAdvisedExemplars(copy: string): string[] {
  if (typeof copy !== 'string') return [];
  const out: string[] = [];
  const pattern =
    /(?:\bsay\b|\bfor example\b)[,:]?\s+(?:'((?:[^']|'(?=\w))+)'|"([^"]+)"|‘((?:[^’]|’(?=\w))+)’|“([^”]+)”)/gi;
  for (const m of copy.matchAll(pattern)) {
    const exemplar = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (typeof exemplar === 'string' && exemplar.trim().length > 0) {
      out.push(exemplar.trim());
    }
  }
  return out;
}

/**
 * Does this exemplar refer to an option at all?
 *
 * The word "option(s)", or one of the CURRENT graph's option labels — the same
 * two anchors `detectConfigureOptionIntent` itself accepts. An exemplar with
 * neither is not configure-option advice and this module has no opinion on it.
 */
function refersToAnOption(normalised: string, optionLabels: readonly string[]): boolean {
  if (OPTION_WORD.test(normalised)) return true;
  const padded = ` ${normalised} `;
  for (const raw of optionLabels) {
    if (typeof raw !== 'string') continue;
    const label = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (label.length >= 3 && containsPhrase(padded, label)) return true;
  }
  return false;
}

/**
 * The closed-loop detector: return the first advised exemplar that names an
 * option and that the product would then REFUSE to route, or `null` when the
 * copy advises nothing of that class.
 *
 * A non-null result means the text is about to tell the user to type a sentence
 * the configure gate does not accept — i.e. the user is being sent back into
 * the loop by the product's own suggestion. Callers decline to ship the text.
 */
export function findNonRoutableConfigureAdvice(
  text: string,
  optionLabels: readonly string[],
): string | null {
  for (const exemplar of extractAdvisedExemplars(text)) {
    const normalised = exemplar.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!refersToAnOption(normalised, optionLabels)) continue;
    if (!detectConfigureOptionIntent(exemplar, optionLabels).matched) return exemplar;
  }
  return null;
}
