/**
 * ⭐ A BARE ANSWER BINDS ONLY TO OLUMI'S OWN RECORDED LINK-SIZE QUESTION (R3 #75 5926021003 (a); AIQ 5926045839).
 * Served R3 `train-0545Z` step 05 → #2437's ask: How much does one more "Qualified angel investor conversations" add to
 * "securing funding", in £? Paul's natural answer is "About £20,000". These rows read that reply against the RECORD of
 * the question (never its prose): the per-one, the ends and the direction are the question's; the amount is the user's.
 */
import { describe, expect, it } from 'vitest';

import { answerToLinkSizeAsk, type OpenLinkSizeAsk } from '../stated-by-user.js';

const ASK: OpenLinkSizeAsk = {
  ask_id: 'pa-1', from_id: 'qualified_angel_investor_conversations', to_id: 'securing_funding',
  source_label: 'Qualified angel investor conversations', target_label: 'securing funding',
  per_unit: 'conversations', amount_unit: 'GBP', direction: 1, graph_hash: 'h1',
};
const SCOPE = { quantities: ['Qualified angel investor conversations', 'securing funding', 'Seed round size', 'Monthly burn', 'Funding lost to distraction'] };

describe('answerToLinkSizeAsk: one figure, read against the recorded question', () => {
  it('RED (R3 positive): "About £20,000" → +£20,000 per one more conversation, the user\'s figure, words as written', () => {
    expect(answerToLinkSizeAsk('About £20,000', ASK, SCOPE)).toEqual({ kind: 'bound', amount: 20000, figure_words: 'about £20,000' });
  });
  it('control: "£20k each" and "roughly 20,000" bind the same figure', () => {
    expect(answerToLinkSizeAsk('£20k each', ASK, SCOPE)).toMatchObject({ kind: 'bound', amount: 20000 });
    expect(answerToLinkSizeAsk('roughly 20,000', ASK, SCOPE)).toMatchObject({ kind: 'bound', amount: 20000, figure_words: 'roughly 20,000' });
  });
  it('a negative link takes the question\'s direction: "about £5,000" → −£5,000', () => {
    expect(answerToLinkSizeAsk('about £5,000', { ...ASK, direction: -1 }, SCOPE)).toMatchObject({ kind: 'bound', amount: -5000 });
  });
  it('R3 negative: "£20k and 3 deals" → refused (another figure)', () => {
    expect(answerToLinkSizeAsk('£20k and 3 deals', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'several_figures' });
  });
  it('R3 negative: a reply naming another quantity → not bound (the rival rule)', () => {
    expect(answerToLinkSizeAsk('About £20,000 of the seed round', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'other_quantity_named' });
    expect(answerToLinkSizeAsk('About £20,000 a month in burn', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'other_quantity_named' });
  });
  it('control: the question\'s own words in the reply are not a rival ("towards funding", "per conversation")', () => {
    expect(answerToLinkSizeAsk('About £20,000 per conversation towards funding', ASK, SCOPE)).toMatchObject({ kind: 'bound', amount: 20000 });
  });
  it('R3 negative: "not sure" → nothing bound', () => {
    expect(answerToLinkSizeAsk('not sure', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'denied' });
    expect(answerToLinkSizeAsk('no idea, honestly', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'denied' });
  });
  it('R3 condition 4: a contradicting sign → refused ("it costs us £20k", "−£20,000")', () => {
    expect(answerToLinkSizeAsk('it costs us £20k', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'direction_contradicts' });
    expect(answerToLinkSizeAsk('-£20,000', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'direction_contradicts' });
    expect(answerToLinkSizeAsk('it adds about £5k', { ...ASK, direction: -1 }, SCOPE)).toEqual({ kind: 'miss', miss: 'direction_contradicts' });
  });
  it('control: an agreeing movement word binds ("it brings in about £20k")', () => {
    expect(answerToLinkSizeAsk('it brings in about £20k', ASK, SCOPE)).toMatchObject({ kind: 'bound', amount: 20000 });
  });
  it('a range is not one figure; a question asks; a figure in another unit is not the asked one', () => {
    expect(answerToLinkSizeAsk('£10k-£30k', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'range' });
    expect(answerToLinkSizeAsk('Maybe £20,000?', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'question' });
    expect(answerToLinkSizeAsk('about 20%', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'not_in_the_asked_unit' });
    expect(answerToLinkSizeAsk('about $20,000', ASK, SCOPE)).toEqual({ kind: 'miss', miss: 'not_in_the_asked_unit' });
  });
});
