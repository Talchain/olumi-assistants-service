/**
 * O-3 — context-size budget enforcement at the ContextPack assembly seam.
 *
 * RED-first contract: before the wiring, an over-budget compacted graph /
 * analysis summary passed straight through assembly untrimmed and the pack
 * carried NO disclosure — the oversized context could only fail the turn
 * at the API window. After the wiring, assembly degrades per the budget
 * module's own policy (src/orchestrator/context/budget.ts — field-trim
 * ladder for the graph, drivers→3 + tensions-drop for the analysis; nodes
 * and edges never deleted) WITH #536-style disclosure: an in-pack
 * `context_budget` marker plus `v5.context_truncation` telemetry
 * (`disclosed: true`).
 *
 * Positive control: an under-budget context must be BYTE-IDENTICAL to the
 * unwired assembler's output — pinned against a sha256 golden captured at
 * the base commit (staging 91e3dda6) with the identical fixture, plus
 * reference-equality on the graph/analysis inputs.
 *
 * Scope guard (O-2): the 5-turn conversation window is not this seam's
 * surface — enforcement receives no `messages`, and the window projection
 * must be unchanged even when the graph section is over budget.
 */

import { createHash } from 'node:crypto';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { applyContextBudgetToAssemblyInputs } from '../context-budget-enforcement.js';
import type { DisplaySafeGraph } from '../../format/format-graph-for-context.js';
import {
  analysisSummaryFixture,
  overBudgetCompactGraph,
  priorTurnsFixture,
  underBudgetCompactGraph,
} from './context-budget-fixtures.js';

const BASE_PAYLOAD = Object.freeze(makeMessagePayload());

/**
 * sha256 of `JSON.stringify(pack)` for the under-budget fixture, captured
 * at the base commit (staging 91e3dda6 — BEFORE the budget wiring) via
 * the capture script run against the identical fixture module. The wired
 * assembler must reproduce these exact bytes for an under-budget context:
 * no trimming, no reordering, no marker key.
 */
