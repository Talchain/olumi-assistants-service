/**
 * T1 / T3 — THE GRAMMAR, in BOTH directions, and the refusal taxonomy.
 *
 * ROADMAP 2.688 slice 1 (+ its guard 2.722).
 *
 * ⭐ TWO KINDS OF GUARD, SHIPPED TOGETHER (CLAUDE.md trap 12d). The negative
 * corpus below has a DERIVED half and a HAND-WRITTEN half, and neither
 * supersedes the other:
 *   - DERIVED: `PRODUCT_COACHING_PROMPTS` is imported from its canonical
 *     definition, so every prompt the product ships — including the ones
 *     added after this file was written — is asserted not to trigger. That
 *     can notice a CONSUMER drifting from the list.
 *   - HAND-WRITTEN: the rate-without-counts, bare-fraction and
 *     numbers-without-a-class rows. Only a corpus can notice the recogniser
 *     is too EAGER on a shape nobody enumerated.
 *
 * ⭐ EVERY POSITIVE ROW IS BOUND BY IDENTITY (trap 19): each asserts the
 * EXACT `(K, N, class, outcome)` tuple, not "some parse happened" and not a
 * value predicate another parse could satisfy. A recogniser that returned
 * K and N transposed, or that captured the whole sentence as the class,
 * fails every row.
 */
import { describe, it, expect } from 'vitest';

import { PRODUCT_COACHING_PROMPTS } from '../../routing/process-meta-intake.js';
import {
  REFERENCE_CLASS_CONFIRM_PREFIX,
  isReferenceClassCollapseHazard,
  recogniseReferenceClass,
} from '../reference-class-grammar.js';

interface PositiveRow {
  readonly id: string;
  readonly message: string;
  readonly k: number;
  readonly n: number;
  readonly class_description: string;
  readonly outcome_description: string;
}

/**
 * The POSITIVE corpus. Each row's expected tuple is what the sentence
 * literally says — derived from the user's words, never from what the
 * implementation happens to produce.
 */
const POSITIVES: readonly PositiveRow[] = [
  {
    id: 'n-first-of',
    message:
      "Of the 7 product launches like this I've seen, 3 hit their first-year target",
    k: 3,
    n: 7,
    class_description: "product launches like this I've seen",
    outcome_description: 'hit their first-year target',
  },
  {
    id: 'k-of-n-inline',
    message: '3 out of 7 similar projects succeeded',
    k: 3,
    n: 7,
    class_description: 'similar projects',
    outcome_description: 'succeeded',
  },
  {
    id: 'experience-semicolon',
    message: "we've run 12 campaigns; 9 landed",
    k: 9,
    n: 12,
    class_description: 'campaigns',
    outcome_description: 'landed',
  },
  {
    id: 'experience-comma',
    message: "I've seen 20 rollouts, 4 failed",
    k: 4,
    n: 20,
    class_description: 'rollouts',
    outcome_description: 'failed',
  },
  {
    id: 'k-of-n-zero',
    message: '0 out of 7 comparable migrations delivered on time',
    k: 0,
    n: 7,
    class_description: 'comparable migrations',
    outcome_description: 'delivered on time',
  },
  {
    id: 'k-equals-n',
    message: '5 out of 5 pilots we ran converted',
    k: 5,
    n: 5,
    class_description: 'pilots we ran',
    outcome_description: 'converted',
  },
];

