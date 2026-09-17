/**
 * ⭐⭐ THE ESTIMATE BATCH — propose, approve once, apply atomically.
 *
 * WHAT THIS SUITE PINS, and why each guard exists rather than being tidy:
 *
 *   1. MEMBERSHIP IS DERIVED FROM THE BLOCKERS, never composed in prose. The
 *      witnessed turn proposed NINE values against TEN blockers and said so;
 *      an approved set short by one still does not unblock the analysis. The
 *      membership guard REFUSES that set and names the missing cell.
 *   2. ATOMICITY — one bad cell in the set writes NOTHING.
 *   3. PROVENANCE SURVIVES THE WRITE. An approved estimate must stay
 *      distinguishable from a user-stated figure for the life of the graph.
 *   4. A GAP WE CANNOT ESTIMATE IS CARRIED, NOT GUESSED and not dropped.
 *
 * ⚠ EVERY EXPECTATION IS DERIVED FROM THE PRODUCER, NEVER TRANSCRIBED. The
 * option ids, factor ids, blocker codes and cell counts are read out of
 * `assessCanonicalAnalysisReadiness` at test time. A self-authored fixture
 * encodes the author's model of the producer rather than the producer
 * (CLAUDE.md trap 16-inverse), and this module's entire job is to carry the
 * producer's own cell set faithfully.
 *
 * The graph is a REAL DATED CAPTURE (`witness-2026-08-17/j4-wrong-entity-write
 * .json`, deployed CEE `8be62df`, scenario J4), varied only by CLEARING option
 * interventions in memory. The capture file itself is never edited — it is a
 * historic record (trap 14b).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  assessCanonicalAnalysisReadiness,
  mergeInterventionSources,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { selectAnswerableBlockers } from '../../routing/readiness-answer-chips.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import {
  PRESERVED_INTERVENTION_SOURCES,
  encodeOptionInterventionsForEdit,
} from '../../../orchestrator/tools/encode-option-interventions.js';
import {
  classifyIssueObligation,
  classifyValueSource,
  obligationFor,
} from '../../../cee/graph-readiness/obligation-provenance.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import {
  READINESS_VALUE_BATCH_HANDLER_ID,
  VALUE_BATCH_INTERVENTION_SOURCE,
  buildValueBatchOffer,
  buildValueBatchProposal,
  executeValueBatch,
  selectValueBatchMembership,
  writableCells,
  type ValueBatchEstimate,
} from '../readiness-value-batch.js';

const CAPTURE = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } };

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/** The witnessed arm: every option unconfigured, so every effect value is open. */
function zeroConfiguredGraph(): Graph {
  const graph = structuredClone(CAPTURE.draft_graph) as Graph;
  for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
  return graph;
}

const assess = (graph: unknown) => assessCanonicalAnalysisReadiness(graph);

/** A complete, valid estimate set derived from the producer's own membership. */
function fullEstimates(graph: unknown, value = 0.4): ValueBatchEstimate[] {
  return selectValueBatchMembership(assess(graph)).cells.map((cell) => ({
    option_id: cell.option_id,
    factor_id: cell.factor_id,
    value,
    reasoning: 'Reviewed estimate.',
    confidence: 'low' as const,
  }));
}

function proposalOrThrow(graph: unknown, estimates: readonly ValueBatchEstimate[]) {
  const result = buildValueBatchProposal({ assessment: assess(graph), estimates });
  if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.proposal;
}

