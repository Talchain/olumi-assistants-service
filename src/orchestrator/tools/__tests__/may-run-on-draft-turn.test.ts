/**
 * `analysis_ready.may_run` ON THE DRAFT TURN — the turn a fresh user first meets
 * the Analyse control.
 *
 * ## THE INVARIANT, WRITTEN AGAINST THE SPEC
 *
 *   A DRAFT TURN REPORTS THE SAME RUN-ADMISSION ASSESSMENT AS ANY OTHER TURN.
 *
 * Not "the draft turn stamps a field" — that is the symptom. The property is that
 * `analysis_ready.may_run` on a draft turn is the SAME answer, from the SAME
 * assessment, that `buildCanonicalAnalysisReadyFromGraph` publishes on every other
 * turn: `resolveRunAdmission(graph).willProceed`. A draft turn that computed its own
 * answer would satisfy the symptom and violate the spec.
 *
 * ## THE DEFECT THIS CLOSES
 *
 * `#1064` published `may_run` so the client could stop reconstructing an admission
 * rule it cannot see (CEE waives certain blockers by EXCLUDING an incomplete option
 * and running on the rest; `status` cannot express that). UI `#843` reads it.
 *
 * But the draft path does not go through the canonical builder when the pipeline
 * supplied a readiness payload (`draft-graph.ts`, the `pipelineHasAnalysisReady`
 * arm). It goes through `extractAnalysisReady`, which is — by its own comment — a
 * NAMED-FIELD RE-PROJECTION: it rebuilds the payload key by key, so any additive
 * field that is not named is silently dropped. `may_run` is not named there, and
 * could not be: the PIPELINE does not know CEE's admission rule. CEE does, because
 * CEE holds the graph.
 *
 * Witnessed at the wire on the deployed build: `may_run` absent from 9 of 9 draft
 * turns, `true`/`false` on the very next turn in the same sessions.
 *
 * ## WHY THESE ARMS, AND WHERE THEY COME FROM
 *
 * The corpus is the SAME REAL CAPTURE `#1064` used (`live-4day-week.cold-read.json`),
 * degraded by REMOVING configuration. Nothing here is a graph written from the
 * author's head. Measured at this tip:
 *
 *   arm              status              willProceed
 *   full             ready               true
 *   unconfigured:1   needs_user_input    TRUE   <- admits by exclusion
 *   unconfigured:2   needs_user_input    false  <- opposite direction
 *
 * ⭐ THE LOAD-BEARING PROPERTY: the last two arms share a `status` and differ in
 * `willProceed`. A stamp that read `status` could not tell them apart, so the corpus
 * is what makes the field's discrimination observable rather than a guard agreeing
 * with itself. Every rule is asserted in BOTH directions in the same run.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

const runUnifiedPipelineMock = vi.fn();
vi.mock('../../../cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: (...args: unknown[]) => runUnifiedPipelineMock(...args),
}));

import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  carryCanonicalRunAdmission,
} from '../analysis-ready-helper.js';
import { extractAnalysisReady, handleDraftGraph } from '../draft-graph.js';

const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

interface Node {
  id?: string;
  kind?: string;
  interventions?: Record<string, unknown>;
  [k: string]: unknown;
}
type Graph = { nodes: Node[]; options?: Array<Record<string, unknown>>; [k: string]: unknown };

const STUB_REQUEST = {} as FastifyRequest;
const BRIEF = 'A decision brief that is comfortably longer than thirty characters.';

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
  // The canonical top-level `options[]` is what the semantic projection reads, so it
  // has to be stripped in step with the nodes or the arm is inconsistent.
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
  return capture()
    .nodes.filter((n) => n.kind === 'option')
    .map((n) => String(n.id));
}

/**
 * What the PIPELINE emits: the readiness payload WITHOUT an admission verdict.
 *
 * Derived from the canonical payload for the same graph and then stripped, rather
 * than hand-written — so the arm stays a real payload shape for a real graph, and
 * the only thing that distinguishes it from the canonical build is the one field
 * under test. The pipeline genuinely cannot supply `may_run`: the admission rule is
 * CEE's, and CEE is the side that holds the graph.
 */
function pipelineAnalysisReady(graph: Graph): Record<string, unknown> {
  const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
  const payload: Record<string, unknown> = { ...canonical };
  delete payload.may_run;
  return payload;
}

