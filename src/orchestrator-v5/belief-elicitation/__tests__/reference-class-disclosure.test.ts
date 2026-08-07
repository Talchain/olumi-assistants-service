/**
 * T4 — THE PREVIEW AND THE DISCLOSURE. I3 (verbatim class), I4 (never a
 * point without its interval), I8 (confirmation is existence).
 *
 * ROADMAP 2.688 slice 1.
 *
 * ⭐ I8 IS ASSERTED WITH A CONSTRUCTOR SPY, NOT WITH absence-of-return.
 * "The preview persisted nothing" is a negative claim, and a negative claim
 * needs an instrument proven able to see a POSITIVE (CLAUDE.md trap 13). The
 * spy below is asserted to FIRE on the confirm path in the same file, so a
 * zero count on the preview path means "it did not happen", never "the
 * instrument was blind".
 */
import { describe, it, expect, vi } from 'vitest';

import {
  NOTHING_CHANGED_SENTENCE,
  NO_MODEL_EFFECT_SENTENCE,
  buildReferenceClassConfirmMessage,
  buildReferenceClassDisclosure,
  buildReferenceClassPreviewText,
  buildReferenceClassReply,
} from '../reference-class-disclosure.js';
import {
  recogniseReferenceClass,
  type ParsedReferenceClass,
} from '../reference-class-grammar.js';

const THREE_OF_SEVEN: ParsedReferenceClass = {
  class_description: "product launches like this I've seen",
  outcome_description: 'hit their first-year target',
  observed_k: 3,
  observed_n: 7,
};

describe('T4 / I4 — never a point without its interval', () => {
  it('the disclosure carries the central estimate AND both band edges', () => {
    const text = buildReferenceClassDisclosure(THREE_OF_SEVEN);
    // Known answers from the Beta(4,5) posterior (see beta-posterior.test.ts).
    expect(text).toContain('central estimate 44%');
    expect(text).toContain('between 33% and 56%');
  });

  it('EVERY count pair discloses a band — swept, not spot-checked', () => {
    for (let n = 1; n <= 25; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const text = buildReferenceClassDisclosure({
          ...THREE_OF_SEVEN,
          observed_k: k,
          observed_n: n,
        });
        expect(text).toContain('central estimate');
        expect(text).toMatch(/middle half of the evidence sits between \d+% and \d+%/);
      }
    }
  });

  it('the band is never degenerate: q25 and q75 are distinct percentages at small N', () => {
    const match = /between (\d+)% and (\d+)%/.exec(buildReferenceClassDisclosure(THREE_OF_SEVEN));
    expect(match).not.toBeNull();
    expect(Number(match![2])).toBeGreaterThan(Number(match![1]));
  });

  it('⭐ K=0 never discloses 0%, and says what the zero DOES support', () => {
    const text = buildReferenceClassDisclosure({ ...THREE_OF_SEVEN, observed_k: 0, observed_n: 7 });
    expect(text).toContain('central estimate 11%');
    expect(text).not.toContain('central estimate 0%');
    expect(text).toContain('supports a low rate, not an impossible one');
  });

  it('⭐ K=N never discloses 100%, and says what it DOES support', () => {
    const text = buildReferenceClassDisclosure({ ...THREE_OF_SEVEN, observed_k: 5, observed_n: 5 });
    expect(text).not.toContain('central estimate 100%');
    expect(text).toContain('supports a high rate, not a certain one');
  });
});

describe('T4 / I3 — the class is named VERBATIM', () => {
  it('interpolates class and outcome BYTE-IDENTICALLY', () => {
    const text = buildReferenceClassDisclosure(THREE_OF_SEVEN);
    // Byte-equality of the substring, not a case-insensitive or fuzzy match:
    // a builder that title-cased the class fails here (mutant M4).
    expect(text).toContain("Of the 7 product launches like this I've seen you cited");
    expect(text).toContain('3 hit their first-year target.');
  });

  it('preserves casing, punctuation and internal spacing exactly, for awkward inputs', () => {
    const awkward: ParsedReferenceClass = {
      class_description: 'B2B SaaS launches (EMEA, post-2019)',
      outcome_description: 'HIT their ARR target',
      observed_k: 2,
      observed_n: 9,
    };
    const text = buildReferenceClassDisclosure(awkward);
    expect(text).toContain('B2B SaaS launches (EMEA, post-2019)');
    expect(text).toContain('HIT their ARR target');
    expect(text).not.toContain('B2b Saas');
    expect(text).not.toContain('Hit Their Arr Target');
  });

  it('carries comparability caveats VERBATIM, and says the band does NOT reflect them', () => {
    const text = buildReferenceClassDisclosure({
      ...THREE_OF_SEVEN,
      comparability_caveats: 'though the market was very different back then',
    });
    expect(text).toContain('though the market was very different back then');
    expect(text).toContain('That band reflects the counts, not how comparable the cases are.');
  });

  it('applies NO comparability discount: the caveat does not move a single number', () => {
    const without = buildReferenceClassDisclosure(THREE_OF_SEVEN);
    const withCaveat = buildReferenceClassDisclosure({
      ...THREE_OF_SEVEN,
      comparability_caveats: 'though the market was very different back then',
    });
    // The numeric sentence must be byte-identical — an effective-N discount
    // would change it, and that constant is not ruled (design §3.3).
    const numericSentence = /Treating those 7 as the reference class: [^.]+\./;
    expect(numericSentence.exec(without)![0]).toBe(numericSentence.exec(withCaveat)![0]);
  });
});

