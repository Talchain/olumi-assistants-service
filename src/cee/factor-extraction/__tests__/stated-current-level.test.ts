/**
 * ROADMAP 2.877 (link 2) — the STATED-CURRENT-LEVEL extractor.
 *
 * `deriveStatedTargetBaselinePercent` answers ONE question: did the user's own
 * words state the CURRENT LEVEL of the named metric, as a percentage? It backs
 * the `observed_state.baseline` mint in `add_constraint` (chat) and the
 * compound-goals repair stage (draft), so its breadth IS the no-invention rule:
 * a false positive here manufactures a baseline the user never stated, and ISL
 * then converts a level threshold against a fiction.
 *
 * CORPUS DESIGN (CLAUDE.md trap 22 — a corpus drawn from the author's head
 * cannot see the class the author did not imagine): the NON-statements below
 * are drawn from the named failure classes in the 2.877 brief (aspirations,
 * comparatives, deltas, someone else's number), from the estate's own measured
 * defect notes (the decimal-point-as-clause-boundary truncation, trap 22(b)),
 * and from the conditional/projection classes the goal-pair grammar already
 * guards (`isProposalFramed`). Every MINT member is a present-state assertion;
 * every NO-MINT member is a sentence a real brief could carry whose number is
 * NOT the metric's current level — or is a level the extractor cannot honestly
 * bind to the named target.
 *
 * FAIL DIRECTION: every ambiguity refuses (returns undefined). The cost of
 * undefined is one honest ISL refusal (`missing_target_baseline`) and an
 * elicitation opportunity (row 2.918); the cost of a wrong mint is a confident
 * wrong probability.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveStatedTargetBaselinePercent,
  extractStatedCurrentLevels,
} from '../stated-level.js';

const LABEL = 'Churn rate';

describe('2.877 link 2 — statements that MUST yield the stated level', () => {
  const statements: ReadonlyArray<readonly [string, number]> = [
    // The brief's own exemplar.
    ['Churn is 12% today, keep it under 10%.', 12],
    ['Churn is currently 12%; keep churn under 10%.', 12],
    ['Churn rate is 12% now. Keep churn below 10%.', 12],
    ['Our churn is 12% today. Keep churn under 10%.', 12],
    ['Churn stands at 12% today. Keep it under 10%.', 12],
    ['Churn sits at 12% at the moment; keep it below 10%.', 12],
    ['Churn is at 12% right now, keep it under 10%.', 12],
    // Hedged current level — same about/around vocabulary the shipped
    // goal-pair patterns 2/3 already accept ("currently at|around|about").
    ['Churn is about 12% today. Keep churn under 10%.', 12],
    // Bare present copula, no now-qualifier: simple present asserts present
    // state in plain English, and the exemplar minus "today" must not go dark.
    ['churn is 12%, keep it under 10%.', 12],
    ['Churn is 12.5% today; keep it under 10%.', 12.5],
    // Zero is a legitimate stated level ("we have no churn today").
    ['Churn is 0% today. Keep it under 2%.', 0],
    // Repeated agreeing statements are unanimous, not conflicting.
    ['Churn is 12% today. Yes, churn is 12% right now. Keep it under 10%.', 12],
    // Reviewer-corpus positives: the clause-scoped guards must not over-reach
    // into NEIGHBOURING clauses (a genuine statement beside a conditional or
    // desire clause still mints when a real boundary separates them).
    ['Churn is 12%. If we do nothing it doubles. Keep churn under 10%.', 12],
    ['£1.5M. Churn is 12% today. Keep churn under 10%.', 12],
    ['We want churn lower; churn is 12% today. Keep churn under 10%.', 12],
    ['Overall churn is 12% today. Keep churn under 10%.', 12],
  ];

  it.each(statements)('"%s" → %d', (message, expected) => {
    expect(deriveStatedTargetBaselinePercent(message, LABEL)).toBe(expected);
  });
});

describe('2.877 link 2 — NON-statements that must NOT mint (the no-invention rule)', () => {
  const nonStatements: ReadonlyArray<readonly [string, string]> = [
    ['constraint clause only', 'Keep churn under 10%.'],
    ['aspiration ("get X to N%")', 'Get churn to 12%. Keep it under 10%.'],
    ['desire ("want X at N%")', 'We want churn at 12%.'],
    ['modal ("should be")', 'Churn should be 12%. Keep it under 10%.'],
    ['past tense', 'Churn was 12% last year. Keep it under 10%.'],
    ['comparative bound ("is above")', 'Churn is above 12% these days. Keep it under 10%.'],
    ['delta ("is down N%")', 'Churn is down 12% this quarter. Keep it under 10%.'],
    ['delta-post ("N% higher")', 'Churn is 12% higher than last year. Keep it under 10%.'],
    ["someone else's number", 'Competitor churn is 12% today. Keep our churn under 10%.'],
    ['reduction delta ("by N%")', 'Reduce churn by 12%. Keep it under 10%.'],
    ['negation', 'Churn is not 12%. Keep it under 10%.'],
    ['conditional ("if")', 'If churn is 12%, we are in trouble. Keep it under 10%.'],
    // Trap 22(b) in this module's own guard: the clause-boundary scan must not
    // treat the decimal point in "£1.5M" as a sentence end, or the "If" becomes
    // invisible and the hypothetical mints.
    [
      'conditional behind a decimal number',
      'If revenue is £1.5M and churn is 12%, cut marketing. Keep churn under 10%.',
    ],
    ['projection ("by next year")', 'By next year churn is 12%. Keep it under 10%.'],
    ['target framing', 'Our target churn is 12%. Keep it under 10%.'],
    ['conflicting statements', 'Churn is 12% today. Actually, churn is 11% now. Keep it under 10%.'],
    ['over 100%', 'Churn is 120% today. Keep it under 10%.'],
    ['no percent sign (v1 is percent-only)', 'Churn is 12 today. Keep it under 10%.'],
    // Binding is subject-words ⊆ label-words, deliberately fail-closed: a
    // qualifier the label does not carry ("monthly") may describe a DIFFERENT
    // metric, so it refuses. Over-refusal costs coverage, never truth.
    ['qualified metric the label does not carry', 'Monthly churn is 12% today. Keep it under 10%.'],
    ['a different metric entirely', 'Marketing budget is 40% today. Keep churn under 10%.'],
    // --- Adversarial review of #868, B1 (reviewer-authored fixtures, trap 22:
    // classes the self-authored corpus did not list). All three MINTED before
    // the fix — each is a fabrication class reachable end-to-end.
    [
      'B1a disbelief echo (the ? sits AFTER the match)',
      'Churn is 12%? That cannot be right. Keep churn under 10% regardless.',
    ],
    [
      'B1a embedded question',
      'Do you think churn is 12%? Keep churn under 10%.',
    ],
    [
      'B1b quoted third-party speech (quote char severed subject capture)',
      'The analyst said "churn is 12%" but I have not verified it. Keep churn under 10%.',
    ],
    [
      'B1b document title in quotes',
      'The deck titled "Churn is 12%" is outdated. Keep churn under 10%.',
    ],
    ['B1b doubted attribution', 'I doubt churn is 12%. Keep churn under 10%.'],
    ['B1b denied claim', 'It is false that churn is 12%. Keep churn under 10%.'],
    [
      'B1c conditional hidden behind an e.g. dot',
      'If, e.g., churn is 12%, we are in trouble. Keep churn under 10%.',
    ],
    [
      'B1c conditional hidden behind a rev. abbreviation',
      'If rev. is flat and churn is 12%, cut marketing. Keep churn under 10%.',
    ],
    [
      'B1c conditional hidden behind a no. abbreviation',
      'If our no. one metric slips and churn is 12%, escalate. Keep churn under 10%.',
    ],
    ['even-if frame', 'Even if churn is 12%, we ship. Keep churn under 10%.'],
    // B3 — the fixture ONLY the clause-frame guard can refuse: the comma
    // severs subject capture from the marker, so subject absorption ("If
    // churn" failing the binding) cannot save it. This is the guard's pin —
    // it must go RED when the guard is deleted (mutant M-C).
    [
      'B3 comma-separated conditional (guard-only refusal)',
      'If, as we fear, churn is 12%, we are in trouble. Keep it under 10%.',
    ],
  ];

  it.each(nonStatements)('%s: no mint', (_name, message) => {
    expect(deriveStatedTargetBaselinePercent(message, LABEL)).toBeUndefined();
  });

  it('POSITIVE CONTROL for the battery above (trap 13b): the same label DOES mint on a genuine statement', () => {
    // Without this, an extractor that stopped matching altogether would pass
    // every absence assertion above while proving nothing.
    expect(deriveStatedTargetBaselinePercent('Churn is 12% today.', LABEL)).toBe(12);
  });
});

describe('2.960 R1 — a future-dated post-qualifier makes the clause a PROJECTION, not an observation', () => {
  // Adversarial review of #868 (2.877 correction lineage): "Churn is 12% by
  // Q4" states where churn is EXPECTED to be at a future date — an aspiration
  // wearing a copula, exactly the class CLAUSE_FRAME_MARKERS exists to refuse.
  // Both repro strings below MINTED at pristine 060e9ed9 (verified by
  // execution); each is a fabrication reachable end-to-end through the chat
  // and draft mints.
  const futureDated: ReadonlyArray<readonly [string, string]> = [
    ['review repro 1: by Q4', 'Churn is 12% by Q4; keep churn under 10%.'],
    ['review repro 2: by December', 'Our goal is simple; churn is 12% by December.'],
    ['by year-end', 'Churn is 12% by year-end, keep churn under 10%.'],
    ['by a 4-digit year', 'Churn is 12% by 2027; keep churn under 10%.'],
    ['by January', 'Churn is 12% by January. Keep churn under 10%.'],
    ['marker BEFORE the match binds the whole clause', 'By Q4 churn is 12%, keep churn under 10%.'],
  ];

  it.each(futureDated)('%s: no mint', (_name, message) => {
    expect(deriveStatedTargetBaselinePercent(message, LABEL)).toBeUndefined();
  });

  it('PRECONDITION PAIR (trap 13b): "by" followed by a non-date stays a genuine statement', () => {
    // The qualifier must be DATE-SHAPED to disqualify — an instrumental "by"
    // ("by our own measurement") is not a projection, and widening it would
    // dark a genuine statement class. Minted at pristine; must keep minting.
    expect(
      deriveStatedTargetBaselinePercent(
        'Churn is 12% by our own measurement. Keep churn under 10%.',
        LABEL,
      ),
    ).toBe(12);
  });

  it('POSITIVE CONTROL (trap 13b): the plain exemplar still mints beside this battery', () => {
    expect(deriveStatedTargetBaselinePercent('Churn is 12% today. Keep churn under 10%.', LABEL)).toBe(
      12,
    );
  });
});

describe('2.877 link 2 — B2: a subject binding MORE THAN ONE candidate target is ambiguous', () => {
  // Adversarial review of #868, B2: "The rate is 12%" satisfies subject ⊆
  // label for BOTH "Churn rate" and "Win rate" — the draft pass minted 0.12
  // onto both nodes from one statement about ONE unnamed metric. Unanimity
  // one level up: such a statement attests neither, so it mints on NEITHER.
  it('a generic subject that binds a competing label mints nothing', () => {
    expect(
      deriveStatedTargetBaselinePercent('The rate is 12% today. Keep churn under 10%.', 'Churn rate', [
        'Win rate',
      ]),
    ).toBeUndefined();
  });

  it('PRECONDITION PAIR (trap 13b): without the competitor the same statement binds', () => {
    expect(
      deriveStatedTargetBaselinePercent('The rate is 12% today. Keep churn under 10%.', 'Churn rate', []),
    ).toBe(12);
  });

  it('a SPECIFIC subject is not disqualified by a competitor it does not bind', () => {
    expect(
      deriveStatedTargetBaselinePercent('Churn is 12% today. Keep churn under 10%.', 'Churn rate', [
        'Win rate',
        'Breach likelihood',
      ]),
    ).toBe(12);
  });

  it('null/undefined competitor labels are ignored, not matched', () => {
    expect(
      deriveStatedTargetBaselinePercent('Churn is 12% today.', 'Churn rate', [undefined, null as never]),
    ).toBe(12);
  });
});

describe('2.877 link 2 — degenerate inputs fail closed', () => {
  it('null / empty message', () => {
    expect(deriveStatedTargetBaselinePercent(null, LABEL)).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent(undefined, LABEL)).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent('', LABEL)).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent('   ', LABEL)).toBeUndefined();
  });

  it('missing / empty label', () => {
    expect(deriveStatedTargetBaselinePercent('Churn is 12% today.', undefined)).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent('Churn is 12% today.', null)).toBeUndefined();
    expect(deriveStatedTargetBaselinePercent('Churn is 12% today.', '')).toBeUndefined();
  });

  it('negative percents cannot form (no minus sign in the grammar)', () => {
    expect(deriveStatedTargetBaselinePercent('Churn is -12% today.', LABEL)).toBeUndefined();
  });
});

describe('2.877 link 2 — extractStatedCurrentLevels surfaces subjects for binding', () => {
  it('captures the subject words the binding predicate reads', () => {
    const levels = extractStatedCurrentLevels('Competitor churn is 12% today.');
    expect(levels).toHaveLength(1);
    expect(levels[0]!.rawPercent).toBe(12);
    // The disqualifying word must be IN the captured subject — that is what
    // lets the binding refuse it.
    expect(levels[0]!.subjectWords.map((w) => w.toLowerCase())).toContain('competitor');
  });

  it('label matching is case-insensitive and singular/plural tolerant', () => {
    expect(deriveStatedTargetBaselinePercent('CHURN IS 12% TODAY.', 'churn rate')).toBe(12);
    expect(
      deriveStatedTargetBaselinePercent('Churn rates are 12% today.', 'Churn rate'),
    ).toBe(12);
  });
});
