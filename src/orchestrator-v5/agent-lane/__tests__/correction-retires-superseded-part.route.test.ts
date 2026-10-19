/**
 * ⛔ A CORRECTION RETIRES ONLY THE PART OF A SHOWN CARD IT REPLACES, VISIBLY (DL-3 19 Oct; Codex R5 on #3427 AMEND item 4; 8b's
 * real-route probe, outbox/8b-retire-probes/). A card the user was shown that sets the corrected subject AND an unrelated one
 * (night 42 + day 65) was discarded from the process's memory only. Its durable carrier stayed on the latest row, so a press of
 * its earlier button rehydrated it and SAVED night 42 beside the pending correction (a stale write), and nothing named it.
 *
 * Now the correction keeps that card for review (PR-2's existing `heldCardForReview`), with the replaced part recorded on it:
 *  · never approvable as it stands, by its old button or typed words, on this or a cold read;
 *  · said once, naming what the correction replaced and what is kept;
 *  · "Review this change" asks for the kept part only, and a kept-only card replaces it.
 *
 * THE PATH: the REAL route → the REAL Agent loop → the REAL `propose_assumptions` / `propose_statement` (correction) → the
 * held carriers → the press. The wire carries the graph identity as the real read and register routes do (`identityWire`).
 * Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the correction retirement rows'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the correction retirement rows'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { authorised, call, chips, closeApps, edge, idOf, node, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';
import { userStatementRecord } from '../../statement-door/statements.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';

afterEach(closeApps);

const OLD = 'Night shifts take 40 hours per week.';
const NIGHT = { kind: 'factor' as const, id: 'night', field: 'level' as const };
const DAY = { kind: 'factor' as const, id: 'day', field: 'level' as const };
const DAY_OLD = 'Day shifts take 60 hours per week.';
const record = (subject: typeof NIGHT, quote: string, value: number) => userStatementRecord(subject, [{ speaker: 'user', quote, source: quote,
  form: 'point', low: value, high: value, unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: subject.id } }],
'2026-10-10T09:00:00Z', { recorded_by: 'construction' });

/** The bakery world with two shift factors the user stated, and the identity on the wire as the real read and register routes carry it. */
function seeded() {
  const w = worldOver(live);
  w.edit((g) => {
    g.nodes.push(
      { id: 'night', ref: 'F3', kind: 'factor', label: 'Night shift hours', category: 'external', provenance: 'from_brief', scale_frame: 200,
        observed_state: { value: 0.2, raw_value: 40, unit: 'hours per week', cap: 200, source: 'brief_extraction', extractionType: 'explicit' },
        user_statements: [record(NIGHT, OLD, 40)] },
      { id: 'day', ref: 'F4', kind: 'factor', label: 'Day shift hours', category: 'external', provenance: 'from_brief', scale_frame: 200,
        observed_state: { value: 0.3, raw_value: 60, unit: 'hours per week', cap: 200, source: 'brief_extraction', extractionType: 'explicit' },
        user_statements: [record(DAY, DAY_OLD, 60)] });
    g.edges.push(edge('night', 'orders_on_time', 0.3), edge('day', 'orders_on_time', 0.2));
    g.ref_high_water = { ...g.ref_high_water, F: 4 };
  });
  const identity = () => computeGraphIdentityHash(w.read() as never);
  const wire = w.graphWire, register = w.register;
  Object.assign(w, { graphWire: () => ({ ...wire(), graph_identity_hash: identity() }),
    register: (body: Rec) => ({ ...register(body), graph_identity_hash: identity() }) });
  return w;
}
const MIXED_WORDS = 'Night shifts take 42 hours per week and day shifts take 65 hours per week.';
const MIXED = { assumptions: [
  { factor_label: 'Night shift hours', value: 42, unit: 'hours per week', user_stated: true, revise: true, basis: 'The user: night shifts take 42 hours per week.' },
  { factor_label: 'Day shift hours', value: 65, unit: 'hours per week', user_stated: true, revise: true, basis: 'The user: day shifts take 65 hours per week.' }] };
