/**
 * THIN CORE DRAFT ADAPTER: the brief must literally be the user's words; the AI's complete living model is labelled by the ONE
 * kernel, compiled by the pure mapper and registered create-only, as a core postimage, under the construction's own operation id;
 * `mutated` only when THIS registration's own receipt and hashes match a fresh read of the complete postimage, living model
 * included; a retry of a committed construction is "already saved"; an unknown write is said as unknown. The routes are scripted
 * (no module mock: the kernel, the mapper and the construction's own helpers are real). SYNTHETIC brief.
 */
import { describe, expect, it, vi } from 'vitest';
import { BuildModelParams, REVIEW_AFTER_SAVE, buildModel, type DraftDeps } from '../draft-tool.js';
import { applyKernel } from '../../living-model/kernel.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { KNOWN_ANSWER } from '../../living-model/__tests__/fixtures.js';
import { constructionOperationId } from '../../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { OUTCOME_TRACE, traceRow } from '../outcome.js';
import type { Rec } from './fixtures.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';

const BRIEF = 'We run a small library and walk-ins swing a lot; should we add a second assistant on Saturdays?';
const SID = 'scn_1';
const LIVING: LivingModelT = {
  aims: [{ id: 'visitors_served', text: 'Visitors served on Saturdays', status: 'current', target: null, defined_as: null, source: 'olumi', party: null, quote: null }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', settings: [], developed_from: null, source: 'olumi', party: null, quote: null },
    { status: 'feasible', id: 'add_assistant', label: 'Add a second assistant on Saturdays', developed_from: null, source: 'user', party: null, quote: 'add a second assistant on Saturdays',
      settings: [{ estimate_by: null, factor_id: 'assistants_on_shift', value: 2, low: null, high: null, unit: 'people', source: 'user', party: null, quote: 'add a second assistant on Saturdays' }] },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'assistants_on_shift', label: 'Assistants on shift', value: 1, low: null, high: null, unit: 'people', defined_as: null, source: 'olumi', party: null, quote: null }],
  links: [{ id: 'assistants_visitors', from: 'assistants_on_shift', to: 'visitors_served', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'direction_only', value: null, low: null, high: null, sd: null, unit: null, sign: '+' } }],
  risks: [], conditions: [], views: [{ holder: 'us', position: 'walk-ins swing a lot', quote: 'walk-ins swing a lot' }], history: [],
};
type Reply = { status: number; json: Rec };
const EMPTY: Reply = { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } };
const kernelled = applyKernel(LIVING, [BRIEF]);
const mapped = mapLivingModel(kernelled.model);
const POSTIMAGE: Rec = { ...mapped.graph, living_model: kernelled.model };
const MODEL: Reply = { status: 200, json: { graph: POSTIMAGE, graph_hash: computeAnalysisAffectingGraphHash(POSTIMAGE as never),
  graph_identity_hash: computeGraphIdentityHash(POSTIMAGE as never) } };
const SAVED: Reply = { status: 200, json: { graph_identity_hash: MODEL.json.graph_identity_hash, graph_hash: MODEL.json.graph_hash,
  model_version: { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', creation_kind: 'initial',
    graph_identity_hash: (MODEL.json.graph_identity_hash as Rec).value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(POSTIMAGE as never) } } };
