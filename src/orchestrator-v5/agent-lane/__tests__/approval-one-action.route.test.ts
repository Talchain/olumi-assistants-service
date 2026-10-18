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
  world as worldOver, type Rec } from './fixtures/approval-world.js';

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

  // ⭐ PL amendment (DL-3 18 Oct 16:28): with several cards waiting, an EXPLICIT selection is honoured — the card the Agent
  // names binds only if it is one the user was shown, and the write quotes their words. Only an ambiguous yes re-offers.
  it('⭐ A2 (the live T3 shape): two cards waiting, a typed yes that names one → exactly that card is saved, as a typed approval; the other keeps its button', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const typed = await turn({ message: 'Yes, I approve the 15% mixer setting.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: b }), say('Saved the 15% mixer setting.')]);
    expect(authorised(typed), JSON.stringify(authorised(typed))).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(mixerSaved(w.read())).toBe(true);
    expect(node(w.read(), 'prep_time_cut').observed_state, 'card A (Olumi\u2019s 0%) was not written').toBeUndefined();
    expect(typed._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: 'Yes, I approve the 15% mixer setting.' }]);
    expect(String(typed.assistant_text)).toContain('Saved on your typed approval: \u201cYes, I approve the 15% mixer setting.\u201d');
    // Card A (Olumi's starting value) was made on the model before B's write, so it does not survive silently: it is SAID.
    expect(String(typed.assistant_text)).toMatch(LAPSE);
    expect(w.onLatestRow(approvalChipIdFor(a))).toBe(false);
  }, 120_000);

  it('A2 ambiguous: two cards waiting, a bare "yes" the Agent asks about → nothing written; every card offered with the change it applies; one press applies the chosen one', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const before = hash(w.read());
    const typed = await turn({ message: 'yes', source: 'composer', agent_session_id: session }, [say('Which change do you mean?')]);
    expect(authorised(typed)).toEqual([]);
    expect(hash(w.read())).toBe(before);
    const ids = chips(typed);
    expect(ids, 'a button for EVERY waiting card').toEqual(expect.arrayContaining([approvalChipIdFor(a), approvalChipIdFor(b), declineChipIdFor(a), declineChipIdFor(b)]));
    expect(String(chipFor(typed, b).detail)).toMatch(/^Buy a faster mixer acts on Prep time cut from mixer/);
    expect(String(chipFor(typed, a).detail)).toMatch(/Prep time cut from mixer = 0%/);
    const chip = chipFor(typed, b);
    const pressed = await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: session });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(mixerSaved(w.read())).toBe(true);
    // Olumi's starting value was made on the model as it was (its basis may read what just changed: the values-only stale
    // negative), so it does not survive this approval silently: it is SAID. (PR-2 keeps it visible for review instead.)
    expect(String(pressed.assistant_text)).toMatch(LAPSE);
    expect(w.onLatestRow(approvalChipIdFor(a))).toBe(false);
  }, 120_000);

  it('A2 host check: with several waiting, a card the user was never SHOWN is not bound by typed words (a shown one is), and the refusal names the choice', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    w.neverShown(approvalChipIdFor(b));
    const before = hash(w.read());
    const unseen = await turn({ message: 'Yes, apply that.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: b }), say('Applied.')]);
    expect(authorised(unseen), JSON.stringify(authorised(unseen))).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'approval_required' })]);
    expect(hash(w.read()), 'nothing written for the unseen card').toBe(before);
    expect(String(unseen.assistant_text)).toMatch(/two changes are waiting\. Press the button on the one you mean\./);
    const shown = await turn({ message: 'Yes, use the starting value.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: a }), say('Saved.')]);
    expect(authorised(shown), JSON.stringify(authorised(shown))).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: a })]);
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

