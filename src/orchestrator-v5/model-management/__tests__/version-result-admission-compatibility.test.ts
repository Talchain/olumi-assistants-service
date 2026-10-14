import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { CARRIERS, legacyGraph, legacyRun, SCENARIO } from '../../context/__tests__/legacy-gap-projection.fixture.js';
import { stampRunAnalysisProjection } from '../../context/analysis-projection-policy.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { bindVersionResults } from '../version-result-binding.js';
import { FIX_SCENARIO, versionRecord } from './fixtures.js';
import { FROM, factSet, savedRun } from './version-result-fixtures.js';

describe('historical admission compatibility without exhaustive sent arms', () => {
  it.each(CARRIERS)('binds a gap-free legacy %s Run with a partial recorded option population', carrier => {
    const version = versionRecord(legacyGraph(carrier, []));
    const run = legacyRun(carrier, false, true);
    run.result.input_snapshot!.options.pop();
    expect(bindVersionResults({ scenarioId: SCENARIO, from: version, to: version, factSet: factSet([run]) }))
      .toMatchObject({ kind: 'shared', recordedRun: { run_id: 'legacy-original' } });
  });

  it('binds a none-mode Run whose empty sent population is fully attested by exclusions', () => {
    const graph = structuredClone(GraphStateIngressSchema.parse(FROM.graph));
    for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
    const version = versionRecord(graph);
    const run = savedRun(version, 'excluded-all', '2026-10-03T00:00:00.000Z') as RunAnalysisHandlerFact;
    expect(run.result.input_snapshot!.options).toEqual([]);
    expect(run.result.input_snapshot!.options_not_sent).toHaveLength(2);
    expect(bindVersionResults({ scenarioId: FIX_SCENARIO, from: version, to: version, factSet: factSet([run]) }))
      .toMatchObject({ kind: 'shared', recordedRun: { run_id: 'excluded-all' } });
  });

  it.each([false, true])('a current gap-bound digest still requires consistent, complete admission (omit exclusion: %s)', omit => {
    const graph = structuredClone(GraphStateIngressSchema.parse(FROM.graph));
    graph.nodes.find(node => node.id === 'opt-a')!.unresolved_targets = ['unmapped effect'];
    const version = versionRecord(graph);
    const run = savedRun(version, 'current-gap-identity', '2026-10-03T00:00:00.000Z') as RunAnalysisHandlerFact;
    expect(run.result.graph_hash_at_run).not.toBe(computeAnalysisAffectingGraphHash(graph, 'legacy'));
    expect(run.result.input_snapshot!.options_not_sent).toEqual([{ option_id: 'opt-a', reason: 'not_analysable' }]);
    if (omit) run.result.input_snapshot!.options_not_sent = [];
    expect(bindVersionResults({ scenarioId: FIX_SCENARIO, from: version, to: version, factSet: factSet([run]) }).kind)
      .toBe(omit ? 'unavailable' : 'shared');
  });

  it.each([false, true])('requires a stamp for unmatched mirror gaps omitted by both digests (stamped: %s)', stamped => {
    const graph = structuredClone(GraphStateIngressSchema.parse(FROM.graph));
    graph.options = [{ id: 'orphan-mirror', label: 'Unmatched mirror', status: 'ready',
      interventions: { n_price: { value: 12 } }, unresolved_targets: ['unmapped effect'] }];
    const version = versionRecord(graph);
    const run = savedRun(version, 'unmatched-mirror-gap', '2026-10-03T00:00:00.000Z') as RunAnalysisHandlerFact;
    if (stamped) run.result.enrichment = stampRunAnalysisProjection(run.result.enrichment ?? {});
    expect(computeAnalysisAffectingGraphHash(graph)).toBe(computeAnalysisAffectingGraphHash(graph, 'legacy'));
    expect(bindVersionResults({ scenarioId: FIX_SCENARIO, from: version, to: version, factSet: factSet([run]) }).kind)
      .toBe(stamped ? 'shared' : 'unavailable');
  });
});
