/**
 * ⭐⭐ THE LABEL A USER READS IN PROSE IS THE LABEL ON THEIR NODE — ELIDED
 * HONESTLY IF IT MUST BE, NEVER CUT MID-PHRASE AND NEVER SUBSTITUTED.
 *
 * ── TWO INDEPENDENT WITNESSES, ONE SEAM (18 Aug 2026) ──────────────────────
 * `UX-GATE-2026-08-18.md` point 4a — Olumi's FIRST sentence to a customer:
 *
 *   > I've built a first decision model for "Several of our largest enterprise
 *   > customers are asking for a self-hosted".
 *
 * and, immediately below it, `hold the line on cloud-only for another` (the
 * word "year" cut). `COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md` link 2(c) —
 * `• double down on enterprise sales (higher`, **an unclosed bracket, no
 * ellipsis**, plus the repair chip `Configure double down on enterprise sales
 * (higher…`.
 *
 * ── AND THE FINDING THAT LOCATED IT, WHICH WAS A REFUTATION ────────────────
 * The natural theory was a UI rendering cap. A UI lane refuted it at the
 * payload: **the strings arrive ALREADY TRUNCATED ON THE WIRE, while the same
 * payload carries the full label intact at five other sites.** Its positive
 * control found no UI product code composing that sentence. So the UI could not
 * have repaired it without inventing text — which is the defect class itself —
 * and the seam is here, in CEE's narrative composer.
 *
 * Confirmed by execution rather than by reading: the OLD `truncate` body
 * reproduced all three witnessed strings BYTE FOR BYTE at the composer's own
 * `MAX_LABEL_CHARS = 40` / `MAX_GOAL_CHARS = 80`. Those three inputs are the
 * corpus below, copied verbatim from the witness files.
 *
 * ── ⚠ WHY THIS IS A SEPARATE PROPERTY FROM SHORTER LABELS, AND MUST STAY SO ─
 * The same wave authors user-stated option labels into short noun phrases. If
 * that were the only fix, a long-but-LEGITIMATE label would still be cut
 * mid-phrase the first time one appeared — and a test that passed merely
 * because today's labels are short would be bound to the wrong property and
 * would stay green until that day. **Every case here therefore uses a label
 * LONGER than the budget on purpose.** The two fixes are proved independently.
 *
 * ── THE BINDING (trap 19) ──────────────────────────────────────────────────
 * The claim is not "the output is short". It is that the output is a
 * WORD-BOUNDED PREFIX OF THE INPUT, plus `…` — bound to the input by identity,
 * so a composer that silently swapped in a different, tidier phrase goes RED
 * even if its replacement were the perfect length.
 */
import { describe, expect, it } from 'vitest';

import { elideAtWordBoundary } from '../post-draft-narrative.js';

/** The composer's own budgets, restated here so the corpus runs at the widths
 *  that produced the witnessed strings. */
const MAX_LABEL_CHARS = 40;
const MAX_GOAL_CHARS = 80;

// ── THE WITNESSED INPUTS, VERBATIM ──────────────────────────────────────────
const WITNESSED: ReadonlyArray<readonly [name: string, input: string, max: number, wasEmitted: string]> = [
  [
    'composed-journey link 2(c): the unclosed bracket',
    'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    MAX_LABEL_CHARS,
    'double down on enterprise sales (higher',
  ],
  [
    "UX gate 4a: Olumi's opening sentence",
    'Several of our largest enterprise customers are asking for a self-hosted deployment option',
    MAX_GOAL_CHARS,
    'Several of our largest enterprise customers are asking for a self-hosted',
  ],
  [
    'UX gate 4a: the option list beneath it',
    'hold the line on cloud-only for another year',
    MAX_LABEL_CHARS,
    'hold the line on cloud-only for another',
  ],
];

/** Every opener closed, and no stray double quote. The reader's test, not a
 *  parser's: an unclosed bracket is what makes an elision read as broken
 *  English rather than as an abbreviation. */
function hasUnclosedDelimiter(text: string): boolean {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '“': '”' };
  const closers = new Set(Object.values(pairs));
  let depth = 0;
  let quotes = 0;
  for (const ch of text) {
    if (ch === '"') quotes += 1;
    else if (pairs[ch] !== undefined) depth += 1;
    else if (closers.has(ch)) depth -= 1;
  }
  return depth !== 0 || quotes % 2 !== 0;
}

/** The identity relation the whole suite rests on: what came out is what went
 *  in, up to a word-boundary elision. */
function isWordBoundedPrefixOf(output: string, input: string): boolean {
  if (output === input.trim()) return true;
  if (!output.endsWith('…')) return false;
  const head = output.slice(0, -1);
  if (!input.startsWith(head)) return false;
  const next = input.charAt(head.length);
  // Either the input ends there, or the very next character is whitespace or
  // the punctuation the elision trimmed — never the middle of a word.
  return next === '' || /[\s,;:—–-]/u.test(next);
}

describe('the instrument: the witnessed strings really were produced by this seam', () => {
  it('every witnessed input is longer than the budget that cut it', () => {
    for (const [name, input, max] of WITNESSED) {
      expect(input.length, name).toBeGreaterThan(max);
    }
  });

  /**
   * ⭐ THE CONTRAST CONTROL (trap 13e). A predicate that called every string
   * "fine" would certify anything. It must convict the strings the deployed
   * build actually emitted.
   */
  it('the unclosed-delimiter predicate CONVICTS the emitted string and ACQUITS its source', () => {
    const [, input, , emitted] = WITNESSED[0]!;
    expect(hasUnclosedDelimiter(emitted)).toBe(true);
    expect(hasUnclosedDelimiter(input)).toBe(false);
  });

  it('the prefix relation ACQUITS an honest elision and CONVICTS a substitution', () => {
    expect(isWordBoundedPrefixOf('double down on enterprise sales…', WITNESSED[0]![1])).toBe(true);
    // A tidier, shorter, entirely reasonable phrase — and not the user's label.
    expect(isWordBoundedPrefixOf('Enterprise Sales Push…', WITNESSED[0]![1])).toBe(false);
    // A mid-token cut, which is the other half of the witnessed defect.
    expect(isWordBoundedPrefixOf('double down on enterprise sal…', WITNESSED[0]![1])).toBe(false);
  });
});

