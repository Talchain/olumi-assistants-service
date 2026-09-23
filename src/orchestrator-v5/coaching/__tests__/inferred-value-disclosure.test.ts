/**
 * THE ANALYSIS MUST SAY WHOSE NUMBERS IT RAN ON.
 *
 * ⛔ MEASURED on deployed staging, 23 Sep, scenario `e243debd`: the brief stated
 * no numbers, the product supplied all four factor values (`cee_inference` /
 * `inferred`, identical across three draws), ran the analysis and reported
 * *"Hire a Tech Lead scored highest against your goal in 81% of runs"* — with no
 * mention that a single number was ours.
 *
 * This applies Paul's ratified D-ask-1 ruling — *"the analysis result must never
 * present a scaffolded option's numbers as user-provided"* — to the population
 * it does not cover: CEE-inferred FACTOR values. Measured: 0 of the six existing
 * disclosure modules reference the inference family, against a contrast control
 * of 59 non-test files for the scaffolded-option path.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInferredValueDisclosure,
  deriveInferredValues,
  INFERRED_VALUE_DISCLOSURE_RE_SRC,
  INFERRED_VALUE_DISCLOSURE_MAX_CHARS,
} from '../inferred-value-disclosure.js';

const ours = (id: string, source: string) => ({
  id, kind: 'factor', label: id, observed_state: { value: 0.5, source },
});
const theirs = (id: string, source: string) => ({
  id, kind: 'factor', label: id, observed_state: { value: 0.5, source },
});

describe('deriveInferredValues — bound to authorship, not to the number', () => {
  it('claims the inference family', () => {
    const g = { nodes: [ours('a', 'cee_inference'), ours('b', 'inferred'), ours('c', 'cee_repair')] };
    expect(deriveInferredValues(g).map((r) => r.factor_id)).toEqual(['a', 'b', 'c']);
  });

  it('CONTROL: never claims a value the TEAM supplied', () => {
    const g = {
      nodes: [
        theirs('u1', 'user_override'), theirs('u2', 'user_confirmed'), theirs('u3', 'user'),
        theirs('u4', 'user_edited'), theirs('u5', 'user_assumption'), theirs('u6', 'user_calibration'),
        theirs('p', 'panel_elicited'), theirs('b', 'brief_extraction'),
      ],
    };
    expect(deriveInferredValues(g)).toEqual([]);
  });

  it('extractionType is honoured when observed_state carries no source', () => {
    const g = { nodes: [{ id: 'x', kind: 'factor', data: { value: 0.4, extractionType: 'inferred' } }] };
    expect(deriveInferredValues(g).map((r) => r.factor_id)).toEqual(['x']);
  });

  it('a factor with NO value is not an inferred value', () => {
    const g = { nodes: [{ id: 'x', kind: 'factor', observed_state: { source: 'cee_inference' } }] };
    expect(deriveInferredValues(g)).toEqual([]);
  });

  it('non-factor kinds are out of scope', () => {
    const g = { nodes: [{ id: 'o', kind: 'option', observed_state: { value: 1, source: 'cee_inference' } }] };
    expect(deriveInferredValues(g)).toEqual([]);
  });

  it('a malformed graph yields nothing rather than throwing', () => {
    for (const g of [undefined, null, {}, { nodes: null }, { nodes: [null, 3, 'x'] }]) {
      expect(() => deriveInferredValues(g)).not.toThrow();
      expect(deriveInferredValues(g)).toEqual([]);
    }
  });
});

describe('buildInferredValueDisclosure', () => {
  it('SILENCE when the team stated everything — there is nothing of ours to flag', () => {
    expect(buildInferredValueDisclosure([])).toBe('');
  });

  it('says the value is OURS, and that changing it changes the implication', () => {
    const one = buildInferredValueDisclosure([{ factor_id: 'a' }]);
    expect(one).toContain('I supplied the value behind this');
    expect(one).toContain('mine rather than yours');
    expect(one).toContain('changes what this model implies');
  });

  it('counts rather than names, and pluralises', () => {
    const many = buildInferredValueDisclosure([{ factor_id: 'a' }, { factor_id: 'b' }, { factor_id: 'c' }]);
    expect(many).toContain('I supplied 3 of the values behind this');
    expect(many).not.toContain('factor_id');
  });

  it('⛔ never claims the numbers are the team’s, and never recommends', () => {
    for (const n of [1, 2, 40]) {
      const s = buildInferredValueDisclosure(Array.from({ length: n }, (_, i) => ({ factor_id: `f${i}` })));
      expect(s).not.toMatch(/your (value|number|estimate)/i);
      expect(s).not.toMatch(/\b(recommend|best option|you should|the answer)\b/i);
    }
  });

  it('EVERY emittable sentence satisfies the published grammar', () => {
    // If it does not, the egress allowlist replaces it with the locked template
    // and the user is told nothing — the exact failure scaffold-disclosure records.
    const re = new RegExp(`^(?:${INFERRED_VALUE_DISCLOSURE_RE_SRC})$`);
    for (const n of [1, 2, 9, 10, 99, 250]) {
      const s = buildInferredValueDisclosure(Array.from({ length: n }, (_, i) => ({ factor_id: `f${i}` })));
      expect(re.test(s), `n=${n} failed the grammar: ${s}`).toBe(true);
      expect(s.length).toBeLessThanOrEqual(INFERRED_VALUE_DISCLOSURE_MAX_CHARS);
    }
  });

  it('a pathological count is clamped so the grammar still admits it', () => {
    const s = buildInferredValueDisclosure(Array.from({ length: 250 }, (_, i) => ({ factor_id: `f${i}` })));
    expect(s).toContain('99 of the values');
  });
});

/**
 * ⭐ WHERE "PROVISIONAL" BECOMES REAL.
 *
 * *"Provisional means the user can change something and see how much it
 * matters."* The engine already answers it per factor — `p_win_sensitivity`
 * carries `status: "below_resolution"` when resolving that factor perfectly
 * would move the result less than the noise floor.
 *
 * Measured on scenario `e243debd`: all four inferred values were
 * `below_resolution`. The product invented four numbers, named a leading
 * option, and NOT ONE of them would have changed which option led — a fact that
 * makes the result MORE trustworthy and which the user was never told.
 */
