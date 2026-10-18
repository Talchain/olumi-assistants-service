/**
 * ⛔ A CORRECTION THE USER ASKED FOR IN THE SAME TURN IS NEVER SILENTLY REFUSED (verifier F1, 18 Oct, PROMPT-INT-VERDICT-3730912b:
 * the AI rightly proposed cutting a held limit with the figure, the loop refused the limit as `one_change_per_approval`, and
 * after the approved figure the old limit stayed live: a stale write).
 *
 * The limit change gets its OWN card, clearly offered beside the figure's: a limit card is field-scoped (it holds while its row
 * still reads the figure it was made against, `heldCardStillApplies`), so approving the other card never makes it stale, and
 * its write lands on the model as it is then. Every card keeps its own button (PR-1).
 *
 * THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop → the REAL `propose_option_interventions` and
 * `propose_limit_change` → each card's press → `authoriseChange` → the REAL in-process level and limit doors → the store.
 * Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model (a bakery). TESTED, not WIRE-WITNESSED.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the same-turn limit replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the same-turn limit replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { ONE_CHANGE_PER_APPROVAL } from '../approval-chips.js';
import { heldCardStillApplies } from '../proposal-object/still-applies.js';
import { authorised, call, chipFor, closeApps, idOf, MIXER, mixerSaved, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';

const world = () => worldOver(live);
afterEach(closeApps);

const LIMIT_ROW = { constraint_id: 'gc-ovens-1', node_id: 'oven_capacity', operator: '<=', value: 3, unit: 'ovens', value_frame: 'level',
  label: 'Oven capacity', provenance: 'explicit' };
const WORDS = 'The faster mixer cuts prep time by 15%. And our oven capacity is at most 2 ovens now, not 3.';
const LIMIT = { limit_label: 'Oven capacity', operator: '<=', new_value: 2, unit: 'ovens', rationale: WORDS };
const limitRows = (g: Rec): Rec[] => (g.goal_constraints ?? []) as Rec[];

describe('a figure AND a limit in one turn: each its own card, and no stale limit after both are approved', () => {
  it('⭐ RED→GREEN: the limit card is offered beside the figure card, survives its approval, and its approval leaves no stale limit', async () => {
    const w = world(); const turn = await route(w);
    w.edit((g) => { g.goal_constraints = [structuredClone(LIMIT_ROW)]; });
    const both = await turn({ message: WORDS, source: 'composer' },
      [call('propose_option_interventions', MIXER), call('propose_limit_change', LIMIT), say('Here are both changes, each for you to approve.')]);
    const calls = both._agent.tool_calls as Rec[];
    expect(calls.map((c) => c.refusal), 'never refused for being the second change').not.toContain(ONE_CHANGE_PER_APPROVAL);
    const mixer = idOf(both, 'propose_option_interventions');
    const limit = idOf(both, 'propose_limit_change');
    const mixerChip = chipFor(both, mixer);
    chipFor(both, limit);
    // The figure first: the limit card is untouched by it and still offered to approve (never under review, never lapsed).
    const first = await turn({ message: mixerChip.message, source: 'chip_click', chip: { id: mixerChip.id }, agent_session_id: both._agent.session_id });
    expect(authorised(first)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(mixerSaved(w.read())).toBe(true);
    expect(limitRows(w.read()).map((r) => r.value), 'the limit is not changed by the figure').toEqual([3]);
    const limitChip = chipFor(first, limit);
    const second = await turn({ message: limitChip.message, source: 'chip_click', chip: { id: limitChip.id }, agent_session_id: both._agent.session_id });
    expect(authorised(second)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: limit })]);
    // ⭐ No stale limit: the one row now holds the user's 2 ovens, in its own unit, and the figure is still saved.
    expect(limitRows(w.read())).toEqual([expect.objectContaining({ constraint_id: 'gc-ovens-1', operator: '<=', value: 2, unit: 'ovens' })]);
    expect(mixerSaved(w.read())).toBe(true);
  }, 120_000);

  it('the limit card is field-scoped: it holds on a moved model while its row reads the old figure, and never once that row moved', () => {
    const op = { op: 'set_limit', path: 'oven_capacity', value: { operator: '<=', raw_value: 2, unit: 'ovens', constraint_id: 'gc-ovens-1', before: 3,
      row_as_made: structuredClone(LIMIT_ROW) } };
    const p = { operations: [op] } as never;
    const g = (row: Rec | undefined) => ({ nodes: [], edges: [], goal_constraints: row === undefined ? [] : [row] });
    expect(heldCardStillApplies(p, g(LIMIT_ROW))).toBe(true);
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, value: 4 })), 'its row moved: someone else changed the limit').toBe(false);
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, unit: 'trays' })), 'another unit').toBe(false);
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, operator: '>=' })), 'another comparator').toBe(false);
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, constraint_id: 'gc-other' })), 'another row').toBe(false);
    expect(heldCardStillApplies(p, g(undefined)), 'the row is gone').toBe(false);
    // Codex BLOCK @db2376d0: its comparator as stated changed ("at most 3" → "less than 3"): the card no longer reads as shown.
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, operator_as_stated: '<' })), 'a strictness edit').toBe(false);
    expect(heldCardStillApplies(p, g({ ...LIMIT_ROW, value_frame: 'change' })), 'another frame').toBe(false);
    // A card made before the row snapshot holds only on its own base (fail closed here).
    const { row_as_made: _made, ...older } = op.value;
    expect(heldCardStillApplies({ operations: [{ ...op, value: older }] } as never, g(LIMIT_ROW)), 'no snapshot').toBe(false);
  });

  it('CONTRAST: two figure cards in one turn are still one change per approval (approving one would make the other stale)', async () => {
    const w = world(); const turn = await route(w);
    const START = { assumptions: [{ factor_label: 'Prep time cut from mixer', value: 0, unit: '%', user_stated: false,
      basis: 'Olumi assumes no cut today because the mixer is not bought yet.' }], option_levels: [] };
    const both = await turn({ message: 'The faster mixer cuts prep time by 15%. What would you assume today?', source: 'composer' },
      [call('propose_option_interventions', MIXER), call('propose_starting_point', START), say('Here is the first change.')]);
    expect((both._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_starting_point')?.refusal).toBe(ONE_CHANGE_PER_APPROVAL);
  }, 120_000);
});

// ⭐ Codex BLOCK on #3424 @db2376d0 (independent probe, adopted): a strictness edit after the card was shown is never
// overwritten by its approval. The card showed "at most 3 → at most 2"; the row now says "less than 3".
describe('a limit card binds the whole row it showed', () => {
  it('a strictness edit after the card was shown → its press writes nothing; the user-edited limit is unchanged', async () => {
    const w = world(); const turn = await route(w);
    w.edit((g) => { g.goal_constraints = [structuredClone(LIMIT_ROW)]; });
    const proposed = await turn({ message: WORDS, source: 'composer' }, [call('propose_limit_change', LIMIT), say('Here is the limit change.')]);
    const chip = chipFor(proposed, idOf(proposed, 'propose_limit_change'));
    w.edit((g) => { g.goal_constraints[0].operator_as_stated = '<'; });
    expect(limitRows(w.read())[0]!.operator_as_stated, 'control: the user changed this limit to strictly less than').toBe('<');
    const before = JSON.stringify(w.read()); const writes = w.graphWrites();
    const reply = await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: proposed._agent.session_id });
    expect(authorised(reply), JSON.stringify(authorised(reply))).toEqual([expect.objectContaining({ ok: false, mutated: false })]);
    expect(w.graphWrites(), 'no stale write').toBe(writes);
    expect(JSON.stringify(w.read()), 'the user-edited limit is unchanged').toBe(before);
  }, 120_000);
});
