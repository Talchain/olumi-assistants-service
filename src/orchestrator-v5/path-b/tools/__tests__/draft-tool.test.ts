/**
 * PATH-B DRAFT ADAPTER: the brief must literally be the user's words; ONE drafter call, the drafter's JSON converted by Step 8's
 * pure `candidateToGraph` and registered create-only under the construction's own operation id; `mutated` only when THIS
 * registration's own receipt and hashes match a fresh read of the complete postimage; a retry of a committed construction is "already
 * saved"; an unknown write is said as unknown. The drafter and the routes are scripted (no module mock: the conversion and the
 * construction's own helpers are real). SYNTHETIC brief.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BuildModelParams, B_DRAFTER_SENTENCE, buildModel, type DraftDeps } from '../draft-tool.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, constructionOperationId, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { traceRow } from '../outcome.js';
import { STANCE_DESCRIPTION } from '../change-tools.js';
import type { Rec } from './fixtures.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';

const ACTION_TIMING_SENTENCE = 'Declare stated additions in interventions with value_kind=additional, leaving unknown current levels as questions, and stated goal time limits in horizon_months and verbatim deadline_words, keeping relative periods relative without inventing dates.';

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
const convertedDraft = candidateToGraph(DRAFT);
if ('refused' in convertedDraft) throw new Error(convertedDraft.refused);
const MODEL: Reply = { status: 200, json: { graph: convertedDraft.graph, graph_hash: computeAnalysisAffectingGraphHash(convertedDraft.graph as never),
  graph_identity_hash: computeGraphIdentityHash(convertedDraft.graph as never) } };
const SAVED: Reply = { status: 200, json: { graph_identity_hash: MODEL.json.graph_identity_hash, graph_hash: MODEL.json.graph_hash,
  model_version: { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', creation_kind: 'initial',
    graph_identity_hash: (MODEL.json.graph_identity_hash as Rec).value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(convertedDraft.graph as never) } } };
const UNKNOWN = { data: { save_outcome: 'UNKNOWN' },
  detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.' };
const NO_WRITE = { data: { save_outcome: 'VERIFIED_NO_WRITE' } };
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
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', save_outcome: 'VERIFIED_SAVED', model_version: SAVED.json.model_version, revision: { graph_hash: MODEL.json.graph_hash },
      draft: { declared: DRAFT, said: [...new Set(converted.loss.map((l) => l.reason))], not_expressible: converted.blocked_schema } } });
    expect(traceRow('build_model_from_brief', out)).toEqual({ name: 'build_model_from_brief', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null });
    expect(p.callStructured).toHaveBeenCalledTimes(1);
    expect(p.onModelRegistered).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no receipt of this construction on record', { graph: [EMPTY, MODEL], register: [{ status: 200, json: {} }], versions: [VERSIONS(false)] }],
    ['a read that holds no model', { graph: [EMPTY, EMPTY], register: [SAVED], versions: [VERSIONS(true)] }],
  ] as const)('the route said saved, but %s: an unknown write, and no GRAPH_READY', async (_name, routes) => {
    const p = product({ graph: [...routes.graph], register: [...routes.register], versions: [...routes.versions] });
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN });
    expect(traceRow('build_model_from_brief', out).mutated).toBeNull();
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });
});

describe('L26B verifier diagnostics never change the outcome bytes or effects', () => {
  const cases = [
    ['receipt', { check: 'receipt_absent' }],
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
    if (fault === 'receipt') delete reg.json.model_version;
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
    if (fault === 'postimage') {
      (graph.nodes as Rec[])[0]!.label = 'Unrelated private content';
      reg.json.graph_identity_hash = read.json.graph_identity_hash = computeGraphIdentityHash(graph as never);
      receipt.graph_identity_hash = (read.json.graph_identity_hash as Rec).value;
      reg.json.graph_hash = read.json.graph_hash = computeAnalysisAffectingGraphHash(graph as never);
      receipt.analysis_affecting_hash = computeAnalysisAffectingGraphHashSha256(graph as never);
    }
    if (fault === 'readback') { read.status = 503; read.json = {}; }
    const p = product({ graph: [EMPTY, read], register: [reg] });
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN });
    expect(JSON.stringify(out)).toBe(JSON.stringify({ status: 'unavailable', reason: 'not_verified', write: 'unknown', ...UNKNOWN }));
    const detail = traceRow('build_model_from_brief', out).draft_verification;
    expect(detail).toEqual({ ...diagnostic, ...extra });
    expect(JSON.stringify(detail)).not.toMatch(/Bearer|synthetic-secret|Unrelated private content/);
    expect(registerCalls(p)).toHaveLength(1);
    expect(p.callStructured).toHaveBeenCalledTimes(1);
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });

  it.each([202, 409, 500, null])('ACK %s retains its UNKNOWN bytes', async (status) => {
    const reply = status === null ? new Error('Bearer secret must never enter a diagnostic')
      : { status, json: status === 409 ? { details: { code: 'OPERATION_ID_REUSED' } } : {} };
    const p = product({ graph: [EMPTY], register: [reply] });
    const out = await buildModel(p, ctx, { brief: BRIEF });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown', ...UNKNOWN });
    expect(traceRow('build_model_from_brief', out).draft_verification).toEqual({ check: 'ack_status', status });
    expect(registerCalls(p)).toHaveLength(1);
  });
});

// ⛔ #3473 R1 (Codex's two probes): no host reading of the brief changes what the AI is told before it declares anything.
describe('the drafter is told the static instructions and the literal brief, nothing a host reader added', () => {
  it.each([
    ['a written range (no range notes)', 'We may add a sales rep. Each deal is worth £1-2m.'],
    ['a deadline (no event-by-date attestation)', 'We need to launch by March. Should we add an engineer?'],
  ])('%s', async (_name, brief) => {
    const p = product({ graph: [EMPTY], register: [{ status: 422, json: {} }] });
    await buildModel(p, { scenario_id: SID, verified_user_messages: [brief], user_turn_text: brief }, { brief });
    expect(p.callStructured).toHaveBeenCalledTimes(1);
    const sent = p.callStructured.mock.calls[0]![0];
    expect(sent.instructions).toBe(`${BUILD_INSTRUCTIONS} ${B_DRAFTER_SENTENCE}`);
    expect(sent.input).toContain(brief);
    expect(sent.input).not.toContain('Construction notes');
    expect(`${sent.instructions}\n${sent.input}`).not.toContain('deterministic reader');
  });
});

// ⭐ B-ONLY DRAFTER TEXT (DL 19 Oct; K5 P0 ruling 20 Oct): the sent bytes after A's static instructions are exactly the AIE's sentence, one
// space, then the K5 P0 ruling's sentence, each by its own sha256.
describe('B\'s drafter request carries the AIE\'s sentence and the K5 P0 ruling\'s sentence verbatim; A\'s instructions carry neither', () => {
  it('the sent instructions are A\'s static instructions, one space, the AIE\'s bytes, one space, the ruling\'s bytes', async () => {
    const p = product({ graph: [EMPTY], register: [{ status: 422, json: {} }] });
    await buildModel(p, ctx, { brief: BRIEF });
    const sent = String(p.callStructured.mock.calls[0]![0].instructions);
    expect(sent.startsWith(`${BUILD_INSTRUCTIONS} `)).toBe(true);
    const extra = 'For every figure, declare origin (user, third_party, olumi or unknown) and stance (stated_current, hypothetical, target or estimate) from its full source context; retain its literal source words where available, named source, sign, unit, period and conditions; identify your estimates and derivations as Olumi’s, preserve unresolved origin as unknown, and never promote a supposition to a stated current fact.';
    const addition = 'Where the brief does not state a level, setting or size the model needs, propose a defensible Olumi starting estimate with origin=olumi and stance=estimate, explaining its basis, unit and period for the person to approve through the existing card, never presenting it as theirs; if no defensible estimate is possible, state the limitation and ask for the missing input rather than silently leaving the model unrunnable; in every draft with a supported additive goal, declare the sum identity with the separate current-level factor and every distinct addition as bound operands under the rules above.';
    const b = sent.slice(BUILD_INSTRUCTIONS.length + 1, -(addition.length + ACTION_TIMING_SENTENCE.length + 2));
    const [aie, ruling] = [b.slice(0, 715), b.slice(716, -(extra.length + 1))];
    expect(sent).toBe(`${BUILD_INSTRUCTIONS} ${aie} ${ruling} ${extra} ${addition} ${ACTION_TIMING_SENTENCE}`);
    const sha = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    expect(sha(ACTION_TIMING_SENTENCE)).toBe('6e5e3d6dcb84a97d40f48dc20fe46c6fe6d7d538e7a54647ec810e63355c8d91');
    expect(BUILD_INSTRUCTIONS).not.toContain(ACTION_TIMING_SENTENCE);
    expect(sha(addition)).toBe('15c1eae82146b2ef05b6e3a78af3a9568af58643e41472fcee15410a628c9085');
    expect(BUILD_INSTRUCTIONS).not.toContain(addition);
    expect(sha(extra)).toBe('96074041c73386e9e0a1e930dd4745ac422577aa91a40ceeedf28277508cb781');
    expect([sha(aie), sha(ruling)]).toEqual(['cfbe03aa8d84e1ed6452817987d331bbf15596be25487da26b93978316d95f49',
      '9111ed60fb9c8e4048118f3d49c6409ba98c59b2a39c2c0bcc90235faf9436ee']);
    expect(BUILD_INSTRUCTIONS).not.toContain(aie.slice(0, 60));
    expect(BUILD_INSTRUCTIONS).not.toContain(ruling.slice(0, 60));
  });
});

it('ONE declared pair: B strict output requires origin/stance on every figure; A stays byte-equal', async () => {
  const before = buildCandidateSchema();
  const p = product({ graph: [EMPTY], register: [{ status: 422, json: {} }] });
  await buildModel(p, ctx, { brief: BRIEF });
  const schema = p.callStructured.mock.calls[0]![0].schema;
  const pair = (path: string, prefix = '') => {
    expect(schema).toHaveProperty(`${path}.properties.${prefix}origin`, { type: 'string', enum: ['user', 'third_party', 'olumi', 'unknown'] });
    expect(schema).toHaveProperty(`${path}.properties.${prefix}stance`, { type: 'string', enum: ['stated_current', 'hypothetical', 'target', 'estimate'], description: STANCE_DESCRIPTION });
    expect(schema).toHaveProperty(`${path}.required`, expect.arrayContaining([`${prefix}origin`, `${prefix}stance`]));
  };
  pair('properties.goal', 'target_'); pair('properties.goal', 'baseline_');
  for (const key of ['factors', 'risks', 'outcomes', 'links']) pair(`properties.${key}.items`);
  pair('properties.options.items.properties.interventions.items');
  expect(schema).not.toHaveProperty('properties.goal.properties.deadline_words.description');
  expect(before).toHaveProperty('properties.goal.properties.deadline_words.description');
  expect(buildCandidateSchema()).toEqual(before);
  expect(before).not.toHaveProperty('properties.factors.items.properties.origin');
});

describe('exactly once: a retry of a committed construction is "already saved"', () => {
  it('the model exists because THIS construction committed (lost response, restart): already saved, no new draft', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS, save_outcome: 'VERIFIED_SAVED' } });
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('the route replayed this construction: already saved, no second "saved"', async () => {
    const p = product({ graph: [EMPTY, MODEL], register: [{ ...SAVED, json: { ...SAVED.json, replayed: true } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
  });

  it.each(['GRAPH_STALE', 'OPERATION_ID_REUSED'])('the register refuses %s and THIS construction is on record: already saved', async (code) => {
    const p = product({ graph: [EMPTY], register: [{ status: 409, json: { details: { code } } }], versions: [VERSIONS(true)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'ok', mutated: false, ran: false, data: { already_saved: true, model_version: OURS, save_outcome: 'VERIFIED_SAVED' } });
  });

  it('a model that is not this construction\'s is never redrafted', async () => {
    const p = product({ graph: [MODEL], versions: [VERSIONS(false)] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'refused', reason: 'model_exists', ...NO_WRITE });
    expect(p.callStructured).not.toHaveBeenCalled();
  });
});

describe('refusals and unknowns, said as such', () => {
  it('a brief that is not literally the user\'s words: nothing is read, drafted or written', async () => {
    const p = product({});
    expect(await buildModel(p, ctx, { brief: 'We run a large museum.' })).toEqual({ status: 'refused', reason: 'brief_not_users_words', ...NO_WRITE });
    expect(p.dispatch).not.toHaveBeenCalled();
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('CONTRAST: a read with no graph flag and no graph is still malformed: nothing is drafted', async () => {
    const p = product({ graph: [{ status: 200, json: { graph: null, graph_hash: null } }] });
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual({ status: 'unavailable', reason: 'read_malformed', write: 'none', ...NO_WRITE });
    expect(p.callStructured).not.toHaveBeenCalled();
  });

  it('no drafter: unavailable', async () => {
    expect(await buildModel({ ...product({ graph: [EMPTY] }), callStructured: undefined }, ctx, { brief: BRIEF }))
      .toEqual({ status: 'unavailable', reason: 'drafter_unavailable', write: 'none', ...NO_WRITE });
  });

  it.each([
    ['no answer from the drafter', '', { status: 'unavailable', reason: 'no_structured_output', write: 'none', ...NO_WRITE }],
    ['an answer cut off before it closed', JSON.stringify(DRAFT).slice(0, 200), { status: 'unavailable', reason: 'no_structured_output', write: 'none', ...NO_WRITE }],
    ['a drafter that throws', new Error('socket'), { status: 'unavailable', reason: 'construction_failed', write: 'none', ...NO_WRITE }],
    ['a draft with no goal (unreadable, never refused for what it means)', JSON.stringify({ ...DRAFT, goal: { metric: ' ' } }), { status: 'refused', reason: 'candidate_invalid', ...NO_WRITE }],
  ] as const)('%s: nothing is written', async (_name, text, outcome) => {
    const p = product({ graph: [EMPTY] }, text);
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual(outcome);
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
    expect(await buildModel(p, ctx, { brief: BRIEF })).toEqual(outcome);
    expect(p.onModelRegistered).not.toHaveBeenCalled();
  });

  it('the parameters take the brief only; an empty brief is not the user\'s words', async () => {
    expect(BuildModelParams.safeParse({ brief: BRIEF, explicit_rebuild_request: 'yes' }).success).toBe(false);
    expect(await buildModel(product({}), ctx, { brief: '' })).toEqual({ status: 'refused', reason: 'brief_not_users_words', ...NO_WRITE });
  });
});