describe('readiness value batch — membership', () => {
  it('BASELINE — the capture really is blocked, with settable and unsettable gaps', () => {
    // Without this, every "the batch covers it" assertion below could pass on a
    // graph that was never blocked (trap 13: an absence probe needs a presence).
    const assessment = assess(zeroConfiguredGraph());
    expect(assessment.blockingIssues.length).toBeGreaterThan(0);
    expect(assessment.safeToAnalyse).toBe(false);
    const membership = selectValueBatchMembership(assessment);
    // Both classes are present in this capture, so neither branch is vacuous.
    expect(membership.cells.length).toBeGreaterThan(0);
    expect(membership.unsettable.length).toBeGreaterThan(0);
  });

  it('⭐ membership is EXACTLY the producer blocker set — every answerable blocker, split by whether the factor is known', () => {
    const assessment = assess(zeroConfiguredGraph());
    const membership = selectValueBatchMembership(assessment);
    // Derived from the producer at test time, never transcribed.
    const answerable = selectAnswerableBlockers(assessment.blockingIssues);

    /**
     * ⚠ THE EXPECTATION IS BOUND TO AN INDEPENDENT PRODUCER PROPERTY, NOT TO A
     * COPY OF THE SPLIT PREDICATE. An earlier revision derived it with
     * `typeof i.factor_id === 'string' && i.factor_id.length > 0` — byte-identical
     * to the production line it was checking, so if the split were wrong (a
     * whitespace-only `factor_id`, say) both sides would be wrong together and
     * this test could not see it. A guard agreeing with itself.
     *
     * The independent property is the blocker CODE, which the producer sets and
     * this module never reads: `OPTION_NEEDS_MAPPING`'s entire content is that
     * the factor is unknown, so it is exactly the unsettable class. Measured on
     * this capture: 3 × `MISSING_OPTION_VALUE` (settable) and 3 ×
     * `OPTION_NEEDS_MAPPING` (unsettable).
     */
    const expectedSettable = answerable
      .filter((i) => i.code !== 'OPTION_NEEDS_MAPPING')
      .map((i) => i.issue_id);
    const expectedUnsettable = answerable
      .filter((i) => i.code === 'OPTION_NEEDS_MAPPING')
      .map((i) => i.issue_id);
    // Neither arm may be vacuous, and the two codes must really both be present
    // — otherwise this passes by partitioning nothing.
    expect(expectedSettable.length).toBeGreaterThan(0);
    expect(expectedUnsettable.length).toBeGreaterThan(0);

    expect(membership.cells.map((c) => c.issue_id)).toEqual(expectedSettable);
    expect(membership.unsettable.map((u) => u.issue_id)).toEqual(expectedUnsettable);
    // Every unsettable issue really is the factor-unknown class, read off the
    // producer rather than off the split.
    expect(membership.unsettable.every((u) => u.reason === 'factor_unknown')).toBe(true);
    // Nothing the producer named is silently absent from the plan.
    expect([...membership.cells.map((c) => c.issue_id), ...membership.unsettable.map((u) => u.issue_id)].sort())
      .toEqual(answerable.map((i) => i.issue_id).sort());
  });

  it('⭐⭐ THE WITNESSED DEFECT: an estimate set short by ONE is REFUSED, and the missing cell is named', () => {
    // The deployed product proposed 9 values for 10 blockers, disclosed the
    // omission, and offered the set anyway. An approved set that is short by
    // one cannot unblock the analysis, so it is not a proposal — it is a
    // request to approve something that does not do what it says.
    const graph = zeroConfiguredGraph();
    const complete = fullEstimates(graph);
    expect(complete.length).toBeGreaterThan(1);
    const dropped = complete[complete.length - 1]!;
    const short = complete.slice(0, -1);

    const result = buildValueBatchProposal({ assessment: assess(graph), estimates: short });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid' || result.reason !== 'incomplete') {
      throw new Error(`expected incomplete, got ${JSON.stringify(result)}`);
    }
    // Bound BY IDENTITY to the cell that was dropped, not merely by a count —
    // a length check would pass if it named the wrong cell (trap 19).
    expect(result.missing.map((m) => `${m.option_id}|${m.factor_id}`)).toEqual([
      `${dropped.option_id}|${dropped.factor_id}`,
    ]);
  });

  it('an estimate for a cell the blockers never named is REFUSED', () => {
    // The mirror of the guard above: the model may not add membership either.
    const graph = zeroConfiguredGraph();
    const estimates = [
      ...fullEstimates(graph),
      { option_id: 'not_a_real_option', factor_id: 'not_a_real_factor', value: 0.5 },
    ];
    const result = buildValueBatchProposal({ assessment: assess(graph), estimates });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid' || result.reason !== 'unknown_cell') {
      throw new Error(`expected unknown_cell, got ${JSON.stringify(result)}`);
    }
    expect(result.cells).toEqual([
      { option_id: 'not_a_real_option', factor_id: 'not_a_real_factor' },
    ]);
  });

  it('a duplicate estimate for one cell is REFUSED rather than last-write-wins', () => {
    const graph = zeroConfiguredGraph();
    const complete = fullEstimates(graph);
    const result = buildValueBatchProposal({
      assessment: assess(graph),
      estimates: [...complete, { ...complete[0]!, value: 0.9 }],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid' || result.reason !== 'duplicate_cell') {
      throw new Error(`expected duplicate_cell, got ${JSON.stringify(result)}`);
    }
  });

  it('the proposal keeps the PRODUCER’s order, not the order the estimates arrived in', () => {
    const graph = zeroConfiguredGraph();
    const membership = selectValueBatchMembership(assess(graph));
    const reversed = [...fullEstimates(graph)].reverse();
    const proposal = proposalOrThrow(graph, reversed);
    expect(proposal.cells.map((c) => c.issue_id)).toEqual(membership.cells.map((c) => c.issue_id));
  });
});

