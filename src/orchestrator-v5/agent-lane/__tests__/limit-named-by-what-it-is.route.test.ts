/**
 * ⛔ A LIMIT FIGURE THE USER WROTE IN DIGITS GIVES ITS CARD, BUT ONLY FOR THE LIMIT THEIR WORDS NAME (verifier P05, 18 Oct,
 * REAL-AI-REPLAY-94b330bd: "the remote-village constraint should be at least 85%" was refused `figure_not_stated`, the nearest
 * label word "village" being another node's; Codex R2 on #3424 @d4be73eb: a generic alias read "the shelf capacity constraint
 * … 2 ovens" as the OVEN limit's, and its press saved Oven = 2, Shelf = 3).
 *
 * The rule: a word for a limit ("limit", "constraint", "floor", "ceiling") lets the figure be this limit's ONLY when the same
 * clause names this limit by a word of its own and names no other limit by a word of that limit's own. A category word never
 * overrides a rival the user named. The ordinary attribution is unchanged; this is checked only when it refuses.
 *
 * THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop → the REAL `propose_limit_change` → the card's press → the REAL
 * in-process limit door → the store. Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the limit-alias replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the limit-alias replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { authorised, call, chipFor, closeApps, idOf, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';

const world = () => worldOver(live);
afterEach(closeApps);

const OVENS = { constraint_id: 'gc-ovens-1', node_id: 'oven_capacity', operator: '<=', value: 3, unit: 'ovens', value_frame: 'level',
  label: 'Oven capacity', provenance: 'explicit' };
const SHELF_NODE = { id: 'shelf_capacity', ref: 'F3', kind: 'factor', label: 'Shelf capacity', category: 'external', provenance: 'ai_inferred',
  observed_state: { unit: 'ovens', raw_value: 1, value: 0.25 } };
const SHELVES = { ...OVENS, constraint_id: 'gc-shelves-1', node_id: 'shelf_capacity', label: 'Shelf capacity' };
const limitRows = (g: Rec): Rec[] => (g.goal_constraints ?? []) as Rec[];

/** One typed turn in which the Agent asks for the OVEN limit's new figure; the user's words decide whether it is theirs. */
async function ovenLimitTurn(words: string, setup: (g: Rec) => void = (g) => { g.goal_constraints = [structuredClone(OVENS)]; }) {
  const w = world(); const turn = await route(w);
  w.edit(setup);
  const before = JSON.stringify(w.read());
  const r = await turn({ message: words, source: 'composer' },
    [call('propose_limit_change', { limit_label: 'Oven capacity', operator: '<=', new_value: 2, unit: 'ovens', rationale: words }),
      say('Here is that change for you to approve.')]);
  return { w, r, turn, before, made: (r._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_limit_change') };
}

describe('a limit named by what it is: the figure is its own only when the words name THIS limit', () => {
  it('⭐ RED→GREEN: "the oven-mixer constraint should be at most 2 ovens" (the nearest label word is another node\'s) → the card; its press saves 2', async () => {
    const { w, r, turn, made } = await ovenLimitTurn('The oven-mixer constraint should be at most 2 ovens now, not 3.');
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: true }));
    const chip = chipFor(r, idOf(r, 'propose_limit_change'));
    const pressed = await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: r._agent.session_id });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(limitRows(w.read())).toEqual([expect.objectContaining({ constraint_id: 'gc-ovens-1', value: 2 })]);
  }, 120_000);

  it.each(['constraint', 'floor', 'ceiling', 'limit'])('⛔ Codex R2: "the shelf capacity %s … 2 ovens" never authors the OVEN limit (both limits held)', async (alias) => {
    const { w, made, before } = await ovenLimitTurn(`The shelf capacity ${alias} should be at most 2 ovens now, not 3.`, (g) => {
      g.nodes.push(structuredClone(SHELF_NODE)); g.goal_constraints = [structuredClone(OVENS), structuredClone(SHELVES)];
    });
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
    expect(JSON.stringify(w.read())).toBe(before);
  }, 120_000);

  it('⛔ naming this limit AND another LIMIT is not this limit\'s ("the oven-shelf constraint", both limits held)', async () => {
    const { made } = await ovenLimitTurn('The oven-shelf constraint should be at most 2 ovens now, not 3.', (g) => {
      g.nodes.push(structuredClone(SHELF_NODE)); g.goal_constraints = [structuredClone(OVENS), structuredClone(SHELVES)];
    });
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
  }, 120_000);

  it('⛔ without a limit word the ordinary attribution stands: "the oven-mixer pairing … 2 ovens" is not the limit\'s', async () => {
    const { made } = await ovenLimitTurn('The oven-mixer pairing should be at most 2 ovens now, not 3.');
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
  }, 120_000);

  it('⛔ a quantity WITHOUT a limit, named with a limit word, never authors the oven limit ("shelf capacity constraint", no shelf limit)', async () => {
    const { made } = await ovenLimitTurn('The shelf capacity constraint should be at most 2 ovens now, not 3.', (g) => {
      g.nodes.push(structuredClone(SHELF_NODE)); g.goal_constraints = [structuredClone(OVENS)];
    });
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
  }, 120_000);

  it('⛔ a limit word beside ANOTHER quantity\'s own name, and none of this limit\'s, is not this limit\'s ("the mixer constraint")', async () => {
    const { made } = await ovenLimitTurn('The mixer constraint should be at most 2 ovens now, not 3.');
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
  }, 120_000);

  it('CONTRAST: the same figure written about another node, with no limit word, is still not the limit\'s', async () => {
    const { made } = await ovenLimitTurn('The faster mixer is worth 2 ovens, not 3.');
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
  }, 120_000);

  it('CONTROL: the limit named by its own label needs no limit word (the ordinary attribution, unchanged)', async () => {
    const { made } = await ovenLimitTurn('Our oven capacity is at most 2 ovens now, not 3.');
    expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: true }));
  }, 120_000);
});
