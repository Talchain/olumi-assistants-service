/**
 * Unit matrix for the round-1 process-meta intake guard
 * (META-DECISION-DIAGNOSIS-2026-07-20).
 *
 * ANTI-MIRROR DISCIPLINE (trap 12): the spark strings below are pinned
 * BYTE-VERBATIM from DecisionGuideAI
 * `src/canvas/components/pre-analysis-v3/constants.ts` (ACTIONS_MENU +
 * SPARK_PROMPTS; staging tip 8007d03d, 2026-07-20) as independent string
 * LITERALS — deliberately NOT imported from the mechanism module, so an
 * edit to the mechanism's list that drops or mangles a prompt goes RED
 * here. A UI-side counterpart contract test (every spark ships explicit
 * intent metadata) is EXPECTED from the UI spark lane but did not exist
 * at UI tip 2e5abdb1 (REVIEW-575 C2 — tracked with that lane).
 *
 * PRECISION BIAS: the negative cases below are the guard's contract too.
 * Over-blocking a genuine decision brief is a WORSE defect than the
 * misroute this guard fixes.
 */
import { describe,expect,it } from 'vitest';


import { isDraftShapedText } from '../../../schemas/assist.js';

/** Byte-verbatim UI prompt list (see file header). */
const UI_SPARK_PROMPTS: readonly string[] = [
  // ACTIONS_MENU (constants.ts:262-303)
  'Is this the right question to be asking, and does it fit my wider goals?',
  'Suggest materially different options that work through a different mechanism from the ones I already have.',
  'Take the outside view on this decision: what do similar decisions and base rates suggest?',
  'Run a pre-mortem with me: imagine this choice failed a year from now. What went wrong?',
  'What risks and best-case upsides are missing from my model?',
  'Help me check the estimates that matter most to the analysis.',
  'Compare my view of this decision with yours. Where do we differ, and why?',
  'What should I check before running the first analysis?',
  // SPARK_PROMPTS additions (constants.ts:305-334)
  'Help me define a measurable success target for this goal.',
  'You flagged a possible blind spot in how my model leans. Help me think it through.',
];







describe('shape relationship with the draft heuristic', () => {
  // The misroute class: sparks that ALSO satisfy isDraftShapedText — these
  // are exactly the prompts that drafted meta-graphs before the guard.
  const DRAFT_SHAPED_SPARKS = UI_SPARK_PROMPTS.filter((p) => isDraftShapedText(p));

  /**
   * ⚠ THIS ASSERTION MOVED WITH ROADMAP 2.715, AND THE DIRECTION IS THE POINT.
   *
   * It used to read `>= 6`, including 'What should I check before running the
   * first analysis?'. Five of those six overlapped ONLY through the draft
   * regex's `\?$` arm — the arm 2.715 exists to invert. `isDraftShapedText`
   * now refuses a question TO the assistant outright, so the misroute class
   * this mirror has to catch has SHRUNK from six to three: the string mirror
   * is no longer the only thing standing between a typed coaching question
   * and a meta-graph.
   *
   * It is not weakened to nothing, and it must not be: the three below are
   * imperative or declarative sparks that carry a decision verb, so the shape
   * predicate cannot see them and the mirror is still load-bearing for them.
   * Pinned as an EXACT set, not a floor, so a further shrink is visible
   * rather than silently tolerated.
   */
  it('exactly the three NON-interrogative sparks still overlap the draft heuristic', () => {
    expect([...DRAFT_SHAPED_SPARKS].sort()).toEqual(
      [
        'Compare my view of this decision with yours. Where do we differ, and why?',
        'Run a pre-mortem with me: imagine this choice failed a year from now. What went wrong?',
        'Take the outside view on this decision: what do similar decisions and base rates suggest?',
      ].sort(),
    );
  });




});