describe('T4 / I8 — the preview commits nothing and says so', () => {
  it('the preview carries the commitment sentence and the honest statement of effect', () => {
    const text = buildReferenceClassPreviewText(THREE_OF_SEVEN);
    expect(text).toContain(NOTHING_CHANGED_SENTENCE);
    expect(text).toContain(NO_MODEL_EFFECT_SENTENCE);
  });

  it('⭐ CONSTRUCTOR SPY — the preview path never reaches the object constructor', async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.doMock('../reference-class-elicitation.js', async (importOriginal) => {
      // `importOriginal` spread, not a hand-listed mock: a `vi.mock` factory
      // REPLACES the module, and a hand-kept export list is the mirror defect
      // (CLAUDE.md trap 12).
      const actual = await importOriginal<
        typeof import('../reference-class-elicitation.js')
      >();
      return {
        ...actual,
        createConfirmedReferenceClass: (...args: Parameters<typeof actual.createConfirmedReferenceClass>) => {
          spy(...args);
          return actual.createConfirmedReferenceClass(...args);
        },
      };
    });

    const disclosure = await import('../reference-class-disclosure.js');
    const elicitation = await import('../reference-class-elicitation.js');

    // The preview path.
    disclosure.buildReferenceClassPreviewText(THREE_OF_SEVEN);
    disclosure.buildReferenceClassReply({ kind: 'statement', parsed: THREE_OF_SEVEN });
    expect(spy).toHaveBeenCalledTimes(0);

    // ⭐ THE POSITIVE CONTROL (trap 13): the SAME spy, proven able to fire.
    elicitation.createConfirmedReferenceClass({
      parsed: THREE_OF_SEVEN,
      session_id: 'session-1',
      stated_at: '2026-08-06T00:00:00.000Z',
    });
    expect(spy).toHaveBeenCalledTimes(1);

    vi.doUnmock('../reference-class-elicitation.js');
    vi.resetModules();
  });
});

describe('T4 — the reply: ONE assembly point for text AND chips', () => {
  it('a STATEMENT offers exactly two chips: record, and correct', () => {
    const reply = buildReferenceClassReply({ kind: 'statement', parsed: THREE_OF_SEVEN });
    expect(reply.suggested_actions.map((a) => a.id)).toEqual([
      'chip_prompt_reference_class_record',
      'chip_prompt_reference_class_correct',
    ]);
    expect(reply.assistant_text).toContain(NOTHING_CHANGED_SENTENCE);
  });

  it('⭐ ROUND TRIP — the confirm chip replays a message that re-parses to the SAME tuple', () => {
    const reply = buildReferenceClassReply({ kind: 'statement', parsed: THREE_OF_SEVEN });
    const record = reply.suggested_actions.find(
      (a) => a.id === 'chip_prompt_reference_class_record',
    );
    expect(record).toBeDefined();
    const replayed = recogniseReferenceClass(record!.message);
    expect(replayed.kind).toBe('confirm');
    if (replayed.kind !== 'confirm') return;
    expect(replayed.parsed.observed_k).toBe(THREE_OF_SEVEN.observed_k);
    expect(replayed.parsed.observed_n).toBe(THREE_OF_SEVEN.observed_n);
    expect(replayed.parsed.class_description).toBe(THREE_OF_SEVEN.class_description);
    expect(replayed.parsed.outcome_description).toBe(THREE_OF_SEVEN.outcome_description);
  });

  it('the round trip survives every count pair the grammar admits', () => {
    for (const [k, n] of [
      [0, 1],
      [1, 2],
      [3, 7],
      [9, 12],
      [5, 5],
      [17, 100],
    ] as const) {
      const parsed: ParsedReferenceClass = { ...THREE_OF_SEVEN, observed_k: k, observed_n: n };
      const replayed = recogniseReferenceClass(buildReferenceClassConfirmMessage(parsed));
      expect(replayed.kind).toBe('confirm');
      if (replayed.kind !== 'confirm') continue;
      expect(replayed.parsed.observed_k).toBe(k);
      expect(replayed.parsed.observed_n).toBe(n);
    }
  });

  it('a CLARIFY offers NO chip — the system does not invite confirming counts it lacks', () => {
    const reply = buildReferenceClassReply({
      kind: 'clarify',
      reason: 'k_exceeds_n',
      question: 'How many cases were there in total?',
    });
    expect(reply.suggested_actions).toEqual([]);
    expect(reply.assistant_text).toBe('How many cases were there in total?');
  });

  it('refuses to assemble a reply for a non-recognition', () => {
    expect(() => buildReferenceClassReply({ kind: 'none' })).toThrow(/no recognition/);
  });
});
