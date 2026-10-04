/**
 * Row1 only: a gap changes the CURRENT canonical option-readiness decision,
 * without changing a number or the persisted status. Its saved Run must stale.
 * Reuses the untouched capture already exercised by mapping-need-survives-to-the-wire.
 * No writer, provider, database, copied status predicate or freshness predicate.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import { stampRunAnalysisProjection } from '../analysis-projection-policy.js';

type Row = Record<string, unknown> & { id: string };
type TestGraph = { nodes: Row[]; edges: unknown[]; options?: Row[]; [key: string]: unknown };
type WireOption = { option_id: string; status: string; status_reason?: string;
  interventions: Record<string, number>; unresolved_targets?: string[] };
const capture = JSON.parse(readFileSync(new URL(
  '../../../cee/transforms/__tests__/fixtures/held-baseline-journey-2026-09-18.json', import.meta.url,
), 'utf8')) as { draft_graph: TestGraph };
const OPTION = '3fb49c45'; // Existing captured option with TWO numeric interventions.
const AT = '2026-10-03T00:00:00.000Z';
const REASON = 'A proposed effect still needs a supported mapping';

type Placement = { name: string; node: boolean; mirror: boolean };
const CONSUMED: Placement[] = [
  { name: 'node fallback, no mirror', node: true, mirror: false },
  { name: 'matching mirror', node: false, mirror: true },
  { name: 'both carriers agree', node: true, mirror: true },
];
const targetNode = (g: TestGraph): Row => g.nodes.find(n => n.id === OPTION)!;

function base(placement: Placement): TestGraph {
  const graph = structuredClone(capture.draft_graph);
  expect(graph.options, 'untouched capture has no top-level mirror').toBeUndefined();
  const node = targetNode(graph);
  expect(node, 'subject exists in the untouched capture').toBeDefined();
  expect(Object.keys(node.interventions as Record<string, unknown>)).toHaveLength(2);
  if (placement.mirror) {
    // A valid matching entry is consumed even in a partial mirror. Numeric
    // values are copied from the capture; persisted status stays ready throughout.
    graph.options = [{ id: OPTION, label: node.label, status: 'ready',
      interventions: structuredClone(node.interventions) }];
  }
  return graph;
}

function withGaps(graph: TestGraph, placement: Placement, targets?: string[], questions?: string[]): TestGraph {
  const next = structuredClone(graph);
  const rows = [
    ...(placement.node ? [targetNode(next)] : []),
    ...(placement.mirror ? [next.options!.find(o => o.id === OPTION)!] : []),
  ];
  for (const row of rows) {
    if (targets === undefined) delete row.unresolved_targets;
    else row.unresolved_targets = [...targets];
    if (questions === undefined) delete row.user_questions;
    else row.user_questions = [...questions];
  }
  return next;
}

function canonicalOption(graph: TestGraph): WireOption {
  // Production chain: canonical builder -> buildAnalysisReadyPayload ->
  // computeAnalysisReadyStatusWithReason (unresolvedTargetCount).
  const ready = buildCanonicalAnalysisReadyFromGraph(graph);
  expect(ready, 'capture reaches the real canonical readiness authority').toBeDefined();
  const option = (ready!.options as unknown as WireOption[]).find(o => o.option_id === OPTION);
  expect(option, 'canonical subject is bound by its captured id').toBeDefined();
  expect(Object.keys(option!.interventions)).toHaveLength(2);
  return option!;
}

function hash(graph: TestGraph): string {
  const result = computeAnalysisAffectingGraphHash(graph as unknown as GraphStateIngress);
  expect(result).toMatch(/^[0-9a-f]{16}$/);
  return result!;
}

function runAt(graph: TestGraph): RunAnalysisHandlerFact {
  // Same successful recorded-fact shape as the existing freshness spec.
  // This is a saved-Run CONTROL, not an attested executed PLoT Run.
  return { fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      summary: 'Saved Run freshness control.', leading_option_id: OPTION,
      graph_hash_at_run: hash(graph), computed_at: AT,
      enrichment: stampRunAnalysisProjection({ analysis_status: 'computed' }) } };
}

const freshness = (saved: RunAnalysisHandlerFact, graph: TestGraph) =>
  deriveAnalysisFreshness([saved], hash(graph), undefined, { priorFactsReadOk: true, currentGraph: graph });

function withoutGapNotes(graph: TestGraph): TestGraph {
  const next = structuredClone(graph);
  for (const row of [...next.nodes, ...(next.options ?? [])]) {
    delete row.unresolved_targets;
    delete row.user_questions;
  }
  return next;
}

describe.each(CONSUMED)('gap-only saved-Run freshness: $name', placement => {
  it.each([
    { transition: 'first gap added', from: undefined, to: ['brand equity'], before: 'ready', after: 'needs_user_mapping' },
    { transition: 'last gap cleared', from: ['brand equity'], to: undefined, before: 'needs_user_mapping', after: 'ready' },
  ])('RED: $transition changes canonical readiness and stales the saved Run', row => {
    const seed = base(placement);
    const before = withGaps(seed, placement, row.from);
    const after = withGaps(seed, placement, row.to);
    // No numerical/value/status drift can stand in for the gap-only change.
    expect(withoutGapNotes(after)).toStrictEqual(withoutGapNotes(before));
    expect(canonicalOption(before).status).toBe(row.before);
    expect(canonicalOption(after).status).toBe(row.after);
    const blocked = row.before === 'needs_user_mapping' ? before : after;
    expect(canonicalOption(blocked)).toMatchObject({ status_reason: REASON, unresolved_targets: ['brand equity'] });
    const saved = runAt(before);
    expect(freshness(saved, before)).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    // Both assertions expose the current omission, using real production readers.
    expect.soft(hash(after)).not.toBe(hash(before));
    expect(freshness(saved, after)).toMatchObject({ freshness: 'stale', reason: 'graph_hash_diverged', computed_at: AT });
  });

  it('CONTROL: absent and explicit-empty gap fields have the same ready meaning', () => {
    const before = base(placement);
    const after = withGaps(before, placement, []);
    expect(canonicalOption(before).status).toBe('ready');
    expect(canonicalOption(after).status).toBe('ready');
    expect(hash(after)).toBe(hash(before));
    expect(freshness(runAt(before), after).freshness).toBe('fresh');
  });

  it('CONTROL: question-only wording does not create a gap or stale a Run', () => {
    const before = withGaps(base(placement), placement, undefined, ['Please clarify this mapping.']);
    const after = withGaps(before, placement, undefined, ['Which mapping should we use?']);
    expect(canonicalOption(before).status).toBe('ready');
    expect(canonicalOption(after).status).toBe('ready');
    expect(hash(after)).toBe(hash(before));
    expect(freshness(runAt(before), after).freshness).toBe('fresh');
  });

  it('CONTROL: provenance-only edits do not change gap admission or stale a Run', () => {
    const before = withGaps(base(placement), placement, ['brand equity']);
    const after = structuredClone(before);
    targetNode(after).provenance = 'user_set';
    if (after.options) after.options[0]!.provenance = { source: 'user_specified' };
    expect(canonicalOption(before).status).toBe('needs_user_mapping');
    expect(canonicalOption(after).status).toBe('needs_user_mapping');
    expect(hash(after)).toBe(hash(before));
    expect(freshness(runAt(before), after).freshness).toBe('fresh');
  });

  it('CONTROL: target order and duplicate entries do not change the admission meaning', () => {
    const before = withGaps(base(placement), placement, ['brand equity', 'support demand']);
    const after = withGaps(before, placement, ['support demand', 'brand equity', 'brand equity']);
    expect(canonicalOption(before).status).toBe('needs_user_mapping');
    expect(canonicalOption(after).status).toBe('needs_user_mapping');
    expect(hash(after)).toBe(hash(before));
    expect(freshness(runAt(before), after).freshness).toBe('fresh');
  });
});

it('a ready mirror shadows node admission but retained node gaps still stale the stamped Run', () => {
  const before = base({ name: 'mirror', node: false, mirror: true });
  const after = withGaps(before, { name: 'shadowed node', node: true, mirror: false }, ['brand equity']);
  expect(targetNode(after).unresolved_targets).toEqual(['brand equity']);
  expect(after.options![0]!.unresolved_targets).toBeUndefined();
  // The existing readiness precedence remains; analytical identity still
  // retains the model's node uncertainty without an append marker.
  expect(canonicalOption(before).status).toBe('ready');
  expect(canonicalOption(after).status).toBe('ready');
  expect(hash(after)).not.toBe(hash(before));
  expect(freshness(runAt(before), after).freshness).toBe('stale');
  expect(freshness(runAt(after), before).freshness).toBe('stale');
});
