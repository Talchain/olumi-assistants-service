import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const scenarioId = '550e8400-e29b-41d4-a716-446655440079';
const graph = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'keep', kind: 'option', label: 'Keep £49', provenance: 'ai_inferred' },
    { id: 'raise', kind: 'option', label: 'Raise to £59', provenance: 'ai_inferred' },
    { id: 'olumi', kind: 'option', label: '£54 Pro release', provenance: 'ai_inferred', proposed_by: 'olumi' },
  ],
  edges: [],
};

describe('the Agent can distinguish an unadopted Olumi option from the user’s options', () => {
  it('carries the saved Olumi marker through the canonical read, without inferring authorship from shared provenance', async () => {
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
    const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
      scenario_id: scenarioId, authenticated_user_id: null, request_id: 'olumi-option-attribution',
    }) as Record<string, any>;

    expect(state.ok).toBe(true);
    const byId = Object.fromEntries((state.entities as Record<string, unknown>[]).map((entity) => [entity.id, entity]));
    expect(byId.olumi).toMatchObject({ kind: 'option', label: '£54 Pro release', provenance: 'ai_inferred', proposed_by: 'olumi' });
    expect(byId.keep.provenance).toBe('ai_inferred');
    expect(byId.raise.provenance).toBe('ai_inferred');
    expect(byId.keep).not.toHaveProperty('proposed_by');
    expect(byId.raise).not.toHaveProperty('proposed_by');
    expect(byId.goal).not.toHaveProperty('proposed_by');
  });
});