describe('readiness value batch — visible absence over confident wrongness', () => {
  it('a gap whose FACTOR is unknown is carried as unsettable, never given a guessed factor', () => {
    const graph = zeroConfiguredGraph();
    const membership = selectValueBatchMembership(assess(graph));
    expect(membership.unsettable.length).toBeGreaterThan(0);
    for (const gap of membership.unsettable) expect(gap.reason).toBe('factor_unknown');
    // The unsettable options appear in NO settable cell — the batch never
    // invents which factor an unmapped option affects.
    const settableOptions = new Set(membership.cells.map((c) => c.option_id));
    for (const gap of membership.unsettable) expect(settableOptions.has(gap.option_id)).toBe(false);
    // …and they survive into the reviewed proposal rather than being dropped.
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    expect(proposal.unsettable.map((u) => u.issue_id)).toEqual(
      membership.unsettable.map((u) => u.issue_id),
    );
  });

  it('a cell the model declines stays in the set, writes nothing, and must say why', () => {
    const graph = zeroConfiguredGraph();
    const estimates = fullEstimates(graph);
    const declined = { ...estimates[0]!, value: null, declined_reason: 'No defensible basis.' };
    const proposal = proposalOrThrow(graph, [declined, ...estimates.slice(1)]);
    // Membership is still complete — a decline cannot smuggle the nine-of-ten
    // omission back in through a different door.
    expect(proposal.cells).toHaveLength(estimates.length);
    expect(writableCells(proposal)).toHaveLength(estimates.length - 1);
    expect(proposal.cells[0]!.declined_reason).toBe('No defensible basis.');

    const outcome = executeValueBatch({ proposal, currentGraph: graph });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);
    // The declined cell is genuinely unset in the applied graph.
    const node = outcome.appliedGraph.nodes.find((n) => n.id === declined.option_id) as
      | Record<string, unknown>
      | undefined;
    expect(mergeInterventionSources(node!)?.[declined.factor_id]).toBeUndefined();
  });

  it('a decline with no reason is REFUSED — silence is indistinguishable from an omission', () => {
    const graph = zeroConfiguredGraph();
    const estimates = fullEstimates(graph);
    const result = buildValueBatchProposal({
      assessment: assess(graph),
      estimates: [{ ...estimates[0]!, value: null }, ...estimates.slice(1)],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid' || result.reason !== 'declined_without_reason') {
      throw new Error(`expected declined_without_reason, got ${JSON.stringify(result)}`);
    }
  });
});

