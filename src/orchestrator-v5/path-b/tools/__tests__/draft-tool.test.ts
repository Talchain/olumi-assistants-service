/**
 * PATH-B DRAFT ADAPTER: the brief must be the user's own words (literally); one drafter call; step 8's conversion (injected);
 * ONE create-only registration; `mutated` only when an INDEPENDENT readback shows the registered hash. Every failure claims
 * nothing, and an unknown write is said as unknown. SYNTHETIC brief and scenario.
 */
import { describe, expect, it, vi } from 'vitest';
import { BuildModelParams, buildModel, type CandidateToGraph } from '../draft-tool.js';
import { traceRow } from '../outcome.js';
import { constructionOperationId } from '../../../agent-lane/runtime/build-model.js';
import { graph, read, type Rec } from './fixtures.js';

const BRIEF = 'We run a small library and walk-ins swing a lot; should we add a second assistant on Saturdays?';
const CANDIDATE = { goal: { metric: 'Visitors served' }, nodes: [], edges: [] };
type Reply = { status: number; json: Rec } | Error;
const EMPTY: Reply = { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h_empty' } };
const MODEL = (hash = 'h_new'): Reply => ({ status: 200, json: read({ graph_hash: hash }) });
const REGISTERED: Reply = { status: 200, json: { registered: true, graph_identity_hash: 'id_new', graph_hash: 'h_new', model_version_receipt: { version: 1 } } };

function product(reads: readonly Reply[], register: Reply, opts: { text?: string; status?: string; convert?: CandidateToGraph; throws?: boolean } = {}) {
  const queue = [...reads];
  const dispatch = vi.fn(async (path: string, _body: unknown) => {
    const next = path.endsWith('/graph/register') ? register : queue.shift();
    if (next === undefined) throw new Error(`unscripted ${path}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const callStructured = vi.fn(async () => {
    if (opts.throws === true) throw new Error('provider');
    return { text: opts.text ?? JSON.stringify(CANDIDATE), ...(opts.status === undefined ? {} : { status: opts.status, incomplete_reason: 'max_output_tokens' }) };
  });
  const candidateToGraph = vi.fn(opts.convert ?? (() => ({ graph: graph() })));
  return { dispatch, callStructured, candidateToGraph, onModelRegistered: vi.fn() };
}
const ctx = { scenario_id: 'scn_1', verified_user_messages: [BRIEF], user_turn_text: BRIEF };

describe('Olumi\'s provisional first model, confirmed by an independent readback', () => {
  it('drafts once, converts, registers create-only, and claims the write only after the readback', async () => {
    const p = product([EMPTY, MODEL()], REGISTERED);
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', revision: { graph_hash: 'h_new' }, model_version: { version: 1 } } });
    expect(traceRow('build_model_from_brief', out)).toEqual({ name: 'build_model_from_brief', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null });
    expect(p.callStructured).toHaveBeenCalledTimes(1);
    expect(p.candidateToGraph).toHaveBeenCalledWith(CANDIDATE, BRIEF);
    expect(p.dispatch).toHaveBeenCalledWith('/assist/v1/scenarios/scn_1/graph/register', { graph: graph(), brief_text: BRIEF,
      operation_id: constructionOperationId('scn_1', BRIEF), expected_graph_identity_hash: null });
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });

  it('a registration replayed from an earlier identical call is no new write', async () => {
    const replayed: Reply = { status: 200, json: { ...(REGISTERED as { json: Rec }).json, replayed: true } };
    expect(await buildModel(product([EMPTY, MODEL()], replayed), ctx, { brief: BRIEF })).toMatchObject({ status: 'ok', mutated: false, data: { replayed: true } });
  });

  it('a readback that does not show the registered hash: an unknown write, and no GRAPH_READY', async () => {
    const p = product([EMPTY, MODEL('h_other')], REGISTERED);
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(traceRow('build_model_from_brief', out).mutated).toBeNull();
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });
});

describe('it refuses or says unavailable, and writes nothing', () => {
  it('a brief that is not literally the user\'s words', async () => {
    const p = product([EMPTY], REGISTERED);
    expect(await buildModel(p, ctx, { brief: 'We run a large museum.' })).toEqual({ status: 'refused', reason: 'brief_not_users_words' });
    expect(p.dispatch).not.toHaveBeenCalled();
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('a model already there is never redrafted', async () => {
    const p = product([MODEL('h_one')], REGISTERED);
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'refused', reason: 'model_exists' });
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it.each([
    ['no drafter', { callStructured: undefined }, 'drafter_unavailable'],
    ['no conversion yet (step 8)', { candidateToGraph: undefined }, 'conversion_unavailable'],
  ] as const)('%s: unavailable', async (_name, missing, reason) => {
    const p = { ...product([EMPTY], REGISTERED), ...missing };
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'unavailable', reason, write: 'none' });
  });

  it.each([
    ['a cut-off draft', { status: 'incomplete' }, { status: 'unavailable', reason: 'draft_cut_off', write: 'none', detail: 'max_output_tokens' }],
    ['an unreadable draft', { text: '{not json' }, { status: 'unavailable', reason: 'draft_unreadable', write: 'none' }],
    ['a drafter that throws', { throws: true }, { status: 'unavailable', reason: 'drafter_failed', write: 'none' }],
    ['a conversion refusal', { convert: () => ({ refused: 'no_goal' }) }, { status: 'refused', reason: 'no_goal' }],
    ['an invalid graph', { convert: () => ({ graph: { nodes: 'x' } }) }, { status: 'refused', reason: 'graph_invalid' }],
  ] as const)('%s, before any registration', async (_name, opts, outcome) => {
    const p = product([EMPTY], REGISTERED, opts as never);
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual(outcome);
    expect(p.dispatch).not.toHaveBeenCalledWith(expect.stringMatching(/register$/), expect.anything());
  });

  it.each([
    ['a model that appeared meanwhile', { status: 409, json: { details: { code: 'GRAPH_STALE' } } }, { status: 'refused', reason: 'model_exists', detail: 'GRAPH_STALE' }],
    ['a registration the route refused', { status: 422, json: {} }, { status: 'refused', reason: 'registration_refused', detail: 'HTTP 422' }],
    ['a registration that failed on the server', { status: 500, json: {} }, { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
    ['a registration that threw', new Error('socket'), { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
  ] as const)('%s', async (_name, register, outcome) => {
    expect(await buildModel(product([EMPTY, MODEL()], register as Reply), ctx, { brief: BRIEF })).toEqual(outcome);
  });

  it('the parameters take the brief only', () => {
    expect(BuildModelParams.safeParse({ brief: BRIEF, explicit_rebuild_request: 'yes' }).success).toBe(false);
    expect(BuildModelParams.safeParse({ brief: '' }).success).toBe(false);
  });
});
