import { describe, expect, it } from 'vitest';
import { optionNameAliases } from '../option-name-truth.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const graph = (label = 'Raise to £59', raw = 60, unit = '£ per subscriber per month') => ({
  nodes: [
    { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { cap: 200, unit } },
    { id: 'raise', kind: 'option', label, interventions: {
      price: { value: raw / 200, raw_value: raw, unit },
    } },
  ], edges: [],
});

describe('Agent result option names are bound to the current stored level', () => {
  it('supplies a display-only alias when the one label figure differs from the one current level', () => {
    expect(optionNameAliases(graph()).get('raise')).toEqual({
      raw: 'Raise to £59', display: 'Raise to £59 (set to £60/month)',
    });
    expect(optionNameAliases(graph('Raise to £59', 59)).size).toBe(0);
  });

  it('qualifies the witnessed two-price label by its target, keeping the baseline in the name', () => {
    expect(optionNameAliases(graph('Raise Pro plan price from £49 to £59')).get('raise')).toEqual({
      raw: 'Raise Pro plan price from £49 to £59',
      display: 'Raise Pro plan price from £49 to £59 (set to £60/month)',
    });
    expect(optionNameAliases(graph('Raise Pro plan price from £49 to £60')).size).toBe(0);
    expect(optionNameAliases(graph('Raise Pro plan price from £49 to £59/month', 60, '£/month')).get('raise')?.display)
      .toBe('Raise Pro plan price from £49 to £59/month (set to £60/month)');
  });

  it('underclaims ambiguous labels, units and inconsistent stored figures', () => {
    expect(optionNameAliases(graph('Raise £59 or £69')).size).toBe(0);
    expect(optionNameAliases(graph('Raise £59 in 2027')).size).toBe(0);
    expect(optionNameAliases(graph('Compare £49 and £59')).size).toBe(0);
    expect(optionNameAliases(graph('Raise to £59', 60, 'users/month')).size).toBe(0);
    const inconsistent = graph();
    inconsistent.nodes[1]!.interventions!.price!.raw_value = 61;
    expect(optionNameAliases(inconsistent).size).toBe(0);
    const duplicate = graph();
    duplicate.nodes.push({ ...duplicate.nodes[1]!, id: 'raise-again' });
    expect(optionNameAliases(duplicate).size).toBe(0);
    expect(optionNameAliases(graph('Raise to £59', 60.333)).size).toBe(0);
  });

  it('gives the Agent the current display name while preserving exact tool-address labels and saved Run facts', async () => {
    const g = graph();
    const result = { computed_against_hash: 'h1', enrichment: { option_comparison: [
      { option_id: 'raise', option_label: 'Raise to £59', outcome: { mean: 100 } },
    ] } };
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph: g, graph_hash: 'h1',
      analysis_result: result, analysis_state: { run_state: { kind: 'complete_current' } } } });
    const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
      scenario_id: '7d18dd9a-5929-4b6e-8ca4-462a11489257', authenticated_user_id: null, request_id: 'name-truth',
    }) as Record<string, any>;
    expect(state.entities.find((e: { id: string }) => e.id === 'raise')).toMatchObject({
      label: 'Raise to £59', display_label: 'Raise to £59 (set to £60/month)',
    });
    expect(state.analysis.saved_run_options[0]).toMatchObject({
      option_label: 'Raise to £59', display_label: 'Raise to £59 (set to £60/month)', outcome: { mean: 100 },
    });
    expect(result.enrichment.option_comparison[0]!.option_label).toBe('Raise to £59');
  });

  it('does not attach the new £60 name to an earlier £59 Run after the edit makes it stale', async () => {
    const previousRun = { computed_against_hash: 'before-edit', enrichment: { option_comparison: [
      { option_id: 'raise', option_label: 'Raise to £59', outcome: { mean: 99 } },
    ] } };
    const dispatch: InternalDispatch = async () => ({ status: 200, json: {
      graph: graph(), graph_hash: 'after-edit', analysis_result: previousRun,
      analysis_state: { run_state: { kind: 'complete_stale', cause: 'graph_changed', graph_hash_at_run: 'before-edit' }, requires_rerun: true },
    } });
    const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
      scenario_id: '7d18dd9a-5929-4b6e-8ca4-462a11489257', authenticated_user_id: null, request_id: 'name-truth-stale',
    }) as Record<string, any>;
    const option = state.entities.find((e: { id: string }) => e.id === 'raise');
    expect(option.label).toBe('Raise to £59');
    expect(option.levels).toBeDefined();
    expect(option).not.toHaveProperty('display_label');
    expect(state.analysis.earlier_analysis).toBe('complete_stale');
    expect(state.analysis).not.toHaveProperty('saved_run_options');
    expect(previousRun.enrichment.option_comparison[0]!.option_label).toBe('Raise to £59');
  });
});
