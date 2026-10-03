import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingHashRecord } from '../../context/graph-identity.js';
import { runAnalysisFact } from '../../context/__tests__/run-delta-fixtures.js';
import { buildRunInputSnapshot } from '../../tools/handlers/run-input-snapshot.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { versionRecord, FIX_SCENARIO } from './fixtures.js';
import { factSet } from './version-result-fixtures.js';

/** Synthetic response controls over the existing producer-minted M1 graph; not a live Run. */
export function sharedLicensedPair() {
  const captures = JSON.parse(readFileSync(fileURLToPath(new URL('../../agent-lane/__tests__/fixtures/m1-s1-served-graphs.json', import.meta.url)), 'utf8'));
  const graph = GraphStateIngressSchema.parse(captures.cases[0].graph);
  const changed = structuredClone(graph);
  const factor = changed.nodes.find(n => n.kind === 'factor' && n.observed_state?.value !== undefined)!;
  factor.observed_state = { ...factor.observed_state!, value: 0.1, raw_value: 10 };
  const from = versionRecord(graph);
  const to = versionRecord(changed, { id: '22222222-2222-4222-8222-222222222222' });
  const admissions = [graph, changed].map(g => buildCanonicalAnalysisReadyFromGraph(g).analysis_admission);
  const run = (version: typeof from, id: string, at: string): HandlerFact => {
    const g = GraphStateIngressSchema.parse(version.graph);
    const goal = g.nodes.find(n => n.kind === 'goal')!;
    const options = g.nodes.filter(n => n.kind === 'option').map(n => ({ id: n.id, option_id: n.id,
      label: n.label, interventions: n.interventions ?? {} }));
    const wire = options.map(o => Object.fromEntries(Object.entries(o.interventions).map(([key, value]) =>
      [key, typeof value === 'number' ? value : value.value])));
    const snapshot = buildRunInputSnapshot({ submittedOptions: options, rawObjectsPerOption: options.map(o => o.interventions),
      wirePerOption: wire, heldFactorIdsByOptionId: new Map(), optionsNotSent: [], wireGraph: g,
      plotPayload: { graph: g, goal_node_id: goal.id, goal_threshold_unit: goal.goal_threshold_unit, options } });
    if (snapshot === null) throw new Error('Control did not produce a valid Run input snapshot');
    const fact = runAnalysisFact(options.map((o, i) => ({ id: o.id, win: i === 0 ? 0.7 : 0.3 / (options.length - 1) })),
      id, computeAnalysisAffectingHashRecord(g)!.value, at);
    const result = (fact as unknown as { result: Record<string, unknown> }).result;
    return { ...fact, result: { ...result, scenario_id: FIX_SCENARIO, run_id: id, input_snapshot: snapshot,
      enrichment: { ...(result.enrichment as Record<string, unknown>), robustness: { level: 'high', near_tie: { is_tie: false } } } } } as unknown as HandlerFact;
  };
  const prior = run(from, 'licensed-prior', '2026-10-02T00:00:00.000Z');
  const current = run(to, 'licensed-current', '2026-10-02T01:00:00.000Z');
  return { from, to, prior, current, admissions, facts: factSet([prior, current]) };
}
