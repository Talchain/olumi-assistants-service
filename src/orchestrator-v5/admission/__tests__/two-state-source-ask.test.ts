/**
 * ⭐ A TWO-STATE SOURCE IS ASKED ABOUT AS THE SWITCH, NEVER AS A RISE (DL 0df0e1; red team 19 #87 6009566552).
 *
 * Served T1b a7d034ae (CEE b38592ed) asked "…when Starter tier launched rises by 1 0 / 1?": a binary source phrased as
 * a one-unit rise in the unit "0/1". The rule lives in ONE helper (`sourceChangeWords`, `say-figure.ts`) that every
 * one-unit-of-a-source ask goes through (target-testability's upstream link question; goal-certainty's two gauge asks).
 * Rows: the T1b switch ask; the continuous control byte-identical; the option-made switch; the count control.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notTargetTestableSentence, targetTestabilityOf } from '../target-testability.js';
import { isTwoStateSource, sourceChangeWords } from '../../agent-lane/say-figure.js';

type Json = Record<string, any>;
const D3 = JSON.parse(readFileSync(new URL('./fixtures/bprime-d3-guessed-upstream-link.json', import.meta.url), 'utf8')) as Json;

/** bprime-failing-link-own-ends' "far end in its own unit" graph: the upstream link question asks in both ends' units. */
const upstreamAsk = (source?: (n: Json) => void): string => {
  const g = structuredClone(D3);
  const e = g.edges.find((x: Json) => x.from === 'existing_price_increase' && x.to === 'monthly_recurring_revenue');
  e.provenance = { ...e.provenance, magnitude: 'user_stated' };
  g.nodes.find((n: Json) => n.id === 'starter_tier_monthly_recurring_revenue').observed_state = { unit: '£/month', value: 0, raw_value: 0, cap: 50000, source: 'cee_inference' };
  if (source !== undefined) source(g.nodes.find((n: Json) => n.id === 'starter_monthly_price'));
  return notTargetTestableSentence(g, targetTestabilityOf(g));
};

describe('the upstream link question', () => {
  it('CONTROL: a continuous source is unchanged, byte for byte', () => {
    expect(upstreamAsk()).toMatch(/ Roughly how much does Starter-tier monthly recurring revenue change, in £\/month, when Starter monthly price rises by £1 \/ subscriber \/ month\?$/);
  });
  it('the T1b switch: a "0/1" source is asked "with {source}", never "rises by 1 0 / 1"', () => {
    const text = upstreamAsk((n) => {
      n.label = 'Starter tier launched';
      n.unit = '0/1';
      n.observed_state = { ...(n.observed_state ?? {}), unit: '0/1' };
    });
    expect(text).toMatch(/ Roughly how much does Starter-tier monthly recurring revenue change, in £\/month, with Starter tier launched\?$/);
    expect(text).not.toMatch(/rises by 1|0 \/ 1/);
  });
});

describe('the one helper', () => {
  it.each(['0/1', '0 / 1', 'binary', 'Yes/No', 'on/off', 'true/false', 'boolean'])('"%s" is two-state', (unit) => {
    expect(isTwoStateSource([], 'f', unit)).toBe(true);
  });
  it('a switch the options create (no unit; every option sets 0 or 1) is two-state', () => {
    const nodes = [{ id: 'o1', kind: 'option', interventions: { f: 1 } }, { id: 'o2', kind: 'option', interventions: { f: { value: 0 } } }];
    expect(isTwoStateSource(nodes, 'f', undefined)).toBe(true);
  });
  it('CONTROL: a count with its own unit stays a count, even at 0 and 1 ("1 hire")', () => {
    const nodes = [{ id: 'o1', kind: 'option', interventions: { f: 1 } }, { id: 'o2', kind: 'option', interventions: { f: 0 } }];
    expect(isTwoStateSource(nodes, 'f', 'hires')).toBe(false);
    expect(sourceChangeWords('‘Hires’', 'hires', false)).toMatchObject({ aRiseIn: 'a 1 hire rise in ‘Hires’', eachOf: 'each 1 hire of ‘Hires’' });
  });
  it('CONTROL: an option setting any other level keeps the source continuous', () => {
    expect(isTwoStateSource([{ id: 'o1', kind: 'option', interventions: { f: 2 } }, { id: 'o2', kind: 'option', interventions: { f: 0 } }], 'f', undefined)).toBe(false);
  });
  it('the switch forms', () => {
    expect(sourceChangeWords('‘Starter tier launched’', '0/1', true)).toEqual({
      aRiseIn: '‘Starter tier launched’', eachOf: '‘Starter tier launched’', when: 'with ‘Starter tier launched’',
    });
  });
});
