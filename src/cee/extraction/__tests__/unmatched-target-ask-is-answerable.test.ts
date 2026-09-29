import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * ⛔⛔ THE ASK THE USER COULD NOT ANSWER.
 *
 * Measured on a real staging draw (run 7, `output/grammar-baseline-20260923/`):
 * the option `Raise Pro Plan from £49 to £59` came back `needs_user_mapping`
 * with `unresolved_targets: ["49"]`, and the product asked:
 *
 *     Which factor does "49" correspond to in the decision model?
 *
 * …while a factor called **Pro Plan Price** sat in the same graph.
 *
 * `"49"` is not a thing the user named. `intervention-extractor.ts` reaches this
 * branch ONLY when the drafter supplied no intervention, and then tokenises the
 * option's own label — so `target_text` here is always OUR OWN READING.
 *
 * The product charter: *"Olumi is explicit about what it knows, what it inferred
 * and where its limits are… open to correction."* An ask that quotes our own
 * token as though the user had chosen it is neither explicit nor correctable.
 *
 * ⚠ THIS IS A SOURCE-LEVEL PIN, deliberately. The question is one string literal
 * in one branch of a 1,400-line extractor whose call needs a full V3 graph, a
 * drafted option and the legacy no-intervention path. Reaching it through the
 * real function would be a fixture standing in for the wire; pinning the literal
 * asserts exactly what ships and nothing more. What it CANNOT prove is that the
 * branch is reached — that is measured, and recorded above.
 */
const SOURCE = readFileSync(
  new URL('../intervention-extractor.ts', import.meta.url),
  'utf8',
);

/** The one branch under test: the "not matched" arm's `userQuestions.push`. */
const UNMATCHED_ASK = (() => {
  const marker = 'could not tie it to a factor';
  const idx = SOURCE.indexOf(marker);
  if (idx === -1) return '';
  const start = SOURCE.lastIndexOf('`', idx);
  const end = SOURCE.indexOf('`', idx);
  return SOURCE.slice(start, end + 1);
})();

describe('the unmatched-target ask', () => {
  it('the probe found the ask (this suite is not vacuous)', () => {
    // Trap 13: an empty extraction agrees with every assertion below.
    expect(UNMATCHED_ASK.length).toBeGreaterThan(40);
  });

  it('⛔ the old, unanswerable wording survives ONLY as a comment', () => {
    // The contrast control: if the old string comes back as live copy, every
    // other check here could still pass while the user gets the dead end.
    //
    // It is deliberately still PRESENT once — the branch's own docblock quotes
    // it, so the next reader knows what was wrong and why. So the assertion is
    // not "absent" but "not executable": every occurrence must sit on a comment
    // line. Asserting absence would force the explanation to be deleted.
    const lines = SOURCE.split('\n').filter((l) => l.includes('correspond to in the decision model'));
    expect(lines.length).toBeGreaterThan(0);   // the probe sees it
    for (const line of lines) {
      expect(line.trim()).toMatch(/^(\/\/|\*|\/\*)/);
    }
  });

  it('⭐ attributes the token to OUR reading, not to the user', () => {
    expect(UNMATCHED_ASK).toContain('We read');
    expect(UNMATCHED_ASK).toContain("this option's own wording");
  });

  it('⭐ asks something the user can actually answer', () => {
    // They know which factor their own option changes. They do not know what our
    // token was supposed to mean.
    expect(UNMATCHED_ASK).toContain('Which factor does this option change');
  });

  it('keeps the token, so the user can see WHAT we misread', () => {
    // Hiding it would make the ask unanswerable in the other direction — they
    // could not tell which part of their wording we failed on.
    expect(UNMATCHED_ASK).toContain('${raw.target_text}');
  });

  it('⛔ still a refusal — the ask is repaired, never removed', () => {
    // Nothing in this branch may guess a factor. The option stays unmapped.
    const branch = SOURCE.slice(
      SOURCE.indexOf('NOT MATCHED — AND THE OLD QUESTION'),
      SOURCE.indexOf('could not tie it to a factor'),
    );
    expect(branch).toContain('unresolvedTargets.push(raw.target_text);');
    expect(branch).not.toContain('interventions[');
  });
});