describe('readiness value batch — atomicity', () => {
  it('⭐⭐ ONE INVALID CELL WRITES NOTHING — the batch is refused whole', () => {
    const graph = zeroConfiguredGraph();
    const estimates = fullEstimates(graph);
    expect(estimates.length).toBeGreaterThan(1);
    // Out of the 0–1 model-unit scale: a single bad cell among good ones.
    const result = buildValueBatchProposal({
      assessment: assess(graph),
      estimates: [{ ...estimates[0]!, value: 42 }, ...estimates.slice(1)],
    });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid' || result.reason !== 'invalid_value') {
      throw new Error(`expected invalid_value, got ${JSON.stringify(result)}`);
    }
    // Bound by identity to the offending cell, and to it alone: the VALID
    // cells must not be reported as the problem.
    expect(result.cells).toEqual([
      { option_id: estimates[0]!.option_id, factor_id: estimates[0]!.factor_id },
    ]);
    // And nothing reached the graph: the input is byte-identical afterwards.
    expect(graph).toEqual(zeroConfiguredGraph());
  });

  it('execute is PURE — the caller’s graph is never mutated in place', () => {
    const graph = zeroConfiguredGraph();
    const before = structuredClone(graph);
    const outcome = executeValueBatch({
      proposal: proposalOrThrow(graph, fullEstimates(graph)),
      currentGraph: graph,
    });
    expect(outcome.status).toBe('executed');
    expect(graph).toEqual(before);
  });

  it('a proposal whose membership has MOVED under it is refused, not applied blind', () => {
    // The user reviewed a plan for the graph as it was. If the model changed,
    // applying the approved estimates would write against something they never
    // saw. CAS in spirit, derived rather than hashed.
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    const moved = structuredClone(graph);
    // Remove one option entirely → the derived membership no longer matches.
    const optionId = proposal.cells[0]!.option_id;
    moved.nodes = moved.nodes.filter((n) => n.id !== optionId);
    // `EdgeV3` is `from`/`to`, NOT `source`/`target`. An earlier revision used
    // the react-flow spelling: it matched 0 of 33 edges on this capture, so the
    // arm left 33 dangling edges pointing at a deleted node and passed on the
    // node removal alone — green for a different reason than it states, on a
    // structurally invalid graph. The assertion below pins the filter itself.
    const edgesBefore = moved.edges.length;
    moved.edges = moved.edges.filter((e) => e.from !== optionId && e.to !== optionId);
    expect(moved.edges.length).toBeLessThan(edgesBefore);
    expect(moved.edges.some((e) => e.from === optionId || e.to === optionId)).toBe(false);
    const outcome = executeValueBatch({ proposal, currentGraph: moved });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') throw new Error('expected invalid');
    expect(outcome.reason).toBe('membership_moved');
  });

  /**
   * ⭐⭐ THE CASE A SURVIVING MUTANT EXPOSED, and it is the more dangerous half.
   *
   * The mutant that disabled the per-key comparison left the suite GREEN,
   * because the test above changes the NUMBER of cells and the size check
   * catches that on its own. A count is not an identity: membership can move
   * while its size is unchanged — one gap closes as another opens — and then
   * approved estimates would be written against cells the user never reviewed.
   *
   * Same cardinality, different cells. Nothing but the per-key comparison can
   * see this (trap 19 — bind by identity, never by a value another set
   * satisfies).
   */
  it('a proposal whose cells DIFFER at the same cardinality is refused', () => {
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    // One cell re-pointed at a different factor: the SAME number of cells, a
    // different set. Only the per-key comparison can see this.
    const tampered = {
      ...proposal,
      cells: proposal.cells.map((cell, index) =>
        index === 0 ? { ...cell, factor_id: `${cell.factor_id}-elsewhere` } : cell,
      ),
    };
    // Preconditions asserted IN-TEST, so this cannot pass for the wrong
    // reason: cardinality is genuinely unchanged, and the key set genuinely
    // differs from what the graph derives.
    const derived = selectValueBatchMembership(assess(graph));
    expect(tampered.cells).toHaveLength(derived.cells.length);
    expect(tampered.cells.map((c) => `${c.option_id}|${c.factor_id}`)).not.toEqual(
      derived.cells.map((c) => `${c.option_id}|${c.factor_id}`),
    );

    const outcome = executeValueBatch({ proposal: tampered, currentGraph: graph });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') throw new Error('expected invalid');
    expect(outcome.reason).toBe('membership_moved');
  });

  /**
   * ⭐⭐ THE WITNESSED DEFECT, ARRIVING AT THE EXECUTOR — the second surviving
   * mutant, and the one that matters most.
   *
   * `membership_moved` is a CONJUNCTION: a cardinality check and a per-key
   * comparison. Disabling the cardinality half left the suite green, because
   * the per-key half only asks whether every PROPOSAL key is in the
   * membership. A proposal that is a strict SUBSET satisfies that completely —
   * which is exactly a nine-of-ten set reaching commit and writing a plan that
   * cannot unblock the analysis.
   *
   * `buildValueBatchProposal` refuses to COMPOSE such a set; this pins that the
   * executor refuses to APPLY one, so a stale proposal cannot walk in behind
   * the composer's back.
   */
  it('a proposal that covers FEWER cells than the model now has is refused', () => {
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    const short = { ...proposal, cells: proposal.cells.slice(0, -1) };
    // Preconditions in-test: genuinely a strict subset, so the per-key
    // comparison alone cannot reject it and only cardinality can.
    const derived = selectValueBatchMembership(assess(graph));
    expect(short.cells.length).toBeLessThan(derived.cells.length);
    const derivedKeys = new Set(derived.cells.map((c) => `${c.option_id}|${c.factor_id}`));
    for (const cell of short.cells) {
      expect(derivedKeys.has(`${cell.option_id}|${cell.factor_id}`)).toBe(true);
    }

    const outcome = executeValueBatch({ proposal: short, currentGraph: graph });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') throw new Error('expected invalid');
    expect(outcome.reason).toBe('membership_moved');
  });
});