// ⭐ THE DISPLAYED-OPERATION CONTRACT (Codex BLOCK on #3420@42e08cdc, 18 Oct: its three CEE probes, adopted as rows). Typed
// assent binds only to a card the client SHOWS, at the revision it shows, and it always keeps the user's exact words.
describe('typed assent binds only to what the user was shown, and always keeps their words', () => {
  it('⭐ exact button words TYPED into the composer: saved as the card, and still a typed approval quoting them', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const b = idOf(first, 'propose_option_interventions'); const chip = chipFor(first, b);
    const reply = await turn({ message: chip.message, source: 'composer', agent_session_id: first._agent.session_id });
    expect(mixerSaved(w.read())).toBe(true);
    expect(reply._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: chip.message }]);
    expect(String(reply.assistant_text)).toContain(`Saved on your typed approval: \u201c${chip.message}\u201d`);
  }, 120_000);

  const corrected = 'The faster mixer cuts prep time by 12%.';
  const replacement = { interventions: (MIXER.interventions as Rec[]).map((x) => ({ ...x, value: 12, basis: corrected })) };
  /** Card A (15%) shown; the user's correction makes replacement B (12%), whose reply is `lost` or delivered. */
  async function replaced(lost: boolean) {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is the 15% reading.')]);
    const a = idOf(first, 'propose_option_interventions');
    const second = await turn({ message: corrected, source: 'composer', agent_session_id: first._agent.session_id, lost },
      [call('propose_option_interventions', replacement), say('Here is the replacement reading.')]);
    const b = idOf(second, 'propose_option_interventions'); expect(b).not.toBe(a);
    expect(w.onLatestRow(approvalChipIdFor(a)), 'the replacement discards card A').toBe(false);
    return { w, turn, a, b, session: first._agent.session_id };
  }

  it('⭐ a replacement whose reply was LOST never inherits the assent given while the client still showed card A: nothing written, B offered', async () => {
    const { w, turn, b, session } = await replaced(true);
    const before = hash(w.read());
    const reply = await turn({ message: 'Approved.', source: 'composer', agent_session_id: session }, [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(reply).some((c) => c.mutated === true), JSON.stringify(authorised(reply))).toBe(false);
    expect(hash(w.read())).toBe(before);
    expect(mixerSaved(w.read())).toBe(false);
    expect(reply._agent.typed_approvals).toBeUndefined();
    expect(chips(reply), 'the card the user has not seen is offered with its own button').toContain(approvalChipIdFor(b));
  }, 120_000);

  it('CONTRAST: the same replacement, its reply DELIVERED (the client shows B) → "Approved." saves B, quoting the words', async () => {
    const { w, turn, b, session } = await replaced(false);
    const reply = await turn({ message: 'Approved.', source: 'composer', agent_session_id: session }, [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(reply)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(node(w.read(), 'buy_faster_mixer').interventions.prep_time_cut.raw_value).toBe(12);
    expect(reply._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: 'Approved.' }]);
  }, 120_000);

  it('a typed turn that sends NO displayed set binds nothing (fail-safe): the card keeps its button', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const b = idOf(first, 'propose_option_interventions');
    const before = hash(w.read());
    const reply = await turn({ message: 'Approved.', source: 'composer', agent_session_id: first._agent.session_id, displayed_proposals: undefined },
      [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(reply).some((c) => c.mutated === true)).toBe(false);
    expect(hash(w.read())).toBe(before);
    expect(chips(reply)).toContain(approvalChipIdFor(b));
  }, 120_000);

  it('a card shown at ANOTHER revision binds nothing; the same card at the revision held now does', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const b = idOf(first, 'propose_option_interventions');
    const held = ((first._proposal_fields?.proposals ?? []) as Rec[]).find((p) => p.proposal_id === b);
    expect(typeof held?.revision, 'the control: the card is listed with its revision').toBe('string');
    const before = hash(w.read());
    const stale = await turn({ message: 'Approved.', source: 'composer', agent_session_id: first._agent.session_id,
      displayed_proposals: [{ proposal_id: b, revision: `${String(held!.revision)}-earlier` }] }, [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(stale).some((c) => c.mutated === true)).toBe(false);
    expect(hash(w.read())).toBe(before);
    const now = await turn({ message: 'Approved.', source: 'composer', agent_session_id: first._agent.session_id,
      displayed_proposals: [{ proposal_id: b, revision: held!.revision }] }, [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(now)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
  }, 120_000);

  it('a same-turn proposal cannot approve itself', async () => {
    const w = world(); let attempts = 0; let attemptedId: string | undefined;
    const turn = await routeOver(w, (req) => {
      const ids = [...JSON.stringify(req).matchAll(/prop_[0-9a-f]{32}/g)].map((x) => x[0]);
      if (attempts === 0) attemptedId = ids[ids.length - 1];
      return new Response(JSON.stringify(attempts++ === 0 ? call('authorise_change', { proposal_id: attemptedId }) : say('Waiting for approval.')), { status: 200 });
    });
    const before = hash(w.read());
    const reply = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER)]);
    expect(authorised(reply)).toHaveLength(1);
    expect(attemptedId).toBe(idOf(reply, 'propose_option_interventions'));
    expect(authorised(reply)[0]!.refusal).toBe('not_on_narration');
    expect(authorised(reply).some((c) => c.mutated)).toBe(false); expect(hash(w.read())).toBe(before);
  }, 120_000);
});
