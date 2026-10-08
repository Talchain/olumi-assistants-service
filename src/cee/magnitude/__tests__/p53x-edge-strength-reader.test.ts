import { describe, expect, it } from 'vitest';
import { linkSizing } from '../link-sizing.js';
import { userFigureMovedRefusal } from '../user-figure-held.js';
import { createAgentCapabilities } from '../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../orchestrator-v5/agent-lane/proposal.js';

const heldProspectRevenue = {
  from: 'prospect',
  to: 'revenue',
  strength: { mean: 0.62, std: 0.1 },
  effect_direction: 'positive',
  provenance: {
    source: 'brief_extraction',
    magnitude: 'user_stated',
    source_quote: 'Each new prospect adds £49 a month.',
    natural_effect: {
      amount: 49,
      amount_unit: 'GBP/month',
      per_source_change: 1,
      per_source_change_unit: 'prospect',
      strength_mean: 0.62,
    },
  },
};

describe('P53x generic merge refusal reads the proposed edge sizing', () => {
  // Science 393023 LICENCE ruling 3 (P53x), re-derived: prospect→revenue at the hypothesis door's
  // defaulted 0.5/0.125 is placeholder, so "replace my figure with strong" → the proposed link is not sized yet.
  it('never turns a defaulted prospect→revenue prior into a band', () => {
    const proposed = {
      from: 'prospect',
      to: 'revenue',
      strength: { mean: 0.5, std: 0.125 },
      effect_direction: 'positive',
      defaulted: true,
      provenance: { source: 'cee_hypothesis' },
    };
    expect(linkSizing(proposed)).toBe('placeholder');
    const words = userFigureMovedRefusal(heldProspectRevenue, proposed);
    expect(words).toBe('This link holds your figure: ‘Each new prospect adds £49 a month.’. The proposed link is not sized yet. Change the figure or supply a size for its replacement.');
    expect(words).not.toContain('strong');
  });

  it('CONTROL: the same prospect→revenue mean explicitly sized by Olumi retains strong', () => {
    const proposed = {
      from: 'prospect',
      to: 'revenue',
      strength: { mean: 0.5, std: 0.1 },
      effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' },
    };
    expect(linkSizing(proposed)).toBe('olumi_estimate');
    expect(userFigureMovedRefusal(heldProspectRevenue, proposed))
      .toBe('This link holds your figure: ‘Each new prospect adds £49 a month.’. Change the figure, or say ‘replace my figure with strong’.');
  });
});

describe('P53x singular review never names a placeholder prior as a settled band', () => {
  const context = {
    scenario_id: '550e8400-e29b-41d4-a716-446655440077',
    authenticated_user_id: null,
    request_id: 'p53x-singular-reader',
    user_text: 'Prospects have a strong effect on Revenue.',
    user_turn_text: 'Prospects have a strong effect on Revenue.',
  };
  const capabilitiesFor = (provenance: Record<string, unknown>) => createAgentCapabilities(async () => ({
    status: 200,
    json: {
      graph_hash: 'p53x-singular-reader',
      graph: {
        nodes: [{ id: 'prospect', kind: 'factor', label: 'Prospects' }, { id: 'revenue', kind: 'goal', label: 'Revenue' }],
        edges: [{ from: 'prospect', to: 'revenue', strength: { mean: 0.5, std: 0.125 },
          effect_direction: 'positive', provenance }],
      },
    },
  }), new ProposalStore());
  const args = { from_label: 'Prospects', to_label: 'Revenue', strength: 'strong' as const, rationale: 'The user named this band.' };

  // Science 393023 LICENCE ruling 3 (P53x), re-derived: projected prospect→revenue is a placeholder;
  // the singular review's "already sits in that band" claim → numbers kept, nobody has sized it.

  it('CONTROL: a user-sized prospect→revenue link keeps its existing settled-band note', async () => {
    const result = await capabilitiesFor({ source: 'user_specified' }).proposeLinkStrength!(context, args);
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('link.was.band', 'strong');
    expect(result.note).toContain('The link already sits in that band, so its strength is kept');
  });
});
