/**
 * ROADMAP 2.918 / 2.1361 — the ELICITED-ANSWER extraction path.
 *
 * `classifyElicitedBaselineAnswer` answers ONE question: in reply to a pending
 * baseline question that already NAMES the target ("Roughly what percentage is
 * Churn rate at right now?"), did the user's message state a single
 * unambiguous percent level, fail to state one while plainly TRYING, or say
 * something else entirely? It is the #868 extractor extended with a bounded
 * question-context carry, NOT a second parser: the full-sentence limb IS
 * `deriveStatedTargetBaselinePercent` (same grammar, same competitor
 * unanimity), and the elliptical limb accepts ONLY a whole-message bare answer
 * built from the module's own qualifier vocabulary — the subject binding the
 * grammar cannot see is supplied by the pending question's target, which is
 * why callers MUST gate this function on a live pending question (no pending
 * question ⇒ no elliptical binding; the handler enforces it, and
 * `add-constraint-baseline-elicitation.test.ts` pins that gate).
 *
 * ⚠⚠ WHAT THIS FILE CANNOT SEE, STATED UP FRONT (2.1361, and it is why the
 * old "POSITIVE CONTROL" block below was replaced). On the elliptical limb the
 * extractor is REFERENT-BLIND BY CONTRACT: `deriveElicitedBaselineAnswerPercent
 * ('about 12%', 'Zzz Unrelated Metric')` returns 12, identically to the genuine
 * label — proven by fixture rot in `refuses to bind` below. So NO test in this
 * file can observe a referent mis-binding, and a control here that passes the
 * real label proves only that the function RUNS. The referent discrimination
 * lives at the two GATES and is pinned there by rot-mutant pairs that MOVE the
 * pending's target and assert the bound referent moves with it
 * (`routing/__tests__/baseline-elicitation-resume.test.ts` and
 * `tools/handlers/__tests__/add-constraint-baseline-elicitation.test.ts`).
 *
 * FAIL DIRECTION, in two halves since 2.1361. A message that does not bind is
 * either UNUSABLE (the user tried; the product must re-ask) or NOT AN ANSWER
 * (the user said something else; the product must stay silent and let the
 * normal flow own the turn). Neither ever mints. The corpora below pin both
 * directions, because a binder that accepts everything writes wrong values
 * confidently and a binder that refuses in silence loses the answer.
 */

import { describe, expect, it } from 'vitest';

import {
  ANSWER_ATTEMPT_VOCABULARY,
  PRESENT_STATE_QUALIFIERS,
  classifyElicitedBaselineAnswer,
  deriveElicitedBaselineAnswerPercent,
} from '../stated-level.js';
import { formatBaselineElicitation } from '../../../orchestrator-v5/tools/handlers/d1-shared/format-confirmation.js';

const LABEL = 'Churn rate';

/**
 * ⭐ CORPUS PROVENANCE — READ BEFORE ADDING A MEMBER.
 *
 * A corpus an author invents to suit the rule they just wrote cannot certify
 * that rule (CLAUDE.md trap 22). Every positive member below therefore comes
 * from OUTSIDE the 2.1361 author's head, from one of exactly three sources,
 * and each block names which:
 *
 *   (A) THE SHIPPED PRE-2.1361 CORPUS, MECHANICALLY TRANSFORMED. The 15
 *       positives the original 2.918 authors wrote, with the '%' stripped by
 *       code at test time. A mechanical transformation of someone else's
 *       corpus is not an invention, and it is exactly the class 2.1361 opened.
 *   (B) THE PRODUCT'S OWN QUESTION, DERIVED AT RUNTIME. The hedge words and
 *       the unit noun are read out of `formatBaselineElicitation`'s actual
 *       output. If the ask ever starts using vocabulary the binder cannot
 *       hear, these go RED — which is the defect 2.1361 exists to close, made
 *       structurally unrepeatable rather than merely fixed once.
 *   (C) THE REPORTED CASE. The bare "30" a user typed at a question that
 *       opens with the word "Roughly".
 */

// ── (A) the shipped pre-2.1361 corpus, verbatim ──────────────────────────
// Authored by the 2.918 lane, copied here unchanged. Every member carries a
// literal '%'; that uniformity is precisely why it was structurally incapable
// of observing the class it wrongly blocked.
const SHIPPED_2918_POSITIVES: ReadonlyArray<readonly [string, number]> = [
  ['about 12%', 12],
  ['12%', 12],
  ['12%.', 12],
  ['roughly 12%', 12],
  ['around 12.5%', 12.5],
  ["it's about 12%", 12],
  ['it is 12%', 12],
  ["It's currently 12%.", 12],
  ['that is about 12%', 12],
  ["we're at about 12%", 12],
  ['we are at 12% today', 12],
  ['at about 12%', 12],
  ['12% today', 12],
  ['about 12% right now', 12],
  ['0%', 0],
];

