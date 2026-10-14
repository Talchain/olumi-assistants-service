/**
 * Science goals §(i), 8 Oct (DL, served 7f9fe459): the card said "… × ‘Pro paying subscribers’, less ‘MRR lost to
 * price-induced churn’", but the stored identity is the product only, the "less" term is a separate definitional edge,
 * and the level its inputs give (49 × 250 = £12,250) is BEFORE that term. (1) A plain "£12,250 a month" is not honest
 * while the term has no figure; (2) the level is said "before ‘C’, which has no figure yet"; (3) the receipt names the
 * term exactly as the card did. One producer (`readingTermsOf`) for the card, the receipt and the level warning.
 * Graphs are CAPTURED /graph reads from P02's final wave (fixtures/goal-level-before-term-*.json, `_capture`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identityReceiptWords, levelBeforeTermsTail, proposeProductIdentity, readingTermsOf, readingTermsWords } from '../identity-proposal.js';
import { GOAL_LEVEL_FROM_IDENTITY_INPUTS, withGoalLevelInGoalUnits } from '../goal-level-in-goal-units.js';

type Rec = Record<string, any>;
const graph = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/goal-level-before-term-${name}.json`, import.meta.url), 'utf8')) as Rec;
const ISL = (level: string, operand: string) => `MRR has no level stated for today, so the chance of reaching the goal is measured from the level its inputs give today: ${level} in its own units; ${operand} is Olumi's estimate, so this is Olumi's estimate of today's MRR, not the user's.`;
const warned = (g: Rec, operand: string) => withGoalLevelInGoalUnits({ inference_warnings: [{ code: GOAL_LEVEL_FROM_IDENTITY_INPUTS, message: ISL('12,250.00', operand), severity: 'warning' }] }, g)
  .inference_warnings[0].message as string;
const TERM = '‘MRR lost to price-induced churn’';

describe('Science goals §(i): a derived level is said before a "less" term with no figure', () => {
  it('RED (7f9fe459, after Yes): the Run\'s level warning says "£12,250 a month, before ‘C’, which has no figure yet"', () => {
    expect(warned(graph('7f9fe459'), 'Pro paying subscribers')).toBe(ISL('12,250.00', 'Pro paying subscribers')
      .replace('12,250.00 in its own units', `£12,250 a month, before ${TERM}, which has no figure yet`));
  });
  it('RED (7f9fe459): the receipt\'s term is the card\'s term, word for word (one producer)', () => {
    const card = proposeProductIdentity(graph('7f9fe459-before'))!.words;
    expect(readingTermsWords(graph('7f9fe459'))).toBe(`, less ${TERM}`);
    expect(card).toContain(readingTermsWords(graph('7f9fe459')));
    expect(identityReceiptWords('MRR', 'Pro plan price', 'Pro paying subscribers', graph('7f9fe459'))).toBe(
      `Recorded, as you confirmed: "MRR" is calculated as "Pro plan price" × "Pro paying subscribers", less ${TERM}. Any earlier result is now out of date; run the analysis again to see it calculated that way.`);
  });
  it('CONTROL (da6d3e53, no addend): the warning is byte-identical to #2829\'s; no receipt term', () => {
    expect(warned(graph('da6d3e53'), 'Paying Pro subscribers')).toBe(ISL('12,250.00', 'Paying Pro subscribers').replace('12,250.00 in its own units', '£12,250 a month'));
    expect(readingTermsWords(graph('da6d3e53'))).toBe('');
    // Byte-identical to staging's receipt (agent-capabilities.ts before this change).
    expect(identityReceiptWords('MRR', 'Pro plan price', 'Paying Pro subscribers', graph('da6d3e53'))).toBe(
      'Recorded, as you confirmed: "MRR" is calculated as "Pro plan price" × "Paying Pro subscribers". Any earlier result is now out of date; run the analysis again to see it calculated that way.');
  });
  it('CONTROL: a term WITH a figure keeps the plain level (the receipt still names it)', () => {
    const g = graph('7f9fe459');
    g.nodes.find((n: Rec) => n.id === 'mrr_lost_to_price_induced_churn').observed_state = { raw_value: 400, unit: '£/month' };
    expect(levelBeforeTermsTail(g)).toBe('');
    expect(readingTermsWords(g)).toBe(`, less ${TERM}`);
  });
  it('CONTROL: a kept-out or non-definitional parent is not a term of the reading', () => {
    const out = graph('7f9fe459'); out.nodes.find((n: Rec) => n.id === 'mrr_lost_to_price_induced_churn').analysis_participation = 'retained_excluded';
    expect(readingTermsOf(out)).toEqual([]);
    const nd = graph('7f9fe459'); delete nd.edges.find((e: Rec) => e.from === 'mrr_lost_to_price_induced_churn').provenance.definitional;
    expect(readingTermsOf(nd)).toEqual([]);
  });
  it('two open terms: "before ‘A’ and ‘B’, which have no figures yet"', () => {
    const g = graph('7f9fe459');
    g.nodes.push({ id: 'refunds', kind: 'risk', label: 'Refunds' });
    g.edges.push({ from: 'refunds', to: 'mrr', effect_direction: 'negative', provenance: { definitional: true } });
    expect(levelBeforeTermsTail(g)).toBe(`, before ${TERM} and ‘Refunds’, which have no figures yet`);
  });
});
