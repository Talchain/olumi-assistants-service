import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';

const scenario = randomUUID();
const message = 'Rename “Launch now” to “Launch in stages”. Remove the supplier delay risk.';
const ctx: AgentToolContext = { scenario_id: scenario, authenticated_user_id: null, request_id: 'targeted-correction',
  turn_id: randomUUID(), user_turn_text: message, user_text: message, user_text_complete: true, verified_user_messages: [message] };
const graph = () => ({
  schema_version: '3.0', goal_node_id: 'goal',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Meet demand', goal_threshold: 0.8 },
    { id: 'capacity', kind: 'factor', label: 'Support capacity', category: 'controllable', unit: 'tickets/week',
      observed_state: { value: 0.4, raw_value: 40, cap: 100, std: 0.1 }, source_quote: 'We can currently handle 40 tickets a week.' },
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
function world() {
  let saved = graph();
  let writes = 0;
  const proposals = new ProposalStore();
  const dispatch: InternalDispatch = vi.fn(async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(saved),
      graph_hash: computeAnalysisAffectingGraphHash(saved), graph_identity_hash: computeGraphIdentityHash(saved), brief_text: 'Improve service while preserving uncertainty and existing reasoning.' } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph/register')) {
      writes += 1;
      saved = structuredClone((body as { graph: ReturnType<typeof graph> }).graph);
      return { status: 200, json: { registered: true, graph_identity_hash: computeGraphIdentityHash(saved) } };
    }
    throw new Error(`No other writer/provider is allowed: ${path}`);
  });
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { turnAuthority: true });
  return { proposals, caps, dispatch, graph: () => saved, writes: () => writes };
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
});