describe('2.918 — the shipped positive corpus still binds, unchanged', () => {
  it.each(SHIPPED_2918_POSITIVES)('"%s" → %d', (message, expected) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBe(expected);
  });
});

describe('2.1361 (A) — the SAME corpus with the % removed must bind identically', () => {
  // The transformation is mechanical, not editorial: strip '%' and tidy the
  // whitespace it leaves. Nothing here was chosen to suit the new rule.
  const stripped = SHIPPED_2918_POSITIVES.map(
    ([message, expected]) =>
      [message.replace(/%/g, '').replace(/\s{2,}/g, ' ').trim(), expected] as const,
  );

  it('the transformation actually changed every member (trap 13 — the probe must be able to see a difference)', () => {
    expect(stripped).toHaveLength(SHIPPED_2918_POSITIVES.length);
    for (const [i, [message]] of stripped.entries()) {
      expect(message).not.toBe(SHIPPED_2918_POSITIVES[i]![0]);
      expect(message).not.toContain('%');
    }
  });

  it.each(stripped)('"%s" → %d', (message, expected) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBe(expected);
  });
});

// ── (B) the product's own question, derived at runtime ────────────────────
describe('2.1361 (B) — the product must hear the vocabulary its OWN question uses', () => {
  const ask = formatBaselineElicitation({ targetLabel: LABEL });
  const askWords = [...new Set(ask.toLowerCase().match(/[a-z]+/g) ?? [])];
  const askHedges = askWords.filter((w) => PRESENT_STATE_QUALIFIERS.includes(w));

  it('DERIVATION LIVENESS CONTROL: the ask really does carry hedge vocabulary', () => {
    // Trap 13e — a probe that silently extracts nothing agrees with every
    // other probe that extracted nothing. The ask says "Roughly … at right
    // now?", so four is the floor; an ask reworded to carry none would fail
    // here rather than vacuously passing the battery below.
    expect(askWords.length).toBeGreaterThan(10);
    expect(askHedges.length).toBeGreaterThanOrEqual(4);
  });

  it.each(askHedges.map((w) => [w] as const))(
    'the ask says "%s", so that word leading a bare number must bind',
    (word) => {
      expect(deriveElicitedBaselineAnswerPercent(`${word} 30`, LABEL)).toBe(30);
    },
  );

  it('the ask names its unit, so that unit spelled out after a number must bind', () => {
    // "percentage" is read out of the ask itself; "percent" and "per cent" are
    // its American and British contractions of the same noun.
    expect(askWords).toContain('percentage');
    expect(deriveElicitedBaselineAnswerPercent('30 percentage', LABEL)).toBe(30);
    expect(deriveElicitedBaselineAnswerPercent('30 percent', LABEL)).toBe(30);
    expect(deriveElicitedBaselineAnswerPercent('30 per cent', LABEL)).toBe(30);
  });

  it('every hedge in the ask is also recognised as answer-attempt vocabulary', () => {
    // Keeps the re-ask discriminator and the binder reading the same words:
    // a hedge the grammar accepts must never be classed "not an answer".
    for (const word of askHedges) {
      expect(ANSWER_ATTEMPT_VOCABULARY.has(word)).toBe(true);
    }
  });
});

// ── (C) the reported case ─────────────────────────────────────────────────
describe('2.1361 (C) — the reported case: a bare number answering "Roughly …?"', () => {
  const reported: ReadonlyArray<readonly [string, number]> = [
    ['30', 30],
    ['roughly 30', 30],
    ['about 30', 30],
    ['30 percent', 30],
  ];

  it.each(reported)('"%s" → %d', (message, expected) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBe(expected);
  });

  it('and the value is the user’s number, never a substitute', () => {
    for (const [message, expected] of reported) {
      const classified = classifyElicitedBaselineAnswer(message, LABEL);
      expect(classified).toEqual({ outcome: 'bound', value: expected });
    }
  });
});

describe('2.918 — full-sentence answers ride the UNCHANGED #868 grammar', () => {
  it('a subject-bearing answer binds through the parent extractor', () => {
    expect(deriveElicitedBaselineAnswerPercent('Churn is about 12%.', LABEL)).toBe(12);
  });

  it('a subject that binds a COMPETING label refuses (unanimity carried over)', () => {
    expect(
      deriveElicitedBaselineAnswerPercent('The rate is 12% today.', LABEL, ['Win rate']),
    ).toBeUndefined();
  });

  it("a full sentence about a DIFFERENT metric never binds the question's target", () => {
    expect(deriveElicitedBaselineAnswerPercent('Win rate is 12% today.', LABEL)).toBeUndefined();
  });

  it('the parent grammar is UNTOUCHED by 2.1361: a bare number in a full sentence still refuses', () => {
    // The '%' became optional on the ELLIPTICAL limb only, because only that
    // limb runs behind a question that names the unit. A subject-bearing
    // sentence can arrive on any turn, so it keeps the percent-only rule and
    // the draft path (`compound-goals.ts`) is unaffected.
    expect(deriveElicitedBaselineAnswerPercent('Churn rate is 12 today.', LABEL)).toBeUndefined();
  });
});

