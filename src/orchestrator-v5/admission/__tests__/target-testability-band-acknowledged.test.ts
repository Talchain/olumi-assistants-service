/**
 * ⭐ MC D1 (e) — THE LINK QUESTION SAYS WHAT THE USER ALREADY SET (DL 6 Oct; Acceptance rehearsal 15 on CEE 3ee87d3).
 *
 * The user set "Service strain from starter support → MRR" slight → moderate (the canvas band edit, `user_specified`), and the
 * next Run asked "Roughly how much … in £/month" as if they had set nothing. A band is not a size in the target's unit
 * (Science: strength-as-size is banned), so it is still asked, after saying what they set (DL's words). Bound to the band
 * edit's own stamp (`adjust-edge-strength.ts`: `source: 'user_specified'` + `provenance_display: 'user_set'`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { targetTestabilityOf, untestableTargetParts } from '../target-testability.js';

type Json = Record<string, any>;
const RAW = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as { paul: Json };
const paul = (band: Json | null): Json => {
  const g = structuredClone(RAW.paul);
  for (const n of g.nodes) if (n.kind === 'goal') n.observed_state = { value: 0, baseline: 0, raw_value: 0, unit: '£', cap: n.goal_threshold_raw };
  const e = g.edges.find((x: Json) => x.from === 'investment_firm_meetings' && x.to === 'securing_funding');
  if (band !== null) Object.assign(e, band);
  return g;
};
const question = (g: Json): string | null | undefined => untestableTargetParts(g, targetTestabilityOf(g))?.question;
const ASK = 'Roughly how much securing funding in £ does a change in Investment firm meetings bring?';
const BAND = { provenance: { source: 'user_specified' }, provenance_display: 'user_set', strength: { mean: 0.5, std: 0.1 } };

describe('(e) a band the user set is said before its size is asked', () => {
  it('PRECONDITION: the asked link carries no band — the question is unchanged', () => {
    expect(question(paul(null))).toBe(ASK);
  });

  it('RED (rehearsal 15): the band edit\'s stamp → "You set this link as …", then the SAME question in the target\'s unit', () => {
    expect(question(paul(BAND))).toBe(`You set this link as strong. To test your £1,200,000 target I need it in £: ${ASK[0]!.toLowerCase()}${ASK.slice(1)}`);
  });

  it('CONTROL: a link the user only DREW (no band stamp) is never "set as" a band', () => {
    expect(question(paul({ ...BAND, provenance_display: undefined }))).toBe(ASK);
  });

  it('LICENCE: the asked investment_firm_meetings → securing_funding link with a projected mean is not a band the user set', () => {
    // Science 393023 LICENCE ruling 3, re-derived: "You set this link as strong" → the unchanged size question;
    // user_specified records drawing the link, mean_projected means nobody sized it even beside the stale display.
    const g = paul({ ...BAND, provenance: { source: 'user_specified', mean_projected: true } });
    expect(question(g)).toBe(ASK);
    expect(question(g)).not.toContain('You set this link as');
  });

  it('CONTROL: a link whose SIZE the user stated is not a band (it would not be asked at all)', () => {
    const g = paul({ ...BAND, provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 1000 } } });
    expect(question(g) ?? ASK).not.toContain('You set this link as');
  });
});