describe('no label is ever cut mid-phrase, and none of the witnessed strings can recur', () => {
  it.each(WITNESSED)('%s', (name, input, max, wasEmitted) => {
    const out = elideAtWordBoundary(input, max);

    // The exact string the deployed build put on a customer's screen, by
    // identity. This is the RED: at pristine, `out` IS `wasEmitted`.
    expect(out, `${name}: the witnessed string must not recur`).not.toBe(wasEmitted);

    expect(hasUnclosedDelimiter(out), `${name}: left a delimiter open`).toBe(false);
    expect(isWordBoundedPrefixOf(out, input), `${name}: not a word-bounded prefix of the label`).toBe(
      true,
    );
    // An elision must SAY it is one.
    expect(out.endsWith('…'), `${name}: elided without a mark`).toBe(true);
  });
});

describe('the opposite direction: what must be left exactly as it is', () => {
  it('a label within budget is returned byte-identical, with no mark added', () => {
    for (const label of [
      'Keep Weekly Deliveries',
      'Double Down on Enterprise Sales',
      'Status Quo: Hold current strategy',
    ]) {
      expect(elideAtWordBoundary(label, MAX_LABEL_CHARS)).toBe(label);
      expect(elideAtWordBoundary(label, MAX_LABEL_CHARS)).not.toContain('…');
    }
  });

  /**
   * ⭐ A LONG HONEST LABEL BEATS A MANGLED ONE. Where no word boundary survives
   * the delimiter rule, the label is returned WHOLE — over budget and truthful.
   * Returning the whole label is the one outcome that can never misrepresent it.
   */
  it('returns the label WHOLE when no honest cut point exists', () => {
    const oneLongToken = 'Supercalifragilisticexpialidociousness';
    expect(elideAtWordBoundary(oneLongToken, 10)).toBe(oneLongToken);

    // Every word boundary sits inside the bracket, so backing out of the
    // bracket leaves nothing: keep it whole rather than cut at `Migrate`.
    const bracketFromTheStart = 'Migrate (everything except the payments platform and its ledger)';
    const out = elideAtWordBoundary(bracketFromTheStart, 12);
    expect(hasUnclosedDelimiter(out)).toBe(false);
    expect(isWordBoundedPrefixOf(out, bracketFromTheStart)).toBe(true);
  });

  it("an apostrophe is not a delimiter — it must not block an otherwise honest cut", () => {
    const out = elideAtWordBoundary(
      "the team's own view of what the next two quarters should look like",
      30,
    );
    expect(out.endsWith('…')).toBe(true);
    expect(isWordBoundedPrefixOf(out, "the team's own view of what the next two quarters should look like")).toBe(
      true,
    );
  });
});

/**
 * ⭐ THE BACK-OFF IS A `while` LOOP OVER USER-SUPPLIED TEXT, AND IT RUNS ON
 * EVERY DRAFT TURN. Termination is an argument on paper — each pass moves the
 * cut strictly leftwards — but a composer that hangs on one adversarial label
 * would take the turn with it, so the argument is made executable here.
 *
 * The fuzz alphabet is deliberately delimiter-DENSE: brackets, braces, both
 * quote styles and the punctuation the trailing trim strips, at a frequency no
 * real brief would produce. That is the point — the property must hold on
 * inputs far worse than anything the corpus above contains.
 */
describe('the delimiter back-off always terminates', () => {
  const DQ = String.fromCharCode(34);

  it('terminates on hand-picked pathological shapes', () => {
    const pathological = [
      '( ( ( ( a b c d e f g h i j k l m n o p',
      `a ${DQ} b ${DQ} c ${DQ} d e f g h i j`,
      '((((((((((',
      '   spaced   out   words   here   more   ',
      '(a (b (c (d (e (f (g (h',
      '\u201cx \u201cy \u201cz w v u t s r q',
      ')))) unmatched closers only ))))',
      '',
      ' ',
      'single',
    ];
    for (const label of pathological) {
      for (const max of [0, 1, 2, 5, 10, 40, 80]) {
        // A hang fails by test timeout; a throw fails here. Either way it REDs.
        expect(typeof elideAtWordBoundary(label, max)).toBe('string');
      }
    }
  });

  it('terminates, and never invents, across a delimiter-dense fuzz', () => {
    const alphabet = ['a', 'b', 'c', ' ', '(', ')', '[', ']', '{', '}', DQ, '\u201c', '\u201d', '-', ','];
    let checked = 0;
    for (let i = 0; i < 2000; i += 1) {
      const length = 1 + ((i * 7) % 60);
      let label = '';
      for (let j = 0; j < length; j += 1) {
        label += alphabet[(i * 31 + j * 17) % alphabet.length]!;
      }
      const max = 1 + ((i * 13) % 50);
      const out = elideAtWordBoundary(label, max);
      // The invariant holds over the whole fuzz, not just the readable corpus:
      // whatever comes out is the input, or a word-bounded prefix of it.
      expect(isWordBoundedPrefixOf(out, label), JSON.stringify({ label, max, out })).toBe(true);
      checked += 1;
    }
    // Non-vacuity: the loop really ran the number of cases it claims.
    expect(checked).toBe(2000);
  });
});