describe('readiness value batch — one approval, one apply', () => {
  it('⭐⭐ EVERY open effect value is set in ONE approved action, and those blockers clear', () => {
    const graph = zeroConfiguredGraph();
    const beforeAssessment = assess(graph);
    const membership = selectValueBatchMembership(beforeAssessment);
    const proposal = proposalOrThrow(graph, fullEstimates(graph));

    // ONE approval covers the whole set.
    const outcomeOffer = buildValueBatchOffer({
      proposal,
      currentGraphHash: 'hash-a',
      scenarioId: 'scn-value-batch',
    });
    expect(outcomeOffer.kind).toBe('offer');
    if (outcomeOffer.kind !== 'offer') throw new Error('expected an offer');
    const offer = outcomeOffer.offer;
    // Narrowed on the discriminant rather than cast through it: `inline_patch`
    // exists only on the `apply_proposed_change` member of the union, so this
    // asserts the offer really is that kind before reading the field.
    const action = offer.pending.action;
    if (action.kind !== 'apply_proposed_change') {
      throw new Error(`expected apply_proposed_change, got ${action.kind}`);
    }
    expect((action.inline_patch as Record<string, unknown>).handler_id).toBe(
      READINESS_VALUE_BATCH_HANDLER_ID,
    );
    // ⛔ THE FABRICATION BOUNDARY: the chip carries no product-chosen VALUE.
    //
    // ⚠ THE PREDICATE IS "NO PROPOSED VALUE", NOT "NO DIGIT" — and the
    // difference is the finding. My first version forbade every digit and went
    // RED on "apply all 3 estimates", where the 3 is a COUNT. A count is not a
    // number the product chose for the model; the estate's rule is about a
    // value landing on the 0–1 effect scale one click away. Forbidding digits
    // outright would also have banned the shipped
    // `buildReadinessRepairOffer` copy ("Apply 3 safe model fixes"). So this
    // binds BY IDENTITY to the values actually proposed (trap 19) and also
    // applies the estate's own shipped pattern.
    const chipText = `${offer.chip.label} ${offer.chip.message}`;
    for (const cell of writableCells(proposal)) {
      expect(chipText.includes(String(cell.value))).toBe(false);
    }
    expect(/\boption's effect on\b.*\bto\s+\d/.test(offer.chip.message)).toBe(false);

    const outcome = executeValueBatch({ proposal, currentGraph: graph });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);
    // ONE candidate, N operations — the definition of a single action.
    expect(outcome.operations).toHaveLength(membership.cells.length);

    // Every settable blocker cleared, read off the SAME producer.
    const after = outcome.assessmentAfter;
    expect(selectValueBatchMembership(after).cells).toHaveLength(0);
    expect(after.blockingIssues.length).toBeLessThan(beforeAssessment.blockingIssues.length);
    // Each approved value is genuinely in the graph, read through the reader
    // the readiness badge itself uses (trap 12 — one reader, one answer).
    for (const cell of writableCells(proposal)) {
      const node = outcome.appliedGraph.nodes.find((n) => n.id === cell.option_id) as
        | Record<string, unknown>
        | undefined;
      expect(mergeInterventionSources(node!)?.[cell.factor_id]).toBeCloseTo(cell.value);
    }
  });

  it('the batch introduces no NEW blocker — the unsettable gaps are exactly what remains', () => {
    const graph = zeroConfiguredGraph();
    const membership = selectValueBatchMembership(assess(graph));
    const outcome = executeValueBatch({
      proposal: proposalOrThrow(graph, fullEstimates(graph)),
      currentGraph: graph,
    });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);
    const remaining = selectValueBatchMembership(outcome.assessmentAfter);
    expect(remaining.unsettable.map((u) => u.option_id).sort()).toEqual(
      membership.unsettable.map((u) => u.option_id).sort(),
    );
  });
});