/**
 * ⛔⛔ THE PROHIBITION GUARD — the claim this module must NOT make.
 *
 * A `p_win_sensitivity`-driven sentence ("our numbers do / do not change which
 * option comes out in front") was built here and withdrawn unshipped on 23 Sep:
 * ISL states the field "structurally cannot capture option-switching", and
 * user-facing narration of it is under a standing ban whose rename-based
 * escape was already considered and rejected (`uncertainty-priority.ts:38-51`).
 *
 * These tests exist so re-adding it is a RED test rather than a silent ship.
 * They are bound to the CLAIM, not to the drafted wording, so a paraphrase does
 * not walk past them.
 */
describe('⛔ makes no sensitivity or option-switching claim (banned pending a ruling)', () => {
  const shapes = [[{ factor_id: 'a' }], [{ factor_id: 'a' }, { factor_id: 'b' }]];

  it('no emittable sentence mentions the ranking or the front-runner', () => {
    for (const recs of shapes) {
      const s = buildInferredValueDisclosure(recs);
      for (const banned of [
        'comes out in front',
        'which option',
        'front-runner',
        'leading option',
        'worth settling',
        'the engine can resolve',
        'noise floor',
      ]) {
        expect(s.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('the published grammar cannot ADMIT such a sentence either', () => {
    // The grammar is the egress contract: if it admitted the banned claim, a
    // future builder change could ship it without touching this file.
    for (const banned of ['comes out in front', 'worth settling', 'engine can resolve']) {
      expect(INFERRED_VALUE_DISCLOSURE_RE_SRC).not.toContain(banned);
    }
  });

  it('CONTRAST: the authorship claim it DOES make survives — this is not a blanket gag', () => {
    const s = buildInferredValueDisclosure([{ factor_id: 'a' }]);
    expect(s).toContain('mine rather than yours');
    expect(s).toContain('changes what this model implies');
  });
});

describe('the length budget is DERIVED from the builder, never hand-estimated', () => {
  /**
   * ⛔ THE FAILURE THIS FORBIDS. A budget smaller than the builder's own worst
   * case does not truncate the suffix — the caller DROPS it, and the user is
   * silently not told the numbers were ours. That is the exact claim-safety
   * failure this module exists to close, reintroduced by an arithmetic slip.
   *
   * So the constant is not compared against; it is RE-DERIVED here by running
   * the real builder over every shape it can emit, and asserted EQUAL. A copy
   * edit that lengthens a sentence fails this test instead of going dark.
   */
  it('the constant equals the real worst case over every rendered count', () => {
    // 1 and 2 cover the singular/plural split; 99 and 150 cover the widest
    // rendered count and the clamp above it.
    const counts = [1, 2, 9, 10, 99, 150];
    let worst = 0;
    let worstSentence = '';
    for (const n of counts) {
      const recs = Array.from({ length: n }, (_, i) => ({ factor_id: `f${i}` }));
      const s = buildInferredValueDisclosure(recs);
      if (s.length > worst) {
        worst = s.length;
        worstSentence = s;
      }
    }
    expect(worstSentence).not.toBe('');
    expect(INFERRED_VALUE_DISCLOSURE_MAX_CHARS).toBe(worst);
  });
});
