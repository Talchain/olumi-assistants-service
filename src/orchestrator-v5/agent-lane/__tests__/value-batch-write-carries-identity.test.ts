/**
 * ⛔ THE ONE-APPROVAL VALUE WRITE CARRIES THE IDENTITY IT READ (Canonical 5844410312, CODE-READ at staging fbb12b8e).
 *
 * The Agent's register writes are a second whole-graph writer. The frame writes send BOTH CAS expectations
 * (`expected_graph_hash` and `expected_graph_identity_hash`, #1810); the value-batch write of a starting point sent
 * only the analysis-space hash. A RENAME is outside the analysis projection, so one landing between the approval's
 * read and the route's own read was overwritten with the stale label — the #1743 counterexample, on the one writer
 * #1810 did not reach.
 *
 * The fake register route behaves as the real one does since #1810: it compares the identity expectation ONLY when
 * the body sends one.
 */
import { describe, it, expect } from 'vitest';
import { type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };
type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };
const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
];
const wired = (ns: Node[]) => ns.filter((o) => o.kind === 'option').flatMap((o) => ns.filter((f) => f.kind === 'factor' && f.id !== 'coordination_load')
  .map((f) => ({ from: o.id, to: f.id, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' })));
const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
const LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
];

/** A product whose read route returns both hashes; a rename moves ONLY the identity hash. */
function product(opts: { renameAfterReads?: number; noIdentity?: boolean } = {}) {
  let nodes: Node[] = BASE.map((n) => ({ ...n }));
  let rev = 0;
  let idRev = 0;
  let reads = 0;
  const registered: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      registered.push(b);
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      if (typeof b.expected_graph_identity_hash === 'string' && b.expected_graph_identity_hash !== `id-${idRev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1; idRev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'option_intervention_edit') {
        nodes = nodes.map((n) => (n.id === ev.option_id ? { ...n, interventions: { ...(n.interventions ?? {}), [String(ev.factor_id)]: { value: ev.value } } } : n));
        rev += 1; idRev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    reads += 1;
    const out = { status: 200, json: {
      graph: { nodes, edges: wired(nodes) }, graph_hash: `h${rev}`,
      ...(opts.noIdentity === true ? {} : { graph_identity_hash: { kind: 'graph_identity_hash', value: `id-${idRev}`, algorithm: 'sha256' } }),
    } };
    if (opts.renameAfterReads !== undefined && reads === opts.renameAfterReads) {
      // A collaborator renames an option: the analysis hash does not move, the identity hash does.
      nodes = nodes.map((n) => (n.id === 'hire_lead' ? { ...n, label: 'Hire a Staff Engineer' } : n));
      idRev += 1;
    }
    return out;
  };
  return { d, registered, label: (id: string) => nodes.find((n) => n.id === id)?.label };
}

async function approve(opts: Parameters<typeof product>[0]) {
  const store = new ProposalStore();
  const clean = product();
  const r = await createAgentCapabilities(clean.d, store).proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const p = product(opts);
  const out = await createAgentCapabilities(p.d, store).authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
  return { p, out };
}

/**
 * ⭐ SINCE THE ONE-COMMIT CONSUMER (Canonical #70 5849037691; the door, CEE #2031) THE AGENT SENDS NO GRAPH AT ALL for
 * a starting point: its values ride the port as typed cells, and the writer patches the CURRENT model. The class this
 * file guarded — a whole-graph write replaying the approval's stale read over a collaborator's rename — is closed by
 * construction, and these rows pin that: the rename survives, and no whole-graph write is the Agent's own (every one it
 * makes carries its `operation_id`; the register calls here are the port fake's).
 */
describe('a starting point never replays the model it read: the rename survives, and the Agent sends no graph', () => {
  it('RED: a rename between the approval\'s read and the write → the collaborator\'s label survives, and the approval lands', async () => {
    const { p, out } = await approve({ renameAfterReads: 1 });
    expect(p.label('hire_lead'), 'the collaborator\'s rename survives').toBe('Hire a Staff Engineer');
    expect(p.registered.every((b) => !('operation_id' in b)), 'no whole-graph write of the Agent\'s own').toBe(true);
    expect(p.registered.every((b) => ((b.graph as { nodes: Node[] }).nodes.find((n) => n.id === 'hire_lead')?.label) === 'Hire a Staff Engineer'),
      'no write carries the approval\'s stale label').toBe(true);
    expect(out.ok, JSON.stringify(out)).toBe(true);
  });

  it('CONTROL: no rename → the same approval lands, and still no whole-graph write is the Agent\'s own', async () => {
    const { p, out } = await approve({});
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.registered.every((b) => !('operation_id' in b))).toBe(true);
  });
});