describe('readiness value batch — provenance survives the write', () => {
  /**
   * ⭐⭐⭐ THE GUARD THAT WAS RED AT PRISTINE `staging` (0142003d).
   *
   * `buildInterventionV3` stamped `source: 'user_specified'` unconditionally,
   * so an approved ESTIMATE became permanently indistinguishable from a figure
   * the USER stated. Measured at pristine through the full apply chain:
   *
   *   AssertionError: expected 'user_specified' to be 'cee_hypothesis'
   *
   * That is the difference between "the product suggested 0.4 and I agreed"
   * and "I said 0.4" — and it is the question every later review rests on.
   *
   * ⚠ Written against the CHAIN, not against the module under test, so it
   * cannot pass by agreeing with its own helper.
   */
  it('an AI estimate reads back as cee_hypothesis, not user_specified', () => {
    const graph = zeroConfiguredGraph();
    const cell = selectValueBatchMembership(assess(graph)).cells[0]!;
    const operations = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
            value: {
              value: 0.4,
              source: VALUE_BATCH_INTERVENTION_SOURCE,
              value_confidence: 'low',
              reasoning: 'Reviewed estimate.',
            },
            old_value: null,
            impact: 'moderate',
            rationale: 'estimate',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: null,
      }),
    ).operations as PatchOperation[];
    const applied = applyPatchOperations(GraphV3.parse(graph), operations);
    const { graph: encoded } = encodeOptionInterventionsForEdit(
      applied,
      new Set([cell.option_id]),
    );
    const node = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === cell.option_id,
    )!;
    const stored = (node.interventions as Record<string, Record<string, unknown>>)[cell.factor_id]!;
    expect(stored.source).toBe('cee_hypothesis');
    expect(stored.value_confidence).toBe('low');
    expect(stored.reasoning).toBe('Reviewed estimate.');
  });

  it('a value with NO stated provenance still defaults to user_specified — the existing contract is unchanged', () => {
    // The control for the guard above. If the default had moved, every
    // pre-existing writer's provenance would have changed silently.
    const graph = zeroConfiguredGraph();
    const cell = selectValueBatchMembership(assess(graph)).cells[0]!;
    const operations = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
            value: { value: 0.4 },
            old_value: null,
            impact: 'moderate',
            rationale: 'user value',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: null,
      }),
    ).operations as PatchOperation[];
    const applied = applyPatchOperations(GraphV3.parse(graph), operations);
    const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([cell.option_id]));
    const node = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === cell.option_id,
    )!;
    const stored = (node.interventions as Record<string, Record<string, unknown>>)[cell.factor_id]!;
    expect(stored.source).toBe('user_specified');
  });

  it('an UNRECOGNISED source cannot be smuggled in, and cannot claim user authorship', () => {
    // The allowlist holds only NON-user provenances, so this carry can narrow a
    // claim but never widen it. A junk value falls through to the default.
    const graph = zeroConfiguredGraph();
    const cell = selectValueBatchMembership(assess(graph)).cells[0]!;
    const operations = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
            value: { value: 0.4, source: 'totally_made_up', value_confidence: 'high' },
            old_value: null,
            impact: 'moderate',
            rationale: 'junk',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: null,
      }),
    ).operations as PatchOperation[];
    const applied = applyPatchOperations(GraphV3.parse(graph), operations);
    const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([cell.option_id]));
    const node = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === cell.option_id,
    )!;
    const stored = (node.interventions as Record<string, Record<string, unknown>>)[cell.factor_id]!;
    expect(stored.source).toBe('user_specified');
    // The confidence rides ONLY with a preserved provenance, never on its own.
    expect(stored.value_confidence).toBeUndefined();
  });

  it('⭐ the applied batch marks every written cell as an estimate, permanently', () => {
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    const outcome = executeValueBatch({ proposal, currentGraph: graph });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);
    for (const cell of writableCells(proposal)) {
      const node = outcome.appliedGraph.nodes.find((n) => n.id === cell.option_id) as
        | Record<string, Record<string, Record<string, unknown>>>
        | undefined;
      const stored = node!.interventions[cell.factor_id]!;
      expect(stored.source).toBe(VALUE_BATCH_INTERVENTION_SOURCE);
      expect(stored.reasoning).toBe('Reviewed estimate.');
    }
  });
});

