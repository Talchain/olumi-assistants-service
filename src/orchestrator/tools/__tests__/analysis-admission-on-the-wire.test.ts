/**
 * `analysis_ready.analysis_admission` — does the ONE admission result actually
 * REACH a consumer?
 *
 * ⭐ WHY THIS FILE IS NOT OPTIONAL. This estate's most expensive chronic failure
 * is building more than it plugs in: 42 roadmap items have been working code no
 * user can reach. A new authority that no payload carries is that failure in its
 * purest form — and the specific mechanism is already documented one file over:
 * `extractAnalysisReady` is a NAMED-FIELD RE-PROJECTION, so an additive field it
 * does not list is silently dropped, which is exactly how `may_run` shipped
 * absent on 9 of 9 draft turns.
 *
 * Every claim here is asserted at a HOP, with a control that proves the probe
 * can see a failure:
 *   hop 1  the canonical build stamps it;
 *   hop 2  `attachComputedAt` (the finaliser's stamp) preserves it;
 *   hop 3  the PINNED boundary contract accepts AND preserves it;
 *   hop 4  `carryCanonicalOnlyFields` puts it on a PIPELINE-shaped payload.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { maximalOlumiResponse } from '@talchain/schemas/fixtures';

import { attachComputedAt } from '../../../orchestrator-v5/compose/analysis-ready-emit.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../../orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../../orchestrator-v5/boundary/request-extensions.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { analysisAdmissionFrom } from '../../../orchestrator-v5/admission/analysis-admission.js';
import type { AnalysisAdmission } from '../../../orchestrator-v5/admission/analysis-admission.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  carryCanonicalOnlyFields,
} from '../analysis-ready-helper.js';

const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

interface Node { id?: string; kind?: string; interventions?: Record<string, unknown>; [k: string]: unknown }
type Graph = { nodes: Node[]; options?: Array<Record<string, unknown>>; [k: string]: unknown };

function capture(): Graph {
  const parsed = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { graph: Record<string, unknown> };
  return JSON.parse(JSON.stringify(parsed.graph)) as Graph;
}

/** The additive field is not on the static payload type — read it structurally. */
function admissionOf(payload: unknown): AnalysisAdmission | undefined {
  return (payload as { analysis_admission?: AnalysisAdmission } | undefined)?.analysis_admission;
}

