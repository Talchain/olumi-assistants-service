/** Coherent selected executions: graph options, scenario identity and producer-stamped endpoints. */
import { readFileSync } from 'node:fs';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { buildRunDelta } from '../../../coaching/build-run-delta.js';
import { runAnalysisFact } from '../../../context/__tests__/run-delta-fixtures.js';

const served = JSON.parse(readFileSync(new URL('./served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8'));
export const SELECTED_SCENARIO = '520aab46-9ed5-4819-9d7f-498d16603943';
export function selectedRunContextPair(hash: string, at: string, mayName = true): HandlerFact[] {
  const priorAt = new Date(Date.parse(at) - 30 * 60_000).toISOString();
  return [at, priorAt].map((computedAt, index) => {
    const options = [
      { id: 'keep_49_price', win: index === 0 ? 0.1 : 0.2 },
      { id: 'raise_to_54', win: index === 0 ? 0.65 : 0.25 },
      { id: 'raise_to_59', win: index === 0 ? 0.25 : 0.55 },
    ];
    const base = runAnalysisFact(options, index === 0 ? '4242' : '4141', hash, computedAt, mayName);
    const result = (base as unknown as { result: Record<string, unknown> }).result;
    const labels = new Map(served.graph.nodes.map((n: { id: string; label: string }) => [n.id, n.label]));
    return { ...base, fact_version: 1, result: { ...result, scenario_id: SELECTED_SCENARIO, run_id: `selected-${computedAt}`,
      leading_option_id: index === 0 ? 'raise_to_54' : 'raise_to_59', summary: 'Recorded comparison on the selected model.',
      enrichment: { ...served.analysis_result.enrichment, ...(result.enrichment as object),
        robustness: { level: 'high', near_tie: { is_tie: false } },
        results: options.map(o => ({ option_id: o.id, option_label: labels.get(o.id), win_probability: o.win })),
        option_comparison: options.map(o => ({ option_id: o.id, option_label: labels.get(o.id), win_probability: o.win })),
        identity_evaluations: [{ node_id: 'mrr', evaluated: true }],
      },
      input_snapshot: RunInputSnapshotSchema.parse({ snapshot_version: 1, sent_digest: 'a'.repeat(64),
        residual_digest: 'b'.repeat(64), goal: { node_id: 'mrr', unit: '£/month' },
        options: options.map(o => ({ option_id: o.id, label: labels.get(o.id), settings: [] })),
        options_not_sent: [], factors: [], constraints: [], links: [] }),
    } } as unknown as HandlerFact;
  });
}
export function selectedRunContextDelta(hash: string, at: string, mayName = true) {
  const built = buildRunDelta({ priorFacts: selectedRunContextPair(hash, at, mayName), mayNameLeadingOption: mayName });
  if (built.kind !== 'ok') throw new Error(`fixture: recorded delta refused (${built.reason})`);
  return RunDeltaSchema.parse(built.delta);
}