describe('readiness value batch — the mark survives persistence, and it changes the obligation', () => {
  /**
   * ⭐⭐ THE RELOAD HALF, WHICH THE FIRST REVISION OF THIS SUITE DID NOT PIN.
   *
   * `executeValueBatch` calls its mark "permanent — written into the graph, not
   * merely into the turn", and the guard above reads `outcome.appliedGraph` —
   * the IN-MEMORY return value. That is not the same claim. A mark is permanent
   * when it survives the write.
   *
   * ⚠ AND THERE IS A SECOND, UNRELATED STAMPER ON THAT PATH.
   * `normalise-option-interventions.ts` `freshInterventionV3` writes
   * `source: 'user_specified'` UNCONDITIONALLY and runs inside
   * `projectGraphForPersistence`. It is a no-op for this module's output only
   * because `encodeOptionInterventionsForEdit` deletes `data.interventions`
   * before it looks — an ORDERING, and nothing enforced it.
   *
   * If that ordering ever inverts, every AI estimate persists as
   * `user_specified`, which `obligation-provenance.ts` classes `user_stated`
   * and turns into `required`: the product would DEMAND the user answer for
   * numbers it invented, and attribute them to the user. Silently.
   *
   * This runs the real projection and goes RED the day that happens.
   */
  it('⭐ the mark survives the persistence projection, not just the turn', () => {
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    const outcome = executeValueBatch({ proposal, currentGraph: graph });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);

    const persisted = projectGraphForPersistence(outcome.appliedGraph, {}) as {
      nodes: Array<Record<string, unknown>>;
    };

    const written = writableCells(proposal);
    expect(written.length).toBeGreaterThan(0);
    for (const cell of written) {
      const node = persisted.nodes.find((n) => n.id === cell.option_id);
      expect(node, `option ${cell.option_id} survives persistence`).toBeDefined();
      const stored = (node!.interventions as Record<string, Record<string, unknown>>)[
        cell.factor_id
      ];
      // Reachability first: a missing entry would make the source assertion
      // pass-by-absence rather than by survival.
      expect(stored, `intervention ${cell.option_id}/${cell.factor_id} survives`).toBeDefined();
      expect(stored!.source).toBe(VALUE_BATCH_INTERVENTION_SOURCE);
      expect(stored!.value).toBe(0.4);
    }
  });

  /**
   * ⭐⭐ THE BEHAVIOUR THE STRING EXISTS FOR — asserted, not just the string.
   *
   * Every other provenance guard in this suite asserts the literal
   * `'cee_hypothesis'`. None asserts what it BUYS, so a tidy-up that collapsed
   * the allowlist would keep them all green while restoring the demand.
   *
   * The live chain is `analysis-ready-helper` → `classifyIssueObligation` →
   * `structureProvenanceOfEffect` → `classifyValueSource(entry.source)`. So this
   * PR silently changes obligation classification on the shared edit path:
   * before, every encoder-written value was `user_specified` → `user_stated` →
   * `required`; now a batch-written one is `ai_drafted` → `offered`.
   *
   * That is the entire point of the mark — the product may OFFER to fill a
   * number it invented and may never DEMAND that the user own it — and it is
   * pinned here with a DISCRIMINATING CONTROL rather than alone: the same issue,
   * the same graph, the same call, differing only in who wrote the value.
   */
  it('⭐ a batch-written value is ai_drafted/offered — and a user-written one is still user_stated/required', () => {
    const graph = zeroConfiguredGraph();
    const assessment = assess(graph);
    const cell = selectValueBatchMembership(assessment).cells[0]!;

    // The real issue from the producer, not a hand-built one — so the category
    // and code are the ones the live path classifies.
    const issue = assessment.blockingIssues.find(
      (i) => i.option_id === cell.option_id && i.factor_id === cell.factor_id,
    );
    expect(issue, 'the producer really raises this cell as a blocker').toBeDefined();

    // Precondition, in-test: before either write, this cell is unattributed —
    // so neither arm below can pass on state that was already there.
    expect(classifyIssueObligation(issue!, graph).provenance).toBe('unattributed');

    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    const outcome = executeValueBatch({ proposal, currentGraph: graph });
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.reason}`);

    const aiDecision = classifyIssueObligation(issue!, outcome.appliedGraph);
    expect(aiDecision.provenance).toBe('ai_drafted');
    expect(aiDecision.obligation).toBe('offered');

    // ⭐ THE CONTROL. Identical call, identical issue, identical graph shape —
    // the ONLY difference is that the user stated this value. If it did not
    // come back `required`, the arm above would be agreeing with itself.
    const userGraph = structuredClone(graph);
    const userNode = userGraph.nodes.find((n) => n.id === cell.option_id)!;
    userNode.interventions = {
      [cell.factor_id]: {
        value: 0.4,
        source: 'user_specified',
        target_match: { node_id: cell.factor_id, match_type: 'exact_id', confidence: 'high' },
      },
    };
    const userDecision = classifyIssueObligation(issue!, userGraph);
    expect(userDecision.provenance).toBe('user_stated');
    expect(userDecision.obligation).toBe('required');
  });

  /**
   * ⭐ THE ALLOWLIST'S INVARIANT, DERIVED FROM THE AUTHORITY RATHER THAN RESTATED.
   *
   * `PRESERVED_INTERVENTION_SOURCES` may only ever hold provenances the estate
   * classes as NOT the user's. An earlier revision of this PR also allowlisted
   * `brief_extraction` under a comment calling it one of "the two NON-user
   * provenances" — but `obligation-provenance.ts` maps it to `user_stated`,
   * the SAME class as `user_specified`, and `obligationFor('user_stated')` is
   * `required`.
   *
   * This reads the mapping out of the authority at test time, so it goes RED if
   * anyone re-adds a user provenance to the carry — including by a rename.
   */
  it('⭐ every preserved source is a NON-user provenance, checked against the authority', () => {
    expect(PRESERVED_INTERVENTION_SOURCES.size).toBeGreaterThan(0);
    for (const source of PRESERVED_INTERVENTION_SOURCES) {
      expect(classifyValueSource(source), `${source} must not be a user provenance`)
        .not.toBe('user_stated');
    }
    // CONTRAST CONTROL: the authority really does discriminate, so a green
    // result above is a fact about the allowlist and not about a probe that
    // returns the same answer for every input.
    expect(classifyValueSource('user_specified')).toBe('user_stated');
    expect(classifyValueSource('brief_extraction')).toBe('user_stated');
    expect(classifyValueSource('cee_hypothesis')).toBe('ai_drafted');
    // And the consequence, stated where it bites.
    expect(obligationFor('user_stated')).toBe('required');
    expect(obligationFor('ai_drafted')).toBe('offered');
  });

  it('a brief_extraction record is NOT carried — it defaults exactly as it did before this PR', () => {
    // Not a regression: `brief_extraction` and the `user_specified` default are
    // the same `user_stated` class, so the obligation is unchanged either way.
    // What the removal buys is that the live edit path gains no new way to
    // persist a "we read this in your brief" stamp the product wrote itself.
    const graph = zeroConfiguredGraph();
    const cell = selectValueBatchMembership(assess(graph)).cells[0]!;
    const operations = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${cell.option_id}/data/interventions/${cell.factor_id}`,
            value: { value: 0.4, source: 'brief_extraction', value_confidence: 'high' },
            old_value: null,
            impact: 'moderate',
            rationale: 'brief',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: null,
      }),
    ).operations as PatchOperation[];
    const applied = applyPatchOperations(GraphV3.parse(graph), operations);
    const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([cell.option_id]));
    const node = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === cell.option_id,
    )!;
    const stored = (node.interventions as Record<string, Record<string, unknown>>)[cell.factor_id]!;
    expect(stored.source).toBe('user_specified');
    expect(stored.value_confidence).toBeUndefined();
  });
});