const UNKNOWN = { data: { save_outcome: 'UNKNOWN' },
  detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.' };
const NO_WRITE = { data: { save_outcome: 'VERIFIED_NO_WRITE' } };
/** The versions read, holding this construction's own version (or not). */
const VERSIONS = (ours: boolean): Reply => ({ status: 200, json: { versions: [{ version_id: 'v_1', sequence: 1, created_at: '2026-10-19T18:00:00.000Z',
  creation: { kind: 'committed_mutation', mutation_id: 'm_1', source_turn_id: ours ? registrationTurnId(SID, constructionOperationId(SID, BRIEF)) : 'someone_else' } }] } });
const OURS = { version_id: 'v_1', version_number: 1, created_at: '2026-10-19T18:00:00.000Z', mutation_id: 'm_1', creation_kind: 'committed_mutation',
  source_turn_id: registrationTurnId(SID, constructionOperationId(SID, BRIEF)) };

/** Each route answers from its own script, in order. */
function product(routes: { graph?: Reply[]; register?: (Reply | Error)[]; versions?: Reply[] }) {
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
  return { dispatch, onModelRegistered: vi.fn(), sent };
}
const ARGS = { brief: BRIEF, model: LIVING };
const ctx = { scenario_id: SID, verified_user_messages: [BRIEF], user_turn_text: BRIEF };
const registerCalls = (p: ReturnType<typeof product>) => p.sent.filter((s) => s.path.endsWith('/graph/register'));

describe('Olumi\'s provisional first model: the AI\'s living model, compiled by the mapper, confirmed by its own receipt and a fresh read', () => {
  it('two stated goals are saved as two aims, including strict conversion and the launch-relative customer deadline', async () => {
    const brief = 'Conversion over 15%. 20 new customers within the first 3 months of launch.';
    const m = structuredClone(KNOWN_ANSWER);
    Object.assign(m.aims[0]!, { text: 'Conversion over 15%', quote: 'Conversion over 15%' });
    Object.assign(m.aims[0]!.target!, { quantity: 'Conversion', comparator: '>', value: 15, unit: '%', current: 10 });
    m.links[0]!.effect.unit = '%';
    m.aims.push({ ...structuredClone(m.aims[0]!), id: 'customers', text: '20 new customers within the first 3 months of launch',
      quote: '20 new customers within the first 3 months of launch', target: { ...m.aims[0]!.target!, quantity: 'New customers',
        comparator: '>=', value: 20, unit: 'customers', current: null, by_when: 'within the first 3 months of launch', period_months: null } });
    const args = BuildModelParams.parse({ brief, model: m });
    const kernel = applyKernel(args.model, [brief]);
    const mapped = mapLivingModel(kernel.model);
    const postimage = JSON.parse(JSON.stringify({ ...mapped.graph, living_model: kernel.model }));
    const graph_hash = computeAnalysisAffectingGraphHash(postimage);
    const graph_identity_hash = computeGraphIdentityHash(postimage);
    const p = product({ graph: [EMPTY, { status: 200, json: { graph: postimage, graph_hash, graph_identity_hash } }],
      register: [{ status: 200, json: { graph_hash, graph_identity_hash } }] });
    const out = await buildModel(p, { scenario_id: SID, verified_user_messages: [brief], user_turn_text: brief }, args);
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
    expect(registerCalls(p)).toHaveLength(1);
    expect((registerCalls(p)[0]!.body as { graph: { living_model: { aims: unknown } } }).graph.living_model.aims).toEqual(m.aims);
    expect(p.onModelRegistered.mock.calls[0]![0].living_model.aims).toEqual(m.aims);
    expect(mapped.graph.nodes.filter(n => n.kind === 'goal').map(n => n.id)).toEqual(['g']);
    expect(mapped.withheld).toEqual([{ id: 'customers', reason: 'goal_level_unknown' }]);
    expect((mapped.graph as Rec).goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'customers', role: 'goal_target', value: 20 }));
    expect((mapped.graph as Rec).goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'g', role: 'goal_target', value: 15, operator_as_stated: '>' }));
  });

  it('the living model and its compiled graph are registered create-only, as a core postimage, under the construction\'s own operation', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const out = await buildModel(p, ctx, ARGS);
    expect(registerCalls(p)).toEqual([{ path: `/assist/v1/scenarios/${SID}/graph/register`, body: {
      graph: POSTIMAGE, thin_core: true, brief_text: BRIEF, operation_id: constructionOperationId(SID, BRIEF), expected_graph_identity_hash: null } }]);
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', save_outcome: 'VERIFIED_SAVED', model_version: SAVED.json.model_version,
      revision: { graph_hash: MODEL.json.graph_hash }, draft: { withheld: mapped.withheld } } });
    // R7 (DL 93d79c3e, C2): the kernel's authorship decisions are the host's; the AI's JSON never carries them, only the trace does.
    expect(JSON.parse(JSON.stringify(out)).data.draft).not.toHaveProperty('relabelled');
    expect(out[OUTCOME_TRACE]).toEqual({ relabelled: [] });
    // What this slice cannot yet convert is said, never guessed: no level target, so no chance.
    expect(mapped.withheld).toEqual([{ id: 'visitors_served', reason: 'no_level_target' }]);
    // The goal is still drawn, and the unsized link to it is Olumi's placeholder (the licence withholds the chance).
    expect(mapped.graph.nodes.find((n) => n.id === 'visitors_served')).toMatchObject({ kind: 'goal' });
    expect(mapped.graph.edges.find((e) => e.id === 'assistants_visitors')).toMatchObject({ provenance: { magnitude: 'olumi_placeholder' } });
    expect(traceRow('build_model_from_brief', out)).toEqual({ name: 'build_model_from_brief', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null });
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });

  it('attribution is a label: a "user" quote the person never wrote is saved as unverified, never as Olumi\'s', async () => {
    const claimed: LivingModelT = structuredClone(LIVING);
    claimed.factors[0] = { ...claimed.factors[0]!, source: 'user', quote: 'we always have one assistant' };
    const k = applyKernel(claimed, [BRIEF]);
    expect(k.relabelled).toEqual([{ id: 'assistants_on_shift', was: 'user' }]);
    expect(k.model.factors[0]!.source).toBe('unverified');
    expect(k.model.options[1]!.settings[0]!.source).toBe('user');
  });

  it.each([
    ['no receipt of this construction on record', { graph: [EMPTY, MODEL], register: [{ status: 200, json: {} }], versions: [VERSIONS(false)] }],
    ['a read that holds no model', { graph: [EMPTY, EMPTY], register: [SAVED], versions: [VERSIONS(true)] }],
  ] as const)('the route said saved, but %s: an unknown write, and no GRAPH_READY', async (_name, routes) => {
    const p = product({ graph: [...routes.graph], register: [...routes.register], versions: [...routes.versions] });
    const out = await buildModel(p, ctx, ARGS);
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN });
    expect(traceRow('build_model_from_brief', out).mutated).toBeNull();
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });
});

