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
/**
 * ⚠⚠ EACH ROW CARRIES ITS EXACT EXPECTED OUTPUT, and that is a correction.
 *
 * The suite previously asserted only `out !== wasEmitted`. A reviewer showed
 * that on one case the new output was literally the witnessed string PLUS `…`,
 * so the assertion could not tell "fixed the cut" from "added a mark".
 *
 * The honest repair is NOT to demand the cut always move — on two of these
 * three the old cut was ALREADY word-bounded and balanced, so the mark IS the
 * whole fix and demanding movement would be asserting a change that should not
 * happen. It is to state per case what the output must be, by identity, so the
 * two outcomes are distinguishable and each is pinned to the right one.
 *
 * `fixKind` records which repair each case exercises, so the set cannot quietly
 * become all-marks — the very degeneration the reviewer was pointing at.
 */
const WITNESSED: ReadonlyArray<
  readonly [name: string, input: string, max: number, wasEmitted: string, expected: string, fixKind: 'cut moved' | 'mark added']
> = [
  [
    'composed-journey link 2(c): the unclosed bracket',
    'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    MAX_LABEL_CHARS,
    'double down on enterprise sales (higher',
    'double down on enterprise sales…',
    'cut moved',
  ],
  [
    "UX gate 4a: Olumi's opening sentence",
    'Several of our largest enterprise customers are asking for a self-hosted deployment option',
    MAX_GOAL_CHARS,
    'Several of our largest enterprise customers are asking for a self-hosted',
    'Several of our largest enterprise customers are asking for a self-hosted…',
    'mark added',
  ],
  [
    'UX gate 4a: the option list beneath it',
    'hold the line on cloud-only for another year',
    MAX_LABEL_CHARS,
    'hold the line on cloud-only for another',
    'hold the line on cloud-only for another…',
    'mark added',
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
  // ⚠ AGAINST THE TRIMMED INPUT. This compared `output` to raw `input`, and the
  // function under test trims first — so any leading-whitespace input that
  // elided would have produced a FALSE RED. 134 fuzz inputs carried leading
  // whitespace and none tripped it purely by luck; a latent false red in the
  // guard is still a defect in the guard.
  const source = input.trim();
  if (output === source) return true;
  if (!output.endsWith('…')) return false;
  const head = output.slice(0, -1);
  if (!source.startsWith(head)) return false;
  const next = source.charAt(head.length);
  // Either the input ends there, or the very next character is whitespace or
  // the punctuation the elision trimmed — never the middle of a word.
  // ⚠ `.` and `…` belong here: they are in the strip class, and omitting them
  // was how `"…soon...…"` and `"phase one ……"` passed unnoticed.
  return next === '' || /[\s,;:—–.…-]/u.test(next);
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
  it('the corpus exercises BOTH repairs, so it cannot degenerate into all-marks', () => {
    const kinds = new Set(WITNESSED.map(([, , , , , kind]) => kind));
    expect([...kinds].sort()).toEqual(['cut moved', 'mark added']);
  });

  it.each(WITNESSED)('%s', (name, input, max, wasEmitted, expected, fixKind) => {
    const out = elideAtWordBoundary(input, max);

    // The exact string the deployed build put on a customer's screen, by
    // identity. This is the RED: at pristine, `out` IS `wasEmitted`.
    expect(out, `${name}: the witnessed string must not recur`).not.toBe(wasEmitted);

    // ⭐ BY IDENTITY, so "fixed the cut" and "added a mark" are distinguishable.
    expect(out, `${name}: exact output`).toBe(expected);
    const survivingNow = out.endsWith('…') ? out.slice(0, -1) : out;
    if (fixKind === 'cut moved') {
      expect(
        survivingNow.length < wasEmitted.length,
        `${name}: claimed the cut moved, but the surviving text is unchanged`,
      ).toBe(true);
    } else {
      expect(
        survivingNow,
        `${name}: claimed only a mark was added, but the cut also moved`,
      ).toBe(wasEmitted);
    }

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

  /**
   * ⚠⚠ THIS TEST DID NOT BITE, AND THE TWEAK IT WARNS AGAINST PROVED IT.
   *
   * It asserted only "ends with `…`" and "is a word-bounded prefix". Treating
   * `'` as a delimiter — the exact change the module's docstring forbids —
   * collapses this fixture from `"the team's own view of what…"` (28 chars) to
   * `"the…"` (4), and **both assertions still hold**, so the suite stayed GREEN
   * while the behaviour it exists to protect was destroyed. A guard whose
   * fixture can collapse to nothing while it applauds is a guard agreeing with
   * itself (trap 13b).
   *
   * Bound by IDENTITY to the expected surviving text, so the collapse REDs.
   */
  it("an apostrophe is not a delimiter — it must not block an otherwise honest cut", () => {
    const input = "the team's own view of what the next two quarters should look like";
    const out = elideAtWordBoundary(input, 30);
    expect(out.endsWith('…')).toBe(true);
    expect(isWordBoundedPrefixOf(out, input)).toBe(true);
    // The apostrophe-bearing token must SURVIVE the cut — that is the property.
    expect(out).toContain("team's");
    expect(out).toBe("the team's own view of what…");
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
    // ⚠ `.` and `…` ADDED (finding 6): they are in the strip class and 25 real
    // corpus strings already end in an elision mark, so a `…`-bearing input was
    // exactly the class the alphabet could not generate — which is how the
    // double-ellipsis outputs `"…soon...…"` and `"phase one ……"` went unseen.
    // ⚠⚠ WORD-LIKE TOKENS, NOT PURE DELIMITER SOUP — and this is a correction the
    // elision counter forced. The alphabet was single characters including
    // brackets and quotes at a frequency no brief produces; with the magnitude
    // floor in place **every single one of the 2,000 cases was returned WHOLE**,
    // so the fuzz exercised the elision path ZERO times while reporting 2,000
    // checked. That is the tautology this counter exists to expose, and it
    // exposed it on its first run. Real tokens interleaved with delimiters
    // produce strings the rule actually cuts.
    const tokens = ['alpha', 'be', 'gamma', 'delta-two', 'epsilon', 'zeta', 'eta', 'theta'];
    const punct = ['(', ')', '[', ']', '{', '}', DQ, '\u201c', '\u201d', '-', ',', '.', '…', "'"];
    let checked = 0;
    let elisions = 0;
    for (let i = 0; i < 2000; i += 1) {
      const words = 2 + ((i * 7) % 12);
      const parts: string[] = [];
      for (let j = 0; j < words; j += 1) {
        let w = tokens[(i * 31 + j * 17) % tokens.length]!;
        // Sprinkle delimiters so the bracket and mark classes are still hit.
        if ((i + j) % 5 === 0) w = `${punct[(i + j) % punct.length]!}${w}`;
        if ((i + j) % 7 === 0) w = `${w}${punct[(i * 3 + j) % punct.length]!}`;
        parts.push(w);
      }
      const label = parts.join(' ');
      const max = 10 + ((i * 13) % 45);
      const out = elideAtWordBoundary(label, max);
      // The invariant holds over the whole fuzz, not just the readable corpus:
      // whatever comes out is the input, or a word-bounded prefix of it.
      expect(isWordBoundedPrefixOf(out, label), JSON.stringify({ label, max, out })).toBe(true);
      // No output the rule PRODUCED may carry a doubled mark. Scoped to real
      // elisions: an input returned whole may legitimately contain `……` already,
      // and convicting the rule for the caller's own bytes would be a false red.
      if (out !== label.trim()) {
        expect(out, JSON.stringify({ label, max, out })).not.toMatch(/(\.\.\.…|……|…\.)$/u);
      }
      checked += 1;
      if (out !== label.trim()) elisions += 1;
    }
    // ⚠⚠ THE OLD PIN WAS A TAUTOLOGY: `checked += 1` is unconditional, so
    // `expect(checked).toBe(2000)` restated the loop bound and would have held
    // if every single case had passed through untouched. What matters is how
    // many cases actually ELIDED — the only ones that exercise the rule.
    expect(checked).toBe(2000);
    expect(elisions, 'the fuzz must actually exercise the elision path').toBeGreaterThan(100);
  });
});
