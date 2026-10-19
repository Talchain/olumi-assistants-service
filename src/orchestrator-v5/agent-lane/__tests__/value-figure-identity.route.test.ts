/**
 * ⛔ THE VALUE DOOR ASKS THE ONE QUANTITY-IDENTITY RULE (DL-3, from step 8b's finding on staging: "70 customers per week; the
 * existing team capacity is unchanged" gave a card that saved 70 as the team's capacity as the user's own bound figure, with no
 * "field binding unverified" label). The figure's own clause names nothing (it counts customers); the team is named only in
 * another clause, which says it is unchanged. The figure is still the user's (they wrote it), but WHICH field it binds to is
 * Olumi's reading, so the card and the saved value say so. The user's own clause naming the factor still binds.
 *
 * THE PATH: the REAL route → the REAL Agent loop → the REAL `propose_assumptions` → the card → the press → the level writer → the
 * store. Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the value-identity replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the value-identity replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { call, chipFor, closeApps, edge, idOf, node, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';

const world = () => worldOver(live);
afterEach(closeApps);

const UNIT = 'tickets per week';
const team = (id: string, ref: string, label: string, raw: number): Rec => ({ id, ref, kind: 'factor', label, category: 'external',
  provenance: 'ai_inferred', scale_frame: 500, observed_state: { unit: UNIT, raw_value: raw, value: raw / 500, source: 'cee_inference' } });
const UNBOUND = '(figure from the quoted message; field binding unverified)';

/** One typed turn, the Agent's one card setting the team's capacity to 70, and its press. */
async function teamTurn(words: string) {
  const w = world(); const turn = await route(w);
  w.edit((g) => {
    g.nodes.push(team('team_capacity', 'F3', 'Existing team capacity', 80), team('specialist_capacity', 'F4', 'Additional specialist capacity', 0));
    g.edges.push(edge('team_capacity', 'orders_on_time', 0.4), edge('specialist_capacity', 'orders_on_time', 0.2));
  });
  const r = await turn({ message: words, source: 'composer' }, [call('propose_assumptions', { assumptions: [{ factor_label: 'Existing team capacity',
    value: 70, unit: UNIT, user_stated: true, revise: true, basis: 'the user’s correction of today’s level' }] }), say('Here is a card to review.')]);
  const made = (r._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_assumptions')!;
  expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: true }));
  const chip = chipFor(r, idOf(r, 'propose_assumptions'));
  await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: r._agent.session_id });
  return { chip, saved: node(w.read(), 'team_capacity').observed_state as Rec };
}

describe('the value door binds a figure to a field only where the user\'s words name that field (one identity rule)', () => {
  it.each([
    ['it counts customers; the team is named only in a clause that says unchanged', 'We now have 70 customers per week; the existing team capacity is unchanged.'],
    ['its clause names nothing; the team is named only in another clause', 'We now resolve 70 tickets per week; the existing team capacity is unchanged.'],
  ])('⛔ RED→GREEN: %s → the card and the saved value say the binding is Olumi\'s reading', async (_why, words) => {
    const { chip, saved } = await teamTurn(words);
    expect(String(chip.detail)).toContain(UNBOUND);
    expect(saved).toMatchObject({ raw_value: 70, user_material_unverified: true });
  }, 120_000);

  it('CONTROL (own quantity, bound on staging too): "our existing team capacity is 70 tickets per week, not 80" binds, unlabelled', async () => {
    const { chip, saved } = await teamTurn('Correction: our existing team capacity is 70 tickets per week, not 80.');
    expect(String(chip.detail)).toContain('Existing team capacity: 80 tickets per week \u2192 70 tickets per week');
    expect(String(chip.detail)).not.toContain(UNBOUND);
    expect(saved.raw_value).toBe(70);
    expect(saved.user_material_unverified).toBeUndefined();
  }, 120_000);
});