describe('a guest\u2019s write mints no version (append_turn_atomic_v5: no owner, no version)', () => {
  it('saved on THIS registration\u2019s acknowledgement and a fresh read holding the complete model; its receipt is that acknowledgement', async () => {
    const reg = structuredClone(SAVED);
    delete reg.json.model_version;
    const p = product({ graph: [EMPTY, MODEL], register: [reg] });
    const out = await buildModel(p, ctx, ARGS);
    expect(out).toMatchObject({ status: 'ok', data: { model_version: { graph_identity_hash: (MODEL.json.graph_identity_hash as Rec).value } } });
    expect(traceRow('build_model_from_brief', out).mutated).toBe(true);
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });
});

describe('L26B verifier diagnostics never change the outcome bytes or effects', () => {
  const cases = [
    ['receipt-postimage', { check: 'postimage_diff', keys: ['nodes'] }],
    ['version_id', { check: 'receipt_invalid', field: 'version_id' }],
    ['version_number', { check: 'revision_mismatch', field: 'version_number' }],
    ['mutation_id', { check: 'receipt_invalid', field: 'mutation_id' }],
    ['ack-missing', { check: 'ack_status', status: 200 }],
    ['ack-identity', { check: 'hash_mismatch', field: 'ack_identity' }],
    ['receipt-identity', { check: 'hash_mismatch', field: 'receipt_identity' }],
    ['read-identity', { check: 'hash_mismatch', field: 'read_identity' }],
    ['revision', { check: 'revision_mismatch', field: 'graph_hash' }],
    ['analysis', { check: 'hash_mismatch', field: 'analysis_hash' }],
    ['postimage', { check: 'postimage_diff', keys: ['nodes'] }],
    ['readback', { check: 'readback_unavailable', code: 'read_failed' }],
  ] as const;
  it.each(cases)('%s: first failed check, exact original JSON', async (fault, diagnostic) => {
    const reg = structuredClone(SAVED);
    const read = structuredClone(MODEL);
    const receipt = reg.json.model_version as Rec;
    const originalIdentity = (read.json.graph_identity_hash as Rec).value as string;
    const graph = read.json.graph as Rec;
    const hash = (x: unknown): string => String(x).slice(0, 12);
    let extra: Rec = {};
    if (fault === 'receipt-postimage') delete reg.json.model_version;
    if (fault === 'version_id' || fault === 'mutation_id') receipt[fault] = '';
    if (fault === 'version_number') receipt.version_number = 0;
    if (fault === 'ack-missing') reg.json.graph_identity_hash = null;
    if (fault === 'ack-identity') {
      reg.json.graph_identity_hash = { value: 'Bearer synthetic-secret' };
      extra = { expected: null, actual: hash(originalIdentity) };
    }
    if (fault === 'receipt-identity') {
      receipt.graph_identity_hash = 'a'.repeat(64);
      extra = { expected: hash(originalIdentity), actual: 'a'.repeat(12) };
    }
    if (fault === 'read-identity') {
      reg.json.graph_identity_hash = read.json.graph_identity_hash = { value: 'a'.repeat(64) };
      receipt.graph_identity_hash = 'a'.repeat(64);
      extra = { expected: 'a'.repeat(12), actual: hash(originalIdentity) };
    }
    if (fault === 'revision') {
      reg.json.graph_hash = 'a'.repeat(16);
      extra = { expected: 'a'.repeat(12), actual: hash(read.json.graph_hash) };
    }
    if (fault === 'analysis') {
      receipt.analysis_affecting_hash = 'a'.repeat(64);
      extra = { expected: hash(computeAnalysisAffectingGraphHashSha256(graph as never)), actual: 'a'.repeat(12) };
    }
    if (fault === 'postimage' || fault === 'receipt-postimage') {
      (graph.nodes as Rec[])[0]!.label = 'Unrelated private content';
      reg.json.graph_identity_hash = read.json.graph_identity_hash = computeGraphIdentityHash(graph as never);
      receipt.graph_identity_hash = (read.json.graph_identity_hash as Rec).value;
      reg.json.graph_hash = read.json.graph_hash = computeAnalysisAffectingGraphHash(graph as never);
      receipt.analysis_affecting_hash = computeAnalysisAffectingGraphHashSha256(graph as never);
    }
    if (fault === 'readback') { read.status = 503; read.json = {}; }
    const p = product({ graph: [EMPTY, read], register: [reg] });
    const out = await buildModel(p, ctx, ARGS);
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN });
    expect(JSON.stringify(out)).toBe(JSON.stringify({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN }));
    const detail = traceRow('build_model_from_brief', out).draft_verification;
    expect(detail).toEqual({ ...diagnostic, ...extra });
    expect(JSON.stringify(detail)).not.toMatch(/Bearer|synthetic-secret|Unrelated private content/);
    expect(registerCalls(p)).toHaveLength(1);
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });

  it.each([202, 409, 500, null])('ACK %s retains its UNKNOWN bytes', async (status) => {
    const reply = status === null ? new Error('Bearer secret must never enter a diagnostic')
      : { status, json: status === 409 ? { details: { code: 'OPERATION_ID_REUSED' } } : {} };
    const p = product({ graph: [EMPTY], register: [reply] });
    const out = await buildModel(p, ctx, ARGS);
    expect(out).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN });
    expect(traceRow('build_model_from_brief', out).draft_verification).toEqual({ check: 'ack_status', status });
    expect(registerCalls(p)).toHaveLength(1);
  });
});

