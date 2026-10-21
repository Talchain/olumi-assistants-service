/** `note_on_item`: Olumi's one note beside one item of the saved model, as the existing `ui_directive` block. Writes nothing. */
import { describe, expect, it, vi } from 'vitest';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';
import { NOTE_MAX, noteOnItem } from '../note-on-item.js';
import { read } from './fixtures.js';

const ctx = { scenario_id: 'scn_1' };
const NOTE = 'What would make two assistants on shift too few?';
function setup(json: Record<string, unknown> = read()) {
  const dispatch = vi.fn(async () => ({ status: 200, json }));
  return { dispatch, turn: { notes: 0 } };
}

describe('note_on_item', () => {
  it('a factor of the saved model gets the note beside it: highlight, one target with its own label and kind, Olumi as composer', async () => {
    const { dispatch, turn } = setup();
    const out = await noteOnItem({ dispatch }, ctx, { item_id: 'staff', note: `  ${NOTE} ` }, turn);
    expect(out).toEqual({ status: 'ok', mutated: false, ran: false, data: { graph_identity: 'id_one', ui_directive: {
      type: 'ui_directive', verb: 'highlight', targets: [{ id: 'staff', label: 'Assistants on shift', kind: 'factor' }], note: NOTE, source: 'composer' } } });
    expect(out.status === 'ok' && UiDirectiveBlockSchema.safeParse(out.data.ui_directive).success).toBe(true);
    // A read only: the graph route, never a write.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(String((dispatch.mock.calls[0] as unknown[])[0])).toBe('/assist/v1/scenarios/scn_1/graph');
  });

  it.each([
    ['an id not in the model', { item_id: 'nowhere', note: NOTE }, 'item_not_in_model'],
    ['the decision, which has no card note', { item_id: 'decision', note: NOTE }, 'item_not_in_model'],
    ['an empty note', { item_id: 'staff', note: '   ' }, 'note_empty'],
    ['a note over the contract limit', { item_id: 'staff', note: 'x'.repeat(NOTE_MAX + 1) }, 'note_too_long'],
    ['a link (no link identity yet)', { item_id: 'staff->goal', note: NOTE }, 'item_not_in_model'],
    ['a note that ranks options ("best")', { item_id: 'add_staff', note: 'This is the best option here.' }, 'note_ranks_options'],
    ['a note that recommends', { item_id: 'add_staff', note: 'I would recommend testing this first.' }, 'note_ranks_options'],
    ['a note naming a machine id', { item_id: 'staff', note: 'Does add_staff really move this?' }, 'note_names_an_id'],
  ])('refuses %s, and reads nothing it does not need', async (_name, args, reason) => {
    const { dispatch, turn } = setup();
    expect(await noteOnItem({ dispatch }, ctx, args, turn)).toMatchObject({ status: 'refused', reason });
    expect(turn.notes).toBe(0);
  });

  it('one note per turn: the second is refused, the first stands', async () => {
    const { dispatch, turn } = setup();
    expect(await noteOnItem({ dispatch }, ctx, { item_id: 'staff', note: NOTE }, turn)).toMatchObject({ status: 'ok' });
    expect(await noteOnItem({ dispatch }, ctx, { item_id: 'queue', note: NOTE }, turn)).toMatchObject({ status: 'refused', reason: 'one_note_per_turn' });
  });

  it('CONTRAST: a plain word that is also an id ("goal") is ordinary wording, not an id', async () => {
    const { dispatch, turn } = setup();
    expect(await noteOnItem({ dispatch }, ctx, { item_id: 'staff', note: 'Does this really serve the goal on busy days?' }, turn)).toMatchObject({ status: 'ok' });
  });

  it('CONTRAST: a note at exactly the limit is kept whole', async () => {
    const { dispatch, turn } = setup();
    const note = 'y'.repeat(NOTE_MAX);
    expect(await noteOnItem({ dispatch }, ctx, { item_id: 'goal', note }, turn)).toMatchObject({ status: 'ok', data: { ui_directive: { note, targets: [{ kind: 'goal' }] } } });
  });

  it('a scenario with no model yet has nothing to note', async () => {
    const { dispatch, turn } = setup({ graph: null, graph_present: false });
    expect(await noteOnItem({ dispatch }, ctx, { item_id: 'staff', note: NOTE }, turn)).toMatchObject({ status: 'refused', reason: 'item_not_in_model' });
  });
});