describe('analysis_admission reaches a consumer', () => {
  it('hop 1 — the canonical build stamps it, from the SAME admission as may_run', () => {
    const graph = capture();
    const payload = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(payload, 'the capture must produce a readiness payload at all').toBeDefined();

    const verdict = admissionOf(payload);
    expect(verdict).toBeDefined();

    // ⭐ THE ANTI-DRIFT ASSERTION, and it is the reason both fields are stamped
    // from one object: `structurally_analysable` IS `may_run`. If a future edit
    // resolves the admission twice, these can disagree and this REDs.
    expect(verdict!.structurally_analysable).toBe(
      (payload as { may_run?: boolean }).may_run,
    );
    // …and it agrees with an independent resolve of the same graph.
    expect(verdict!.structurally_analysable).toBe(resolveRunAdmission(graph).willProceed);
  });

  it('hop 2 + hop 3 — attachComputedAt and the PINNED boundary schema both preserve it', () => {
    const graph = capture();
    const payload = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(payload).toBeDefined();

    const stamped = attachComputedAt(payload!);
    expect(admissionOf(stamped), 'attachComputedAt must preserve additive fields').toBeDefined();

    const parsed = OlumiResponseSchema.safeParse({
      ...structuredClone(maximalOlumiResponse),
      analysis_ready: stamped,
    });

    // POSITIVE CONTROL — prove the probe can see a success before reading one.
    expect(parsed.success, 'CONTROL: the envelope itself must be valid').toBe(true);
    if (!parsed.success) return;

    const wire = admissionOf(
      (parsed.data as { analysis_ready?: unknown }).analysis_ready,
    );
    expect(wire, 'analysis_admission must survive the boundary schema').toBeDefined();
    // Not merely present — the load-bearing field must survive with a real value.
    expect(wire!.permitted_analysis_mode).toBe(
      admissionOf(payload)!.permitted_analysis_mode,
    );
    expect(wire!.reasons.length).toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROL — the boundary schema really does reject something', () => {
    // Without this, the hop-3 assertion could pass against a schema that
    // validates anything, i.e. be evidence about nothing.
    const bad = OlumiResponseSchema.safeParse({
      ...structuredClone(maximalOlumiResponse),
      analysis_admission: { structurally_analysable: true },
    });
    expect(bad.success, 'an unknown TOP-LEVEL key must still be rejected').toBe(false);
  });

  it('hop 4 — carryCanonicalOnlyFields puts it on a PIPELINE-shaped payload', () => {
    const graph = capture();
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(canonical).toBeDefined();

    // A pipeline-shaped payload: the same identity, WITHOUT any canonical-only
    // field. This is what `extractAnalysisReady`'s named-field re-projection
    // hands the draft path.
    const pipelineShaped = {
      options: canonical!.options,
      goal_node_id: canonical!.goal_node_id,
      status: canonical!.status,
    } as NonNullable<
      import('../../types.js').GraphPatchBlockData['analysis_ready']
    >;

    // PRECONDITION PINNED IN-TEST: the payload really is missing the field, so a
    // green result below is the carry's doing and not the fixture's.
    expect(admissionOf(pipelineShaped)).toBeUndefined();

    const carried = carryCanonicalOnlyFields(pipelineShaped, canonical);
    expect(admissionOf(carried), 'the carry must supply the missing verdict').toBeDefined();
    // ⚠ READ, NOT RE-DERIVED — the carried object must be the SAME REFERENCE the
    // canonical build produced. A structurally-equal copy would mean a second
    // computation of one verdict, which is the hazard this whole module removes.
    expect(admissionOf(carried)).toBe(admissionOf(canonical));
  });

  it('hop 1b — the ONE production mint path stamps a REAL graph_hash (FINDING 2)', () => {
    // ⚠ THE FINDING THIS PINS. `canonicalAnalysisReadyFrom` is the only
    // production mint of `analysis_admission`, and it called
    // `analysisAdmissionFrom(admission, graph)` with TWO arguments against a
    // THREE-parameter signature whose third defaulted to `null`. So every wire
    // payload across all ~30 `buildCanonicalAnalysisReadyFromGraph` call sites
    // carried `graph_hash: null`, while the field's own contract promised the
    // subject "so a consumer can tell a stale one". A promise no consumer could
    // ever redeem is the guarantee-theatre class this estate is named for.
    const graph = capture();
    const verdict = admissionOf(buildCanonicalAnalysisReadyFromGraph(graph));

    expect(verdict, 'the capture must produce a verdict at all').toBeDefined();
    // Bound by IDENTITY to the sanctioned authority — no third hash is minted
    // here, and a bare shape assertion would not say WHICH hash this is.
    expect(verdict!.graph_hash).toBe(
      computeAnalysisAffectingGraphHashSha256(graph as unknown as GraphStateIngress),
    );
    expect(verdict!.graph_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hop 4 identity — a payload that ALREADY carries the verdict is returned unchanged', () => {
    const graph = capture();
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);
    const same = carryCanonicalOnlyFields(
      canonical as unknown as NonNullable<
        import('../../types.js').GraphPatchBlockData['analysis_ready']
      >,
      canonical,
    );
    expect(same).toBe(canonical);
  });
});