/** Drive the real draft path with a pipeline body that carries a readiness payload. */
async function draftTurnFor(
  graph: Graph,
  analysisReadyOverride?: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof handleDraftGraph>>> {
  runUnifiedPipelineMock.mockResolvedValue({
    statusCode: 200,
    body: {
      graph,
      analysis_ready: analysisReadyOverride ?? pipelineAnalysisReady(graph),
    },
  });
  return handleDraftGraph(BRIEF, STUB_REQUEST, 'turn-draft-1');
}

beforeEach(() => {
  runUnifiedPipelineMock.mockReset();
});

describe('draft turn — analysis_ready.may_run reports the canonical run admission', () => {
  it('a draft the run WOULD admit carries may_run: true', async () => {
    const graph = withUnconfiguredOptions(optionIds().slice(0, 1));

    // ── PRECONDITIONS PINNED IN-TEST ────────────────────────────────────────
    // Without these the assertion could pass on an arm that is simply `ready` —
    // the state that already worked — or on an arm whose pipeline payload was
    // never actually consumed. Assert the arm really is the disagreement case,
    // so a green result is provably about the field under test.
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(canonical, 'the arm must produce a readiness payload at all').toBeDefined();
    expect(canonical!.status, 'PRECONDITION: this arm must NOT be strictly ready').not.toBe(
      'ready',
    );
    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: the run path must nevertheless admit this graph',
    ).toBe(true);

    const result = await draftTurnFor(graph);

    expect(
      result.analysisReady,
      'PRECONDITION: the draft path must have produced a readiness payload',
    ).toBeDefined();
    expect(
      result.analysisReady!.status,
      'PRECONDITION: the pipeline payload (not the canonical fallback) is the one on the block',
    ).not.toBe('ready');

    expect(result.analysisReady!.may_run).toBe(true);
  });

  it('OPPOSITE DIRECTION — a draft the run would REFUSE carries may_run: false, not absent', async () => {
    const graph = withUnconfiguredOptions(optionIds().slice(0, 2));

    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(canonical, 'the arm must produce a readiness payload at all').toBeDefined();
    expect(canonical!.status, 'PRECONDITION: this arm must NOT be strictly ready').not.toBe(
      'ready',
    );
    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: the run path must REFUSE this graph',
    ).toBe(false);

    const result = await draftTurnFor(graph);

    expect(result.analysisReady, 'the draft path must produce a payload').toBeDefined();
    // Absence is the OVER-PERMISSIVE failure the consumer doctrine turns into
    // "unknown, fall back" — on a refusing graph that re-opens the offer-and-refuse
    // harm. Assert presence separately from value so the two failures are distinct.
    expect(
      'may_run' in result.analysisReady!,
      'a refusing draft must SAY so — absence is not acceptable here',
    ).toBe(true);
    expect(result.analysisReady!.may_run).toBe(false);
  });

  it('a fully configured draft carries may_run: true', async () => {
    const graph = capture();

    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: the unmodified capture must be admissible',
    ).toBe(true);

    const result = await draftTurnFor(graph);

    expect(result.analysisReady!.may_run).toBe(true);
  });
});

