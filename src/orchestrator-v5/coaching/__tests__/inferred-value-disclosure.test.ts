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
