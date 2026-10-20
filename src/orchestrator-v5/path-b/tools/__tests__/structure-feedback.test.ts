/**
 * THIN CORE STRUCTURE FEEDBACK AT THE TOOL SEAM: within one turn, a writing tool's first call with an encoding the calculation
 * cannot read comes back to the AI with its fixes and writes nothing; its next call is taken as it is; a clean model saves on
 * its first call. A stateful product double (CAS on the identity, versions by operation); the kernel, the mapper, the write
 * and the SDK tools are real. SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { RunContext, type FunctionTool, type Tool } from '@openai/agents';
import { pathBTools, type OnToolCall } from '../index.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { OPTION_EFFECTS, RESTATED } from '../../living-model/__tests__/fixtures.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_1';
const BRIEF = 'at least 60 widgets per hour; today 40. option A or option B. A adds exactly 30, B adds exactly 19.9';
const ctx = { scenario_id: SID, authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [BRIEF], user_turn_text: BRIEF };

/** The product's graph, register and versions routes over one scenario (empty, or holding a model), with CAS on the identity. */
function turn(initial: LivingModelT | null) {
  let graph: Rec | null = initial === null ? null : { ...mapLivingModel(initial).graph, living_model: initial };
  const registered: Rec[] = [];
  const identity = () => (graph === null ? null : computeGraphIdentityHash(graph as never)!);
  const dispatch = vi.fn(async (path: string, body?: unknown) => {
    const b = (body ?? {}) as Rec;
    if (path.endsWith('/graph/register')) {
      if (b.expected_graph_identity_hash !== (identity()?.value ?? null)) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph as Rec;
      registered.push(b);
      return { status: 200, json: { graph_identity_hash: identity(), graph_hash: computeAnalysisAffectingGraphHash(graph as never),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: 'committed_mutation', graph_identity_hash: identity()!.value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(graph as never) } } };
    }
    if (path.endsWith('/versions')) {
      return { status: 200, json: { versions: registered.map((r, i) => ({ version_id: `v_${i + 1}`, sequence: i + 1,
        creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId(SID, String(r.operation_id)) } })) } };
    }
    if (graph === null) return { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } };
    return { status: 200, json: { graph, brief_text: BRIEF, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: identity() } };
  });
  const calls: Parameters<OnToolCall>[] = [];
  const tools = pathBTools({ dispatch, proposals: new ProposalStore(), runAnalysis: vi.fn() }, ctx, 'core', (row, result) => { calls.push([row, result]); }, 'core');
  const call = async (name: string, args: Rec) => JSON.parse(String(await (tools.find((t: Tool) => t.name === name) as FunctionTool)
    .invoke(new RunContext(), JSON.stringify(args)))) as Rec & { data?: Rec };
  return { registered, calls, call };
}
const ids = (out: { data?: Rec }) => (out.data?.feedback as { id: string; reason: string }[] | undefined)?.map((f) => [f.id, f.reason]);
const P04_FEEDBACK = [['a_level', 'link_endpoint_unknown'], ['b_level', 'link_endpoint_unknown']];

describe('structure feedback inside the SDK turn: once per writing tool, before anything is saved or prepared', () => {
  it('⭐ build_model_from_brief: the P04 shape comes back with its fixes and writes nothing; the next call is taken as it is', async () => {
    const t = turn(null);
    const first = await t.call('build_model_from_brief', { brief: BRIEF, model: RESTATED });
    expect(first).toMatchObject({ status: 'refused', reason: 'restructure', data: { save_outcome: 'VERIFIED_NO_WRITE' } });
    expect(ids(first)).toEqual(P04_FEEDBACK);
    expect(t.registered).toHaveLength(0);
    expect(t.calls[0]?.[0]).toMatchObject({ name: 'build_model_from_brief', ok: false, mutated: false, refusal: 'restructure' });

    const second = await t.call('build_model_from_brief', { brief: BRIEF, model: RESTATED });
    expect(second).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
    expect(t.registered).toHaveLength(1);
    expect((t.registered[0]!.graph as Rec).living_model).toMatchObject({ links: RESTATED.links.map((l) => ({ id: l.id, from: l.from, to: l.to })) });
  });

  it('control: build_model_from_brief saves a clean model on its first call', async () => {
    const t = turn(null);
    expect(await t.call('build_model_from_brief', { brief: BRIEF, model: OPTION_EFFECTS })).toMatchObject({ status: 'ok', mutated: true });
    expect(t.registered).toHaveLength(1);
  });

  it('⭐ propose_change: the P04 shape comes back with its fixes and prepares no card; the next call prepares it', async () => {
    const t = turn(OPTION_EFFECTS);
    const args = { public_label: 'Link the options through the hourly level', basis: 'Synthetic.', model: RESTATED, remove: ['a_w', 'b_w'] };
    const first = await t.call('propose_change', args);
    expect(first).toMatchObject({ status: 'refused', reason: 'restructure' });
    expect(ids(first)).toEqual(P04_FEEDBACK);
    expect(t.calls[0]?.[1]).not.toHaveProperty('proposal_id');

    const second = await t.call('propose_change', args);
    expect(second).toMatchObject({ status: 'ok', mutated: false, data: { proposal_id: expect.stringMatching(/^prop_/) } });
    expect(t.registered).toHaveLength(0);
  });

  it('control: propose_change prepares a clean change on its first call', async () => {
    const t = turn(OPTION_EFFECTS);
    const model = structuredClone(OPTION_EFFECTS);
    model.links[1]!.effect.value = 20;
    const out = await t.call('propose_change', { public_label: 'B adds 20', basis: 'Synthetic.', model, remove: [] });
    expect(out).toMatchObject({ status: 'ok', data: { proposal_id: expect.stringMatching(/^prop_/) } });
  });
});