describe('draft turn — bound to the canonical assessment by identity, not by coincidence', () => {
  const arms = (): Array<{ name: string; graph: Graph }> => {
    const ids = optionIds();
    return [
      { name: 'full', graph: capture() },
      { name: 'unconfigured:1', graph: withUnconfiguredOptions(ids.slice(0, 1)) },
      { name: 'unconfigured:2', graph: withUnconfiguredOptions(ids.slice(0, 2)) },
    ];
  };

  it('THE CORPUS DISCRIMINATES: the arms do not all give the same admission', () => {
    // A corpus whose arms agree cannot observe a stamp that is always-true or
    // always-false. Pin the discrimination itself, so this suite fails loud if the
    // fixture is ever tidied into uniformity (12b: a control pinned to something
    // that moves silently decays into a tautology).
    const verdicts = arms().map((a) => resolveRunAdmission(a.graph).willProceed);
    expect(new Set(verdicts).size, 'the corpus must contain BOTH verdicts').toBe(2);
  });

  it.each(arms())(
    'arm $name — the draft turn publishes exactly the canonical turn payload verdict',
    async ({ graph }) => {
      const canonicalMayRun = buildCanonicalAnalysisReadyFromGraph(graph)?.may_run;
      expect(canonicalMayRun, 'the canonical builder must have a verdict for this arm').toBeTypeOf(
        'boolean',
      );

      const result = await draftTurnFor(graph);

      // The spec: SAME assessment, not merely "a boolean". Equality with the
      // canonical builder's answer for the same graph is what "reports the same
      // assessment as any other turn" means operationally.
      expect(result.analysisReady!.may_run).toBe(canonicalMayRun);
    },
  );

  it('THE PIPELINE IS NOT THE AUTHORITY — a contradictory upstream may_run does not survive', async () => {
    // The admission rule belongs to the side that holds the graph.
    //
    // ⚠ WHY THIS TEST PINS ITS OWN MECHANISM. A mutant that made the payload's own
    // verdict win survived this case, and the reason is instructive: on the draft
    // path `payload.may_run` is ALWAYS undefined by the time the carry runs, because
    // `extractAnalysisReady`'s named-field re-projection has already dropped it
    // (demonstrated by execution, not assumed). So without the assertion below this
    // test would pass because of an UPSTREAM drop while reading as if it proved the
    // carry overrules. Pin the drop as the mechanism it is; the carry's own
    // precedence is proved directly in the unit block below, where a payload that
    // really does carry a contradictory verdict can be constructed.
    const graph = withUnconfiguredOptions(optionIds().slice(0, 2));
    expect(
      resolveRunAdmission(graph).willProceed,
      'PRECONDITION: CEE must refuse this graph',
    ).toBe(false);

    const lying = pipelineAnalysisReady(graph);
    lying.may_run = true;

    expect(
      extractAnalysisReady({ analysis_ready: lying })?.may_run,
      'MECHANISM: the named-field re-projection drops the pipeline verdict upstream',
    ).toBeUndefined();

    const result = await draftTurnFor(graph, lying);

    expect(result.analysisReady!.may_run).toBe(false);
  });
});

/**
 * `carryCanonicalRunAdmission` directly — the precedence and identity rules the
 * end-to-end arms above cannot reach.
 *
 * The draft path never presents a payload that already carries a verdict (the
 * re-projection drops it), so precedence is unobservable end-to-end. It is still a
 * rule the function must hold: the moment any producer DOES name the field, the
 * answer must be CEE's, and nothing else in the tree would notice if it were not.
 */
describe('carryCanonicalRunAdmission — precedence and identity', () => {
  const refusingGraph = (): Graph => withUnconfiguredOptions(optionIds().slice(0, 2));
  const admittingGraph = (): Graph => withUnconfiguredOptions(optionIds().slice(0, 1));

  it('the canonical REFUSAL overrules a payload that claims it may run', () => {
    const graph = refusingGraph();
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(canonical!.may_run, 'PRECONDITION: canonical must refuse').toBe(false);

    const claiming = { ...canonical!, may_run: true };
    expect(
      claiming.may_run,
      'PRECONDITION: the payload must really disagree, or this asserts nothing',
    ).toBe(true);

    expect(carryCanonicalRunAdmission(claiming, canonical).may_run).toBe(false);
  });

  it('OPPOSITE DIRECTION — the canonical ADMISSION overrules a payload that claims it may not', () => {
    const graph = admittingGraph();
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(canonical!.may_run, 'PRECONDITION: canonical must admit').toBe(true);

    const claiming = { ...canonical!, may_run: false };
    expect(claiming.may_run, 'PRECONDITION: the payload must really disagree').toBe(false);

    expect(carryCanonicalRunAdmission(claiming, canonical).may_run).toBe(true);
  });

  it('IDENTITY when there is no canonical verdict — absence is never synthesised into false', () => {
    const payload = buildCanonicalAnalysisReadyFromGraph(capture())!;

    // Reference equality, not deep equality: the path that already built
    // canonically must be provably unperturbed, which is what makes "every
    // non-draft turn is byte-identical" a property rather than a hope.
    expect(carryCanonicalRunAdmission(payload, undefined)).toBe(payload);
  });

  it('IDENTITY when the payload already carries that exact verdict', () => {
    const graph = capture();
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph)!;
    expect(canonical.may_run, 'PRECONDITION: canonical must have a verdict').toBeTypeOf('boolean');

    expect(carryCanonicalRunAdmission(canonical, canonical)).toBe(canonical);
  });
});
