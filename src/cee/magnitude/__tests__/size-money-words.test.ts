/**
 * MONEY IS SAID AS THE USER WRITES IT (AIQ #75 5923220559). Served paul-1 and paul-2 on `d23f5df1` read, in the build turn's
 * open questions: "…raises "Angel funding secured" by 20000 £…" and "…lowers "securing funding" by 5000 GBP…". A size in a
 * currency unit goes through the estate's one figure formatter (`sayFigure`): "£20,000", "£5,000". Any other unit, and a
 * figure that formatter would round, keeps the words it had.
 */
import { describe, expect, it } from 'vitest';

import { sizeLink, type MagnitudeNode } from '../link-effect.js';

const outcome = (label: string, unit: string, cap: number): MagnitudeNode => ({ label, kind: 'outcome', scale_frame: cap, unit, option_levels: [] } as MagnitudeNode);
const count = (label: string, unit: string, cap: number): MagnitudeNode => ({
  label, kind: 'factor', observed_state: { value: 0.1, raw_value: cap / 10, cap, unit, source: 'cee_inference', extractionType: 'inferred' }, option_levels: [],
});
/** Olumi's own size, too large for the frames, so its statement is asked back in the question (the served shape). */
const asked = (amount: number, per: number, source: MagnitudeNode, target: MagnitudeNode): string =>
  sizeLink({ direction: 'positive', effect_amount: amount, effect_per_source_change: per, user_stated: false }, source, target).question ?? '';

describe('a size in money is said as money', () => {
  it('RED (served paul-1): "by £20,000", never "by 20000 £"', () => {
    const q = asked(20000, 1, count('Qualified angel conversations', 'conversations/month', 100), outcome('Angel funding secured', '£', 10000));
    expect(q).toContain('raises "Angel funding secured" by £20,000,');
    expect(q).not.toMatch(/20000 £/);
  });

  it('RED (served paul-2): a currency CODE says its symbol ("£5,000", never "5000 GBP")', () => {
    const q = asked(5000, 1, count('Deals closed', 'deals', 10), outcome('Funding', 'GBP', 10000));
    expect(q).toContain('by £5,000,');
    expect(q).not.toMatch(/GBP/);
  });

  it('pence are said with both digits ("£49.50 per month")', () => {
    expect(asked(49.5, 1, count('Subscribers', 'subscribers', 2000), outcome('MRR', 'GBP per month', 30))).toContain('by £49.50 per month,');
  });

  it('CONTROL: a count keeps its own words ("by 1500 subscribers")', () => {
    expect(asked(1500, 1, count('Ad spend', 'campaigns', 10), outcome('Subscribers', 'subscribers', 1000))).toContain('by 1500 subscribers,');
  });

  it('CONTROL: a money figure the formatter would round keeps its exact words ("0.125 £")', () => {
    expect(asked(0.125, 1, count('Clicks', 'clicks', 10), outcome('Revenue', '£', 0.1))).toContain('by 0.125 £,');
  });
});
