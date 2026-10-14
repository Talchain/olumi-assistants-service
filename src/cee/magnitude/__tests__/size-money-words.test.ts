/**
 * MONEY IS SAID AS THE USER WRITES IT (AIQ #75 5923220559). Served paul-1 and paul-2 on `d23f5df1` read, in the build turn's
 * open questions: "…raises "Angel funding secured" by 20000 £…" and "…lowers "securing funding" by 5000 GBP…". A size in a
 * currency unit goes through the estate's one figure formatter (`sayFigure`): "£20,000", "£5,000". Any other unit, and a
 * figure that formatter would round, keeps the words it had.
 */
import { describe, expect, it } from 'vitest';

import { sizeLink, type MagnitudeNode } from '../link-effect.js';
import { buildModelFromBrief, type CallStructuredModel } from '../../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';

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

  it('a money LEVEL is said as money too ("is £10,000 today")', () => {
    const cash = { label: 'Cash in bank', kind: 'factor', observed_state: { value: 0.1, raw_value: 10000, cap: 100000, unit: '£', source: 'brief_extraction', extractionType: 'explicit' }, option_levels: [] } as MagnitudeNode;
    const hires = { label: 'New hires', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'hires', source: 'brief_extraction', extractionType: 'explicit' }, option_levels: [0, 0.5] } as MagnitudeNode;
    const q = sizeLink({ direction: 'negative', effect_amount: -5000, effect_per_source_change: 1, user_stated: false }, hires, cash).question ?? '';
    expect(q).toContain('lowers "Cash in bank" by £5,000, but "Cash in bank" is £10,000 today');
  });

  it('CONTROL: a percentage level keeps its points ("by 30 points")', () => {
    const churn = { label: 'Churn', kind: 'factor', observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: '%', source: 'cee_inference', extractionType: 'inferred' }, option_levels: [] } as MagnitudeNode;
    const q = asked(30, 1, count('Price rises', 'rises', 10), churn);
    expect(q).toContain('by 30 points');
    expect(q).not.toMatch(/£/);
  });
});

/**
 * THE REAL BUILD PATH: `construction-target-is-not-an-effect.test.ts` ROW 1/2 builds through `buildModelFromBrief` and reads
 * the open question the user sees: "…lowers "Monthly spend" by £9,000 per month…" (staging said "by 9000 GBP per month").
 * The angel-funding row this file first had no longer reaches a question on staging: the frame refit now fits Olumi's
 * £20,000 (`refitFramesForOlumiEstimates`), so nothing is asked back.
 */
