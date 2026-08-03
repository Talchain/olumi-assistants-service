/**
 * ROADMAP 2.380 — APPLIER ↔ REFEREE PARITY on tunable field writes.
 *
 * ⭐ THE ABSENCE OF THIS FILE IS THE ROOT CAUSE OF THE DEFECT IT PINS.
 *
 * Live defect (L52 diagnosis, `diagnosis-edit-lane-2026-08-04.md`, 0/15 live
 * edge-strength edits): the LIVE applier (`orchestrator/patch-applier.ts`,
 * hardened 2026-05-12 `85a18f52`) MERGES a partial `{strength:{mean}}` write
 * over the existing `{mean, std}`, while the referee's candidate builder
 * (`graph-management/candidate-graph.ts` `setTunableFieldPath`) REPLACED the
 * whole object — dropping the REQUIRED `std`, failing the post-mutation
 * `GraphV3.parse`, and returning `GRAPH_INVARIANT_VIOLATED`. Because
 * `referee.ts` `advanceBatchGraph` ADOPTS a built candidate as the applied
 * view for tunable mutations, that rebuild OVERWRITES the applier's correct
 * result — the live gate then discarded an edit that had already been
 * computed correctly.
 *
 * Two independent guards ship here, and NEITHER supersedes the other
 * (CLAUDE.md trap 12d):
 *   - DERIVED: the required-nested field set comes from the canonical Zod
 *     schema (`EdgeV3`), not a hand-copied literal, so a future required
 *     nested object is covered without anyone remembering to add it. A
 *     derived guard proves the two paths AGREE.
 *   - CORPUS: hand-written real-world write shapes (including the exact live
 *     `w5` failure payload). A corpus is what notices the derived LIST is
 *     short — derivation is structurally blind to a missing member.
 *
 * Every assertion binds to its edge by IDENTITY (the exact from→to pair),
 * never by a value predicate another edge could satisfy (trap 19). Sibling
 * edges deliberately carry DIFFERENT strengths so a wrong-edge match cannot
 * pass.
 *
 * The referee side is driven through the REAL producer projection
 * (`editOperationsToCandidateEnvelopes`), not a hand-written payload, so the
 * test binds to the live wire shape rather than to my reading of it.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { applyPatchOperations, PatchApplyError } from '../../../orchestrator/patch-applier.js';
import {
  EDGE_REQUIRED_NESTED_FIELDS,
  NODE_REQUIRED_NESTED_FIELDS,
  mergeRequiredNestedWrite,
  requiredNestedMemberNames,
  requiredNestedObjectFields,
} from '../../../schemas/required-nested-merge.js';
import { EdgeV3 } from '../../../schemas/cee-v3.js';
import { editOperationsToCandidateEnvelopes } from '../adapters/edit-graph-producer.js';
import { buildUpdateEdgeFieldCandidate, type UpdateEdgeFieldPayload } from '../candidate-graph.js';
import { GRAPH_INVARIANT_VIOLATED, CANDIDATE_BUILD_FAILED } from '../reason-codes.js';
import { GraphV3, type GraphV3T, type EdgeV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Fixture — mirrors the live scenario shape from the L52 probe (`run2`/`w5`).
// Sibling edges carry DISTINCT strengths so identity binding is load-bearing:
// an assertion that matched the wrong edge would read a different std.
// ---------------------------------------------------------------------------

const TARGET_FROM = 'fac_churn_rate';
const TARGET_TO = 'fac_churn_risk';
/** A sibling FROM the same source — catches a from-only match. */
const SIBLING_FROM = 'fac_churn_rate';
const SIBLING_TO = 'goal_revenue';

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_growth', kind: 'decision', label: 'Growth plan' },
      { id: 'opt_content', kind: 'option', label: 'Invest in content' },
      { id: 'fac_churn_rate', kind: 'factor', label: 'Customer Churn Rate' },
      { id: 'fac_churn_risk', kind: 'factor', label: 'Churn Acceleration Risk' },
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue Growth' },
    ],
    edges: [
      // THE TARGET. std 0.12 is the value the defect dropped.
      {
        from: TARGET_FROM,
        to: TARGET_TO,
        strength: { mean: 0.55, std: 0.12 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      // Sibling from the SAME source node, deliberately different std.
      {
        from: SIBLING_FROM,
        to: SIBLING_TO,
        strength: { mean: -0.4, std: 0.07 },
        exists_probability: 0.85,
        effect_direction: 'negative',
      },
      {
        from: 'opt_content',
        to: 'fac_churn_rate',
        strength: { mean: 0.3, std: 0.2 },
        exists_probability: 0.8,
        effect_direction: 'positive',
      },
      {
        from: 'dec_growth',
        to: 'opt_content',
        strength: { mean: 1, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

/** The fixture must be a valid GraphV3 or the referee's ingress parse, not the
 *  defect, would be what these tests measure (a false RED). */
it('fixture control: the base graph is a valid GraphV3 (so a failure is the mutation, not the ingress)', () => {
  expect(GraphV3.safeParse(makeGraph()).success).toBe(true);
});

/** Find an edge by IDENTITY. Throws rather than returning undefined so a
 *  missing edge can never silently satisfy a `toEqual(undefined)`. */
function edgeByIdentity(graph: unknown, from: string, to: string): EdgeV3T {
  const edges = (graph as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) throw new Error('graph has no edges array');
  const found = edges.filter(
    (e) => (e as EdgeV3T).from === from && (e as EdgeV3T).to === to,
  ) as EdgeV3T[];
  if (found.length !== 1) {
    throw new Error(`expected exactly 1 edge ${from}->${to}, found ${found.length}`);
  }
  return found[0]!;
}

/** Project a patch op through the REAL producer and return EVERY
 *  `update_edge_field` payload it fans out to, in order. Binds the test to the
 *  live projection instead of a hand-written envelope.
 *
 *  ⚠ A multi-field `update_edge` projects to ONE ENVELOPE PER FIELD
 *  (`edit-graph-producer.ts`: "a multi-field update_node / update_edge fans out
 *  into one envelope PER FIELD"). An earlier version of this test fed the
 *  referee only the `strength` envelope and compared against an applier run
 *  that had applied the WHOLE op — so it reported a parity break that was the
 *  test's own omission. Fold them all, which is what the referee itself does. */
function projectedPayloads(op: PatchOperation): UpdateEdgeFieldPayload[] {
  let n = 0;
  const envelopes = editOperationsToCandidateEnvelopes([op], {
    base_graph_hash: 'hash-under-test',
    scenario_id: 'scn-l53',
    turn_id: 'turn-l53',
    makeCandidateId: () => `0000000${n++}-0000-4000-8000-000000000000`,
  }) as { kind: string; payload: UpdateEdgeFieldPayload }[];
  const matching = envelopes.filter((e) => e.kind === 'update_edge_field');
  if (matching.length !== Object.keys(op.value as Record<string, unknown>).length) {
    throw new Error(
      `producer fan-out changed: ${matching.length} envelopes for ${Object.keys(op.value as Record<string, unknown>).length} fields`,
    );
  }
  return matching.map((e) => e.payload);
}

/** Exactly one payload, for the single-field cases. */
function projectedPayload(op: PatchOperation, field: string): UpdateEdgeFieldPayload {
  const matching = projectedPayloads(op).filter((p) => p.field === field);
  if (matching.length !== 1) {
    throw new Error(
      `expected exactly 1 update_edge_field envelope for '${field}', got ${matching.length}`,
    );
  }
  return matching[0]!;
}

/**
 * Run EVERY projected envelope through the referee's candidate builder in
 * order, feeding each candidate forward as the next base — which is exactly
 * `referee.ts` `advanceBatchGraph`'s rule for tunable mutations ("a built
 * candidate … IS the applied view — adopt it"). This is the referee-side
 * equivalent of one `applyPatchOperations` call.
 */
function refereeApplyAll(
  graph: GraphV3T,
  op: PatchOperation,
): { graph: unknown; error?: { code: string } } {
  let working: unknown = graph;
  for (const payload of projectedPayloads(op)) {
    const result = buildUpdateEdgeFieldCandidate(working, payload);
    if (result.error) return { graph: working, error: result.error };
    working = result.candidate;
  }
  return { graph: working };
}

const targetPath = `${TARGET_FROM}::${TARGET_TO}`;

// ---------------------------------------------------------------------------
// (a) The candidate builder must PRESERVE `std` on a partial strength write.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.380 (a) — referee candidate preserves required nested members', () => {
  it('partial {strength:{mean:0.8}} on an edge with std present: candidate parses and std is preserved', () => {
    const graph = makeGraph();
    const payload = projectedPayload(
      { op: 'update_edge', path: targetPath, value: { strength: { mean: 0.8 } } },
      'strength',
    );
    // The producer must have resolved the identity, or this test is measuring
    // the wrong thing.
    expect(payload.from_node).toBe(TARGET_FROM);
    expect(payload.to_node).toBe(TARGET_TO);

    const result = buildUpdateEdgeFieldCandidate(graph, payload);

    expect(result.error).toBeUndefined();
    expect(result.candidate).toBeDefined();
    // The candidate is the applied view — it MUST be a valid GraphV3.
    expect(GraphV3.safeParse(result.candidate).success).toBe(true);

    const edge = edgeByIdentity(result.candidate, TARGET_FROM, TARGET_TO);
    expect(edge.strength).toEqual({ mean: 0.8, std: 0.12 });
  });

  it('the sibling edge from the SAME source node is untouched (identity binding is real)', () => {
    const graph = makeGraph();
    const payload = projectedPayload(
      { op: 'update_edge', path: targetPath, value: { strength: { mean: 0.8 } } },
      'strength',
    );
    const result = buildUpdateEdgeFieldCandidate(graph, payload);
    expect(result.candidate).toBeDefined();

    const sibling = edgeByIdentity(result.candidate, SIBLING_FROM, SIBLING_TO);
    expect(sibling.strength).toEqual({ mean: -0.4, std: 0.07 });
  });

  it('a FULL {mean, std} write still replaces both members (the fix is not a blanket loosening)', () => {
    const graph = makeGraph();
    const payload = projectedPayload(
      { op: 'update_edge', path: targetPath, value: { strength: { mean: 0.95, std: 0.02 } } },
      'strength',
    );
    const result = buildUpdateEdgeFieldCandidate(graph, payload);

    expect(result.error).toBeUndefined();
    const edge = edgeByIdentity(result.candidate, TARGET_FROM, TARGET_TO);
    expect(edge.strength).toEqual({ mean: 0.95, std: 0.02 });
  });

  it('the input graph is never mutated by the candidate build', () => {
    const graph = makeGraph();
    const snapshot = structuredClone(graph);
    const payload = projectedPayload(
      { op: 'update_edge', path: targetPath, value: { strength: { mean: 0.8 } } },
      'strength',
    );
    buildUpdateEdgeFieldCandidate(graph, payload);
    expect(graph).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// (b) ⭐ THE PARITY GUARD — the test whose absence caused the defect.
//
// CORPUS (trap 12d): hand-written real-world write shapes. Derivation over the
// schema proves the two paths agree on the fields the schema declares; only a
// corpus notices a shape nobody thought to declare.
// ---------------------------------------------------------------------------

interface ParityCase {
  readonly label: string;
  readonly value: Record<string, unknown>;
  /** The field whose envelope carries the parity-relevant write. */
  readonly field: string;
}

const PARITY_CORPUS: readonly ParityCase[] = [
  // The EXACT live failure payload from the L52 walk (`w5`) and `run2`.
  { label: 'partial {mean} only — the live w5 payload', value: { strength: { mean: 0.8 } }, field: 'strength' },
  { label: 'partial {std} only', value: { strength: { std: 0.05 } }, field: 'strength' },
  { label: 'full {mean, std}', value: { strength: { mean: 0.95, std: 0.02 } }, field: 'strength' },
  { label: 'negative mean (sign flip)', value: { strength: { mean: -0.6 } }, field: 'strength' },
  { label: 'boundary mean = 1', value: { strength: { mean: 1 } }, field: 'strength' },
  { label: 'boundary mean = -1', value: { strength: { mean: -1 } }, field: 'strength' },
  { label: 'mean = 0', value: { strength: { mean: 0 } }, field: 'strength' },
  // The applier's own documented staging shape: strength partial + a scalar sibling.
  {
    label: 'compound: partial {mean} alongside a scalar field',
    value: { strength: { mean: 0.28 }, exists_probability: 0.88 },
    field: 'strength',
  },
  // A scalar-only write must ALSO agree — and must leave strength alone.
  { label: 'scalar-only: exists_probability', value: { exists_probability: 0.5 }, field: 'exists_probability' },
  { label: 'scalar-only: effect_direction', value: { effect_direction: 'negative' }, field: 'effect_direction' },
];

describe('ROADMAP 2.380 (b) ⭐ — applier ↔ referee parity on the SAME operation', () => {
  it.each(PARITY_CORPUS)(
    'produces a byte-equal target edge through both paths: $label',
    ({ value }) => {
      const op: PatchOperation = { op: 'update_edge', path: targetPath, value };

      // Path A — the LIVE applier.
      const applied = applyPatchOperations(makeGraph(), [op]);
      const applierEdge = edgeByIdentity(applied, TARGET_FROM, TARGET_TO);

      // Path B — the REFEREE, through the real producer projection, folded in
      // the same order `advanceBatchGraph` folds it.
      const result = refereeApplyAll(makeGraph(), op);
      expect(result.error).toBeUndefined();
      const refereeEdge = edgeByIdentity(result.graph, TARGET_FROM, TARGET_TO);

      // Byte-equal. This is the guarantee whose absence let the two drift.
      expect(refereeEdge).toEqual(applierEdge);
      // ...and the referee's own view must be schema-valid, since it is ADOPTED
      // as the applied view (referee.ts advanceBatchGraph).
      expect(GraphV3.safeParse(result.graph).success).toBe(true);
    },
  );

  it.each(PARITY_CORPUS)('leaves the sibling edge byte-equal through both paths: $label', ({ value }) => {
    const op: PatchOperation = { op: 'update_edge', path: targetPath, value };
    const applied = applyPatchOperations(makeGraph(), [op]);
    const result = refereeApplyAll(makeGraph(), op);
    expect(result.error).toBeUndefined();
    expect(edgeByIdentity(result.graph, SIBLING_FROM, SIBLING_TO)).toEqual(
      edgeByIdentity(applied, SIBLING_FROM, SIBLING_TO),
    );
  });

  it('the whole edges array is byte-equal through both paths (not just the two edges asserted above)', () => {
    // Scope widener: the per-edge assertions above could miss a divergence on
    // an edge neither test names. This one has no such blind spot.
    for (const { value } of PARITY_CORPUS) {
      const op: PatchOperation = { op: 'update_edge', path: targetPath, value };
      const applied = applyPatchOperations(makeGraph(), [op]);
      const result = refereeApplyAll(makeGraph(), op);
      expect(result.error).toBeUndefined();
      expect((result.graph as GraphV3T).edges).toEqual(applied.edges);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) NEGATIVE CONTROL — a malformed strength payload is STILL refused, and
// with a reason that names the producer fault rather than blaming the schema.
//
// Direction matters: the fix must not become "merge anything". A non-object
// strength is incoherent (the applier says so explicitly, patch-applier.ts:186)
// and must not be silently absorbed.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.380 (d) — malformed strength is still refused, precisely', () => {
  const MALFORMED: readonly [string, unknown][] = [
    ['null', null],
    ['array', []],
    ['string', 'very strong'],
    ['bare number', 0.8],
    ['boolean', true],
  ];

  it.each(MALFORMED)('referee refuses strength=%s without claiming a schema violation', (_label, bad) => {
    const graph = makeGraph();
    const payload = projectedPayload(
      { op: 'update_edge', path: targetPath, value: { strength: bad } },
      'strength',
    );
    const result = buildUpdateEdgeFieldCandidate(graph, payload);

    // Refused: no candidate is produced.
    expect(result.candidate).toBeUndefined();
    expect(result.error).toBeDefined();
    // PRECISION: the fault is the PRODUCER's payload, not the graph's schema.
    // GRAPH_INVARIANT_VIOLATED sent every reader to the wrong file for a month.
    expect(result.error!.code).toBe(CANDIDATE_BUILD_FAILED);
    expect(result.error!.code).not.toBe(GRAPH_INVARIANT_VIOLATED);
  });

  it.each(MALFORMED)('applier ALSO refuses strength=%s (both paths agree on the refusal)', (_label, bad) => {
    expect(() =>
      applyPatchOperations(makeGraph(), [
        { op: 'update_edge', path: targetPath, value: { strength: bad } },
      ]),
    ).toThrow(PatchApplyError);
  });
});

// ---------------------------------------------------------------------------
// DERIVATION GUARDS — the OTHER half of trap 12d.
//
// The corpus above proves the two writers agree on shapes a human thought of.
// These prove the SET they agree over is derived from the canonical schema
// rather than hand-copied, and — the union assertion — that no sibling holds a
// required nested field the canonical derivation has missed.
//
// Read the direction of each guard carefully: a derived guard is structurally
// BLIND to a member the schema itself omits, which is why it does not replace
// the corpus and the corpus does not replace it.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.380 — derivation guards over the required-nested field set', () => {
  it('the field set is DERIVED from EdgeV3, not hand-listed (every member is a required ZodObject)', () => {
    for (const field of EDGE_REQUIRED_NESTED_FIELDS) {
      const declared = EdgeV3.shape[field as keyof typeof EdgeV3.shape];
      expect(declared, `EdgeV3 declares no field '${field}'`).toBeDefined();
      expect(declared instanceof z.ZodObject, `EdgeV3.${field} is not a required ZodObject`).toBe(true);
    }
  });

  it('the derivation EXCLUDES optional object fields (the reason node edits never broke)', () => {
    // NodeV3's object-typed fields are all `.optional()`, so the node set is
    // empty. If this ever stops being true, the node write path needs the same
    // treatment and this guard is the thing that says so.
    expect([...NODE_REQUIRED_NESTED_FIELDS]).toEqual([]);
    // Positive control for the predicate itself: an optional ZodObject must not
    // be picked up, or "empty" above would prove nothing.
    const probe = z.object({
      required_obj: z.object({ a: z.number() }),
      optional_obj: z.object({ b: z.number() }).optional(),
      passthrough_optional: z.object({ c: z.number() }).passthrough().optional(),
      scalar: z.number(),
    });
    expect([...requiredNestedObjectFields(probe)]).toEqual(['required_obj']);
  });

  it('the set is non-empty for EdgeV3 — a derivation that silently returned {} would make every guard vacuous', () => {
    // Trap 13: an absence assertion must first prove it can see a presence.
    // If the predicate broke and returned an empty set, the merge would never
    // run and the parity corpus would go green by not exercising the branch.
    expect(EDGE_REQUIRED_NESTED_FIELDS.size).toBeGreaterThan(0);
    expect([...EDGE_REQUIRED_NESTED_FIELDS]).toContain('strength');
  });

  it('UNION ASSERTION — every required nested field the corpus exercises is in the derived set', () => {
    // Direction: canonical set ⊇ what the corpus writes. Catches a corpus that
    // has drifted onto a field the derivation no longer covers.
    const corpusNestedFields = new Set(
      PARITY_CORPUS.flatMap(({ value }) =>
        Object.entries(value)
          .filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v))
          .map(([k]) => k),
      ),
    );
    expect(corpusNestedFields.size).toBeGreaterThan(0);
    for (const field of corpusNestedFields) {
      expect(EDGE_REQUIRED_NESTED_FIELDS.has(field), `corpus writes '${field}', derived set does not cover it`).toBe(true);
    }
  });

  it('the refusal message names the schema-declared members rather than a restated literal', () => {
    expect(requiredNestedMemberNames(EdgeV3, 'strength')).toEqual(['mean', 'std']);
    // A field that is NOT a required nested object yields no members.
    expect(requiredNestedMemberNames(EdgeV3, 'exists_probability')).toEqual([]);
  });

  it('mergeRequiredNestedWrite: an explicit undefined member is a no-op, never a wipe', () => {
    expect(mergeRequiredNestedWrite({ mean: 0.55, std: 0.12 }, { mean: 0.8, std: undefined }))
      .toEqual({ mean: 0.8, std: 0.12 });
  });
});
