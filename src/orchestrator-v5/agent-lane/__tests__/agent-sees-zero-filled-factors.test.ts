/**
 * ⛔ SERVED CEE `263dbd5`, final witness `053159Z/12-F7-reload` (Paul's path): the Agent read `get_canonical_state` and
 * said two add-on factors were "unknown—not zero", while the analysis on screen had used 0.0 for both and its previous
 * turn had said so ("defaulted to 0"). `get_canonical_state` never carried the run's own `ROOT_NODE_DEFAULT_VALUE`
 * warnings, and the prompt says "An absent value is unknown, never zero". The warnings below are the served ones, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { AGENT_INSTRUCTIONS } from '../../../routes/agent-v1-turn.js';

const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400b1', authenticated_user_id: null, request_id: 'r' };
const GRAPH = { nodes: [
  { id: 'mrr', kind: 'goal', label: 'MRR' },
  { id: 'fac_ai_add_on_uptake', kind: 'factor', label: 'AI add-on uptake' },
  { id: 'fac_ai_add_on_price', kind: 'factor', label: 'AI add-on price' },
], edges: [{ from: 'fac_ai_add_on_uptake', to: 'mrr' }, { from: 'fac_ai_add_on_price', to: 'mrr' }] };
const STATE = { run_state: { kind: 'complete_current', computed_at: '2026-09-27T05:34:56.870Z' }, leader_claim: { permitted: false } };
const SERVED_WARNINGS = [
  { code: 'EDGE_E_VALUE_NON_FINITE_DROPPED', message: '12 edge E-value entries were omitted from edge_e_values …', severity: 'info' },
  { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[fac_ai_add_on_uptake].observed_state.value', severity: 'info', node_label: 'AI add-on uptake',
    message: 'No starting value was provided for "AI add-on uptake", so the analysis used a default of 0.0. Results for downstream nodes may be unreliable until a real value or range is set.' },
  { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[fac_ai_add_on_price].observed_state.value', severity: 'info', node_label: 'AI add-on price',
    message: 'No starting value was provided for "AI add-on price", so the analysis used a default of 0.0. Results for downstream nodes may be unreliable until a real value or range is set.' },
  { code: 'GOAL_DIRECTION_UNATTESTED', field: 'goal_direction', severity: 'info', message: 'No objective sense was stated for the goal node …' },
];
const result = (warnings: unknown[]) => ({ type: 'analysis_result', computed_against_hash: 'h0', enrichment: { inference_warnings: warnings } });
const capsOver = (analysisResult?: unknown) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h0', analysis_state: STATE, ...(analysisResult !== undefined ? { analysis_result: analysisResult } : {}) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
};
type Read = { analysis?: { earlier_analysis?: string; run_used_default_zero_for?: string[] } };

describe('the Agent sees which factors the run on screen filled with 0', () => {
  it('RED (served 053159Z/12): the current result\'s zero-filled factors reach get_canonical_state, by the producer\'s own labels', async () => {
    const r = await capsOver(result(SERVED_WARNINGS)).getCanonicalState(ctx) as Read;
    expect(r.analysis?.earlier_analysis).toBe('complete_current');
    expect(r.analysis?.run_used_default_zero_for).toEqual(['AI add-on uptake', 'AI add-on price']);
  });

  it('CONTRAST: a current result whose warnings fill nothing with 0 → no such field (other codes are not read as zero-fills)', async () => {
    // Plus a node-labelled warning of ANOTHER code: a label alone never makes a zero-fill (authored; the served list has none).
    const otherLabelled = { code: 'NODE_RANGE_INFERRED', field: 'nodes[fac_ai_add_on_price].observed_state.cap', severity: 'info', node_label: 'AI add-on price', message: 'A range was inferred.' };
    const r = await capsOver(result([...SERVED_WARNINGS.filter((w) => w.code !== 'ROOT_NODE_DEFAULT_VALUE'), otherLabelled])).getCanonicalState(ctx) as Read;
    expect(r.analysis?.earlier_analysis, 'PRECONDITION: the earlier analysis is still projected').toBe('complete_current');
    expect(r.analysis).not.toHaveProperty('run_used_default_zero_for');
  });

  it('CONTRAST: no result on the read (it is not current for this graph) → nothing is claimed about what a run did', async () => {
    const r = await capsOver().getCanonicalState(ctx) as Read;
    expect(r.analysis?.earlier_analysis).toBe('complete_current');
    expect(r.analysis).not.toHaveProperty('run_used_default_zero_for');
  });

  it('RED: the prompt tells the model what the field means, beside "never zero" (the stored value stays unknown)', () => {
    expect(AGENT_INSTRUCTIONS).toContain('An absent value is unknown, never zero.');
    expect(AGENT_INSTRUCTIONS).toMatch(/`analysis\.run_used_default_zero_for` names a factor, the analysis on screen used 0 for it/);
  });
});
