import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { selectedRunContextDelta, selectedRunContextPair, SELECTED_SCENARIO } from './fixtures/selected-run-context-delta.js';

describe('selected Run fixtures carry canonical execution identity', () => {
  it('uses the graph’s options and distinct scenario-bound Run endpoints', () => {
    const read = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8'));
    const at = read.analysis_state.run_state.computed_at;
    const pair = selectedRunContextPair(read.graph_hash, at).map(f => RunAnalysisHandlerFactSchema.parse(f));
    const options = read.graph.nodes.filter((n: { kind: string }) => n.kind === 'option').map((n: { id: string }) => n.id).sort();
    for (const fact of pair) {
      expect(fact.result.scenario_id).toBe(SELECTED_SCENARIO);
      const results = fact.result.enrichment!.results as { option_id: string }[];
      expect(results.map(r => r.option_id).sort()).toEqual(options);
    }
    const delta = selectedRunContextDelta(read.graph_hash, at);
    expect(delta.endpoints).toEqual({
      current: { run_id: pair[0]!.result.run_id, computed_at: pair[0]!.result.computed_at },
      prior: { run_id: pair[1]!.result.run_id, computed_at: pair[1]!.result.computed_at },
    });
    expect(selectedRunContextDelta(read.graph_hash, '2026-10-04T00:00:00.000Z')).not.toEqual(delta);
  });
});
