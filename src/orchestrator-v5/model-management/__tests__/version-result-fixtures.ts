import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingHashRecord } from '../../context/graph-identity.js';
import type { ScenarioAnalysisFactSet } from '../../context/reconcile-scenario-analysis-facts.js';
import { runAnalysisFact } from '../../context/__tests__/run-delta-fixtures.js';
import { BASE_GRAPH, STRUCTURAL_EDIT, FIX_SCENARIO, versionRecord } from './fixtures.js';
import type { ModelVersionRecord } from '../types.js';

const graph = (source: typeof BASE_GRAPH, unit = 'GBP/month') => GraphStateIngressSchema.parse({
  ...source, goal_node_id: 'n_revenue',
  nodes: [...source.nodes.map(node => node.id === 'n_revenue'
    ? { ...node, kind: 'goal', goal_threshold_unit: unit } : node),
    { id: 'opt-a', kind: 'option', label: 'Offshore partner' },
    { id: 'opt-b', kind: 'option', label: 'Hire locally' }],
});
export const FROM = versionRecord(graph(BASE_GRAPH));
export const TO = versionRecord(graph(STRUCTURAL_EDIT), { id: '22222222-2222-4222-8222-222222222222' });
export function savedRun(version: ModelVersionRecord, id: string, at: string, win = 0.62): HandlerFact {
  const hash = computeAnalysisAffectingHashRecord(version.graph as typeof BASE_GRAPH)!.value;
  const base = runAnalysisFact([{ id: 'opt-a', win }, { id: 'opt-b', win: 1 - win }], id, hash, at);
  const result = (base as unknown as { result: Record<string, unknown> }).result;
  const value = version.graph as ReturnType<typeof graph>;
  const goal = value.nodes.find(node => node.id === 'n_revenue')!;
  return { ...base, result: { ...result, scenario_id: FIX_SCENARIO, run_id: id,
    enrichment: { ...(result.enrichment as Record<string, unknown>),
      robustness: { level: 'high', near_tie: { is_tie: false } } },
    input_snapshot: RunInputSnapshotSchema.parse({ snapshot_version: 1, sent_digest: 'a'.repeat(64),
      residual_digest: 'b'.repeat(64), goal: { node_id: 'n_revenue', unit: goal.goal_threshold_unit },
      options: [], options_not_sent: [], factors: [], constraints: [], links: [] }),
  } } as unknown as HandlerFact;
}
export const PRIOR = savedRun(FROM, 'bound-prior', '2026-10-02T00:00:00.000Z');
export const CURRENT = savedRun(TO, 'bound-current', '2026-10-02T01:00:00.000Z', 0.45);
export const factSet = (facts: readonly HandlerFact[] = [CURRENT, PRIOR]): ScenarioAnalysisFactSet =>
  ({ status: 'complete', source: 'scenario', facts, total_count: facts.length });