describe('T1 positives — the exact (K, N, class, outcome) tuple, bound by identity', () => {
  it.each(POSITIVES)(
    '$id: "$message" parses to K=$k N=$n',
    ({ message, k, n, class_description, outcome_description }) => {
      const recognition = recogniseReferenceClass(message);
      expect(recognition.kind).toBe('statement');
      if (recognition.kind !== 'statement') return;
      expect(recognition.parsed.observed_k).toBe(k);
      expect(recognition.parsed.observed_n).toBe(n);
      // BYTE-EQUALITY, not `toContain` — a recogniser that captured the whole
      // sentence would satisfy a contains() predicate (trap 19).
      expect(recognition.parsed.class_description).toBe(class_description);
      expect(recognition.parsed.outcome_description).toBe(outcome_description);
    },
  );

  it('K and N are not transposable: the smaller count is K only because the sentence says so', () => {
    // "9 landed" out of 12 run — K > N would be the naive reading if the
    // pattern grabbed integers in document order.
    const recognition = recogniseReferenceClass("we've run 12 campaigns; 9 landed");
    expect(recognition.kind).toBe('statement');
    if (recognition.kind !== 'statement') return;
    expect(recognition.parsed.observed_n).toBe(12);
    expect(recognition.parsed.observed_k).toBe(9);
  });

  it('captures comparability caveats VERBATIM when the user offers one', () => {
    const recognition = recogniseReferenceClass(
      '3 out of 7 similar projects succeeded, though the market was very different back then',
    );
    expect(recognition.kind).toBe('statement');
    if (recognition.kind !== 'statement') return;
    expect(recognition.parsed.comparability_caveats).toBe(
      'though the market was very different back then',
    );
  });

  it('omits the caveat field entirely when none was offered', () => {
    const recognition = recogniseReferenceClass('3 out of 7 similar projects succeeded');
    expect(recognition.kind).toBe('statement');
    if (recognition.kind !== 'statement') return;
    expect(recognition.parsed.comparability_caveats).toBeUndefined();
  });
});

/**
 * The HAND-WRITTEN negative corpus (trap 12d's other half). Every row is a
 * shape a too-eager recogniser would grab.
 */
const HAND_WRITTEN_NEGATIVES: readonly { readonly id: string; readonly message: string }[] = [
  // I5 — a stated RATE carries no N. Refused into this machinery entirely.
  { id: 'rate-only', message: 'about 40% of launches like this succeed' },
  { id: 'rate-only-2', message: '40% of similar projects succeeded' },
  { id: 'rate-threshold', message: '3% churn is pretty likely' },
  // Bare fractions — probability expressions, NOT reference classes. These
  // are the rows that keep `elicitBelief("3 in 4") -> 0.75` intact.
  { id: 'bare-fraction-in', message: '3 in 4' },
  { id: 'bare-fraction-chance', message: '3 in 4 chance' },
  { id: 'bare-fraction-slash', message: '3/4' },
  { id: 'bare-fraction-odds', message: '1 in 10 chance of failure' },
  // Numbers with no class-and-outcome structure at all.
  { id: 'counts-no-class', message: '7 options, 3 factors' },
  { id: 'counts-inventory', message: 'I have 7 factors and 3 options on the canvas' },
  // Calibration's own territory — must reach the calibration pre-route.
  { id: 'calibration-set', message: 'Set AI Chatbot Deployment to pretty likely.' },
  {
    id: 'calibration-threshold',
    message:
      'I think monthly churn staying below 3% in December is pretty likely. Please set that estimate and show me the number you will use before applying it.',
  },
  // Ordinary conversation.
  { id: 'plain-question', message: 'What should I check before running the analysis?' },
  { id: 'plain-statement', message: 'Add a risk about supplier delays.' },
];

describe('T1 negatives — HAND-WRITTEN corpus (notices an over-eager recogniser)', () => {
  it.each(HAND_WRITTEN_NEGATIVES)('$id: "$message" is NOT recognised', ({ message }) => {
    expect(recogniseReferenceClass(message).kind).toBe('none');
  });
});

describe('T1 negatives — DERIVED corpus (notices a consumer drifting from the list)', () => {
  it('no product coaching prompt triggers the recogniser', () => {
    // Derived from the canonical constant, so prompts added later are covered.
    expect(PRODUCT_COACHING_PROMPTS.length).toBeGreaterThan(0);
    for (const prompt of PRODUCT_COACHING_PROMPTS) {
      expect(recogniseReferenceClass(prompt).kind).toBe('none');
    }
  });

  it('including the outside-view prompt itself — the ASK must not be read as an ANSWER', () => {
    const outsideView = PRODUCT_COACHING_PROMPTS.find((p) => p.startsWith('Take the outside view'));
    expect(outsideView).toBeDefined();
    expect(recogniseReferenceClass(outsideView!).kind).toBe('none');
  });
});

