import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { approvalChipsFor } from '../approval-chips.js';

const scenario = randomUUID();
const message = 'Rename “Launch now” to “Launch in stages”. Remove the supplier delay risk.';
const ctx: AgentToolContext = { scenario_id: scenario, authenticated_user_id: null, request_id: 'targeted-correction',
  turn_id: randomUUID(), user_turn_text: message, user_text: message, user_text_complete: true, verified_user_messages: [message] };
const graph = () => ({
  schema_version: '3.0', goal_node_id: 'goal',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Meet demand', goal_threshold: 0.8 },
    { id: 'capacity', kind: 'factor', label: 'Support capacity', category: 'controllable',
      observed_state: { value: 0.4, raw_value: 40, cap: 100, std: 0.1, unit: 'tickets/week' }, source_quote: 'We can currently handle 40 tickets a week.' },
    { id: 'launch', kind: 'option', label: 'Launch now', interventions: { capacity: { value: 0.6, raw_value: 60 } } },
    { id: 'wait', kind: 'option', label: 'Wait', interventions: { capacity: { value: 0.4, raw_value: 40 } } },
    { id: 'delay', kind: 'risk', label: 'Supplier delay' },
  ],
  edges: [
    { from: 'capacity', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'delay', to: 'goal', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
  ],
  options: [
    { id: 'launch', label: 'Launch now', status: 'ready', interventions: { capacity: { value: 0.6, raw_value: 60 } } },
    { id: 'wait', label: 'Wait', status: 'ready', interventions: { capacity: { value: 0.4, raw_value: 40 } } },
  ], meta: { roots: ['launch', 'wait'], leaves: ['goal'] },
});
const rename = { op: 'rename', kind: 'option', id: 'launch', label: 'Launch now', new_label: 'Launch in stages', quote: 'Rename “Launch now” to “Launch in stages”.' };
const remove = { op: 'remove', kind: 'risk', id: 'delay', label: 'Supplier delay', quote: 'Remove the supplier delay risk.' };
function world(opts: { conflict?: boolean; wrongReadback?: boolean; refusalStatus?: number } = {}) {
  let saved = graph();
  let writes = 0;
  const proposals = new ProposalStore();
  const dispatch: InternalDispatch = vi.fn(async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(saved),
      graph_hash: computeAnalysisAffectingGraphHash(saved), graph_identity_hash: computeGraphIdentityHash(saved), brief_text: 'Improve service while preserving uncertainty and existing reasoning.' } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph/register')) {
      if (opts.conflict || opts.refusalStatus) return { status: opts.refusalStatus ?? 409, json: { code: opts.conflict ? 'GRAPH_STALE' : 'BAD_INPUT' } };
      expect((body as any).expected_graph_hash).toBe(computeAnalysisAffectingGraphHash(saved));
      expect((body as any).expected_graph_identity_hash).toBe(computeGraphIdentityHash(saved)?.value);
      writes += 1;
      saved = structuredClone((body as { graph: ReturnType<typeof graph> }).graph);
      const acknowledged = computeGraphIdentityHash(saved);
      if (opts.wrongReadback) saved.nodes[1]!.label = 'Another saved edit';
      return { status: 200, json: { registered: true, graph_identity_hash: acknowledged } };
    }
    throw new Error(`No other writer/provider is allowed: ${path}`);
  });
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { turnAuthority: true });
  return { proposals, caps, dispatch, graph: () => saved, writes: () => writes,
    editLabel: () => { saved.nodes[1]!.label = 'A concurrent label'; } };
}
const prepare = (w: ReturnType<typeof world>, ops: readonly unknown[]) => dispatchTool('propose_change', JSON.stringify({ ops }), ctx, w.caps, 'full');