describe('readiness value batch — an all-declined set is a RESULT, not silence', () => {
  /**
   * ⭐⭐ THE WITNESSED HARM'S SHAPE, ARRIVING THROUGH A NEW DOOR.
   *
   * The module refuses a SILENT decline at compose time
   * (`declined_without_reason`) — and then, when EVERY cell declined,
   * `buildValueBatchOffer` returned a bare `null`, throwing the reasons and the
   * `unsettable` list away together. The user asks a fifth time, the model
   * declines all of them with good reasons, and the product shows nothing.
   *
   * The outcome is discriminated so those reasons can reach a surface. There is
   * still no chip, because there is still nothing to approve.
   */
  it('⭐ every cell declined ⇒ no_writable carrying the reasons, never a bare absence', () => {
    const graph = zeroConfiguredGraph();
    const declined = fullEstimates(graph).map((estimate) => ({
      option_id: estimate.option_id,
      factor_id: estimate.factor_id,
      value: null,
      declined_reason: 'No evidence in the brief to base this on.',
    })) as ValueBatchEstimate[];
    const proposal = proposalOrThrow(graph, declined);
    // Precondition in-test: this really is the all-declined case.
    expect(writableCells(proposal)).toHaveLength(0);
    expect(proposal.cells.length).toBeGreaterThan(0);

    const outcome = buildValueBatchOffer({
      proposal,
      currentGraphHash: 'hash-a',
      scenarioId: 'scn-value-batch',
    });

    expect(outcome.kind).toBe('no_writable');
    if (outcome.kind !== 'no_writable') throw new Error('expected no_writable');
    // The reasons survive — this is the whole point of not returning null.
    expect(outcome.proposal.cells.length).toBe(proposal.cells.length);
    expect(outcome.proposal.cells.every((c) => typeof c.declined_reason === 'string'
      && c.declined_reason.length > 0)).toBe(true);
    // And so do the gaps we could never have estimated.
    expect(outcome.proposal.unsettable.length).toBeGreaterThan(0);
  });

  it('CONTROL — a writable set still produces an offer, so the discriminant is real', () => {
    // Without this, the arm above would pass on a function that returned
    // `no_writable` unconditionally.
    const graph = zeroConfiguredGraph();
    const proposal = proposalOrThrow(graph, fullEstimates(graph));
    expect(writableCells(proposal).length).toBeGreaterThan(0);
    const outcome = buildValueBatchOffer({
      proposal,
      currentGraphHash: 'hash-a',
      scenarioId: 'scn-value-batch',
    });
    expect(outcome.kind).toBe('offer');
  });
});