const UNDER_BUDGET_GOLDEN_SHA256 =
  'd957f274b90bce3a75c3243f044e490a10c6987658f069b8814fff819a6bf10c';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function assembleUnderBudgetPack() {
  return assembleContextPack({
    payload: BASE_PAYLOAD,
    priorTurns: priorTurnsFixture(2),
    priorFacts: [],
    compactedGraph: underBudgetCompactGraph(),
    compactedConstraints: null,
    analysis: analysisSummaryFixture(),
  });
}

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('context budget enforcement at assembly (O-3)', () => {
  it('degrades an over-budget graph per the budget module policy and discloses in-pack', () => {
    const bigGraph = overBudgetCompactGraph();
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: priorTurnsFixture(2),
      priorFacts: [],
      compactedGraph: bigGraph,
      compactedConstraints: null,
      analysis: analysisSummaryFixture(),
    });

    // Structure preserved: the module NEVER deletes nodes or edges.
    expect(pack.graph.counts.nodes).toBe(bigGraph.nodes.length);
    expect(pack.graph.counts.edges).toBe(bigGraph.edges.length);
    expect(pack.graph.edges).toHaveLength(bigGraph.edges.length);

    // Pass-2 field drops are visible in the LLM-facing display projection:
    // no node carries `category` or `intervention_summary` any more.
    const displayGraph = pack.display_graph as DisplaySafeGraph;
    expect(displayGraph.nodes.length).toBeGreaterThan(0);
    for (const node of displayGraph.nodes) {
      expect(node).not.toHaveProperty('category');
      expect(node).not.toHaveProperty('intervention_summary');
    }

    // The trimmed compact graph (handler-facing slot) lost the trim-ladder
    // fields while keeping label/value/unit.
    const firstNode = pack.graph.nodes[0] as Record<string, unknown>;
    expect(firstNode).not.toHaveProperty('type');
    expect(firstNode).not.toHaveProperty('category');
    expect(firstNode).not.toHaveProperty('source');
    expect(firstNode.label).toBeDefined();

    // In-pack disclosure marker (#536 pattern — never a silent drop).
    expect(pack.context_budget).toBeDefined();
    const truncations = pack.context_budget?.truncations ?? [];
    const graphRecord = truncations.find((t) => t.section === 'graph');
    expect(graphRecord).toBeDefined();
    expect(graphRecord!.original_chars).toBeGreaterThan(graphRecord!.kept_chars);
    expect(graphRecord!.kept_chars).toBe(
      JSON.stringify(bigGraphTrimmedProbe(pack)).length,
    );
  });

  it('emits v5.context_truncation with disclosed:true for a budget trim', () => {
    assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      compactedGraph: overBudgetCompactGraph(),
      compactedConstraints: null,
      analysis: null,
    });
    const truncationEvents = emitSpy.mock.calls.filter(
      ([event]) => event === TelemetryEvents.V5ContextTruncation,
    );
    expect(truncationEvents.length).toBeGreaterThanOrEqual(1);
    const budgetCut = truncationEvents
      .map(([, payload]) => payload as Record<string, unknown>)
      .find(
        (p) =>
          p.site ===
          'context-budget-enforcement.applyContextBudgetToAssemblyInputs',
      );
    expect(budgetCut).toBeDefined();
    expect(budgetCut!.section).toBe('graph');
    expect(budgetCut!.disclosed).toBe(true);
    expect(budgetCut!.strategy).toBe('field_trim');
  });

  it('trims an over-budget analysis to 3 drivers, drops tensions, and discloses', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      compactedGraph: underBudgetCompactGraph(),
      compactedConstraints: null,
      analysis: analysisSummaryFixture({ inflate: true }),
    });

    expect(pack.analysis).not.toBeNull();
    expect(pack.analysis!.top_drivers.length).toBeLessThanOrEqual(3);

    const truncations = pack.context_budget?.truncations ?? [];
    const analysisRecord = truncations.find((t) => t.section === 'analysis');
    expect(analysisRecord).toBeDefined();
    expect(analysisRecord!.original_chars).toBeGreaterThan(
      analysisRecord!.kept_chars,
    );
  });

  it('positive control: an under-budget context is untrimmed, unmarked, and byte-identical to base', () => {
    const graph = underBudgetCompactGraph();
    const analysis = analysisSummaryFixture();
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: priorTurnsFixture(2),
      priorFacts: [],
      compactedGraph: graph,
      compactedConstraints: null,
      analysis,
    });

    // No marker key at all (key-absence doctrine — byte identity).
    expect('context_budget' in pack).toBe(false);

    // Nothing trimmed: node/edge arrays flow through by reference and the
    // five-driver projection survives (CONTEXT_PACK_TOP_DRIVER_CAP = 5).
    expect(pack.graph.nodes).toBe(graph.nodes);
    expect(pack.graph.edges).toBe(graph.edges);
    expect(pack.analysis!.top_drivers).toHaveLength(5);

    // Byte-identity against the base-commit golden (same fixture, no wiring).
    expect(sha256(JSON.stringify(assembleUnderBudgetPack()))).toBe(
      UNDER_BUDGET_GOLDEN_SHA256,
    );

    // And no budget-truncation telemetry fired.
    const budgetCuts = emitSpy.mock.calls.filter(
      ([event, payload]) =>
        event === TelemetryEvents.V5ContextTruncation &&
        (payload as Record<string, unknown>).site ===
          'context-budget-enforcement.applyContextBudgetToAssemblyInputs',
    );
    expect(budgetCuts).toHaveLength(0);
  });

  it('O-2 scope guard: the 5-turn conversation window is untouched by an over-budget graph', () => {
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: priorTurnsFixture(7),
      priorFacts: [],
      compactedGraph: overBudgetCompactGraph(),
      compactedConstraints: null,
      analysis: null,
    });
    expect(pack.conversation.recent_turns).toHaveLength(5);
    expect(pack.conversation.window).toEqual({ shown: 5, available: 7 });
    expect(pack.conversation.turn_count).toBe(7);
  });

  it('helper is a no-op returning the same references when both inputs are null', () => {
    const result = applyContextBudgetToAssemblyInputs({
      compactedGraph: null,
      analysis: null,
      scenarioId: 'scen-abc',
    });
    expect(result.compactedGraph).toBeNull();
    expect(result.analysis).toBeNull();
    expect(result.disclosure).toBeNull();
  });
});

/**
 * kept_chars must equal the serialised size of the graph that actually
 * landed on the pack — the disclosure numbers describe the real object,
 * not an estimate. (pack.graph nodes/edges ARE the trimmed compact
 * arrays on the compacted path.)
 */
function bigGraphTrimmedProbe(pack: {
  graph: { nodes: readonly unknown[]; edges: readonly unknown[] };
}): unknown {
  return {
    nodes: pack.graph.nodes,
    edges: pack.graph.edges,
    _node_count: pack.graph.nodes.length,
    _edge_count: pack.graph.edges.length,
  };
}
