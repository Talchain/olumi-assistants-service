/**
 * ⭐ AN APPROVAL IS ONE ACTION (DL-3 18 Oct; Codex co-design §2; assessment 18 Oct K5: L2 "Yes, I approve the proposed 10%"
 * refused while its card waited; T4 approving Olumi's starting value lapsed the user's pending card).
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject, the UI's shapes: a typed message; a press is `chip_click` + `chip.id`)
 * → the REAL Agent loop → the REAL `propose_starting_point` / `propose_option_interventions` → the cards → typed words or a
 * press → `authoriseChange` → the REAL in-process level door → the store → the reconcile (`lifecycle.ts`) → the read-back.
 * Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model (a bakery). TESTED, not WIRE-WITNESSED.
 */
import { randomUUID } from 'node:crypto';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the approval replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the approval replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { approvalChipIdFor } from '../approval-chips.js';
import { declineChipIdFor } from '../proposal-object/record.js';
import { authorised, bothCards, call, chipFor, chips, closeApps, hash, idOf, LAPSE, MIXER, MIXER_WORDS, mixerSaved, node, route as routeOver, say,
  world as worldOver } from './fixtures/approval-world.js';

const world = () => worldOver(live);
const route = (w: ReturnType<typeof world>) => routeOver(w);
afterEach(closeApps);

describe('an approval is ONE action: typed words with one card waiting are its press; several cards ask which, each with a button', () => {
  it('⭐ A1: one card waiting, typed "Yes, go ahead with the 15% mixer change." → saved once, the same model as its button', async () => {
    const typedWorld = world(); const typedTurn = await route(typedWorld);
    const first = await typedTurn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const b = idOf(first, 'propose_option_interventions');
    const typed = await typedTurn({ message: 'Yes, go ahead with the 15% mixer change.', source: 'composer', agent_session_id: first._agent.session_id },
      [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(typed), JSON.stringify(authorised(typed))).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(mixerSaved(typedWorld.read())).toBe(true);
    // Consent provenance (ruling A): recorded as a typed approval read by Olumi, the user's exact words quoted.
    expect(typed._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: 'Yes, go ahead with the 15% mixer change.' }]);
    expect(String(typed.assistant_text)).toContain('Saved on your typed approval: \u201cYes, go ahead with the 15% mixer change.\u201d');
    // CONTRAST: the same card pressed in its own world — the saved model is the same.
    const pressWorld = world(); const pressTurn = await route(pressWorld);
    const offered = await pressTurn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const chip = chipFor(offered, idOf(offered, 'propose_option_interventions'));
    const pressed = await pressTurn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: offered._agent.session_id });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(pressed._agent.typed_approvals, 'a press is not a typed approval').toBeUndefined();
    expect(String(pressed.assistant_text)).not.toContain('typed approval');
    expect(typedWorld.read().edges).toEqual(pressWorld.read().edges);
    expect(node(typedWorld.read(), 'buy_faster_mixer')).toEqual(node(pressWorld.read(), 'buy_faster_mixer'));
  }, 120_000);

  it('A1 host guarantee: typed words with one card waiting write nothing unless the Agent approves THAT card', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const before = hash(w.read());
    const declined = await turn({ message: 'No, leave that for now.', source: 'composer', agent_session_id: first._agent.session_id }, [say('Left as it is.')]);
    expect(authorised(declined)).toEqual([]);
    expect(hash(w.read())).toBe(before);
  }, 90_000);

  it('⭐ A2 (the live T3 shape): two cards waiting, typed yes naming one → nothing written, both buttons shown, that card first; one press applies it', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const before = hash(w.read());
    const typed = await turn({ message: 'Yes, I approve the 15% mixer setting.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: b }), say('You approved the 15% mixer setting.')]);
    expect(authorised(typed), JSON.stringify(authorised(typed))).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'approval_required' })]);
    expect(hash(w.read()), 'nothing written').toBe(before);
    const ids = chips(typed);
    expect(ids, 'a button for EVERY waiting card').toEqual(expect.arrayContaining([approvalChipIdFor(a), approvalChipIdFor(b)]));
    expect(ids.indexOf(approvalChipIdFor(b)), 'the card the words meant comes first').toBeLessThan(ids.indexOf(approvalChipIdFor(a)));
    expect(ids).toEqual(expect.arrayContaining([declineChipIdFor(a), declineChipIdFor(b)]));
    expect(String(typed.assistant_text)).toMatch(/two changes are waiting\. To apply "Buy a faster mixer[^"]*", press its button below\./);
    // ONE click applies the right one; the other card keeps its button. Each button shows the change it applies.
    const chip = chipFor(typed, b);
    expect(String(chip.detail)).toMatch(/^Buy a faster mixer acts on Prep time cut from mixer/);
    expect(String(chipFor(typed, a).detail)).toMatch(/Prep time cut from mixer = 0%/);
    const pressed = await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: session });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(mixerSaved(w.read())).toBe(true);
    // Olumi's starting value was made on the model as it was (its basis may read what just changed: the values-only stale
    // negative), so it does not survive this approval silently: it is SAID. (PR-2 keeps it visible for review instead.)
    expect(String(pressed.assistant_text)).toMatch(LAPSE);
    expect(w.onLatestRow(approvalChipIdFor(a))).toBe(false);
  }, 120_000);

  it('A2 ambiguous: two cards waiting, a bare typed "yes" → never bound (even when the Agent picks one), both buttons offered', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const before = hash(w.read());
    const typed = await turn({ message: 'yes', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: a }), say('Which change do you mean?')]);
    expect(authorised(typed)).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'approval_required' })]);
    expect(hash(w.read())).toBe(before);
    expect(chips(typed)).toEqual(expect.arrayContaining([approvalChipIdFor(a), approvalChipIdFor(b)]));
    expect(String(typed.assistant_text)).toMatch(/two changes are waiting/);
  }, 120_000);

  it('⭐ A4: approving Olumi’s starting value never lapses the user’s new-link card on the same factor; it stays pressable, then saves', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session, first } = await bothCards(w, turn);
    const chipA = chipFor(first, a);
    const before = hash(w.read());
    const pressedA = await turn({ message: chipA.message, source: 'chip_click', chip: { id: chipA.id }, agent_session_id: session });
    expect(authorised(pressedA)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(hash(w.read()), 'the model moved').not.toBe(before);
    expect(String(pressedA.assistant_text)).not.toMatch(LAPSE);
    expect(w.onLatestRow(approvalChipIdFor(b)), 'the user’s card is still held').toBe(true);
    const chipB = chipFor(pressedA, b);
    // Cold: a fresh session still offers it; its press writes the link and the level on the CURRENT model.
    const cold = await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() }, [say('Here is where things stand.')]);
    expect(chips(cold)).toContain(approvalChipIdFor(b));
    const pressedB = await turn({ message: chipB.message, source: 'chip_click', chip: { id: chipB.id }, agent_session_id: session });
    expect(authorised(pressedB), JSON.stringify(authorised(pressedB)) + String(pressedB.assistant_text)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(mixerSaved(w.read())).toBe(true);
  }, 150_000);
});
