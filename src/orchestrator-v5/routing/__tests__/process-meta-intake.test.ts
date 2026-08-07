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
import { describe, it, expect } from 'vitest';

import {
  isProcessMetaIntake,
  PRODUCT_COACHING_PROMPTS,
  PROCESS_META_TYPED_PATTERN,
  composeProcessMetaIntakeResponse,
  PROCESS_META_ANSWER_MARKER,
} from '../process-meta-intake.js';
import { isDraftShapedText } from '../../../schemas/assist.js';
import {
  findForbiddenPhraseHit,
} from '../../compose/forbidden-user-facing-phrases.js';

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

describe('isProcessMetaIntake — product-authored prompts', () => {
  for (const prompt of UI_SPARK_PROMPTS) {
    it(`claims spark: ${JSON.stringify(prompt.slice(0, 50))}…`, () => {
      expect(isProcessMetaIntake(prompt)).toBe(true);
    });
  }

  it('the mechanism list carries every pinned UI prompt (drift check)', () => {
    for (const prompt of UI_SPARK_PROMPTS) {
      expect(PRODUCT_COACHING_PROMPTS).toContain(prompt);
    }
  });

  it('matching is whitespace/case-normalised but not fuzzy', () => {
    expect(
      isProcessMetaIntake('  what should i check before running the first analysis?  '),
    ).toBe(true);
    expect(
      isProcessMetaIntake('What  should I check\nbefore running the first analysis?'),
    ).toBe(true);
  });
});

describe('isProcessMetaIntake — narrow typed variants', () => {
  const TYPED_META: readonly string[] = [
    'What should I check before running the first analysis?',
    'What should I do before I run the analysis?',
    'What do I need to have before the first analysis?',
    'What data do I need before the analysis?',
    'Is there anything I should review before running the analysis?',
    // REVIEW-575-2026-07-20 C1 under-capture: the ORIGINAL defect string
    // minus the trailing "?" reproduced the meta-draft end-to-end. Arm A
    // accepts the interrogative-opener form without a question mark.
    'What should I check before I run my first analysis',
    'What should I check before running the first analysis',
    'How does the analysis work?',
    'How does this model work?',
    'How does Olumi work?',
    'Can you explain how the analysis works?',
  ];
  for (const q of TYPED_META) {
    it(`claims typed variant: ${JSON.stringify(q)}`, () => {
      expect(isProcessMetaIntake(q)).toBe(true);
    });
  }
});

describe('isProcessMetaIntake — precision (genuine briefs must NOT match)', () => {
  const GENUINE_BRIEFS: readonly string[] = [
    // The diagnosis' canonical positive control.
    'Should I hire a founding engineer or contract the build out?',
    'Should we expand the product into the German market next quarter or hold?',
    // Analysis-adjacent nouns inside genuine decision content.
    'Should we invest in a new analytics platform for the finance team?',
    'Should I license my model to a competitor or keep it in-house?',
    'Should we hire a data analyst to run our analysis or outsource it?',
    // Decision-verb questions with "before" but no process referent.
    'What should I check before buying the house?',
    'What should we do before the merger: sell the warehouse or lease it?',
    // Domain "model"/"work" words without the product-process construction.
    "How does the competitor's pricing model work?",
    // Decision-verb opener referencing analysis timing — falls toward
    // draft by design (opener is a decision verb, not an accepted arm
    // opener).
    'Should we run the analysis before hiring?',
    'Whether to launch in Q3 or hold for Q4?',
    // ── REVIEW-575-2026-07-20 C1 over-capture cases 1–5, pinned RED-first
    // (each was CLAIMED by the pre-tightening arms; each is a plausible
    // genuine first message). ──
    // Case 1 — Arm B: "analysis work" is a noun compound (the user's lab
    // work), and the question ends with the decision clause, not "work?".
    'How does the analysis work at our lab affect which vendor we choose?',
    // Case 2 — Arm A: "model" is the user's own option content after
    // "before the acquisition", not the object of "before"; the message
    // even lists the user's two options.
    'What do we need to check before the acquisition: the model of their finances or their contracts?',
    // Case 3 — Arm A: domain noun "data analysis" after "before".
    'What should I review before choosing a vendor for data analysis?',
    // Case 4 — Arm A: "analysis provider" is a domain compound.
    'What do I need to know before switching our analysis provider from Gartner to Forrester?',
    // Case 5 — Arm A: "which" opener + domain compound "merger analysis".
    'Which contracts do we need to review before the merger analysis call with the bankers?',
  ];
  for (const brief of GENUINE_BRIEFS) {
    it(`does NOT claim: ${JSON.stringify(brief.slice(0, 50))}…`, () => {
      expect(isProcessMetaIntake(brief)).toBe(false);
    });
  }

  it('empty / non-string-ish inputs are refused', () => {
    expect(isProcessMetaIntake('')).toBe(false);
    expect(isProcessMetaIntake('   ')).toBe(false);
  });
});

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

  it('2.715: the interrogative sparks are now refused by the SHAPE predicate, '
    + 'not only by the string mirror', () => {
    for (const prompt of [
      'What should I check before running the first analysis?',
      'What risks and best-case upsides are missing from my model?',
      'Is this the right question to be asking, and does it fit my wider goals?',
    ]) {
      expect(isDraftShapedText(prompt)).toBe(false);
      // ...and the mirror still claims them, so the deterministic answer branch
      // (which keys on isProcessMetaIntake, not on the shape) is unaffected.
      expect(isProcessMetaIntake(prompt)).toBe(true);
    }
  });

  it('the typed pattern requires a single interrogative sentence', () => {
    // Internal '?' (two questions) falls through — narrow by design.
    expect(
      PROCESS_META_TYPED_PATTERN.test(
        'What should I check before the analysis? And should we expand to Leeds?',
      ),
    ).toBe(false);
    // A trailing second SENTENCE after the process object falls through
    // (the compound may carry a genuine brief — precision bias).
    expect(
      PROCESS_META_TYPED_PATTERN.test(
        'What should I check before running the first analysis. Also whether to expand to Leeds.',
      ),
    ).toBe(false);
    // An imperative without an interrogative opener falls through even
    // with the process object present (REVIEW-575 C1 keeps the no-"?"
    // allowance opener-gated).
    expect(
      PROCESS_META_TYPED_PATTERN.test('Tell me what to check before running the analysis.'),
    ).toBe(false);
  });
});

describe('composeProcessMetaIntakeResponse', () => {
  it('carries the stable marker, frame stage, and NO suggested actions', () => {
    const res = composeProcessMetaIntakeResponse();
    expect(res.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
    expect(res.stage_indicator).toBe('frame');
    // No chips: the only available draft-offer seed on this state is the
    // meta-question itself — the poisoned brief this guard exists to
    // prevent.
    expect(res.suggested_actions).toEqual([]);
    expect(res.response_version).toBe(2);
  });

  it('answer copy is clear of the egress forbidden-phrase list', () => {
    const res = composeProcessMetaIntakeResponse();
    expect(findForbiddenPhraseHit(res.assistant_text ?? '')).toBeNull();
  });

  it('house style: no em dashes in user-facing copy', () => {
    const res = composeProcessMetaIntakeResponse();
    expect(res.assistant_text).not.toMatch(/—/);
  });
});