const DAY_ONLY = { assumptions: [MIXED.assumptions[1]] };
const FIX = 'Correction: night shifts take forty-five hours per week.';
const correction = (subject = NIGHT, old = OLD, words = FIX, value = 45, span = 'forty-five hours per week') => ({ correction: { quote: words, edits: [{
  subject, retirement: { quote: old, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: `correct the ${subject.id} shift account`,
  replacement: { value, unit: 'hours per week', span } }] } });
/** The one line said when a correction replaces part of a shown card: the replaced part and the kept part, by name. */
const SAID = /Your correction replaces "Night shift hours" in the held change "Revise 2 values[^"]*", so that change waits for your review; nothing was applied\. Its other part \("Day shift hours"\) can be prepared again with Review this change\./;
const reviewChip = (id: string) => `agent-review-proposal:${id}`;
const action = (body: Rec, id: string): Rec => ((body.suggested_actions ?? []) as Rec[]).find((c) => c.id === id)!;
/** The review mark on the card's held carrier on the latest row (undefined: not under review, or not held). */
const markOf = (w: ReturnType<typeof seeded>, id: string): Rec | undefined =>
  w.latestPendings().find((p) => p.chip_id === approvalChipIdFor(id))?.action?.inline_patch?.awaiting_review;

async function mixedThenCorrection() {
  const w = seeded(); const turn = await route(w);
  const shown = await turn({ message: MIXED_WORDS, source: 'composer' }, [call('propose_assumptions', MIXED), say('Here is a card to review.')]);
  const old = idOf(shown, 'propose_assumptions'); const session = shown._agent.session_id;
  const offered = await turn({ message: FIX, source: 'composer', agent_session_id: session }, [call('propose_statement', correction()), say('Here is the correction.')]);
  const fix = idOf(offered, 'propose_statement');
  return { w, turn, shown, offered, old, fix, session };
}

