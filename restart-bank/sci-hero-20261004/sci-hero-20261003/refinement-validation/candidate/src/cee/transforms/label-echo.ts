/**
 * CEE-6 echo rule, stated ONCE — now in its own module.
 *
 * A display string must not simply repeat the factor's label (e.g. "Marketing
 * Expertise" as the display for the "Marketing Expertise" factor). Strip only
 * when the candidate IS the label or fully CONTAINS it — never when the label
 * contains the candidate, which would discard valid qualitative band output
 * ("High (0.7)" for a factor labelled "High Risk").
 *
 * Guard against an empty label: `String.includes("")` is always true, which
 * would strip every supplied display value for unlabelled nodes.
 *
 * ⚠ This predicate had FOUR call sites and was hand-copied at three of them.
 * A rule a human must remember to keep in step across copies is the
 * hand-maintained mirror this estate keeps paying for (CLAUDE.md trap 12), so
 * it is derived from one definition rather than restated per site.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT MOVED OUT OF `analysis-ready.ts` (ROADMAP 2.384, 27 Aug 2026)
 *
 * A SIXTH consumer arrived from a different layer: the band-vocabulary refusal
 * in `orchestrator-v5/compose/validation-failure-responses.ts`, which quotes a
 * factor's display string back at the user in a recovery sentence. Review
 * measured that consumer applying NEITHER of the blocker's guards, and it
 * emitted `"CRM Annual Licence Cost" is CRM Annual Licence Cost just now.` —
 * a label echoed back as its own value, which is precisely what this predicate
 * exists to prevent.
 *
 * ⭐ The fix could have been a fifth hand-copy in `compose/`. That is the exact
 * failure this header already warned about, so the definition moved here
 * instead: `analysis-ready.ts` and the compose consumer now import ONE
 * function. A module with no dependencies of its own can be imported from any
 * layer without a cycle, which is what makes sharing possible rather than
 * merely desirable.
 */
export function isLabelEcho(factorLabelLower: string, candidate: string): boolean {
  if (factorLabelLower === "") return false;
  const lowered = candidate.toLowerCase().trim();
  return lowered === factorLabelLower || lowered.includes(factorLabelLower);
}
