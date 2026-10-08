/**
 * ⛔ A FALLBACK NEVER CONTRADICTS THE CARD IT SHIPS WITH (DL 58e392, 8 Oct; EDIT-UX served witness, staging 2dab5176, guest
 * scenario be7a896f, turn 3a5a1258). "Set 'New option' to change 'Sprint capacity for integration fix' to 50%." held a
 * `propose_option_interventions` card ("Record this level"), the turn then hit its hop limit, and the user read "I could not
 * settle that within this turn, and nothing in your model was changed." above that card — then "Yes, use those." saved it
 * ("Saved 1 of 1 option levels"). The tool results below are arranged in that turn's shape; the served words are quoted.
 */
import { describe, expect, it } from 'vitest';
import { hopLimitText, unfinishedAnswerText } from '../../../routes/agent-v1-turn.js';

const SERVED_FALLBACK = 'I could not settle that within this turn, and nothing in your model was changed. Try asking for one change at a time.';
const HELD = { ok: true, mutated: false, proposal_id: '264047b9-a5d2-4ea9-8136-e4a193c45532', public_label: 'Record this level', base_revision: 'h1',
  interventions: [{ option: 'New option', factor: 'Sprint capacity for integration fix', value: 50, unit: '%', stated_by: 'user' }] };
const REFUSED = { ok: false, mutated: false, refusal: 'some_other_refusal', detail: 'Use another tool.' };
const heldCall = { name: 'propose_option_interventions', ok: true, mutated: false, proposal_id: HELD.proposal_id };
const refusedCall = { name: 'propose_option_interventions', ok: false, mutated: false, refusal: 'some_other_refusal' };
const SERVED_TURN = { tool_calls: [heldCall, refusedCall], tool_results: [HELD, REFUSED], mutated: false };
const TYPED = 'I’ve prepared this change: Record this level.\n\nApprove this change?';
const CONTRADICTS = /could not settle|nothing in your model was changed|Nothing was changed|cut short/i;

describe.each([['hop limit', hopLimitText], ['cut-short answer', unfinishedAnswerText]] as const)('%s with a held card', (_n, fallback) => {
  it('RED (be7a896f): a turn offering one held card answers with that card’s own typed reply, never "could not settle"', () => {
    const t = fallback(SERVED_TURN);
    expect(t).toBe(TYPED);
    expect(t).not.toMatch(CONTRADICTS);
  });

  it('a held result the typed composer does not cover → the one held-change sentence', () => {
    const t = fallback({ ...SERVED_TURN, tool_results: [{ ...HELD, extra_key: 1 }, REFUSED] });
    expect(t).toBe('I have prepared this change: Record this level. Nothing is changed until you approve it.');
  });

  it('a turn that also changed the model says both', () => {
    expect(fallback({ ...SERVED_TURN, mutated: true })).toBe(`Your model was updated. ${TYPED}`);
  });

  it('CONTROL: the held proposal consumed by a later approval → no card, so no held-change words', () => {
    const t = fallback({ tool_calls: [heldCall, { name: 'authorise_change', ok: true, mutated: true, proposal_id: HELD.proposal_id }],
      tool_results: [HELD, { ok: true, mutated: true }], mutated: true });
    expect(t).not.toMatch(/prepared this change/);
  });

  it('CONTROL: two held proposals → approvalChipsFor offers no card, so neither is described', () => {
    const second = { ...HELD, proposal_id: 'p2', public_label: 'Record another level' };
    const t = fallback({ tool_calls: [heldCall, { ...heldCall, proposal_id: 'p2' }], tool_results: [HELD, second], mutated: false });
    expect(t).not.toMatch(/prepared this change/);
  });
});

it('CONTROL: with no held card the hop limit keeps its honest served sentence', () => {
  expect(hopLimitText({ tool_calls: [refusedCall], tool_results: [REFUSED], mutated: false })).toBe(SERVED_FALLBACK);
});

it('CONTROL: a run’s own sentence still wins on a cut-short answer', () => {
  const t = unfinishedAnswerText({ tool_calls: [heldCall, { name: 'run_analysis', ok: false, mutated: false }],
    tool_results: [HELD, { ok: false, mutated: false, refusal: 'not_ready' }], mutated: false });
  expect(t).not.toMatch(/prepared this change/);
  expect(t).toMatch(/analysis/i);
});
