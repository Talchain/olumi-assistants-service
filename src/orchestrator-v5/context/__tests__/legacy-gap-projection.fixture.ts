import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

export const CARRIERS = ['node', 'mirror', 'both'] as const;
export type Carrier = typeof CARRIERS[number];
export const SUBJECT = 'opt-a';
export const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const AT = '2026-10-01T00:00:00.000Z';

export function legacyGraph(carrier: Carrier, gaps: string[] | undefined = ['unmapped effect']): GraphStateIngress {
  const graph: GraphStateIngress = {
    nodes: [
      { id: 'factor', kind: 'factor', label: 'Investment', category: 'controllable', observed_state: { value: 0.4 } },
      { id: 'goal', kind: 'goal', label: 'Growth' },
      { id: SUBJECT, kind: 'option', label: 'Expand', status: 'ready', interventions: { factor: { value: 0.8 } } },
      { id: 'opt-b', kind: 'option', label: 'Hold', status: 'ready', interventions: { factor: { value: 0.2 } } },
    ],
    edges: [{ from: 'factor', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
    goal_node_id: 'goal',
  };
  const subject = graph.nodes.find(n => n.id === SUBJECT)!;
  if (carrier !== 'node') graph.options = [{ id: SUBJECT, label: subject.label, status: 'ready',
    interventions: structuredClone(subject.interventions), ...(gaps === undefined ? {} : { unresolved_targets: gaps }) }];
  if (carrier !== 'mirror' && gaps !== undefined) subject.unresolved_targets = gaps;
  return graph;
}

// Filled once from the frozen PRE-GAP helper; never mint saved identities with the live projection.
export const LEGACY_SHA256 = {
  node: 'c89612a8d28fc890b814ed6577bbf9605d8bfc75cf09e22ffd46f6f494dabeca',
  mirror: '2f69b69974cd23bc40822704edbe90a843e625bdae07875fce8579254153cf87',
  both: '2f69b69974cd23bc40822704edbe90a843e625bdae07875fce8579254153cf87',
} as const;
export const LEGACY_CHANGED_SHA256 = {
  node: '25fb86e218d97d7b16e12372c8838fcfee787d64186a30db1212da0ce3c013aa',
  mirror: '0e45d4c41f8c9d9a697897e2fffa64fcea979044c9fb151e4124298773251515',
  both: '0e45d4c41f8c9d9a697897e2fffa64fcea979044c9fb151e4124298773251515',
} as const;

export function legacyRun(carrier: Carrier, changed = false, gapFree = false): RunAnalysisHandlerFact {
  const hash = (changed ? LEGACY_CHANGED_SHA256 : LEGACY_SHA256)[carrier].slice(0, 16);
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    scenario_id: SCENARIO, leading_option_id: 'opt-b', summary: 'Frozen pre-upgrade Run.',
    run_id: changed ? 'legacy-changed' : 'legacy-original', computed_at: changed ? '2026-10-02T00:00:00.000Z' : AT,
    graph_hash_at_run: hash, enrichment: { analysis_status: 'computed' },
    input_snapshot: { snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null,
      options: [{ option_id: 'opt-b', settings: [{ factor_id: 'factor', encoded: 0.2 }] },
        ...(gapFree ? [{ option_id: SUBJECT, settings: [{ factor_id: 'factor', encoded: 0.8 }] }] : [])],
      options_not_sent: gapFree ? [] : [{ option_id: SUBJECT, reason: 'not_analysable' }], factors: [], constraints: [], links: [] },
  } };
}
