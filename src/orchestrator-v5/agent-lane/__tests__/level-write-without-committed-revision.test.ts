/**
 * ⛔ A LEVEL WRITE THAT REPORTS NO COMMITTED REVISION IS NOT "RECORDED" (review of #1851,
 * mutant C survived: nothing pinned the single-kind level path's no-hash branch).
 *
 * `option_intervention_edit` answers a committed write with its own `graph_hash`. A 200
 * WITHOUT one committed nothing (the writer's verified no-op, or a refusal answered 200),
 * so the approval must neither count it as this operation's write nor advance the CAS base
 * to anything. The contrast: the same write answering with its committed revision IS recorded.
 */
import { describe, it, expect } from 'vitest';
import { type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import { ProposalStore } from '../proposal.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

const SCENARIO = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-l', request_id: 'r' };

const edge = (from: string, to: string) => ({
  from, to,
  strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
  exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability,
  effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
  provenance: { source: 'cee_hypothesis' },
});

function product(committed: boolean) {
  const nodes = [
    { id: 'velocity', kind: 'goal', label: 'Velocity' },
    { id: 'developers_hired', kind: 'factor', label: 'Developers hired', observed_state: { value: 0, raw_value: 0, cap: 20, unit: 'hires' } },
    { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' } as { id: string; kind: string; label: string; interventions?: Record<string, unknown> },
  ];
  const edges = [edge('hire_two', 'developers_hired'), edge('developers_hired', 'velocity')];
  let rev = 0;
  const posted: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'option_intervention_edit') {
        posted.push(String(ev.base_graph_hash));
        if (!committed) return { status: 200, json: { assistant_text: 'Nothing to change.' } };
        nodes[2] = { ...nodes[2]!, interventions: { developers_hired: { value: ev.value } } };
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  return { d, posted };
}

async function approveOneLevel(committed: boolean) {
  const p = product(committed);
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store);
  const proposed = await caps.proposeOptionInterventions(ctx, {
    interventions: [{ option_label: 'Hire Two Developers', factor_label: 'Developers hired', value: 2, basis: 'two hires' }],
  });
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const r = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
  return { r, p };
}

describe('single-kind level approval: a 200 with no committed revision', () => {
  // Retired with the whole-scope level port (Canonical #70 5847348206): every level is ONE commit, so a per-level 200 without a revision is the writer\u2019s concern, not a chain the Agent walks. The contract is `whole-request-is-one-commit.test.ts`.

  it('CONTRAST: the same write answering with its committed revision IS recorded', async () => {
    const { r } = await approveOneLevel(true);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('no committed revision');
  });
});
