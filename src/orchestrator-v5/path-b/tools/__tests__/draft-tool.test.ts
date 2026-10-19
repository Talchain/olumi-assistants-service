/**
 * PATH-B DRAFT ADAPTER: the brief must literally be the user's words; ONE drafter call, the drafter's JSON converted by Step 8's
 * pure `candidateToGraph` and registered create-only under the construction's own operation id; `mutated` only when THIS
 * construction's own version is on record and a fresh read holds a model; a retry of a committed construction is "already
 * saved"; an unknown write is said as unknown. The drafter and the routes are scripted (no module mock: the conversion and the
 * construction's own helpers are real). SYNTHETIC brief.
 */
import { describe, expect, it, vi } from 'vitest';
import { BuildModelParams, buildModel, type DraftDeps } from '../draft-tool.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { constructionOperationId, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { traceRow } from '../outcome.js';
import { read, type Rec } from './fixtures.js';

const BRIEF = 'We run a small library and walk-ins swing a lot; should we add a second assistant on Saturdays?';
const SID = 'scn_1';
const DRAFT: Rec = {
  goal: { kind: null, deliverable: null, metric: 'Visitors served on Saturdays', operator: '>=', target_stated: false, value: null, unit: 'visitors',
    horizon_months: null, provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
    quantity_frame: 'level', basis: null },
  constraints: [], identities: [], risks: [], outcomes: [], unknowns: [], unknown_concerns: [], statements: [],
  options: [
    { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Add a second assistant on Saturdays', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Assistants on shift', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit', stated_evidence: null }] },
  ],
  factors: [{ label: 'Assistants on shift', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'people', provenance: 'inferred', plausible_max: 6 }],
  links: [{ from: 'Assistants on shift', to: 'Visitors served on Saturdays', direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
  decision_question: 'should we add a second assistant on Saturdays?',
};
type Reply = { status: number; json: Rec };
const EMPTY: Reply = { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } };
const MODEL: Reply = { status: 200, json: read({ graph_hash: 'h_new' }) };
const SAVED: Reply = { status: 200, json: { model_version: { version_id: 'v_1', version_number: 1 } } };
/** The versions read, holding this construction's own version (or not). */
const VERSIONS = (ours: boolean): Reply => ({ status: 200, json: { versions: [{ version_id: 'v_1', sequence: 1, created_at: '2026-10-19T18:00:00.000Z',
  creation: { kind: 'committed_mutation', mutation_id: 'm_1', source_turn_id: ours ? registrationTurnId(SID, constructionOperationId(SID, BRIEF)) : 'someone_else' } }] } });
const OURS = { version_id: 'v_1', version_number: 1, created_at: '2026-10-19T18:00:00.000Z', mutation_id: 'm_1', creation_kind: 'committed_mutation',
  source_turn_id: registrationTurnId(SID, constructionOperationId(SID, BRIEF)) };

/** Each route answers from its own script, in order; the drafter answers `text` (or throws). */
function product(routes: { graph?: Reply[]; register?: (Reply | Error)[]; versions?: Reply[] }, text: string | Error = JSON.stringify(DRAFT)) {
  const scripts = { graph: [...(routes.graph ?? [])], register: [...(routes.register ?? [])], versions: [...(routes.versions ?? [])] };
  const sent: { path: string; body: Rec }[] = [];
  const dispatch = vi.fn<DraftDeps['dispatch']>(async (path, body) => {
    sent.push({ path, body: body as Rec });
    const key = path.endsWith('/graph/register') ? 'register' : path.endsWith('/versions') ? 'versions' : 'graph';
    const next = scripts[key].shift();
    if (next === undefined) throw new Error(`unscripted ${path}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const callStructured = vi.fn<CallStructuredModel>(async () => {
    if (text instanceof Error) throw text;
    return { text, status: 'completed' };
  });
  return { dispatch, callStructured, onModelRegistered: vi.fn(), sent };
}
const ctx = { scenario_id: SID, verified_user_messages: [BRIEF], user_turn_text: BRIEF };
const registerCalls = (p: ReturnType<typeof product>) => p.sent.filter((s) => s.path.endsWith('/graph/register'));

describe('Olumi\'s provisional first model: ONE draft, converted by candidateToGraph, confirmed by its own receipt and a fresh read', () => {
  it('the conversion\'s graph is registered create-only under the construction\'s own operation; the draft travels beside the receipt', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const out = await buildModel(p, ctx, { brief: BRIEF });
    const converted = candidateToGraph(DRAFT);
    if ('refused' in converted) throw new Error(converted.refused);
    expect(registerCalls(p)).toEqual([{ path: `/assist/v1/scenarios/${SID}/graph/register`, body: {
      graph: converted.graph, brief_text: BRIEF, operation_id: constructionOperationId(SID, BRIEF), expected_graph_identity_hash: null } }]);
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', model_version: OURS, revision: { graph_hash: 'h_new' },
      draft: { declared: DRAFT, said: [...new Set(converted.loss.map((l) => l.reason))], not_expressible: converted.blocked_schema } } });
    expect(traceRow('build_model_from_brief', out)).toEqual({ name: 'build_model_from_brief', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null });
    expect(p.callStructured).toHaveBeenCalledTimes(1);
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no version of this construction on record', { graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(false)] }],
    ['a read that holds no model', { graph: [EMPTY, EMPTY], register: [SAVED], versions: [VERSIONS(true)] }],
  ] as const)('the route said saved, but %s: an unknown write, and no GRAPH_READY', async (_name, routes) => {
    const p = product({ graph: [...routes.graph], register: [...routes.register], versions: [...routes.versions] });
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(traceRow('build_model_from_brief', out).mutated).toBeNull();
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });
});

describe('exactly once: a retry of a committed construction is "already saved"', () => {
  it('the model exists because THIS construction committed (lost response, restart): already saved, no new draft', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS } });
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('the route replayed this construction: already saved, no second "saved"', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [{ status: 200, json: { replayed: true } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
  });

  it.each(['GRAPH_STALE', 'OPERATION_ID_REUSED'])('the register refuses %s and THIS construction is on record: already saved', async (code) => {
    const p = product({ graph: [EMPTY], register: [{ status: 409, json: { details: { code } } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS } });
  });

  it('a model that is not this construction\'s is never redrafted', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(false)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'refused', reason: 'model_exists' });
    expect(p.callStructured).not.toHaveBeenCalled();
  });
});

describe('refusals and unknowns, said as such', () => {
  it('a brief that is not literally the user\'s words: nothing is read, drafted or written', async () => {
    const p = product({});
    expect(await buildModel(p, ctx, { brief: 'We run a large museum.' })).toEqual({ status: 'refused', reason: 'brief_not_users_words' });
    expect(p.dispatch).not.toHaveBeenCalled();
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('CONTRAST: a read with no graph flag and no graph is still malformed: nothing is drafted', async () => {
    const p = product({ graph: [{ status: 200, json: { graph: null, graph_hash: null } }] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'unavailable', reason: 'read_malformed', write: 'none' });
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('no drafter: unavailable', async () => {
    expect(await buildModel({ ...product({ graph: [EMPTY] }), callStructured: undefined }, ctx, { brief: BRIEF }))
      .toEqual({ status: 'unavailable', reason: 'drafter_unavailable', write: 'none' });
  });

  it.each([
    ['no answer from the drafter', '', { status: 'unavailable', reason: 'no_structured_output', write: 'none' }],
    ['an answer cut off before it closed', JSON.stringify(DRAFT).slice(0, 200), { status: 'unavailable', reason: 'no_structured_output', write: 'none' }],
    ['a drafter that throws', new Error('socket'), { status: 'unavailable', reason: 'construction_failed', write: 'none' }],
    ['a draft with no goal (unreadable, never refused for what it means)', JSON.stringify({ ...DRAFT, goal: { metric: ' ' } }), { status: 'refused', reason: 'candidate_invalid' }],
  ] as const)('%s: nothing is written', async (_name, text, outcome) => {
    const p = product({ graph: [EMPTY] }, text);
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual(outcome);
    expect(registerCalls(p)).toEqual([]);
  });

  it.each([
    ['a model that appeared meanwhile (not ours)', { status: 409, json: { details: { code: 'GRAPH_STALE' } } }, [VERSIONS(false)], { status: 'refused', reason: 'model_exists' }],
    ['a registration the route refused', { status: 422, json: { message: 'bad graph' } }, [], { status: 'refused', reason: 'registration_refused' }],
    ['a registration that failed on the server', { status: 500, json: {} }, [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
    ['a registration whose answer was lost', new Error('socket'), [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown' }],
  ] as const)('%s', async (_name, reply, versions, outcome) => {
    const p = product({ graph: [EMPTY], register: [reply], versions: [...versions] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual(outcome);
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });

  it('the parameters take the brief only; an empty brief is not the user\'s words', async () => {
    expect(BuildModelParams.safeParse({ brief: BRIEF, explicit_rebuild_request: 'yes' }).success).toBe(false);
    expect(await buildModel(product({}), ctx, { brief: '' })).toEqual({ status: 'refused', reason: 'brief_not_users_words' });
  });
});
