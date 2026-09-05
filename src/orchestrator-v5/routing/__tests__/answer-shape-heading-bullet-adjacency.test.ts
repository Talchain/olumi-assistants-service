/**
 * A SECTION HEADING KEEPS THE BULLETS UNDER IT.
 *
 * `synthesiseAnswerShapeFromText` lifted every bullet line into `bullets`, and
 * `deriveAnswerTextFromShape` re-renders `[headline, bullets, detail]` — so a
 * bullet emitted directly beneath its heading was hoisted ABOVE that heading,
 * and the heading shipped to the user with nothing under it.
 *
 * WITNESS (deployed CEE `1af54f6c`, founder journey 2026-09-05T16:52:05Z, turn
 * 10, `What would you do next?`). The reply ended:
 *
 *     Hire a Dedicated Sales Team sits in second place, with a probability of 13%.
 *
 *     What to check next
 *
 *     The analysis used a default value for …
 *
 * — a section title, then nothing but a caveat. Reproduced byte-exact through
 * these two real functions before the fix (425 chars, matching the capture's
 * shaped prefix exactly), which is why `OBSERVED_DEFECTIVE_TURN_10` below is
 * pinned as a NEGATIVE: the pipeline must never produce those bytes again.
 *
 * ⚠ `OBSERVED_DEFECTIVE_TURN_10` is a RECORD OF WHAT THE PRODUCT ONCE SAID.
 * Append to this file; never edit that string to match new behaviour.
 *
 * SCOPE, measured not asserted (809 real replies: the 2026-08-17 live corpus
 * plus this journey): 148 replies change, every one of them stranded today;
 * 290 stranded headings across those replies go to 0; zero replies gain or
 * lose a shape. The negative case below is the guard on the other direction —
 * an ordinary lead-sentence-then-list must STILL hoist its bullets.
 */
import { describe, expect, it } from 'vitest';
import {
  synthesiseAnswerShapeFromText,
  deriveAnswerTextFromShape,
} from '../answer-shape';

/** The advice gate's own template — `post-analysis-advice-gate.ts` composeAdvice. */
const ADVICE_GATE_OUTPUT =
  'Based on this model, the analysis currently favours ICP Validation Sprint Before Hiring, with a probability of 82%.'
  + ' Hire a Dedicated Sales Team sits in second place, with a probability of 13%.'
  + '\n\nWhat to check next'
  + '\n• The biggest thing to examine next is product quality, because it carries more of the margin than anything else.';

/** Shipped to a real user on 2026-09-05. Historic record — do not edit. */
const OBSERVED_DEFECTIVE_TURN_10 =
  'Based on this model, the analysis currently favours ICP Validation Sprint Before Hiring, with a probability of 82%.'
  + '\n\n• The biggest thing to examine next is product quality, because it carries more of the margin than anything else.'
  + '\n\nHire a Dedicated Sales Team sits in second place, with a probability of 13%.'
  + '\n\nWhat to check next';

/**
 * Turn 8 of the same journey, verbatim. The best passage in that run: it
 * contradicts the user's premise, separates what it can see from what they can
 * see, names a probable rendering artefact WITHOUT asserting it, and closes on
 * one specific question. Pinned so a shaping change cannot quietly reorder or
 * re-register it.
 */
const OBSERVED_TURN_8 =
  'Looking at the model, none of the strengths on the outcome or risk connections are stored as a flat 50% figure.'
  + '\n\nWhat\'s actually recorded are plain descriptions like "moderate positive link", "very strong positive link",'
  + ' or "weak negative link" between factors and things like runway risk, churn, or MRR growth. There isn\'t a numeric'
  + ' coefficient sitting behind these in what I can see, so if a display is showing 50% uniformly across the board,'
  + ' that looks like a rendering artefact rather than something the model itself set.'
  + '\n\nI\'d want to check the actual figures behind a couple of these connections before trusting that display.'
  + ' Which one would you like to look at first?';

function derive(text: string): string {
  const shape = synthesiseAnswerShapeFromText(text);
  return shape === null ? text : deriveAnswerTextFromShape(shape);
}

