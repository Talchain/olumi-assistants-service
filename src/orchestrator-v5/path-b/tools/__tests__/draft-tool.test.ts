/**
 * PATH-B DRAFT ADAPTER: the brief must literally be the user's words; the existing construction is the named bridge
 * (mocked here: its own behaviour is its own suite's); `mutated` only when THIS construction's own version is on record and a
 * fresh read holds a model; a retry of a committed construction is "already saved"; an unknown write is said as unknown.
 * SYNTHETIC brief.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ build: vi.fn(), version: vi.fn() }));
vi.mock('../../../agent-lane/runtime/build-model.js', () => ({ buildModelFromBrief: bridge.build, findConstructionVersion: bridge.version }));

import { BuildModelParams, buildModel } from '../draft-tool.js';
import { traceRow } from '../outcome.js';
import { read, type Rec } from './fixtures.js';

const BRIEF = 'We run a small library and walk-ins swing a lot; should we add a second assistant on Saturdays?';
const VERSION = { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', creation_kind: 'committed_mutation', source_turn_id: 't_1' };
type Reply = { status: number; json: Rec };
const EMPTY: Reply = { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h_empty' } };
const MODEL: Reply = { status: 200, json: read({ graph_hash: 'h_new' }) };

function product(reads: readonly Reply[]) {
  const queue = [...reads];
  const dispatch = vi.fn(async (path: string) => {
    const next = queue.shift();
    if (next === undefined) throw new Error(`unscripted ${path}`);
    return next;
  });
  return { dispatch, callStructured: vi.fn(), onModelRegistered: vi.fn() };
}
const ctx = { scenario_id: 'scn_1', verified_user_messages: [BRIEF], user_turn_text: BRIEF };

beforeEach(() => {
  bridge.build.mockReset().mockResolvedValue({ ok: true, mutated: true, model_version: { version_id: 'v_1' } });
  bridge.version.mockReset().mockResolvedValue(VERSION);
});

describe('Olumi\'s provisional first model, confirmed by its own receipt and a fresh read', () => {
  it('the bridge builds; the write is claimed only with this construction\'s version and a model read back', async () => {
    const p = product([EMPTY, MODEL]);
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', model_version: VERSION, revision: { graph_hash: 'h_new' } } });
    expect(traceRow('build_model_from_brief', out)).toEqual({ name: 'build_model_from_brief', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null });
    expect(bridge.build).toHaveBeenCalledWith('scn_1', BRIEF, p.dispatch, p.callStructured);
    expect(bridge.version).toHaveBeenCalledWith(p.dispatch, 'scn_1', BRIEF);
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no version of this construction on record', () => bridge.version.mockResolvedValue(null), [EMPTY, MODEL]],
    ['a read that holds no model', () => undefined, [EMPTY, EMPTY]],
  ] as const)('the bridge said saved, but %s: an unknown write, and no GRAPH_READY', async (_name, arrange, reads) => {
    arrange();
    const p = product(reads);
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(traceRow('build_model_from_brief', out).mutated).toBeNull();
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });
});

describe('exactly once: a retry of a committed construction is "already saved"', () => {
  it('the model exists because THIS construction committed (lost response, restart): already saved, no new build', async () => {
    const p = product([MODEL]);
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: VERSION } });
    expect(bridge.build).not.toHaveBeenCalled();
  });

  it('the bridge replayed this construction: already saved, no second "saved"', async () => {
    bridge.build.mockResolvedValue({ ok: true, mutated: false, replayed: true });
    expect(await buildModel(product([EMPTY, MODEL]), ctx, { brief: BRIEF })).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
  });

  it('a model that is not this construction\'s is never redrafted', async () => {
    bridge.version.mockResolvedValue(null);
    expect(await buildModel(product([MODEL]), ctx, { brief: BRIEF })).toEqual({ status: 'refused', reason: 'model_exists' });
    expect(bridge.build).not.toHaveBeenCalled();
  });
});

describe('refusals and unknowns, said as such', () => {
  it('a brief that is not literally the user\'s words: nothing is read or built', async () => {
    const p = product([]);
    expect(await buildModel(p, ctx, { brief: 'We run a large museum.' })).toEqual({ status: 'refused', reason: 'brief_not_users_words' });
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it('no drafter: unavailable', async () => {
    expect(await buildModel({ ...product([EMPTY]), callStructured: undefined }, ctx, { brief: BRIEF }))
      .toEqual({ status: 'unavailable', reason: 'drafter_unavailable', write: 'none' });
  });

  it.each([
    ['a construction refusal', { ok: false, mutated: false, refusal: 'construction_needs_redraft' }, { status: 'refused', reason: 'construction_needs_redraft' }],
    ['no answer from the drafter', { ok: false, mutated: false, refusal: 'no_structured_output' }, { status: 'unavailable', reason: 'no_structured_output', write: 'none' }],
    ['a model that appeared meanwhile', { ok: false, mutated: false, refusal: 'model_already_exists' }, { status: 'refused', reason: 'model_exists' }],
    ['a registration that failed on the server', { ok: false, mutated: false, refusal: 'registration_refused', http: 500 }, { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
    ['an unconfirmed write', { ok: false, mutated: true, refusal: 'not_confirmed' }, { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
  ] as const)('%s', async (_name, result, outcome) => {
    bridge.build.mockResolvedValue(result);
    expect(await buildModel(product([EMPTY, MODEL]), ctx, { brief: BRIEF })).toEqual(outcome);
  });

  it('a bridge that throws mid-build: an unknown write', async () => {
    bridge.build.mockRejectedValue(new Error('socket'));
    expect(await buildModel(product([EMPTY]), ctx, { brief: BRIEF })).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown' });
  });

  it('the parameters take the brief only', () => {
    expect(BuildModelParams.safeParse({ brief: BRIEF, explicit_rebuild_request: 'yes' }).success).toBe(false);
    expect(BuildModelParams.safeParse({ brief: '' }).success).toBe(false);
  });
});
