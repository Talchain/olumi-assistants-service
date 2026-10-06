/**
 * ⛔ RT-7 (red team #87 5992627435; re-witnessed on 43e51050, turn 2ff3cc10): "Make the rise 6% instead of 8%." made six
 * tool calls, each refused in-process, then hit the hop limit, and the user read "I was not able to finish that within
 * this turn. Ask me again and I will continue." Asking again replays the same refusals, so the promise is false and the
 * typed reason never reaches the user. The reply is composed from the turn's own typed results, never from a refusal's
 * `detail`/`reason`/note, which address the Agent.
 */
import { describe, it, expect } from 'vitest';
import { hopLimitText } from '../../../routes/agent-v1-turn.js';

const refused = (r: Record<string, unknown>) => ({ ok: false, mutated: false, ...r });
const turn = (results: Record<string, unknown>[], mutated = false) => ({
  tool_calls: results.map(() => ({ name: 'propose_option_interventions' })), tool_results: results, mutated,
});
const PROMISE = /ask me again|continue/i;

describe('hopLimitText', () => {
  it('RED (RT-7): six "no stated range" refusals → the reason, never the "ask me again" promise', () => {
    const r = refused({ refusal: 'nothing_to_set',
      no_stated_range: [{ factor: 'Bread price increase', detail: '"Bread price increase" has no stated range, and 6 cannot be read against one. Nothing here will pick a range on your behalf for a figure like that.' }],
      detail: 'Nothing could be recorded. Tell the user exactly which of these it was and why.' });
    const t = hopLimitText(turn([r, r, r, r, r, r]));
    expect(t).toBe('Nothing was changed. "Bread price increase" has no stated range, and 6 cannot be read against one. '
      + 'Nothing here will pick a range on your behalf for a figure like that.');
    expect(t).not.toMatch(PROMISE);
    expect(t).not.toMatch(/Tell the user/);
  });

  it.each([
    ['already set', { already_set: ['Raise prices already sets Bread price increase to 8'] }, 'Nothing was changed. Raise prices already sets Bread price increase to 8.'],
    ['not the user\'s figure', { not_the_users_figure: [{ option: 'Raise prices', factor: 'Bread price increase', value: 6 }],
      not_the_users_figure_note: 'The user did not write these figures… Say so plainly.' },
      'Nothing was changed. 6 for Bread price increase in Raise prices is not a figure you wrote, so it was not recorded as yours.'],
    ['two names for one thing', { ambiguous_targets: [{ requested: 'price', candidates: [
      { id: 'a', label: 'Bread price', connected_to: ['Footfall'] }, { id: 'b', label: 'Subscription price', connected_to: ['Wholesale subscription revenue'] }] }],
      ambiguous_note: 'More than one entity… never by its id.' },
      'Nothing was changed. More than one thing in your model is called “price”: “Bread price” (linked to Footfall) or “Subscription price” (linked to Wholesale subscription revenue). Which do you mean?'],
    ['an unknown option', { unresolved: ['option "Raise price"'], levels_not_accepted: [{ option: 'Raise price', reason: 'No option in the model is labelled "Raise price". Use an option label exactly as get_canonical_state gives it.' }] },
      'Nothing was changed. I could not find option "Raise price" in your model.'],
  ] as const)('nothing_to_set (%s) → its typed reason in the user\'s terms, no Agent instruction', (_n, why, said) => {
    const t = hopLimitText(turn([refused({ refusal: 'nothing_to_set', ...why, detail: 'Nothing could be recorded. Tell the user exactly which of these it was and why.' })]));
    expect(t).toBe(said);
    expect(t).not.toMatch(/get_canonical_state|Tell the user|Say so plainly|its id/);
  });

  it('a refusal that asks ONE typed question → that question, verbatim', () => {
    const q = 'Is £1 a change in “Pro plan price”, or its level today?';
    expect(hopLimitText(turn([refused({ refusal: 'not_the_users_statement', question: q, detail: 'Ask the user this question.' })]))).toBe(q);
  });

  it('only the LAST refusal speaks; a later successful read does not hide it', () => {
    const t = hopLimitText({ tool_calls: [{ name: 'propose_option_interventions' }, { name: 'get_canonical_state' }],
      tool_results: [refused({ refusal: 'nothing_to_set', already_set: ['Raise prices already sets Bread price increase to 8'] }), { ok: true, graph: {} }], mutated: false });
    expect(t).toBe('Nothing was changed. Raise prices already sets Bread price increase to 8.');
  });

  it('a turn that CHANGED the model says so, and never promises to continue', () => {
    const t = hopLimitText(turn([{ ok: true, mutated: true }, refused({ refusal: 'nothing_to_set', already_set: ['x'] })], true));
    expect(t).toBe('Your model was updated, but I could not finish the rest within this turn. Ask me what changed.');
  });

  it('CONTROL: no typed reason → an honest limit, never the "ask me again" promise', () => {
    for (const results of [[], [{ ok: true }], [refused({ refusal: 'some_other_refusal', detail: 'Use another tool.' })]]) {
      const t = hopLimitText(turn(results));
      expect(t).toBe('I could not settle that within this turn, and nothing in your model was changed. Try asking for one change at a time.');
      expect(t).not.toMatch(PROMISE);
    }
  });
});
