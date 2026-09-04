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
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
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
    const expectedSettable = answerable
      .filter((i) => typeof i.factor_id === 'string' && i.factor_id.length > 0)
      .map((i) => i.issue_id);
    const expectedUnsettable = answerable
      .filter((i) => !(typeof i.factor_id === 'string' && i.factor_id.length > 0))
      .map((i) => i.issue_id);

    expect(membership.cells.map((c) => c.issue_id)).toEqual(expectedSettable);
    expect(membership.unsettable.map((u) => u.issue_id)).toEqual(expectedUnsettable);
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
    moved.edges = moved.edges.filter((e) => e.source !== optionId && e.target !== optionId);
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
    const offer = buildValueBatchOffer({
      proposal,
      currentGraphHash: 'hash-a',
      scenarioId: 'scn-value-batch',
    });
    expect(offer).not.toBeNull();
    expect(offer!.pending.action.kind).toBe('apply_proposed_change');
    expect(
      (offer!.pending.action.inline_patch as Record<string, unknown>).handler_id,
    ).toBe(READINESS_VALUE_BATCH_HANDLER_ID);
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
    const chipText = `${offer!.chip.label} ${offer!.chip.message}`;
    for (const cell of writableCells(proposal)) {
      expect(chipText.includes(String(cell.value))).toBe(false);
    }
    expect(/\boption's effect on\b.*\bto\s+\d/.test(offer!.chip.message)).toBe(false);

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
