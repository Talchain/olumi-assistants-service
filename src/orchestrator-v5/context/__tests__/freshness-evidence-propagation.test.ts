import { bindRunAnalysisOccurrence } from '../../types/handler-fact.js';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { deriveAnalysisFreshness, type DeriveAnalysisFreshnessOptions, type FreshnessDerivation } from '../freshness.js';
import { legacyEditFactsForFreshness } from '../reconcile-scenario-analysis-facts.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { stampRunAnalysisProjection } from '../analysis-projection-policy.js';
import { legacyGraph, legacyRun, AT, SCENARIO } from './legacy-gap-projection.fixture.js';

// Execute the actual production expressions, including every late recovery
// derivation and BOTH chip helper callers. Branch integration tests separately
// exercise the shared loader and narration race; this scan closes omissions in
// paths that are difficult to provoke together in one dispatch fixture.
function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}
function calls(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source); return found;
}
function expression(source: ts.SourceFile, node: ts.Node, scope: Record<string, unknown>): unknown {
  const js = ts.transpileModule(`export const probe = (${node.getText(source)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  // The source is this checkout's reviewed TypeScript, never external input.
  new Function('exports', ...Object.keys(scope), js)(exports, ...Object.values(scope));
  return exports.probe;
}
const edit = parse('../../handlers/edit-graph-dispatch.ts');
const chip = parse('../../handlers/chip-click-dispatch.ts');
const route = parse('../../../orchestrator/route-v2.ts');
const writers = parse('../../system-events/dispatch.ts');
const sites = [
  ...calls(edit, 'deriveAnalysisFreshness').map(node => ({ source: edit, node })),
  ...calls(route, 'deriveAnalysisFreshness').map(node => ({ source: route, node })),
  ...calls(chip, 'deriveChipClickFreshness').map(node => ({ source: chip, node })),
  // The writer helper is the common authority for pre-write and EVERY post-commit reply.
  { source: writers, node: calls(writers, 'deriveAnalysisFreshness')[0]! },
];
const graph = legacyGraph('node', []);
const hash = computeAnalysisAffectingGraphHash(graph)!;
const stamp = '2026-10-02T00:00:00.000Z';
const editFact = { fact_type: 'edit_graph', fact_version: 1, noop: false, result: {
  edit_kind: 'option_configuration', status: 'applied', operations_count: 1, affected_entities: [],
  graph_hash_before: hash, graph_hash_after: hash, safe_summary: 'Cleared the option gap.',
  impact: 'moderate', rerun_recommended: true,
} };
const scenarios = ['failed', 'capped', 'durable-edit', 'hot-edit', 'db-chronology', 'unusable-rerun', 'noop', 'refused', 'non-rerun', 'healthy'] as const;

describe('complete freshness evidence at every dispatch/recovery derivation', () => {
  it('enumerates all six edit derivations, both route derivations, both chip callers and the writer authority', () => {
    expect(calls(edit, 'deriveAnalysisFreshness')).toHaveLength(6);
    expect(calls(route, 'deriveAnalysisFreshness')).toHaveLength(2);
    expect(calls(chip, 'deriveAnalysisFreshness')).toHaveLength(1);
    expect(calls(chip, 'deriveChipClickFreshness')).toHaveLength(2);
    expect(calls(writers, 'deriveAnalysisFreshness')).toHaveLength(2); // authority + explicit fail-weak sentinel
  });
  for (const site of sites) for (const kind of ['legacy', 'stamped'] as const) {
    const line = site.source.getLineAndCharacterOfPosition(site.node.getStart()).line + 1;
    it.each(scenarios)(`${site.source.fileName}:${line} ${kind} %s preserves the selected Run and complete evidence`, scenario => {
      const selected = legacyRun('node', false, true);
      selected.result.graph_hash_at_run = hash;
      if (kind === 'stamped') selected.result.enrichment = stampRunAnalysisProjection(selected.result.enrichment!);
      const editResult = structuredClone(editFact);
      if (scenario === 'noop') editResult.noop = true;
      if (scenario === 'refused') editResult.result.status = 'rejected';
      if (scenario === 'non-rerun') editResult.result.rerun_recommended = false;
      const visible = ['hot-edit', 'db-chronology', 'unusable-rerun', 'noop', 'refused', 'non-rerun'].includes(scenario);
      const priorFactsWithTurn = visible ? [{ fact: editResult, fact_row_id: 'visible-edit', turn_id: 'edit-turn', fact_created_at: stamp }] : [];
      const legacyEdits = { since: AT, facts: scenario === 'durable-edit' ? [{ fact: editResult, fact_row_id: 'durable-edit', fact_created_at: stamp }] : [],
        readOk: scenario !== 'failed' && scenario !== 'capped', total_count: scenario === 'capped' ? 22 : scenario === 'durable-edit' ? 1 : 0 };
      const unusable = { ...selected, result: { ...selected.result, run_id: 'failed-rerun', computed_at: stamp,
        enrichment: { ...selected.result.enrichment, analysis_status: 'failed' } } };
      const facts = scenario === 'db-chronology' ? [selected, editResult] : scenario === 'unusable-rerun' ? [unusable, editResult, selected] : visible ? [editResult, selected] : [selected];
      const factSet = { status: 'complete', source: 'scenario', facts: [selected], total_count: 1, legacy_edit_facts: legacyEdits };
      const context = { prior_facts: facts, prior_facts_read_ok: true, analysis_invalidated_at: null,
        prior_facts_with_turn: priorFactsWithTurn, scenario_analysis_fact_set: factSet,
        persistedGraph: graph, persistedRevision: 7 };
      // Graph-only writer doors cannot supply a current revision. Other sites
      // use their existing graph/revision snapshot, without an extra read.
      const graphOnlyWriter = site.source === writers;
      const currentScenarioRevision = graphOnlyWriter ? undefined : 7;
      const options = { currentScenarioRevision, priorFactsReadOk: true, analysisInvalidatedAt: null, priorFactsWithTurn, legacyEditFacts: legacyEdits };
      const scope: Record<string, unknown> = {
        deriveAnalysisFreshness, legacyEditFactsForFreshness, config: { cee: { optionIdentityFreshnessGuard: false } },
        turnContext: context, context, currentGraphHash: hash, addOptionGraphHash: hash, textGraphHash: hash,
        persistedPostEditGraph: graph, addOptionFrameGraph: graph, textFrameGraph: graph, gmFrameBase: graph,
        gmCurrentHash: hash, unchangedHash: hash, withheldCurrentHash: hash, priorFactsForRecovery: facts,
        freshnessReadOptionsForRecovery: options, cachedSnapshot: { rawPersistedGraph: graph, evaluatedScenarioRevision: 7 }, postDispatchFacts: facts,
        // These are real lexical inputs used by the source expressions after C2.
        editBase: { graph, revision: 7 }, currentScenarioRevision,
        read: { factSet: { ...factSet, facts }, hotWindow: { status: 'ok', facts }, analysisInvalidatedAt: null, priorFactsWithTurn },
        allowLegacyWindowAbsence: false,
        durableAuthority: true, persistedAnalysisGraphHash: hash, currentGraph: graph,
      };
      // Capture the real recovery assignment, so dropping a field THERE cannot be hidden by the fixture.
      let assignment: ts.Expression | undefined;
      function find(node: ts.Node) {
        if (ts.isBinaryExpression(node) && node.left.getText(edit) === 'freshnessReadOptionsForRecovery') assignment = node.right;
        ts.forEachChild(node, find);
      }
      find(edit);
      expect(assignment).toBeDefined();
      scope.freshnessReadOptionsForRecovery = expression(edit, assignment!, scope);
      scope.deriveChipClickFreshness = (_snapshot: unknown, prior: Parameters<typeof deriveAnalysisFreshness>[0], readOk?: boolean,
        invalidated?: string | null, chronology?: DeriveAnalysisFreshnessOptions) => expression(chip, calls(chip, 'deriveAnalysisFreshness')[0]!, {
          deriveAnalysisFreshness, config: scope.config, cachedSnapshot: _snapshot, currentGraphHash: scope.currentGraphHash,
          facts: prior, priorFactsReadOk: readOk, analysisInvalidatedAt: invalidated, chronology,
        });
      const result = expression(site.source, site.node, scope) as FreshnessDerivation;
      expect(result.selected_fact_row_id).toBeNull();
      expect(result.run_revision).toEqual({ value: null, source: 'legacy_unknown' });
      expect(result.basis).toBe('analysis_graph_hash_interim');
      const stale = scenario === 'hot-edit' || scenario === 'db-chronology' || scenario === 'unusable-rerun'
        || (kind === 'legacy' && ['failed', 'capped', 'durable-edit'].includes(scenario));
      expect(result).toMatchObject({ freshness: stale ? 'stale' : 'fresh', graph_hash_at_run: hash, computed_at: AT });
      if (!stale) expect(result).toEqual(deriveAnalysisFreshness(facts as never, hash, undefined, { currentGraph: graph, priorFactsWithTurn } as never));
      // The same selected identity with FULL inputs must agree at each consumer.
      expect(result).toEqual(deriveAnalysisFreshness(facts as never, hash, undefined, { ...options, currentGraph: graph } as never));
      expect(selected.result).toMatchObject({ run_id: 'legacy-original', graph_hash_at_run: hash, computed_at: AT, scenario_id: SCENARIO });
      if (kind === 'stamped' && scenario === 'healthy') {
        // Make revision threading consequential; equal hashes alone could hide
        // an omitted current revision in any of these real source expressions.
        const recorded = structuredClone(selected);
        delete recorded.result.graph_hash_at_run;
        bindRunAnalysisOccurrence({ fact: recorded, fact_row_id: 'evaluated-run-row', evaluated_scenario_revision: 7 });
        context.prior_facts = [recorded]; factSet.facts = [recorded];
        scope.priorFactsForRecovery = [recorded]; scope.postDispatchFacts = [recorded];
        scope.read = { factSet, hotWindow: { status: 'ok', facts: [recorded] },
          analysisInvalidatedAt: null, priorFactsWithTurn };
        // Neither a candidate edit nor a graph-only writer has a current
        // persisted revision available to authorise the no-hash fallback.
        const candidate = site.node.getText(site.source).includes('currentGraph: persistedPostEditGraph');
        const revisionUnavailable = candidate || graphOnlyWriter;
        expect(expression(site.source, site.node, scope)).toEqual({
          selected_fact_row_id: 'evaluated-run-row', run_revision: { value: 7, source: 'recorded' },
          basis: revisionUnavailable ? 'analysis_graph_hash_interim' : 'recorded_run_revision',
          freshness: revisionUnavailable ? 'unknown' : 'fresh', reason: 'legacy_fact_missing_hash', selected_fact_index: 0,
          graph_hash_at_run: null, current_graph_hash: hash, computed_at: AT,
        });
        if (graphOnlyWriter) {
          // The same helper also serves writes whose existing v6 snapshot or
          // commit result supplies a revision. Keep that threading decisive.
          scope.currentScenarioRevision = 7;
          expect(expression(site.source, site.node, scope)).toEqual({
            selected_fact_row_id: 'evaluated-run-row', run_revision: { value: 7, source: 'recorded' },
            basis: 'recorded_run_revision', freshness: 'fresh', reason: 'legacy_fact_missing_hash', selected_fact_index: 0,
            graph_hash_at_run: null, current_graph_hash: hash, computed_at: AT,
          });
          scope.currentScenarioRevision = undefined;
        }
        // A real analysis-affecting edit is stale with equal revisions, and
        // remains stale on graph-only doors with no current revision.
        const edited = legacyGraph('node', []);
        edited.nodes[0]!.observed_state = { value: 0.5 };
        const editedHash = computeAnalysisAffectingGraphHash(edited)!;
        expect(editedHash).not.toBe(hash);
        recorded.result.graph_hash_at_run = hash;
        context.persistedGraph = edited;
        for (const key of ['currentGraphHash', 'addOptionGraphHash', 'textGraphHash', 'gmCurrentHash',
          'unchangedHash', 'withheldCurrentHash', 'persistedAnalysisGraphHash']) scope[key] = editedHash;
        for (const key of ['persistedPostEditGraph', 'addOptionFrameGraph', 'textFrameGraph', 'gmFrameBase', 'currentGraph']) scope[key] = edited;
        scope.editBase = { graph: edited, revision: 7 };
        scope.cachedSnapshot = { rawPersistedGraph: edited, evaluatedScenarioRevision: 7 };
        expect(expression(site.source, site.node, scope)).toEqual({
          selected_fact_row_id: 'evaluated-run-row', run_revision: { value: 7, source: 'recorded' },
          basis: 'analysis_graph_hash_interim', freshness: 'stale', reason: 'graph_hash_diverged', selected_fact_index: 0,
          graph_hash_at_run: hash, current_graph_hash: editedHash, computed_at: AT,
        });
      }
    });
  }
});

it('goal-direction guard still overrides an equal hash for the served Run that sent no direction', () => {
  const currentGraph = JSON.parse(readFileSync(new URL(
    '../../agent-lane/__tests__/fixtures/served-rt10-churn-below-2pct.json', import.meta.url), 'utf8'))
    .captures.staging_91656b1b.graph;
  const currentHash = computeAnalysisAffectingGraphHash(currentGraph);
  expect(currentHash).not.toBeNull();
  const selected = legacyRun('node', false, true);
  selected.result.graph_hash_at_run = currentHash!;
  selected.result.enrichment = stampRunAnalysisProjection(selected.result.enrichment!);
  selected.result.input_snapshot = { ...selected.result.input_snapshot!, goal: { node_id: 'monthly_churn', label: 'monthly churn',
    target_raw: 2, unit: '%', operator: '<', frame: 'level' } };
  expect(deriveAnalysisFreshness([selected], currentHash, undefined, { currentGraph })).toEqual({
    selected_fact_row_id: null, run_revision: { value: null, source: 'legacy_unknown' },
    basis: 'analysis_graph_hash_interim', freshness: 'stale', reason: 'goal_direction_changed',
    selected_fact_index: 0, graph_hash_at_run: currentHash, current_graph_hash: currentHash, computed_at: AT,
  });
});
