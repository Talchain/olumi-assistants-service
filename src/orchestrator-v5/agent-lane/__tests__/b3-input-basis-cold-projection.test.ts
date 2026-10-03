import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
import { projectAnalysisAdmission } from '../../../routes/analysis-admission-projection.js';

// Existing captured pricing graph and the authority suite's target-free materiality control.
// No fake dependency topology or admission flag: the actual authority must admit it.
function capturedPricing() {
  const parsed = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/cbd15f83-bdd43f4-paul.draft-graph.json', import.meta.url), 'utf8'));
  const graph = structuredClone(parsed.graph);
  const goals = new Set(graph.nodes.filter((n: { kind: string }) => n.kind === 'goal').map((n: { id: string }) => n.id));
  for (const n of graph.nodes) if (n.kind === 'goal') delete n.goal_threshold_raw;
  if (Array.isArray(graph.goal_constraints)) graph.goal_constraints = graph.goal_constraints.filter((r: { node_id: string }) => !goals.has(r.node_id));
  return graph;
}
function census(projected: unknown) {
  return (projected as { semantic_signals?: { material_parameters_awaiting_user_node_ids?: unknown } })
    ?.semantic_signals?.material_parameters_awaiting_user_node_ids;
}

describe('B3-8 actual census → cold-read machine projection', () => {
  it('RED: a truly admitted captured graph retains its nonempty authoritative census', () => {
    const graph = capturedPricing(); const authority = resolveAnalysisAdmission(graph);
    expect(authority.structurally_analysable).toBe(true);
    expect(authority.permitted_analysis_mode).toBe('comparative_leader');
    expect(authority.semantic_signals.material_parameters_awaiting_user_node_ids).toContain('pro_subscribers');
    const projection = projectAnalysisAdmission(graph, true);
    expect(census(projection)).toEqual(authority.semantic_signals.material_parameters_awaiting_user_node_ids);
  });
  it('RED: a known-empty actual census remains an array, never an absent answer', () => {
    const graph = capturedPricing();
    for (const n of graph.nodes) if (n.kind === 'factor' && n.observed_state) n.observed_state.source = 'user_edited';
    const authority = resolveAnalysisAdmission(graph);
    expect(authority.structurally_analysable).toBe(true);
    expect(authority.semantic_signals.material_parameters_awaiting_user_node_ids).toEqual([]);
    expect(census(projectAnalysisAdmission(graph, true))).toEqual([]);
  });
  it('CONTROL: projection keeps the authority hash/licence and an absent graph stays absent', () => {
    const graph = capturedPricing(); const authority = resolveAnalysisAdmission(graph);
    const projection = projectAnalysisAdmission(graph, true)!;
    expect(projection.graph_hash).toBe(authority.graph_hash);
    expect(projection.admitted).toBe(authority.structurally_analysable);
    expect(projection.permitted_analysis_mode).toBe(authority.permitted_analysis_mode);
    expect(projectAnalysisAdmission(graph, false)).toBeNull();
    const text = JSON.stringify(projection);
    for (const r of authority.reasons) expect(text).not.toContain(r.message);
  });
});
