/**
 * `analysis_ready.may_run` — the run path's OWN admission answer, on the turn payload.
 *
 * ## THE DEFECT THIS CLOSES
 *
 * The client gates the `run_analysis` chip on `ceeAnalysisReady.status === 'ready'`
 * (`DecisionGuideAI@a3ad0c22 SuggestedChips.tsx:196`). But `status` and
 * "will the run proceed?" are DIFFERENT QUESTIONS, and the readiness answer loop's
 * payoff turn lands exactly where they disagree: the run WILL proceed by excluding
 * the options the user left open, while `status` is still `needs_user_input`.
 * So the affordance the turn has just promised is filtered out of the chip row.
 *
 * ## WHY A CORPUS, AND WHY THESE ARMS
 *
 * Derived from ONE REAL CAPTURE (`live-4day-week.cold-read.json`) by REMOVING
 * configuration — nothing here is a graph written from the author's head. Measured
 * at this tip, the arms are:
 *
 *   arm              status              willProceed
 *   full             ready               true
 *   unconfigured:1   needs_user_input    TRUE   <- the payoff turn, the defect
 *   unconfigured:2   needs_user_input    false  <- opposite direction
 *   unconfigured:3   needs_user_input    false  <- opposite direction
 *
 * ⭐ THE LOAD-BEARING PROPERTY OF THIS CORPUS: the last three arms all carry the
 * SAME status, and differ in `willProceed`. So a test that passed by reading
 * `status` could not distinguish them — the corpus is what makes the new field's
 * discrimination observable at all, rather than a guard agreeing with itself.
 *
 * Every rule is asserted in BOTH directions in the same run: a model that WILL run
 * must say so, and a model that must NOT run must still say so.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { maximalOlumiResponse } from '@talchain/schemas/fixtures';

import { attachComputedAt } from '../../../orchestrator-v5/compose/analysis-ready-emit.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../analysis-ready-helper.js';

const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

interface Node { id?: string; kind?: string; interventions?: Record<string, unknown>; [k: string]: unknown }
type Graph = { nodes: Node[]; options?: Array<Record<string, unknown>>; [k: string]: unknown };

function capture(): Graph {
  const parsed = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { graph: Record<string, unknown> };
  // Structured clone so one arm's mutation cannot leak into another's.
  return JSON.parse(JSON.stringify(parsed.graph)) as Graph;
}

/** Strip the named options' interventions — what a partly-configured fresh draft is. */
function withUnconfiguredOptions(optionIds: readonly string[]): Graph {
  const graph = capture();
  graph.nodes = graph.nodes.map((node) =>
    node.kind === 'option' && optionIds.includes(node.id ?? '')
      ? { ...node, interventions: {} }
      : node,
  );
  // The canonical top-level `options[]` is what the semantic projection reads, so
  // it has to be stripped in step with the nodes or the arm is inconsistent.
  if (Array.isArray(graph.options)) {
    graph.options = graph.options.map((option) =>
      optionIds.includes(String(option.option_id ?? option.id))
        ? { ...option, interventions: {} }
        : option,
    );
  }
  return graph;
}

function optionIds(): string[] {
  return capture().nodes.filter((n) => n.kind === 'option').map((n) => String(n.id));
}

/** `may_run` is additive on a passthrough payload, so it is not on the static type. */
function mayRunOf(payload: unknown): unknown {
  return (payload as { may_run?: unknown } | undefined)?.may_run;
}

describe('analysis_ready.may_run — the payoff turn', () => {
  it('a model that is NOT strictly ready but WILL proceed carries may_run: true', () => {
    const graph = withUnconfiguredOptions(optionIds().slice(0, 1));

    // ── PRECONDITION PINNED IN-TEST ──────────────────────────────────────────
    // Without this the assertion below could pass on an arm that is simply
    // `ready`, which is the state that already worked. Assert the arm really is
    // the disagreement case, so a green result is provably about the new field.
    const payload = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(payload, 'the arm must produce a readiness payload at all').toBeDefined();
    expect(payload!.status, 'PRECONDITION: this arm must NOT be strictly ready').not.toBe('ready');
    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: the run path must nevertheless admit this graph',
    ).toBe(true);

    expect(mayRunOf(payload)).toBe(true);
  });

  it('OPPOSITE DIRECTION — a model that must NOT run still carries may_run: false', () => {
    const graph = withUnconfiguredOptions(optionIds().slice(0, 2));

    const payload = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(payload, 'the arm must produce a readiness payload at all').toBeDefined();
    expect(payload!.status, 'PRECONDITION: this arm must NOT be strictly ready').not.toBe('ready');
    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: the run path must REFUSE this graph',
    ).toBe(false);

    expect(mayRunOf(payload)).toBe(false);
  });
});

