/**
 * The construction contract has nowhere to put the decision's own number.
 *
 * ⛔ THE FINDING, measured on both live configurations. The brief says
 * "increase the Pro plan price **from £49 to £59**". The builder captures £49 as
 * a structured factor baseline — auditable, typed, reachable. It captures £59
 * **only as characters inside an option label**. It is not a value anywhere in
 * either candidate.
 *
 * The banked option contract is `{ label, provenance }` and nothing else
 * (`builder-schema.json`). There is no slot for "this option sets Pro plan price
 * to 59", so the single most important number in the decision never becomes
 * model content.
 *
 * ⭐ AND THE CONSEQUENCE IS USER-VISIBLE, not theoretical. Running analysis
 * through the real endpoint returns `analysis_ready.status: "blocked"` with 4 of
 * 5 options at `needs_user_mapping`, and the product asks:
 *
 *     "Choose which option changes for "Pro plan price" and by how much."
 *
 * The user already answered that, in the first sentence of their brief. The
 * product is right to ask rather than guess — the fault is upstream, in a
 * contract that had nowhere to carry the answer.
 *
 * This test pins the gap so it cannot close silently: when a producer contract
 * gains typed interventions, these assertions fail and this file is the place
 * that explains why they should.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const d = new URL('./fixtures/', import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, d), 'utf8'));

const numbersIn = (o: unknown, path = ''): string[] => {
  const out: string[] = [];
  if (o !== null && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'number') out.push(`${path}.${k}=${v}`);
      else out.push(...numbersIn(v, `${path}.${k}`));
    }
  }
  return out;
};

describe('the decisive number is not model content', () => {
  for (const [name, file] of [['config A (two-pass)', 'faithful.json'], ['config B (one-pass)', 'configB.json']] as const) {
    it(`${name}: 59 appears in a label but is NOT a value`, () => {
      const c = load(file);
      const nums = numbersIn(c);
      expect(JSON.stringify(c), 'the brief’s target price is present as TEXT').toContain('59');
      expect(nums.some((n) => n.endsWith('=59')), 'but nowhere as a NUMBER').toBe(false);
    });

    it(`${name}: options carry no interventions at all`, () => {
      for (const o of load(file).options) {
        expect(Object.keys(o).sort()).toEqual(['label', 'provenance']);
      }
    });
  }

  it('the four numbers that DO survive are the same in both configurations', () => {
    const shape = (f: string) => numbersIn(load(f)).sort();
    expect(shape('faithful.json')).toEqual([
      '.constraints.0.value=4', '.factors.0.baseline_value=49',
      '.goal.horizon_months=12', '.goal.value=20000',
    ]);
    expect(shape('configB.json')).toEqual(shape('faithful.json'));
  });
});
