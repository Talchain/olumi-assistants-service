import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { buildModelFromRecords, buildStrictDraftRecordsSchema } from '../runtime/build-model-from-records.js';
import { BUILD_INSTRUCTIONS, constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { draftRecordsInstructionHash } from '../../../cee/draft/records/instruction.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { BRIEF, sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { ProposalStore } from '../proposal.js';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';
import { strictRecordsWire } from './records-wire-fixture.js';

const SID = '11111111-1111-4111-8111-111111111111';
const ctx = { scenario_id: SID, authenticated_user_id: 'user-a', request_id: 'records-wiring' };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function store() {
  let graph: Record<string, unknown> = { nodes: [], edges: [] };
  const writes: Record<string, unknown>[] = [];
  const versions: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions, next_cursor: null } };
    if (path.endsWith('/graph/register')) {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Registration body must be an object.');
      const registration = body as Record<string, unknown>;
      writes.push(registration);
      graph = registration.graph as Record<string, unknown>;
      versions.push({ version_id: 'records-version', sequence: 1, creation: {
        kind: 'initial', mutation_id: null, source_turn_id: registrationTurnId(SID, String(registration.operation_id)),
      } });
      return { status: 200, json: { model_version: { version_id: 'records-version', version_number: 1 } } };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'held-hash' } };
    throw new Error(`Unexpected offline dispatch: ${path}`);
  };
  return { dispatch, writes, versions, hold: (held: Record<string, unknown>) => { graph = held; } };
}
const recordsCall = () => vi.fn<CallStructuredModel>(async () => ({ text: JSON.stringify(strictRecordsWire(sealedRecords())), status: 'completed' }));
const build = (dispatch: InternalDispatch, call: CallStructuredModel) =>
  createAgentCapabilities(dispatch, new ProposalStore(), call).buildModelFromBrief(ctx, { brief: BRIEF });

// Deliberate contrast input: the legacy constructor accepts this, but the records seam MUST refuse it.
const legacyOutput = {
  goal: { metric: 'Revenue', operator: '>=', value: 100, unit: 'GBP', horizon_months: null, provenance: 'inferred' },
  constraints: [], options: [{ label: 'Keep going', provenance: 'explicit', interventions: [] }],
  factors: [], risks: [], outcomes: [], links: [], unknowns: [],
};

describe('served records construction identity', () => {
  it('(i) calls exactly once with the records schema and instruction identities, never the construct prompt', async () => {
    const held = store(); const call = recordsCall();
    const result = await build(held.dispatch, call).catch(() => undefined);
    expect(call).toHaveBeenCalledTimes(1);
    const request = call.mock.calls[0]![0];
    expect(sha(JSON.stringify(request.schema))).toBe(sha(JSON.stringify(buildStrictDraftRecordsSchema())));
    expect(sha(request.instructions)).toBe(draftRecordsInstructionHash());
    expect(call.mock.calls.filter(([req]) => sha(req.instructions) === sha(BUILD_INSTRUCTIONS))).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, mutated: true });
    const validate = new Ajv({ strict: false }).compile(request.schema);
    expect(validate(strictRecordsWire(sealedRecords())), JSON.stringify(validate.errors)).toBe(true);
  });

  it('(ii) sends byte-identical registration to the records builder, with the same create-only identity', async () => {
    const direct = store(); const served = store();
    await buildModelFromRecords(SID, BRIEF, direct.dispatch, recordsCall());
    await build(served.dispatch, recordsCall());
    expect(direct.writes).toHaveLength(1); expect(served.writes).toHaveLength(1);
    expect(JSON.stringify(served.writes[0])).toBe(JSON.stringify(direct.writes[0]));
    expect(served.writes[0]).toMatchObject({ operation_id: constructionOperationId(SID, BRIEF), expected_graph_identity_hash: null });
  });

  it('(iii) refuses legacy output through the records seam, writes nothing, and returns the typed not-built reply', async () => {
    const held = store();
    const result = await build(held.dispatch, async () => ({ text: JSON.stringify(legacyOutput) }));
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_failed' });
    expect(held.writes).toHaveLength(0);
    const reply = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    expect(withWriteOutcome(reply.text, reply.status)).toBe('The model was not built: the model builder could not produce a usable model this time — ask me to try again.');
  });

  it('(iv) recovers the same version before generation and refuses an unrelated populated model', async () => {
    const held = store(); const call = recordsCall();
    const first = await build(held.dispatch, call);
    const replay = await build(held.dispatch, call);
    expect(first.ok).toBe(true);
    expect(replay).toMatchObject({ ok: true, mutated: false, replayed: true, model_version: first.model_version });
    expect(call).toHaveBeenCalledTimes(1); expect(held.writes).toHaveLength(1);
    const other = store(); other.hold({ nodes: [{ id: 'human-node', kind: 'goal', label: 'Human work' }], edges: [] });
    const never = recordsCall(); const refusal = await build(other.dispatch, never);
    expect(refusal).toMatchObject({ ok: false, mutated: false, refusal: 'model_already_exists' });
    expect(never).not.toHaveBeenCalled(); expect(other.writes).toHaveLength(0);
  });
});

describe('records ToolResult adapter', () => {
  it('carries compiler questions and typed dropped identities unchanged, and reports no retry', async () => {
    const records = sealedRecords();
    records.claims.push({ claim_kind: 'causal_link', label: 'Unresolved endpoint', from_claim: 999, to_stated: 6, effect: 'positive' });
    const compiled = await replayRecordSet(records, { brief: BRIEF });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.detail);
    expect(compiled.projection.dropped.length).toBeGreaterThan(0);
    expect(compiled.ask.items.length).toBeGreaterThan(0);
    const trace = vi.fn(); const held = store();
    const result = await buildModelFromRecords(SID, BRIEF, held.dispatch,
      async () => ({ text: JSON.stringify(strictRecordsWire(records)) }), trace);
    expect(result.ok).toBe(true);
    expect(result.open_questions).toEqual(compiled.ask.items.map(item => item.detail));
    expect(result.not_represented).toEqual(compiled.projection.dropped);
    expect(trace.mock.calls).toEqual([[{ retried: false }]]);
  });

  it('preserves the mid-construction create-only refusal wording and ignores a throwing trace observer', async () => {
    const held = store(); held.hold({ nodes: [{ id: 'human-node' }], edges: [] });
    const result = await buildModelFromRecords(SID, BRIEF, held.dispatch, recordsCall(), () => { throw new Error('observer'); });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'model_already_exists',
      detail: 'While that model was being built, something was added to this one — so nothing was written, and your own change is untouched. Ask me to propose a change to the model you now have.' });
    expect(held.writes).toHaveLength(0);
  });
});
