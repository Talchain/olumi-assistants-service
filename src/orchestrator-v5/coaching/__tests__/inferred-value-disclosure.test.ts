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
  readInferredValueResolution,
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
describe('the disclosure says whether OUR numbers actually matter', () => {
  const inferred = [{ factor_id: 'a' }, { factor_id: 'b' }];

  it('none matter → says so, and points at the reasoning instead', () => {
    const enrichment = { p_win_sensitivity: [
      { factor_id: 'a', status: 'below_resolution' },
      { factor_id: 'b', status: 'below_resolution' },
    ] };
    expect(readInferredValueResolution(enrichment, inferred)).toBe('none_matter');
    const s = buildInferredValueDisclosure(inferred, 'none_matter');
    expect(s).toContain('none of them changes which option comes out in front');
    // ⛔ THE INVERSION GUARD, PLURAL ONLY. Splicing `${one ? 'it does' :
    // 'none of them does'} not change` rendered the plural as "none of them
    // does not change" — a double negative stating the OPPOSITE of the run's
    // verdict. This test asserted that defective string until 23 Sep, so it is
    // now bound to the meaning rather than to the bytes that came out. The
    // singular below is the contrast: there "does not change" is CORRECT, so a
    // blanket ban on the phrase would be the wrong invariant.
    expect(s).not.toContain('does not change');
    expect(s).toContain('push back is the reasoning');
  });

  it('CONTRAST, singular: the same verdict reads "it does not change"', () => {
    const one = [{ factor_id: 'a' }];
    const enrichment = { p_win_sensitivity: [{ factor_id: 'a', status: 'below_resolution' }] };
    expect(readInferredValueResolution(enrichment, one)).toBe('none_matter');
    const s = buildInferredValueDisclosure(one, 'none_matter');
    expect(s).toContain('it does not change which option comes out in front');
    expect(s).toContain('not that number.');
  });

  it('one matters → says it is worth settling', () => {
    const enrichment = { p_win_sensitivity: [
      { factor_id: 'a', status: 'below_resolution' },
      { factor_id: 'b', status: 'resolved' },
    ] };
    expect(readInferredValueResolution(enrichment, inferred)).toBe('some_matter');
    expect(buildInferredValueDisclosure(inferred, 'some_matter')).toContain('worth settling');
  });

  it('⛔ a PARTIAL sweep is unknown — "none matter" needs every factor accounted for', () => {
    const partial = { p_win_sensitivity: [{ factor_id: 'a', status: 'below_resolution' }] };
    expect(readInferredValueResolution(partial, inferred)).toBe('unknown');
  });

  it('missing or malformed enrichment is unknown, never a guess', () => {
    for (const e of [undefined, null, {}, { p_win_sensitivity: null }, { p_win_sensitivity: [1, 'x'] }]) {
      expect(readInferredValueResolution(e, inferred)).toBe('unknown');
    }
  });

  it('⛔ sensitivity NEVER suppresses the disclosure itself', () => {
    // An assumption the team would dispute is worth seeing whether or not it
    // moves the ranking — disputing it is the reasoning.
    for (const r of ['none_matter', 'some_matter', 'unknown'] as const) {
      const s = buildInferredValueDisclosure(inferred, r);
      expect(s).toContain('I supplied 2 of the values behind this');
      expect(s).toContain('mine rather than yours');
    }
  });

  it('EVERY sensitivity variant still satisfies the published grammar', () => {
    const re = new RegExp(`^(?:${INFERRED_VALUE_DISCLOSURE_RE_SRC})$`);
    for (const r of ['none_matter', 'some_matter', 'unknown'] as const) {
      for (const n of [1, 2, 99]) {
        const s = buildInferredValueDisclosure(
          Array.from({ length: n }, (_, i) => ({ factor_id: `f${i}` })), r,
        );
        expect(re.test(s), `${r} n=${n} failed the grammar: ${s}`).toBe(true);
        expect(s.length).toBeLessThanOrEqual(INFERRED_VALUE_DISCLOSURE_MAX_CHARS);
      }
    }
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
  it('the constant equals the real worst case over every (count, resolution)', () => {
    const resolutions = ['none_matter', 'some_matter', 'unknown'] as const;
    // 1 and 2 cover the singular/plural split; 99 and 150 cover the widest
    // rendered count and the clamp above it.
    const counts = [1, 2, 9, 10, 99, 150];
    let worst = 0;
    let worstSentence = '';
    for (const n of counts) {
      const recs = Array.from({ length: n }, (_, i) => ({ factor_id: `f${i}` }));
      for (const r of resolutions) {
        const s = buildInferredValueDisclosure(recs, r);
        if (s.length > worst) {
          worst = s.length;
          worstSentence = s;
        }
      }
    }
    expect(worstSentence).not.toBe('');
    expect(INFERRED_VALUE_DISCLOSURE_MAX_CHARS).toBe(worst);
  });
});
