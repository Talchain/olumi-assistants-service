import { describe, expect, it } from 'vitest';
import { sameUnit, readMoney, readCountRate, evidencePeriod } from '../../../../orchestrator-v5/agent-lane/same-unit.js';
import { canonicalQuantityUnits, unitEvidenceReason, literalConventionValue } from '../quantity-evidence.js';
import type { DraftStatedItem } from '../grammar.js';
const item = (unit: string, source_quote: string, unit_literals: string[], value_literal = '10'): DraftStatedItem =>
  ({ kind: 'figure', quantity: 0, unit, source_quote, value: 10, value_literal, unit_literals });
describe('U-CANON v1 one table, no conversion', () => {
  it.each([['percent','%'], ['per cent','pct'], ['percentage points','pp'], ['GBP/week','pounds each week'],
    ['USD/day','$ daily'], ['EUR/quarter','euros quarterly'], ['hours/week','hrs every week'],
    ['minutes/day','min a day'], ['customers/month','customer pcm'], ['GBP/year','sterling per annum'], ['GBP per customer-week','£/customer/week']])('equal %s = %s', (a,b) => expect(sameUnit(a,b)).toBe(true));
  it.each([['%','pp'], ['£/week','£/month'], ['customers','clients'], ['£k','GBP'], ['percentile','percent'],
    ['m','month'], ['k','GBP'], ['p','%'], ['pm','pcm'], ['pw','weekly'], ['hours/week','hours/month'], ['USD','EUR'], ['£k','£k'], ['GBP/month/month','GBP/month/month']])('refused twin %s != %s', (a,b) => expect(sameUnit(a,b)).toBe(false));
  it.each(['per','a','an','each','every','/'])('week introducer %s', p => {
    expect(readMoney(`GBP ${p} week`, '')).toEqual({code:'GBP',period:'week',per:null});
    expect(readCountRate(`hrs ${p} week`)).toEqual({noun:['hour'],period:'week'});
    expect(evidencePeriod([`${p} week`])).toBe('week');
  });
  it.each([['percent','10%',['%'],'10%'], ['pounds/week','£10 each week',['each week'],'£10'],
    ['hours/week','10 hrs weekly',['hrs','weekly'],'10'], ['pp','10 percentage points',['percentage points'],'10']])('components evidenced %s', (unit,quote,parts,literal) => {
    expect(unitEvidenceReason(item(unit,quote,parts,literal),unit)).toBeUndefined();
  });
  it.each([['£/customer/week','£10 weekly',['weekly'],'£10'], ['hours/week','10 weekly',['weekly'],'10'],
    ['GBP/month','£10 weekly',['weekly'],'£10'], ['£k','£10k',['£'],'£10k']])('missing component refused %s', (unit,quote,parts,literal) => {
    expect(unitEvidenceReason(item(unit,quote,parts,literal),unit)).toBeDefined();
  });
  it('explicit percent conventions read the table, never the magnitude',()=>{expect(literalConventionValue(0.05,'per cent','ratio')).toBe(5);expect(literalConventionValue(0.05,'pp','ratio')).toBe(0.05);});
  it('compiler canonicalises without changing authored inputs or literals', () => {
    const i=item('hours per week','10 hours each week',['hours','each week']);
    const result=canonicalQuantityUnits({stated_items:[i],claims:[]});
    expect(result.refusals).toEqual([]); expect(sameUnit(result.records.stated_items[0]!.unit,'hour/week')).toBe(true);
    expect(i.unit).toBe('hours per week'); expect(result.records.stated_items[0]!.unit_literals).toEqual(i.unit_literals);
  });
});