describe('exactly once: a retry of a committed construction is "already saved"', () => {
  it('the model exists because THIS construction committed (lost response, restart): already saved, no new draft', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, ARGS)).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS, save_outcome: 'VERIFIED_SAVED' } });
    expect(registerCalls(p)).toEqual([]);
  });

  it('the route replayed this construction: already saved, no second "saved"', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [{ ...SAVED, json: { ...SAVED.json, replayed: true } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, ARGS)).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
  });

  it.each(['GRAPH_STALE', 'OPERATION_ID_REUSED'])('the register refuses %s and THIS construction is on record: already saved', async (code) => {
    const p = product({ graph: [EMPTY], register: [{ status: 409, json: { details: { code } } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, ARGS)).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS, save_outcome: 'VERIFIED_SAVED' } });
  });

  it('a model that is not this construction\'s is never redrafted', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(false)] });
    expect(await buildModel(p, ctx, ARGS)).toEqual({ status: 'refused', reason: 'model_exists', ...NO_WRITE });
    expect(registerCalls(p)).toEqual([]);
  });
});

describe('refusals and unknowns, said as such', () => {
  it('a brief that is not literally the user\'s words: nothing is read, drafted or written', async () => {
    const p = product({});
    expect(await buildModel(p, ctx, { brief: 'We run a large museum.', model: LIVING })).toEqual({ status: 'refused', reason: 'brief_not_users_words', ...NO_WRITE });
    expect(p.dispatch).not.toHaveBeenCalled();
    expect(registerCalls(p)).toEqual([]);
  });

  it('CONTRAST: a read with no graph flag and no graph is still malformed: nothing is drafted', async () => {
    const p = product({ graph: [{ status: 200, json: { graph: null, graph_hash: null } }] });
    expect(await buildModel(p, ctx, ARGS)).toEqual({ status: 'unavailable', reason: 'read_malformed', write: 'none', ...NO_WRITE });
    expect(registerCalls(p)).toEqual([]);
  });

  it('a model with nothing in it: nothing is written', async () => {
    const empty: LivingModelT = { aims: [], options: [], factors: [], links: [], risks: [], conditions: [], views: [], history: [] };
    const p = product({ graph: [EMPTY] });
    expect(await buildModel(p, ctx, { brief: BRIEF, model: empty })).toEqual({ status: 'refused', reason: 'model_empty', ...NO_WRITE });
    expect(registerCalls(p)).toEqual([]);
  });

  it.each([
    ['a model that appeared meanwhile (not ours)', { status: 409, json: { details: { code: 'GRAPH_STALE' } } }, [VERSIONS(false)], { status: 'refused', reason: 'model_exists', ...NO_WRITE }],
    ['a registration the route refused', { status: 422, json: { message: 'bad graph' } }, [], { status: 'refused', reason: 'registration_refused', ...NO_WRITE }],
    ['a dispatched registration without a completed acknowledgement', { status: 202, json: {} }, [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN }],
    ['an operation already used but its receipt unavailable', { status: 409, json: { details: { code: 'OPERATION_ID_REUSED' } } }, [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN }],
    ['a registration that failed on the server', { status: 500, json: {} }, [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN }],
    ['a registration whose answer was lost', new Error('socket'), [], { status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN }],
  ] as const)('%s', async (_name, reply, versions, outcome) => {
    const p = product({ graph: [EMPTY], register: [reply], versions: [...versions] });
    expect(await buildModel(p, ctx, ARGS)).toEqual(outcome);
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });

  it('the parameters take the brief and the complete model, nothing else; an empty brief is not the user\'s words', async () => {
    expect(BuildModelParams.safeParse(ARGS).success).toBe(true);
    expect(BuildModelParams.safeParse({ brief: BRIEF }).success).toBe(false);
    expect(BuildModelParams.safeParse({ ...ARGS, explicit_rebuild_request: 'yes' }).success).toBe(false);
    expect(await buildModel(product({}), ctx, { brief: '', model: LIVING })).toEqual({ status: 'refused', reason: 'brief_not_users_words', ...NO_WRITE });
  });

  it('Olumi\'s own link carries its direction (21 Oct: unsigned goal links left Run disabled): the strict tool schema tells the AI so', () => {
    const link = (BuildModelParams.shape.model as unknown as { shape: { links: { element: { shape: { effect: { shape: { sign: { description?: string } } } } } } } })
      .shape.links.element.shape.effect.shape.sign;
    expect(link.description).toMatch(/For source olumi, give your provisional judgement of direction; use form direction_only only when `to` has no unit or `from` is a quantity with no unit \(an option or an on-or-off step is \+1 when in place\), else give its size\./);
    // Codex #3551 R1: every other source (user, party, unverified) keeps only the direction it supplied; else null and ask.
    expect(link.description).toMatch(/For source user, party or unverified, preserve only the direction that source supplied\. If none was supplied, use sign null and form unknown, then ask\./);
    expect(link.description).toMatch(/Never put an Olumi-inferred direction under another source\./);
  });
});