describe('a correction retires only the part of a shown card it replaces, visibly (real route)', () => {
  it('⭐ RED before: the old card’s button, pressed beside the pending correction, writes NOTHING; the reply names the replaced and the kept part, once', async () => {
    const { w, turn, shown, offered, old, session } = await mixedThenCorrection();
    expect(String(offered.assistant_text)).toMatch(SAID);
    // Its held carrier is kept for review with the replaced part recorded on it (by identity), and is not approvable as it stands.
    expect(markOf(w, old), JSON.stringify(w.latestPendings())).toMatchObject({ replaced: [{ subject: 'night', name: 'Night shift hours' }] });
    expect(chips(offered), 'not approvable as it stands').not.toContain(approvalChipIdFor(old));
    const writes = w.graphWrites();
    const button = action(shown, approvalChipIdFor(old));
    const pressed = await turn({ message: button.message, source: 'chip_click', chip: { id: button.id }, agent_session_id: session });
    expect(authorised(pressed).filter((c) => c.ok === true || c.mutated === true), JSON.stringify(authorised(pressed))).toEqual([]);
    expect(w.graphWrites(), 'no write from the replaced card').toBe(writes);
    expect(node(w.read(), 'night').observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
    expect(node(w.read(), 'day').observed_state).toMatchObject({ raw_value: 60, source: 'brief_extraction' });
    // Typed words never bind it either.
    const typed = await turn({ message: 'Yes, apply the night and day shift values.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: old }), say('Applied.')]);
    expect(authorised(typed)).toEqual([expect.objectContaining({ ok: false, mutated: false })]);
    expect(w.graphWrites()).toBe(writes);
    expect(String(typed.assistant_text), 'said once').not.toMatch(SAID);
  }, 150_000);

  it('⭐ the journey: correction approved → saved and read back → the old card under review → cold reopen → only the kept part is prepared again, and saves', async () => {
    const { w, turn, offered, old, fix, session } = await mixedThenCorrection();
    const approve = action(offered, approvalChipIdFor(fix));
    const saved = await turn({ message: approve.message, source: 'chip_click', chip: { id: approve.id }, agent_session_id: session });
    expect(authorised(saved), JSON.stringify(authorised(saved))).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: fix })]);
    expect(node(w.read(), 'night').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
    expect(node(w.read(), 'day').observed_state, 'the unrelated value is untouched').toMatchObject({ raw_value: 60, source: 'brief_extraction' });
    expect(chips(saved)).toContain(reviewChip(old));
    expect(chips(saved)).not.toContain(approvalChipIdFor(old));
    // Cold: a fresh session still shows it for review, never as approvable, and its review asks for the kept part only.
    const cold = await turn({ message: 'What is still waiting for me?', source: 'composer', agent_session_id: randomUUID() }, [say('One change waits for your review.')]);
    expect(chips(cold)).toContain(reviewChip(old));
    expect(chips(cold)).not.toContain(approvalChipIdFor(old));
    const review = action(cold, reviewChip(old));
    expect(String(review.message)).toMatch(/^Show me this change again on the model as it is now, without "Night shift hours", which my correction replaced: "Revise 2 values/);
    const again = await turn({ message: review.message, source: 'chip_click', chip: { id: review.id }, agent_session_id: session },
      [call('propose_assumptions', DAY_ONLY), say('Here is the day shift value on the model as it is now.')]);
    const kept = idOf(again, 'propose_assumptions');
    expect(w.onLatestRow(approvalChipIdFor(old)), 'the kept-only card replaces the reviewed one').toBe(false);
    const yes = action(again, approvalChipIdFor(kept));
    const keptSaved = await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: session });
    expect(authorised(keptSaved)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: kept })]);
    expect(node(w.read(), 'day').observed_state).toMatchObject({ raw_value: 65 });
    expect(node(w.read(), 'night').observed_state, 'the correction stands').toMatchObject({ raw_value: 45, source: 'user_override' });
  }, 200_000);

  it('a second correction, of the kept part, retires the rest: the card goes (cumulative), said once', async () => {
    const { w, turn, offered, old, fix, session } = await mixedThenCorrection();
    const approve = action(offered, approvalChipIdFor(fix));
    await turn({ message: approve.message, source: 'chip_click', chip: { id: approve.id }, agent_session_id: session });
    const dayFix = 'Correction: day shifts take seventy hours per week.';
    const second = await turn({ message: dayFix, source: 'composer', agent_session_id: session },
      [call('propose_statement', correction(DAY, DAY_OLD, dayFix, 70, 'seventy hours per week')), say('Here is the correction.')]);
    expect(String(second.assistant_text)).toMatch(/The held change "Revise 2 values[^"]*" is no longer waiting; say the word if you still want it\./);
    expect(chips(second)).not.toContain(reviewChip(old));
    expect(chips(second)).not.toContain(approvalChipIdFor(old));
    expect(w.onLatestRow(approvalChipIdFor(old)), 'no longer held').toBe(false);
    expect(node(w.read(), 'night').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
    expect(node(w.read(), 'day').observed_state, 'the second correction is only offered').toMatchObject({ raw_value: 60, source: 'brief_extraction' });
  }, 200_000);

  it('⭐ cumulative (Codex approach review): two corrections each replace one part of a three-part card; a cold review asks for the third part only, and a card for it replaces the reviewed one', async () => {
    const w = seeded(); const turn = await route(w);
    w.edit((g) => {
      g.nodes.push({ id: 'weekend', ref: 'F5', kind: 'factor', label: 'Weekend shift hours', category: 'external', provenance: 'ai_inferred', scale_frame: 200,
        observed_state: { value: 0.1, raw_value: 20, unit: 'hours per week', cap: 200, source: 'cee_inference' } });
      g.edges.push(edge('weekend', 'orders_on_time', 0.1));
      g.ref_high_water = { ...g.ref_high_water, F: 5 };
    });
    const WEEKEND = { factor_label: 'Weekend shift hours', value: 24, unit: 'hours per week', user_stated: true, revise: true, basis: 'The user: weekend shifts take 24 hours per week.' };
    const shown = await turn({ message: `${MIXED_WORDS} Weekend shifts take 24 hours per week.`, source: 'composer' },
      [call('propose_assumptions', { assumptions: [...MIXED.assumptions, WEEKEND] }), say('Here is a card to review.')]);
    const old = idOf(shown, 'propose_assumptions'); const session = shown._agent.session_id;
    await turn({ message: FIX, source: 'composer', agent_session_id: session }, [call('propose_statement', correction()), say('Here is the correction.')]);
    const dayFix = 'Correction: day shifts take seventy hours per week.';
    const second = await turn({ message: dayFix, source: 'composer', agent_session_id: session },
      [call('propose_statement', correction(DAY, DAY_OLD, dayFix, 70, 'seventy hours per week')), say('Here is the correction.')]);
    expect(String(second.assistant_text)).toMatch(/Your correction replaces "Day shift hours" in the held change "Revise 3 values[^"]*", so that change waits for your review; nothing was applied\. Its other part \("Weekend shift hours"\) can be prepared again with Review this change\./);
    expect(markOf(w, old)).toMatchObject({ replaced: [{ subject: 'night', name: 'Night shift hours' }, { subject: 'day', name: 'Day shift hours' }] });
    const cold = await turn({ message: 'What is still waiting for me?', source: 'composer', agent_session_id: randomUUID() }, [say('Here is what waits.')]);
    const review = action(cold, reviewChip(old));
    expect(String(review.message)).toMatch(/^Show me this change again on the model as it is now, without "Night shift hours" and "Day shift hours", which my correction replaced: "Revise 3 values/);
    const again = await turn({ message: review.message, source: 'chip_click', chip: { id: review.id }, agent_session_id: session },
      [call('propose_assumptions', { assumptions: [WEEKEND] }), say('Here is the weekend value on the model as it is now.')]);
    idOf(again, 'propose_assumptions');
    expect(w.onLatestRow(approvalChipIdFor(old)), 'the kept-only card replaces the reviewed one').toBe(false);
  }, 200_000);

  it('declining the correction does not revive the old card; it stays under review, never approvable', async () => {
    const { w, turn, offered, old, fix, session } = await mixedThenCorrection();
    const no = action(offered, `agent-decline-proposal:${fix}`);
    const declined = await turn({ message: no.message, source: 'chip_click', chip: { id: no.id }, agent_session_id: session });
    expect(authorised(declined)).toEqual([]);
    expect(markOf(w, old)).toMatchObject({ replaced: [{ subject: 'night', name: 'Night shift hours' }] });
    expect(chips(declined)).not.toContain(approvalChipIdFor(old));
    expect(node(w.read(), 'night').observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
  }, 150_000);

  it('a card already under review for a model change gets the replaced part recorded too (the changed-hash branch)', async () => {
    const w = seeded(); const turn = await route(w);
    const shown = await turn({ message: MIXED_WORDS, source: 'composer' }, [call('propose_assumptions', MIXED), say('Here is a card to review.')]);
    const old = idOf(shown, 'propose_assumptions');
    // A canvas edit on an unrelated factor moves the model: the card is kept for review (PR-2) before any correction.
    w.edit((g) => { g.nodes.find((n: Rec) => n.id === 'oven_capacity').observed_state.raw_value = 2; });
    const offered = await turn({ message: FIX, source: 'composer', agent_session_id: shown._agent.session_id },
      [call('propose_statement', correction()), say('Here is the correction.')]);
    expect(String(offered.assistant_text)).toMatch(SAID);
    expect(markOf(w, old)).toMatchObject({ replaced: [{ subject: 'night', name: 'Night shift hours' }] });
    expect(chips(offered)).not.toContain(approvalChipIdFor(old));
  }, 150_000);

  it('CONTROL: a shown card on an unrelated subject only stays approvable beside the correction', async () => {
    const w = seeded(); const turn = await route(w);
    const shown = await turn({ message: 'Day shifts take 65 hours per week.', source: 'composer' }, [call('propose_assumptions', DAY_ONLY), say('Here is a card.')]);
    const dayCard = idOf(shown, 'propose_assumptions');
    const offered = await turn({ message: FIX, source: 'composer', agent_session_id: shown._agent.session_id },
      [call('propose_statement', correction()), say('Here is the correction.')]);
    expect(String(offered.assistant_text)).not.toMatch(/Your correction replaces/);
    expect(chips(offered)).not.toContain(reviewChip(dayCard));
    expect(w.onLatestRow(approvalChipIdFor(dayCard)), 'still held as approvable').toBe(true);
  }, 150_000);

  it('CONTROL: a refused correction retires nothing; the mixed card stays approvable', async () => {
    const w = seeded(); const turn = await route(w);
    const shown = await turn({ message: MIXED_WORDS, source: 'composer' }, [call('propose_assumptions', MIXED), say('Here is a card to review.')]);
    const old = idOf(shown, 'propose_assumptions');
    const refused = await turn({ message: FIX, source: 'composer', agent_session_id: shown._agent.session_id },
      [call('propose_statement', correction({ ...NIGHT, id: 'no_such_factor' })), say('I could not prepare that.')]);
    expect((refused._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_statement')).toMatchObject({ ok: false });
    expect(String(refused.assistant_text)).not.toMatch(/Your correction replaces/);
    expect(chips(refused)).not.toContain(reviewChip(old));
    expect(w.onLatestRow(approvalChipIdFor(old))).toBe(true);
  }, 150_000);
});
