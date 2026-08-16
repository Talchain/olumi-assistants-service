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

import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack, CONTEXT_PACK_RECENT_TURNS_CAP } from '../context-pack-assembler.js';
import { applyContextBudgetToAssemblyInputs } from '../context-budget-enforcement.js';
import { CONTEXT_POLICY } from '../context-policy.js';
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

// Typed against the real emit signature so `mock.calls` destructures with
// concrete tuple types (the generic `ReturnType<typeof vi.spyOn>` widening
// left the call-tuple elements implicitly `any` — 5 errors visible only to
// the full-tsc drift ratchet, whose config includes test files).
let emitSpy: MockInstance<typeof telemetry.emit>;

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
    //
    // ⚠ THE GOLDEN IS NOT RE-CAPTURED, DELIBERATELY. Context/Memory V5
    // defect 2 added ONE key to the display-safe analysis projection
    // (`analysis_not_current_note`), which this fixture triggers because it
    // wires no freshness verdict and the disclosure is fail-closed. Swapping
    // the hash for a fresh capture would retire the only evidence that the
    // budget wiring is byte-neutral — and would do so silently, which is
    // exactly what a golden exists to prevent.
    //
    // Instead the delta is SUBTRACTED and the ORIGINAL hash still asserted.
    // That proves two things at once, where a re-capture proved neither:
    // everything except the intended key is unchanged from the base commit,
    // and the intended key is genuinely the whole delta. If a later change
    // touches anything else in this pack, this line REDs as it always has.
    const withoutFreshnessDisclosure = assembleUnderBudgetPack();
    const displayAnalysis = withoutFreshnessDisclosure.display_analysis as
      | Record<string, unknown>
      | null;
    expect(
      displayAnalysis?.analysis_not_current_note,
      'precondition: this fixture wires no freshness, so the fail-closed disclosure must be present — ' +
        'if it is absent the subtraction below is vacuous and proves nothing',
    ).toBeTypeOf('string');
    delete displayAnalysis?.analysis_not_current_note;

    expect(sha256(JSON.stringify(withoutFreshnessDisclosure))).toBe(
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

  it('O-2 scope guard: the O-3 graph/analysis seam never cuts the conversation window', () => {
    // ⚠ RETARGETED 2026-08-15 (Context/Memory V5 defect 3), and the reason is
    // the whole point of the guard. This test used to assert that the window
    // still held CONTEXT_PACK_RECENT_TURNS_CAP turns after an over-budget
    // graph. That assertion is no longer REACHABLE and could not be preserved
    // by any fixture: the O-3 valve only fires above ~120,000 chars of graph,
    // and any pack carrying that much graph is >2x the 55,000-char WHOLE-PACK
    // ceiling, which `enforceContextPackCeiling` now enforces by trimming the
    // conversation to its floor. The two conditions are mutually exclusive.
    //
    // So the guard is re-bound to the claim it always NAMED — the O-3 seam
    // does not touch the window — by ATTRIBUTING every cut to its site, which
    // is a stronger check than the count it replaces (a count passes for any
    // reason, including nothing having run at all).
    const available = CONTEXT_PACK_RECENT_TURNS_CAP + 2;
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: priorTurnsFixture(available),
      priorFacts: [],
      compactedGraph: overBudgetCompactGraph(),
      compactedConstraints: null,
      analysis: null,
    });

    // The O-3 seam ran (positive control — an absence claim over a seam that
    // never executed is vacuous) and its disclosure names ONLY graph/analysis.
    const o3Sections = (pack.context_budget?.truncations ?? []).map((t) => t.section);
    expect(o3Sections).toContain('graph');
    expect(o3Sections).not.toContain('conversation');
    const o3Cuts = emitSpy.mock.calls
      .filter(([event]) => event === TelemetryEvents.V5ContextTruncation)
      .map(([, payload]) => payload as Record<string, unknown>)
      .filter(
        (p) => p.site === 'context-budget-enforcement.applyContextBudgetToAssemblyInputs',
      );
    expect(o3Cuts.length).toBeGreaterThan(0);
    for (const cut of o3Cuts) expect(cut.section).not.toBe('conversation');

    // The window IS shorter here — by the OTHER seam, and disclosed. Bind that
    // to the ceiling site by identity so a future regression cannot smuggle a
    // conversation cut into the O-3 seam and pass this test.
    const ceilingCuts = emitSpy.mock.calls
      .filter(([event]) => event === TelemetryEvents.V5ContextTruncation)
      .map(([, payload]) => payload as Record<string, unknown>)
      .filter((p) => p.site === 'context-pack-assembler.enforceContextPackCeiling');
    expect(ceilingCuts).toHaveLength(1);
    expect(ceilingCuts[0].section).toBe('conversation');
    expect(ceilingCuts[0].floor_reached).toBe(true);

    // …and the conversation's own TRUTH is untouched by either seam: these two
    // count the conversation, not the window. This call supplies no
    // `priorTurnsTotal`, so the numbers stay the read window's own length.
    expect(pack.conversation.window?.available).toBe(available);
    expect(pack.conversation.turn_count).toBe(available);
    expect(pack.conversation.window?.summarised).toBeUndefined();
    expect(pack.conversation.window?.shown).toBe(pack.conversation.recent_turns.length);
    expect(pack.conversation.window?.notice).toBeTypeOf('string');
  });

  it('the whole-pack ceiling pass is byte-neutral on an under-budget pack', () => {
    // Context/Memory V5 defect 3 — the same subtraction idiom as the positive
    // control above, asserting the SAME base-commit golden. The ceiling pass
    // must add ZERO keys, cut nothing, and emit nothing when it does not fire;
    // the golden is what proves "zero keys" rather than "no key I thought of".
    const pack = assembleUnderBudgetPack();

    // Precondition (else this asserts byte-identity over a case the pass could
    // never have touched for a different reason than the one claimed).
    expect(
      JSON.stringify(pack).length,
      'precondition: this fixture must be UNDER the ceiling for the no-op claim to be about the ceiling',
    ).toBeLessThanOrEqual(CONTEXT_POLICY.coach_converse.total_char_budget!);

    expect(pack.conversation.recent_turns).toHaveLength(2);
    const displayAnalysis = pack.display_analysis as Record<string, unknown> | null;
    expect(displayAnalysis?.analysis_not_current_note).toBeTypeOf('string');
    delete displayAnalysis?.analysis_not_current_note;
    expect(sha256(JSON.stringify(pack))).toBe(UNDER_BUDGET_GOLDEN_SHA256);

    const ceilingCuts = emitSpy.mock.calls.filter(
      ([event, payload]) =>
        event === TelemetryEvents.V5ContextTruncation &&
        (payload as Record<string, unknown>).site ===
          'context-pack-assembler.enforceContextPackCeiling',
    );
    expect(ceilingCuts).toHaveLength(0);
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