/**
 * ⭐⭐ THE DISCRIMINATING PAIR, ON REAL CAPTURES, IN ONE RUN.
 *
 * A verdict that read the same for every input would be evidence about the
 * probe, not the product (CLAUDE.md trap 20: *when a per-item query returns
 * identical results for every item, suspect the query*). These two arms are
 * different STATE CLASSES of real captured data, and they must answer
 * differently:
 *
 *   FRESH DRAFT      `acceptance-evidence/draft-speed/*` — nothing but the
 *                    drafter's own estimates behind every baseline and edge.
 *                    → `quantified_provisional`: run it, show figures, name no
 *                      leader. This is the 3 Sep journey's population.
 *
 *   WORKED SESSION   `live-4day-week.cold-read.json` — the same shape after a
 *                    user has been in it. Measured at this tip, `out_csat`
 *                    carries `observed_state.source: brief_extraction`
 *                    (`extractionType: explicit`), i.e. the user's own figure
 *                    for a parameter the comparison's confidence rests on.
 *                    → `comparative_leader`.
 *
 * ⚠ STATE CLASS IS NAMED DELIBERATELY (the fixture state-class rule): a seeded
 * capture is not evidence about a fresh user, and the whole value of this pair
 * is that the two classes are shown to diverge rather than assumed to.
 *
 * ⚠ AND THE HONEST LIMIT OF THE FLOOR, stated where it cannot be missed: ONE
 * user-stated parameter flips this field. It is a FLOOR — "no human judgement
 * has entered the parameters this claim rests on" — not a sufficiency score. A
 * consumer wanting a stricter bar reads `semantic_signals`, which is published
 * for exactly that, rather than minting a second opinion. A ratio threshold
 * chosen here would be an invented scoring model, and this estate has already
 * paid four rounds for a predicate settled by arbitrary constants.
 */
describe('the claim-strength bound discriminates across real state classes', () => {
  const FRESH_DRAFTS = [
    'acceptance-evidence/draft-speed/live-draft-1-eu-expansion.json',
    'acceptance-evidence/draft-speed/live-draft-2-ev-fleet.json',
    'acceptance-evidence/draft-speed/live-draft-3-hospital-staffing.json',
  ] as const;

  it.each(FRESH_DRAFTS)(
    'FRESH DRAFT %s — admissible, and may NOT name a leader',
    (file) => {
      const graph = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const admission = resolveRunAdmission(graph);
      const verdict = analysisAdmissionFrom(admission, graph);

      // PRECONDITION PINNED IN-TEST: the engine really would run this. Without
      // it the assertion below could hold because the model was refused, which
      // is an entirely different cell.
      expect(verdict.structurally_analysable).toBe(true);

      // ⭐ THE 3 SEP P0 AS AN ASSERTION: executable is not the same question as
      // claimable, and on a fresh draft the two answers differ.
      expect(verdict.semantic_quality_sufficient).toBe(false);
      expect(verdict.permitted_analysis_mode).toBe('quantified_provisional');

      // The withholding is not silent — it names the field and what would change it.
      const mode = verdict.reasons.find((r) => r.field === 'permitted_analysis_mode');
      expect(mode?.code).toBe('CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED');
      expect(mode?.message.length).toBeGreaterThan(0);
    },
  );

  it('WORKED SESSION — a user-stated baseline lifts the same graph to comparative_leader', () => {
    const graph = capture();
    const verdict = analysisAdmissionFrom(resolveRunAdmission(graph), graph);

    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.semantic_quality_sufficient).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('comparative_leader');
    // Bound to the CAUSE, not just the verdict: the census must show the
    // user-stated parameter that lifted it, or the arm passed for some other
    // reason and proves nothing about the predicate.
    expect(verdict.semantic_signals.confidence_parameters_user_stated).toBeGreaterThan(0);
  });

  it('and REMOVING that one stamp drops the same graph back to quantified_provisional', () => {
    // The discriminating mutation, in-test: same graph, one field changed. This
    // is what proves the verdict is bound to the provenance stamp and not to
    // something else about the capture.
    const graph = capture();
    const stamped = graph.nodes.filter(
      (n) => (n as { observed_state?: { source?: string } }).observed_state?.source
        === 'brief_extraction',
    );
    expect(stamped.length, 'PRECONDITION: the capture must carry the stamp').toBeGreaterThan(0);
    for (const node of stamped) delete (node as { observed_state?: unknown }).observed_state;

    const verdict = analysisAdmissionFrom(resolveRunAdmission(graph), graph);
    expect(verdict.semantic_quality_sufficient).toBe(false);
    expect(verdict.permitted_analysis_mode).toBe('quantified_provisional');
  });
});
