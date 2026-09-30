/**
 * ⛔ ONE QUANTITY, ONE MEANING (R3 #75 5914500931; AIQ 5914532431; DL 5915507578 item 4).
 *
 * Paul's funding brief weighs angel outreach against "whether the overhead would be worth it". The served draft kept ONE
 * lever — "Funding process overhead" (hours/week) — that the options set and that cut investor conversations; Paul later
 * sized it as EFFORT, so his size landed on a meaning he never held. The drafter is now told to keep the activity's
 * effort and its cost as two quantities. This pins that the rule is SENT — on the first draft and on every retry, which
 * extend the same instructions. Whether drafts follow it is measured on served builds of Paul's brief, not here.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS } from '../runtime/build-model.js';

describe("construction keeps an activity's effort and its cost apart (DL 5915507578 item 4)", () => {
  it('the construction instructions carry the rule, with the effort named for the activity and the cost as its own node', () => {
    const text = String(BUILD_INSTRUCTIONS);
    expect(text).toContain('KEEP AN ACTIVITY’S EFFORT AND ITS COST APART');
    expect(text).toMatch(/draft TWO quantities, never one that means both/);
    expect(text).toMatch(/Never name a lever the options set for its cost \("overhead"\)/);
  });

  it('AIQ CR (5916139879): the rule never splits MONEY the options set — a spend lever stays one quantity in its money unit', () => {
    expect(String(BUILD_INSTRUCTIONS)).toMatch(/This never splits MONEY the options set: a budget, a price, a spend or a split of spend IS the lever, and stays ONE quantity in its own money unit\./);
  });
});