/** Every heading-like line must be immediately followed by a bullet. */
function strandedHeadings(text: string): string[] {
  const lines = text.split('\n');
  const bullet = /^\s*[•\-*]\s+\S/;
  const headingLike = (t: string): boolean =>
    t.length > 0
    && !bullet.test(t)
    && (t.endsWith(':') || (t.length <= 60 && !/[.!?]$/.test(t)));
  const stranded: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!headingLike(t)) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    if (j >= lines.length || !bullet.test(lines[j])) stranded.push(t);
  }
  return stranded;
}

describe('answer shape — a heading keeps its bullets', () => {
  it('the detector itself discriminates (positive and negative control)', () => {
    // Without this pair every assertion below could pass on a blind detector.
    expect(strandedHeadings('Lead.\n\n• b\n\nWhat to check next')).toEqual([
      'What to check next',
    ]);
    expect(strandedHeadings('Lead.\n\nWhat to check next\n• b')).toEqual([]);
  });

  it('does not strand `What to check next` — the deployed turn-10 defect', () => {
    const out = derive(ADVICE_GATE_OUTPUT);
    expect(strandedHeadings(out)).toEqual([]);
    expect(out).toContain(
      'What to check next\n• The biggest thing to examine next is product quality,',
    );
    // The exact bytes a real user was shown must no longer be reachable.
    expect(out).not.toBe(OBSERVED_DEFECTIVE_TURN_10);
    expect(strandedHeadings(OBSERVED_DEFECTIVE_TURN_10)).toEqual(['What to check next']);
  });

  it('keeps a heading-led bullet OUT of `bullets` while a plain bullet stays IN', () => {
    // The discriminating pair: same function, same input shape, opposite
    // outcomes — so this cannot pass on a change that simply stopped
    // extracting bullets altogether.
    const headed = synthesiseAnswerShapeFromText(ADVICE_GATE_OUTPUT);
    expect(headed).not.toBeNull();
    expect(headed?.bullets).toEqual([]);

    const plain = synthesiseAnswerShapeFromText(
      'The result is clear. It rests on two things.\n• Cost of delay.\n• Team capacity.\n\nThat is the whole picture.',
    );
    expect(plain).not.toBeNull();
    expect(plain?.bullets).toEqual(['Cost of delay.', 'Team capacity.']);
  });

  it('keeps `Options compared` with its options (146 of 146 corpus replies stranded it)', () => {
    const out = derive(
      "I've built a first decision model from your brief.\n\nOptions compared\n"
      + '• Hire a Dedicated Sales Team\n• Continue With Founder-Led Sales\n\n'
      + 'Next, run the analysis to see how the options compare.',
    );
    expect(strandedHeadings(out)).toEqual([]);
    expect(out).toContain('Options compared\n• Hire a Dedicated Sales Team');
  });

  it('keeps a colon-led lead-in with the list it promises', () => {
    const out = derive(
      'I can set that to a high level, but "high" needs an anchor. Here are three ways to define it:\n'
      + '• A monthly spend.\n• A share of total budget.\n\nWhich matches what you mean?',
    );
    expect(strandedHeadings(out)).toEqual([]);
    expect(out).toContain('define it:\n• A monthly spend.');
  });

  it('NEGATIVE — an ordinary sentence followed by a list still hoists the bullets', () => {
    // The predicate must not swallow the shape it was never aimed at. A
    // sentence-terminated lead is not a heading.
    const shape = synthesiseAnswerShapeFromText(
      'Three things stand out here.\n• Cost of delay.\n• Team capacity.\n\nEach is worth a look on its own.',
    );
    expect(shape).not.toBeNull();
    expect(shape?.bullets).toEqual(['Cost of delay.', 'Team capacity.']);
  });

  it('leaves the turn-8 passage unaltered in content and order', () => {
    const shape = synthesiseAnswerShapeFromText(OBSERVED_TURN_8);
    expect(shape).not.toBeNull();
    expect(shape?.bullets).toEqual([]);
    // No bullets, so derive() rejoins headline + detail exactly as written.
    expect(derive(OBSERVED_TURN_8)).toBe(OBSERVED_TURN_8);
    expect(derive(OBSERVED_TURN_8)).toContain('looks like a rendering artefact');
    expect(derive(OBSERVED_TURN_8)).toMatch(/Which one would you like to look at first\?$/);
  });
});
