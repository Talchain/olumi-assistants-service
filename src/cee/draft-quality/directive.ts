/**
 * THE CORRECTIVE CONTEXT FOR THE REDRAW — codes and counts only.
 *
 * Attempt 2 of a quality redraw gets ONE system-authored paragraph telling it
 * what was inadequate about attempt 1. It is the only thing that differs
 * between the two draws; the brief is byte-identical.
 *
 * ## Why codes and counts, and never labels
 *
 * This paragraph is concatenated into `systemDirective`, which the adapter
 * places OUTSIDE the `[BEGIN/END]_UNTRUSTED_USER_CONTENT` markers
 * (`adapters/llm/anthropic.ts`) so the model reads its own retry instruction
 * with SYSTEM authority. Node labels are drafted FROM the user's brief, so
 * echoing one into that region is a prompt-injection carrier. The estate
 * already drew this exact line twice — `graph-enforcement.ts` keeps validator
 * `message` strings off the wire for the same reason, and
 * `unified-pipeline/retry-directive.ts` states it at length. This module is
 * that adjudicated judgement applied again, not a new one.
 *
 * ⚠ AND THE DISTINCTION A LATER LANE WILL OTHERWISE REOPEN: the JUDGE sees
 * labels, because its projection rides in the USER message inside the untrusted
 * markers. The DIRECTIVE does not, because it rides in the system region. Same
 * data, different region, different rule. Do not "simplify" by reusing the
 * judge's projection here.
 *
 * ## ⛔ Why this is not enrichment
 *
 * It names the SHAPE of the inadequacy (coded grounds the judge returned, plus
 * counts the pipeline already computed) and never a dimension, a factor, an
 * option or any other content. It cannot: `ImpoverishmentGround` is a
 * five-member enum and the counts are integers. The closing sentence is not
 * decoration — without it the directive reads as "add more", and the cheapest
 * way to satisfy that is to invent a causal claim the brief does not support,
 * which is strictly worse than the impoverished draft it replaces.
 */

import type { DraftCoverageFacts, ImpoverishmentGround } from './types.js';

/**
 * Plain-English gloss per coded ground, in the DRAFT prompt's own vocabulary
 * (options, factors, outcomes, risks, goal).
 *
 * ⚠ A hand-written mirror of `ImpoverishmentGround`, and it is kept honest the
 * same way `retry-directive.ts` keeps its own: `satisfies Record<...>` makes it
 * TOTAL, so adding a ground to the enum fails TYPECHECK here until its sentence
 * is written. That is stronger than the sibling table (which is `Partial`) —
 * this enum is small and closed, so totality costs nothing and removes the
 * "a code disappeared from the model's view because nobody wrote its sentence"
 * failure entirely.
 */
const GROUND_GUIDANCE = {
  collapsed_dimensions:
    'every option acted through the same single consideration, so the options could only differ by one number',
  missing_options: 'courses of action the brief describes were not represented as separate options',
  missing_outcomes: 'consequences the brief treats as material were not represented',
  missing_risks: 'risks or constraints the brief states were not represented',
  off_brief: 'the model did not correspond to what the brief is about',
} satisfies Record<ImpoverishmentGround, string>;

/**
 * The rule attempt 2 has to satisfy, stated POSITIVELY and once.
 *
 * ⛔ The final sentence is load-bearing. Read `retry-directive.ts` before
 * touching it: the projector reasons the same way about the same choice
 * (FORCE IT IN / DROP IT / DISCLOSE IT — only the third is honest).
 */
const REDRAW_RULE =
  'Draft the model again from the same brief. Represent every consideration the brief actually ' +
  'states as its own factor, and connect each option to the considerations that option genuinely ' +
  'affects, so the options differ in more than one number where the brief says they do. ' +
  'Do not invent a consideration, an option or a causal link the brief does not support — leaving ' +
  'something out is better than adding a claim the user never made.';

/**
 * Build the directive, or return null when there is nothing honest to say.
 *
 * Returns null on an empty grounds list rather than emitting a contentless
 * instruction: a directive that names no defect gives attempt 2 nothing to act
 * on, and the wrapper then re-draws with byte-identical input — which is the
 * exact defect `retry-directive.ts` was written to remove.
 */
export function buildImpoverishmentDirective(
  grounds: readonly ImpoverishmentGround[],
  coverage: DraftCoverageFacts | null,
): string | null {
  if (grounds.length === 0) return null;

  const lines: string[] = [
    'A previous draft of this same model was reviewed and found not to cover the brief.',
    'What was inadequate:',
  ];
  for (const ground of grounds) {
    lines.push(`  - ${GROUND_GUIDANCE[ground]}`);
  }
  if (coverage !== null) {
    // Counts only. These are integers the pipeline already computed; none of
    // them can carry a label, an id or any user text.
    lines.push(
      `Previous draft: ${coverage.option_count} options, ${coverage.factor_count} factors, ` +
        `${coverage.causal_waist} distinct consideration(s) on any option-to-goal path.`,
    );
  }
  lines.push(REDRAW_RULE);
  return lines.join('\n');
}