describe('analysis_ready.may_run — bound to the run path by identity', () => {
  const arms = (): Array<{ name: string; graph: Graph }> => {
    const ids = optionIds();
    return [
      { name: 'full', graph: capture() },
      ...ids.map((_, k) => ({
        name: `unconfigured:${k + 1}`,
        graph: withUnconfiguredOptions(ids.slice(0, k + 1)),
      })),
    ];
  };

  it('may_run IS resolveRunAdmission(graph).willProceed, never a re-derivation', () => {
    const observed: boolean[] = [];
    for (const { name, graph } of arms()) {
      const payload = buildCanonicalAnalysisReadyFromGraph(graph);
      if (!payload) continue;
      const willProceed = resolveRunAdmission(graph).willProceed;
      expect(mayRunOf(payload), `arm ${name}`).toBe(willProceed);
      observed.push(willProceed);
    }

    // ⭐ THE CORPUS MUST DISCRIMINATE. A binding assertion over a corpus whose
    // every arm gives the same answer is satisfied by a constant, so it would
    // certify `may_run: true` hardcoded. Assert both verdicts are present.
    expect(observed, 'corpus must contain a proceeding arm').toContain(true);
    expect(observed, 'corpus must contain a refusing arm').toContain(false);
  });

  it('WIDENING, NEVER NARROWING — every strictly-ready model has may_run: true', () => {
    let readyArms = 0;
    for (const { name, graph } of arms()) {
      const payload = buildCanonicalAnalysisReadyFromGraph(graph);
      if (payload?.status !== 'ready') continue;
      readyArms += 1;
      // The UI's existing gate shows the chip on `status === 'ready'`. If any
      // ready model could carry `may_run: false`, adopting the field would HIDE
      // a chip that renders today — a narrowing. It must not be possible.
      expect(mayRunOf(payload), `arm ${name} is ready and must admit`).toBe(true);
    }
    expect(readyArms, 'corpus must contain at least one strictly-ready arm').toBeGreaterThan(0);
  });

  it('the status vocabulary alone CANNOT decide admission — why the field is needed', () => {
    // The three unconfigured arms share one status and disagree on admission.
    // This is the defect stated as a property: it fails the day `status` becomes
    // sufficient, which is the day this field could be retired.
    const ids = optionIds();
    const byStatus = new Map<string, Set<boolean>>();
    for (const k of [1, 2, 3]) {
      const graph = withUnconfiguredOptions(ids.slice(0, k));
      const payload = buildCanonicalAnalysisReadyFromGraph(graph);
      if (!payload) continue;
      const set = byStatus.get(payload.status) ?? new Set<boolean>();
      set.add(resolveRunAdmission(graph).willProceed);
      byStatus.set(payload.status, set);
    }
    const ambiguous = [...byStatus.entries()].filter(([, verdicts]) => verdicts.size > 1);
    expect(
      ambiguous.length,
      'at least one status value must map to BOTH admission verdicts',
    ).toBeGreaterThan(0);
  });
});

describe('may_run reaches the WIRE, not just the payload object', () => {
  /**
   * ⭐ THIS IS THE GUARD THAT FAILS LOUD IF THE CONTRACT IS EVER TIGHTENED.
   *
   * `may_run` is additive: it is NOT declared in `@talchain/schemas` 0.48.0. It
   * crosses only because `analysis_ready` is `.passthrough()` there. That is a
   * real property of a real dependency, not an assumption — so it is asserted
   * against the ACTUAL pinned schema. If a future contract makes
   * `analysis_ready` strict, or the boundary starts stripping unknown keys, this
   * REDs here rather than silently dropping the field on the wire, where the
   * only symptom would be a Run chip quietly going missing again.
   */
  it('survives attachComputedAt AND the pinned boundary schema', () => {
    const graph = withUnconfiguredOptions(optionIds().slice(0, 1));
    const payload = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(payload).toBeDefined();

    // PRECONDITION: the arm is the disagreement case, so this is not a test
    // about an already-ready model.
    expect(payload!.status).not.toBe('ready');
    expect(mayRunOf(payload)).toBe(true);

    // Hop 1 — the finaliser's stamp must not drop it.
    const stamped = attachComputedAt(payload!);
    expect(mayRunOf(stamped), 'attachComputedAt must preserve additive fields').toBe(true);

    // Hop 2 — the PINNED boundary contract must accept AND preserve it.
    // Base on the CONTRACT'S OWN maximal fixture so the envelope is valid by
    // construction and the only thing under test is the added field.
    const parsed = OlumiResponseSchema.safeParse({
      ...structuredClone(maximalOlumiResponse),
      analysis_ready: stamped,
    });

    // POSITIVE CONTROL: prove the probe can see a success at all before reading
    // anything into one. A schema error here is about the envelope, not may_run.
    expect(parsed.success, 'CONTROL: the envelope itself must be valid').toBe(true);
    if (!parsed.success) return;

    const wire = (parsed.data as { analysis_ready?: { may_run?: unknown } }).analysis_ready;
    expect(wire?.may_run, 'may_run must survive the boundary schema').toBe(true);
  });

  it('NEGATIVE CONTROL — the boundary schema really does reject something', () => {
    // Without this, the assertion above could pass against a schema that
    // validates anything, which would make it evidence about nothing.
    const bad = OlumiResponseSchema.safeParse({
      ...structuredClone(maximalOlumiResponse),
      may_run: true,
    });
    expect(bad.success, 'an unknown TOP-LEVEL key must still be rejected').toBe(false);
  });
});