describe('T3 — the refusal taxonomy: ask, never guess', () => {
  it('K > N CLARIFIES — never swaps, never clamps', () => {
    const recognition = recogniseReferenceClass('9 out of 3 similar projects succeeded');
    expect(recognition.kind).toBe('clarify');
    if (recognition.kind !== 'clarify') return;
    expect(recognition.reason).toBe('k_exceeds_n');
    expect(recognition.question.length).toBeGreaterThan(0);
  });

  it('N = 0 CLARIFIES rather than dividing by an empty class', () => {
    const recognition = recogniseReferenceClass('0 out of 0 similar projects succeeded');
    expect(recognition.kind).toBe('clarify');
    if (recognition.kind !== 'clarify') return;
    expect(recognition.reason).toBe('n_not_positive');
  });

  it('VAGUE COUNTS clarify, and the question asks for the two integers', () => {
    const recognition = recogniseReferenceClass(
      'about half of a dozen or so similar projects succeeded',
    );
    expect(recognition.kind).toBe('clarify');
    if (recognition.kind !== 'clarify') return;
    expect(recognition.reason).toBe('vague_counts');
    expect(recognition.question.toLowerCase()).toContain('how many');
  });

  it('a clarify carries NO parse — there is nothing to record', () => {
    const recognition = recogniseReferenceClass('9 out of 3 similar projects succeeded');
    expect(recognition).not.toHaveProperty('parsed');
  });

  it('I5 — a rate never acquires an effective N: no synthesised counts anywhere', () => {
    for (const message of [
      'about 40% of launches like this succeed',
      '40% of similar projects succeeded',
      'roughly a third of comparable migrations delivered on time',
    ]) {
      const recognition = recogniseReferenceClass(message);
      expect(recognition).not.toHaveProperty('parsed');
      expect(recognition.kind === 'none' || recognition.kind === 'clarify').toBe(true);
    }
  });

  it('empty and whitespace input are not recognised', () => {
    expect(recogniseReferenceClass('').kind).toBe('none');
    expect(recogniseReferenceClass('   ').kind).toBe('none');
  });
});

describe('the confirm prefix — confirmation is structural (I8)', () => {
  it('a message bearing the prefix parses as CONFIRM, with the same tuple', () => {
    const recognition = recogniseReferenceClass(
      `${REFERENCE_CLASS_CONFIRM_PREFIX} of the 7 product launches like this, 3 hit their first-year target.`,
    );
    expect(recognition.kind).toBe('confirm');
    if (recognition.kind !== 'confirm') return;
    expect(recognition.parsed.observed_k).toBe(3);
    expect(recognition.parsed.observed_n).toBe(7);
    expect(recognition.parsed.class_description).toBe('product launches like this');
    expect(recognition.parsed.outcome_description).toBe('hit their first-year target');
  });

  it('the SAME sentence WITHOUT the prefix is a STATEMENT, never a confirm', () => {
    const recognition = recogniseReferenceClass(
      'of the 7 product launches like this, 3 hit their first-year target.',
    );
    expect(recognition.kind).toBe('statement');
  });

  it('the prefix alone, with no counts, confirms nothing', () => {
    expect(recogniseReferenceClass(REFERENCE_CLASS_CONFIRM_PREFIX).kind).toBe('none');
  });
});

describe('isReferenceClassCollapseHazard — the 2.722 predicate', () => {
  it('is TRUE for every count-bearing statement in the positive corpus', () => {
    for (const row of POSITIVES) {
      expect(isReferenceClassCollapseHazard(row.message)).toBe(true);
    }
  });

  it('⭐ is FALSE for every bare fraction — the existing probability parses are untouched', () => {
    for (const expression of ['3 in 4', '3 out of 4', '3/4', '1 in 10', '3 in 4 chance']) {
      expect(isReferenceClassCollapseHazard(expression)).toBe(false);
    }
  });

  it('is FALSE for the whole hand-written negative corpus', () => {
    for (const row of HAND_WRITTEN_NEGATIVES) {
      expect(isReferenceClassCollapseHazard(row.message)).toBe(false);
    }
  });

  it('is FALSE for a clarify — an unusable attempt is not a collapse hazard for a point parser', () => {
    expect(isReferenceClassCollapseHazard('9 out of 3 similar projects succeeded')).toBe(false);
  });
});