describe('the structure facts (21 Oct, advisory): never a refusal; said with the saved draft', () => {
  it('a draft with gaps and no critic is saved at once, its gaps said with it', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const out = await buildModel({ ...p, review: { done: false } }, ctx, ARGS);
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { draft: { gaps: { goal_not_measurable: true, unreachable: [], risk_without_chance: [] } } } });
  });
});

describe('the critic (21 Oct): a second model reviews the first draft of the turn, beside the structure check', () => {
  const CRITIQUE = { measurable_goal: { quantity: 'visitors served', unit: 'visitors', horizon: 'per Saturday', why: 'the aim has no target' },
    missing: [{ kind: 'risk' as const, label: 'Assistant calls in sick', reaches_goal_via: 'lowers assistants on shift', why_it_matters: 'one absence undoes the option' }],
    connect: [], question: 'How many visitors do you need to serve on a Saturday?' };
  it('Track 3 candidate 2 (504s after a 32–46 s redraft): the first draft is SAVED at once, its review returned beside it; the critic read the brief and the draft, once', async () => {
    const review = { done: false };
    // Codex #3599: the critic is held PENDING, so the save is proven to happen before (and without) its answer.
    let answer: (c: typeof CRITIQUE) => void = () => {};
    const critique = vi.fn((_input: string) => new Promise<typeof CRITIQUE>((resolve) => { answer = resolve; }));
    const p = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const pending = buildModel({ ...p, review, critique }, ctx, ARGS);
    await vi.waitFor(() => expect(registerCalls(p), 'saved while the critic is still reading').toHaveLength(1));
    answer(CRITIQUE);
    const first = await pending;
    expect(first).toMatchObject({ status: 'ok', mutated: true, data: { review: { critique: CRITIQUE, note: REVIEW_AFTER_SAVE }, draft: { gaps: { goal_not_measurable: true } } } });
    expect(REVIEW_AFTER_SAVE).toContain('Do not rebuild or change the model in this turn.');
    expect(JSON.parse(critique.mock.calls[0]![0])).toMatchObject({ brief: BRIEF, draft: { aims: [{ id: 'visitors_served' }] } });
    expect(registerCalls(p), 'one save, never gated on the review').toHaveLength(1);
    expect(critique, 'the critic reads the first draft of the turn only').toHaveBeenCalledTimes(1);
  });

  it('CONTRAST: an unavailable critic never blocks the draft: it is saved at once', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const out = await buildModel({ ...p, review: { done: false }, critique: async () => undefined }, ctx, ARGS);
    expect(out).toMatchObject({ status: 'ok', mutated: true });
    expect((out as { data: Record<string, unknown> }).data, 'no review to carry').not.toHaveProperty('review');
    const failing = product({ graph: [EMPTY, MODEL], register: [SAVED], versions: [VERSIONS(true)] });
    const thrown = await buildModel({ ...failing, review: { done: false }, critique: async () => { throw new Error('critic down'); } }, ctx, ARGS);
    expect(thrown, 'a failed critic never fails the saved draft').toMatchObject({ status: 'ok', mutated: true });
  });
});