// ── the two refusal classes ───────────────────────────────────────────────
describe('2.1361 — UNUSABLE: the user tried, and the product must RE-ASK', () => {
  const unusable: ReadonlyArray<readonly [string, string]> = [
    // Guesswork is not a statement, but it is plainly an attempt.
    ['guess hedge', 'maybe 12%'],
    ['guess hedge, no unit', 'probably 12'],
    // More than one candidate value: the product may not pick.
    ['range with dash', '10-15%'],
    ['range spelled out', '10 to 15%'],
    ['range with "between"', 'between 10 and 15'],
    ['two candidate numbers', '12% or 15%'],
    ['two candidate numbers, no unit', '12 or 15'],
    // An aside only the full grammar could judge.
    ['a second clause after a comma', 'about 12%, I think'],
    // Understood perfectly and still unusable.
    ['over 100 refuses (same [0,100] rule as the parent)', '120%'],
    ['negative level', '-12%'],
    ['question echo', '12%?'],
    ['quoted number', '"12%"'],
  ];

  it.each(unusable)('%s: no bind, but ASK', (_name, message) => {
    expect(classifyElicitedBaselineAnswer(message, LABEL).outcome).toBe('unusable');
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBeUndefined();
  });
});

describe('2.918 — NOT AN ANSWER: no bind, and the pre-2.1361 SILENT fall-through', () => {
  const nonAnswers: ReadonlyArray<readonly [string, string]> = [
    // Delta and bound words change the claim; only the full grammar may judge
    // a longer utterance, so these stay with the normal flow exactly as before.
    ['delta-post word', '12% higher'],
    ['delta-post word after hedge', 'about 12% up'],
    ['bound word before', 'under 12%'],
    ['bound word before hedge', 'below about 12%'],
    ['direction word', 'down 12%'],
    ['conditional tail', 'about 12% if things improve'],
    ['past tense', 'it was 12%'],
    ['second sentence changes the claim', 'About 12%. But it varies a lot.'],
    ['empty message', ''],
    ['whitespace only', '   '],
    // ⭐ THE ANTI-HIJACK CASES. A user who has moved on must never be captured
    // by a stale question — this is the half that keeps the re-ask honest.
    ['a full sentence about a different metric', 'Win rate is 12% today.'],
    ['changed the subject entirely', 'Actually, can we talk about pricing instead?'],
    ['a different request that happens to carry a number', 'Please add 3 more factors'],
    ['prose with no digit at all', 'I have no idea what it is'],
  ];

  it.each(nonAnswers)('%s: no bind, and no re-ask', (_name, message) => {
    expect(classifyElicitedBaselineAnswer(message, LABEL).outcome).toBe('not_an_answer');
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBeUndefined();
  });

  it('DISCRIMINATION CONTROL: the two refusal classes are genuinely different verdicts', () => {
    // Trap 20 — a classifier that returned one verdict for everything would
    // satisfy each battery above on its own. Assert all three outcomes are
    // reachable in a single run, so a collapsed classifier cannot pass.
    const outcomes = new Set([
      classifyElicitedBaselineAnswer('30', LABEL).outcome,
      classifyElicitedBaselineAnswer('10-15%', LABEL).outcome,
      classifyElicitedBaselineAnswer('Please add 3 more factors', LABEL).outcome,
    ]);
    expect([...outcomes].sort()).toEqual(['bound', 'not_an_answer', 'unusable']);
  });
});

describe('2.918 — degenerate inputs fail closed like the parent', () => {
  it('null / undefined message and label', () => {
    expect(deriveElicitedBaselineAnswerPercent(null, LABEL)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent(undefined, LABEL)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', undefined)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', null)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', '')).toBeUndefined();
  });

  it('a missing label is NOT AN ANSWER, never UNUSABLE: no referent, no question to re-ask', () => {
    expect(classifyElicitedBaselineAnswer('10-15%', '').outcome).toBe('not_an_answer');
  });

  it('⚠ FIXTURE ROT, DELIBERATE: this module is referent-blind on the elliptical limb', () => {
    // Not an aspiration — a PIN on the documented contract, so that a reader
    // of this file cannot mistake the batteries above for referent evidence.
    // The gate supplies the referent; see the file header for where that is
    // actually proven.
    expect(deriveElicitedBaselineAnswerPercent('about 12%', 'Zzz Unrelated Metric')).toBe(12);
    expect(deriveElicitedBaselineAnswerPercent('30', 'Zzz Unrelated Metric')).toBe(30);
  });
});