describe('one bounded targeted correction on the saved model', () => {
  it.each([rename, remove])('existing singleton is valid: $op', async op => {
    const w = world();
    const offered = await prepare(w, [op]);
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.outstanding(scenario, null)).toHaveLength(1);
    expect(w.writes()).toBe(0); expect(w.graph()).toEqual(graph());
  });
  it('two valid operations prepare one exact-change card with zero writes, preserving the saved reasoning', async () => {
    const w = world();
    const offered = await prepare(w, [rename, remove]);
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.outstanding(scenario, null)).toHaveLength(1);
    expect(w.writes()).toBe(0); expect(w.graph()).toEqual(graph());
    expect(String(offered.public_label)).toContain('Launch in stages');
    expect(String(offered.public_label)).toContain('Supplier delay');
  });
  it('the complete current card is rendered, and only its own press writes both changes once', async () => {
    const w = world();
    const offered = await prepare(w, [rename, remove]);
    const pid = String(offered.proposal_id);
    const proposal = w.proposals.get(pid)!;
    const chips = approvalChipsFor([{ name: 'propose_change', ...offered } as never], () => ({ proposal, result: offered }));
    expect(chips[0]).toMatchObject({ id: `agent-approve-proposal:${pid}`, label: 'Make this change', detail: offered.public_label });
    const withoutPress = await w.caps.authoriseChange({ ...ctx, user_turn_text: 'Yes.' }, { proposal_id: pid });
    expect(withoutPress).toMatchObject({ ok: false, mutated: false }); expect(w.writes()).toBe(0);
    const saved = await w.caps.authoriseChange({ ...ctx, typed_approval_of: pid, user_turn_text: '' }, { proposal_id: pid });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.writes()).toBe(1);
    const expected = graph();
    expected.nodes = expected.nodes.filter(n => n.id !== 'delay');
    expected.edges = expected.edges.filter(e => e.from !== 'delay');
    expected.nodes.find(n => n.id === 'launch')!.label = 'Launch in stages';
    Object.assign(expected.nodes.find(n => n.id === 'launch')!, { label_authored: false });
    expected.options[0]!.label = 'Launch in stages';
    expect(w.graph()).toEqual(expected);
    await w.caps.authoriseChange({ ...ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(w.writes()).toBe(1);
  });
  it.each(['source', 'missing', 'unsupported', 'oversize'])('one invalid %s operation offers no partial card and writes nothing', async failure => {
    const w = world();
    const invalid = failure === 'source' ? { ...remove, quote: 'Olumi invented this request.' }
      : failure === 'missing' ? { ...remove, id: 'absent', label: 'Absent risk' }
        : { ...remove, op: 'revise_model' };
    const offered = await prepare(w, failure === 'oversize' ? Array(7).fill(rename) : [rename, invalid]);
    expect(offered).toMatchObject({ ok: false, mutated: false });
    expect(w.proposals.outstanding(scenario, null)).toHaveLength(0); expect(w.writes()).toBe(0); expect(w.graph()).toEqual(graph());
  });
  it('a label-only concurrent edit refuses the card before writing', async () => {
    const w = world(); const offered = await prepare(w, [rename, remove]); const pid = String(offered.proposal_id);
    const analysis = computeAnalysisAffectingGraphHash(w.graph()); w.editLabel();
    expect(computeAnalysisAffectingGraphHash(w.graph())).toBe(analysis);
    expect(await w.caps.authoriseChange({ ...ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(w.writes()).toBe(0);
  });
  it.each([{ conflict: true }, { wrongReadback: true }])('a refused or mismatched save never claims the approved set landed: %j', async opts => {
    const w = world(opts); const offered = await prepare(w, [rename, remove]); const pid = String(offered.proposal_id);
    expect(await w.caps.authoriseChange({ ...ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, applied: false });
    expect(w.writes()).toBe(opts.conflict ? 0 : 1);
  });
  it.each([400, 403, 422])('a definite native refusal (%s) reports zero mutation and leaves the whole saved model unchanged', async refusalStatus => {
    const w = world({ refusalStatus }); const offered = await prepare(w, [rename, remove]); const pid = String(offered.proposal_id);
    expect(await w.caps.authoriseChange({ ...ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false, applied: false });
    expect(w.writes()).toBe(0); expect(w.graph()).toEqual(graph());
  });
});