describe('the construction deadline (buddy served BLOCK on #3574): the critic gets only what is left, so the save keeps its time', () => {
  const CRITIQUE = { measurable_goal: null, missing: [], connect: [], question: 'How many visitors do you need to serve on a Saturday?' };

  it('the critic is bounded by what is LEFT of one construction deadline; with none, it keeps its own clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      const critique = vi.fn(async (_input: string, _msLeft?: number) => CRITIQUE);
      vi.setSystemTime(1_000_000 + 100_000);
      await buildModel({ ...product({ graph: [EMPTY] }), review: { done: false }, critique, deadlineAt: 1_000_000 + 145_000 }, ctx, ARGS);
      expect(critique.mock.calls[0]![1]).toBe(45_000);
      critique.mockClear();
      await buildModel({ ...product({ graph: [EMPTY] }), review: { done: false }, critique }, ctx, ARGS);
      expect(critique.mock.calls[0]![1]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the critic reads the brief, the draft and the gaps, nothing else', async () => {
    const critique = vi.fn(async (_input: string) => CRITIQUE);
    await buildModel({ ...product({ graph: [EMPTY] }), review: { done: false }, critique }, ctx, ARGS);
    expect(Object.keys(JSON.parse(critique.mock.calls[0]![0]))).toEqual(['brief', 'draft', 'gaps']);
  });
});
